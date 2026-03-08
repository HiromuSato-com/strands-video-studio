"""
Video editing tools for the Strands Agent.
All file operations use S3 as the storage backend.
Temporary files are written to /tmp/ during processing.
"""

import os
import json
import uuid
import random
import logging
from pathlib import Path

import time

import boto3
from strands import tool

logger = logging.getLogger(__name__)

# Environment variables injected at Fargate task launch
S3_BUCKET = os.environ["S3_BUCKET"]
TASK_ID = os.environ["TASK_ID"]
LUMA_S3_BUCKET = os.environ.get("LUMA_S3_BUCKET", "")
NOVA_REEL_S3_BUCKET = os.environ.get("NOVA_REEL_S3_BUCKET", "")

s3 = boto3.client("s3")
# Luma AI Ray 2 is only available in us-west-2 (Oregon)
bedrock_luma = boto3.client("bedrock-runtime", region_name="us-west-2")
s3_luma = boto3.client("s3", region_name="us-west-2")
# Amazon Nova Reel, Stable Diffusion XL, and Claude Vision are available in us-east-1
bedrock_nova = boto3.client("bedrock-runtime", region_name="us-east-1")
s3_nova = boto3.client("s3", region_name="us-east-1")
polly = boto3.client("polly", region_name="ap-northeast-1")
transcribe = boto3.client("transcribe", region_name="ap-northeast-1")

# Tracks the most recent output S3 key produced by any tool call
_last_output_key: str | None = None


def get_last_output_key() -> str | None:
    return _last_output_key


def _download_from_s3(key: str, suffix: str = "") -> str:
    """Download a file from S3 to /tmp/ and return the local path."""
    local_path = f"/tmp/{uuid.uuid4().hex}{suffix}"
    s3.download_file(S3_BUCKET, key, local_path)
    logger.info(f"Downloaded s3://{S3_BUCKET}/{key} → {local_path}")
    return local_path


def _upload_to_s3(local_path: str, filename: str) -> str:
    """Upload a local file to S3 under tasks/{task_id}/output/ and return the S3 key."""
    global _last_output_key
    key = f"tasks/{TASK_ID}/output/{filename}"
    s3.upload_file(local_path, S3_BUCKET, key)
    _last_output_key = key
    logger.info(f"Uploaded {local_path} → s3://{S3_BUCKET}/{key}")
    return key


@tool
def list_files() -> str:
    """
    List all input files available for this task.
    Returns a JSON string with file metadata (key, size, filename).
    """
    prefix = f"tasks/{TASK_ID}/input/"
    response = s3.list_objects_v2(Bucket=S3_BUCKET, Prefix=prefix)
    files = []
    for obj in response.get("Contents", []):
        files.append(
            {
                "key": obj["Key"],
                "filename": Path(obj["Key"]).name,
                "size_bytes": obj["Size"],
            }
        )
    return json.dumps(files, ensure_ascii=False)


@tool
def trim_video(input_key: str, start_sec: float, end_sec: float) -> str:
    """
    Trim a video to the specified time range.

    Args:
        input_key: S3 key of the source video (e.g. "tasks/{task_id}/input/video.mp4")
        start_sec: Start time in seconds
        end_sec: End time in seconds

    Returns:
        S3 key of the trimmed output video
    """
    from moviepy import VideoFileClip

    suffix = Path(input_key).suffix or ".mp4"
    local_input = _download_from_s3(input_key, suffix)

    output_filename = f"trimmed_{Path(input_key).name}"
    local_output = f"/tmp/{uuid.uuid4().hex}{suffix}"

    try:
        with VideoFileClip(local_input) as clip:
            trimmed = clip.subclipped(start_sec, end_sec)
            trimmed.write_videofile(local_output, logger=None)

        output_key = _upload_to_s3(local_output, output_filename)
        return json.dumps({"output_key": output_key, "status": "success"})
    finally:
        for path in [local_input, local_output]:
            if os.path.exists(path):
                os.remove(path)


@tool
def insert_image(video_key: str, image_key: str, start_sec: float, end_sec: float) -> str:
    """
    Insert (overlay) an image into a video for a specified time range.
    The image is displayed as a full-frame overlay replacing the video frames.

    Args:
        video_key: S3 key of the source video
        image_key: S3 key of the image to insert
        start_sec: Start time in seconds where the image appears
        end_sec: End time in seconds where the image disappears

    Returns:
        S3 key of the output video with the image inserted
    """
    from moviepy import VideoFileClip, ImageClip, concatenate_videoclips

    video_suffix = Path(video_key).suffix or ".mp4"
    local_video = _download_from_s3(video_key, video_suffix)

    image_suffix = Path(image_key).suffix or ".jpg"
    local_image = _download_from_s3(image_key, image_suffix)

    output_filename = f"with_image_{Path(video_key).name}"
    local_output = f"/tmp/{uuid.uuid4().hex}{video_suffix}"

    try:
        with VideoFileClip(local_video) as video:
            duration = video.duration
            w, h = video.size

            # Build: [before] + [image clip] + [after]
            segments = []
            if start_sec > 0:
                segments.append(video.subclipped(0, start_sec))

            image_duration = end_sec - start_sec
            img_clip = (
                ImageClip(local_image)
                .resized((w, h))
                .with_duration(image_duration)
                .with_fps(video.fps)
            )
            segments.append(img_clip)

            if end_sec < duration:
                segments.append(video.subclipped(end_sec, duration))

            final = concatenate_videoclips(segments)
            final.write_videofile(local_output, logger=None)

        output_key = _upload_to_s3(local_output, output_filename)
        return json.dumps({"output_key": output_key, "status": "success"})
    finally:
        for path in [local_video, local_image, local_output]:
            if os.path.exists(path):
                os.remove(path)


@tool
def image_to_clip(image_key: str, duration_sec: float, fps: int = 24) -> str:
    """
    Convert a still image into a video clip of the specified duration.
    Use this to create slide-style videos: generate or upload an image, convert it
    to a clip, add text overlay, then concatenate multiple clips with transitions.

    Args:
        image_key: S3 key of the source image (JPG or PNG)
        duration_sec: Duration of the output video clip in seconds
        fps: Frames per second (default 24)

    Returns:
        S3 key of the output video clip (.mp4)
    """
    from moviepy import ImageClip

    image_suffix = Path(image_key).suffix or ".jpg"
    local_image = _download_from_s3(image_key, image_suffix)
    output_filename = f"clip_{Path(image_key).stem}.mp4"
    local_output = f"/tmp/{uuid.uuid4().hex}.mp4"

    try:
        clip = ImageClip(local_image).with_duration(duration_sec).with_fps(fps)
        clip.write_videofile(local_output, logger=None)
        output_key = _upload_to_s3(local_output, output_filename)
        return json.dumps({"output_key": output_key, "status": "success"})
    finally:
        for path in [local_image, local_output]:
            if os.path.exists(path):
                os.remove(path)


@tool
def concat_videos(input_keys: list[str]) -> str:
    """
    Concatenate multiple videos into a single output video.

    Args:
        input_keys: List of S3 keys of the videos to concatenate, in order

    Returns:
        S3 key of the concatenated output video
    """
    from moviepy import VideoFileClip, concatenate_videoclips

    local_paths = []
    for key in input_keys:
        suffix = Path(key).suffix or ".mp4"
        local_paths.append(_download_from_s3(key, suffix))

    output_filename = "concatenated.mp4"
    local_output = f"/tmp/{uuid.uuid4().hex}.mp4"

    try:
        clips = [VideoFileClip(p) for p in local_paths]
        final = concatenate_videoclips(clips)
        final.write_videofile(local_output, logger=None)
        for clip in clips:
            clip.close()

        output_key = _upload_to_s3(local_output, output_filename)
        return json.dumps({"output_key": output_key, "status": "success"})
    finally:
        for path in local_paths + [local_output]:
            if os.path.exists(path):
                os.remove(path)


@tool
def generate_video(
    prompt: str,
    duration: str = "5s",
    aspect_ratio: str = "16:9",
    resolution: str = "720p",
) -> str:
    """
    Generate a video from a text prompt using Luma AI Ray 2 on Amazon Bedrock (us-west-2).
    The generated video is copied to the main Tokyo S3 bucket.

    Args:
        prompt: Text description of the video to generate (1–5000 characters)
        duration: Video length — "5s" (default) or "9s"
        aspect_ratio: Aspect ratio — "16:9" (default), "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"
        resolution: Output resolution — "720p" (default) or "540p"

    Returns:
        S3 key of the generated output video (in the main Tokyo bucket)
    """
    if not LUMA_S3_BUCKET:
        return json.dumps({"status": "failed", "error": "LUMA_S3_BUCKET env var not set"})

    # Clamp to valid values ("5s" or "9s")
    if duration not in ("5s", "9s"):
        try:
            sec = float(duration.rstrip("s"))
        except ValueError:
            sec = 0
        duration = "9s" if sec >= 7 else "5s"
        logger.info(f"duration adjusted to {duration}")

    # Clamp resolution to valid values
    if resolution not in ("720p", "540p"):
        resolution = "720p"
        logger.info(f"resolution adjusted to 720p")

    # Clamp aspect_ratio to valid values
    valid_ratios = {"16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"}
    if aspect_ratio not in valid_ratios:
        aspect_ratio = "16:9"
        logger.info(f"aspect_ratio adjusted to 16:9")

    # Luma AI output must go to us-west-2 bucket (same region as the model)
    luma_output_prefix = f"s3://{LUMA_S3_BUCKET}/tasks/{TASK_ID}/output/"

    logger.info(
        f"Starting Luma AI video generation: prompt='{prompt[:80]}...' "
        f"duration={duration} aspect_ratio={aspect_ratio} resolution={resolution}"
    )

    try:
        response = bedrock_luma.start_async_invoke(
            modelId="luma.ray-v2:0",
            modelInput={
                "prompt": prompt,
                "duration": duration,
                "aspect_ratio": aspect_ratio,
                "resolution": resolution,
            },
            outputDataConfig={
                "s3OutputDataConfig": {"s3Uri": luma_output_prefix}
            },
        )
    except Exception as e:
        logger.error(f"start_async_invoke failed: {type(e).__name__}: {e}")
        return json.dumps({"status": "failed", "error": str(e)})

    invocation_arn = response["invocationArn"]
    logger.info(f"Bedrock async invoke started: {invocation_arn}")

    # Poll until completed or failed (timeout: 15 minutes)
    timeout_sec = 900
    poll_interval = 15
    elapsed = 0
    while elapsed < timeout_sec:
        time.sleep(poll_interval)
        elapsed += poll_interval
        status_resp = bedrock_luma.get_async_invoke(invocationArn=invocation_arn)
        status = status_resp["status"]
        logger.info(f"Bedrock job status: {status} (elapsed {elapsed}s)")
        if status == "Completed":
            break
        if status == "Failed":
            failure = status_resp.get("failureMessage", "unknown error")
            return json.dumps({"status": "failed", "error": failure})
    else:
        return json.dumps({"status": "failed", "error": "Timeout waiting for video generation"})

    # Bedrock saves output under {prefix}{invocation_id}/output.mp4
    invocation_id = invocation_arn.split("/")[-1]
    luma_key = f"tasks/{TASK_ID}/output/{invocation_id}/output.mp4"

    # Download from Oregon (us-west-2) and re-upload to Tokyo (ap-northeast-1)
    local_output = f"/tmp/{uuid.uuid4().hex}.mp4"
    try:
        logger.info(f"Downloading from Oregon bucket: s3://{LUMA_S3_BUCKET}/{luma_key}")
        s3_luma.download_file(LUMA_S3_BUCKET, luma_key, local_output)
        output_key = _upload_to_s3(local_output, "generated.mp4")
    finally:
        if os.path.exists(local_output):
            os.remove(local_output)

    logger.info(f"Video generation complete. Copied to Tokyo: {output_key}")
    return json.dumps({"output_key": output_key, "status": "success"})


@tool
def generate_video_nova_reel(
    prompt: str,
    duration_sec: int = 6,
) -> str:
    """
    Generate a video from a text prompt using Amazon Nova Reel on Amazon Bedrock (us-east-1).
    Output resolution is fixed at 1280x720 (16:9). Supports up to 6 seconds.

    Args:
        prompt: Text description of the video to generate (up to 512 characters)
        duration_sec: Video length in seconds (1-6, default 6)

    Returns:
        S3 key of the generated output video (in the main Tokyo bucket)
    """
    if not NOVA_REEL_S3_BUCKET:
        return json.dumps({"status": "failed", "error": "NOVA_REEL_S3_BUCKET env var not set"})

    # Clamp duration to valid range
    duration_sec = max(1, min(6, int(duration_sec)))

    # Nova Reel output must go to us-east-1 bucket (same region as the model)
    nova_output_prefix = f"s3://{NOVA_REEL_S3_BUCKET}/tasks/{TASK_ID}/output/"

    logger.info(
        f"Starting Nova Reel video generation: prompt='{prompt[:80]}' duration={duration_sec}s"
    )

    try:
        response = bedrock_nova.start_async_invoke(
            modelId="amazon.nova-reel-v1:0",
            modelInput={
                "taskType": "TEXT_VIDEO",
                "textToVideoParams": {"text": prompt},
                "videoGenerationConfig": {
                    "durationSeconds": duration_sec,
                    "fps": 24,
                    "dimension": "1280x720",
                    "seed": random.randint(0, 2147483647),
                },
            },
            outputDataConfig={
                "s3OutputDataConfig": {"s3Uri": nova_output_prefix}
            },
        )
    except Exception as e:
        logger.error(f"Nova Reel start_async_invoke failed: {type(e).__name__}: {e}")
        return json.dumps({"status": "failed", "error": str(e)})

    invocation_arn = response["invocationArn"]
    logger.info(f"Nova Reel async invoke started: {invocation_arn}")

    # Poll until completed or failed (timeout: 15 minutes)
    timeout_sec = 900
    poll_interval = 15
    elapsed = 0
    while elapsed < timeout_sec:
        time.sleep(poll_interval)
        elapsed += poll_interval
        status_resp = bedrock_nova.get_async_invoke(invocationArn=invocation_arn)
        status = status_resp["status"]
        logger.info(f"Nova Reel job status: {status} (elapsed {elapsed}s)")
        if status == "Completed":
            break
        if status == "Failed":
            failure = status_resp.get("failureMessage", "unknown error")
            return json.dumps({"status": "failed", "error": failure})
    else:
        return json.dumps({"status": "failed", "error": "Timeout waiting for Nova Reel video generation"})

    # Nova Reel writes output to {prefix}{invocation_id}/output.mp4
    invocation_id = invocation_arn.split("/")[-1]
    nova_key = f"tasks/{TASK_ID}/output/{invocation_id}/output.mp4"

    # Download from N. Virginia (us-east-1) and re-upload to Tokyo (ap-northeast-1)
    local_output = f"/tmp/{uuid.uuid4().hex}.mp4"
    try:
        logger.info(f"Downloading from N. Virginia bucket: s3://{NOVA_REEL_S3_BUCKET}/{nova_key}")
        s3_nova.download_file(NOVA_REEL_S3_BUCKET, nova_key, local_output)
        output_key = _upload_to_s3(local_output, "nova_generated.mp4")
    finally:
        if os.path.exists(local_output):
            os.remove(local_output)

    logger.info(f"Nova Reel generation complete. Copied to Tokyo: {output_key}")
    return json.dumps({"output_key": output_key, "status": "success"})


# ─── MoviePy 拡張ツール群 ──────────────────────────────────────────────────────


@tool
def add_text(
    video_key: str,
    text: str,
    start_sec: float,
    end_sec: float,
    position: str = "bottom",
    font_size: int = 40,
    color: str = "white",
) -> str:
    """
    Overlay text (subtitles/captions) onto a video for the specified time range.
    Supports Japanese text with CJK fonts installed in the container.

    Args:
        video_key: S3 key of the source video
        text: Text to display (supports Japanese/Chinese characters)
        start_sec: Start time in seconds when text appears
        end_sec: End time in seconds when text disappears
        position: Text position — "top", "center", or "bottom" (default "bottom")
        font_size: Font size in pixels (default 40)
        color: Text color name or hex string (default "white")

    Returns:
        S3 key of the output video with text overlay
    """
    import glob as glob_module
    from moviepy import VideoFileClip, TextClip, CompositeVideoClip

    suffix = Path(video_key).suffix or ".mp4"
    local_input = _download_from_s3(video_key, suffix)
    output_filename = f"text_{Path(video_key).name}"
    local_output = f"/tmp/{uuid.uuid4().hex}{suffix}"

    # Locate a Japanese-capable font.
    # Priority: IPA P Gothic (.ttf) → IPA Gothic (.ttf) → Noto CJK (.ttc/.otf) → any font
    # IPA fonts are standard .ttf files that PIL/MoviePy handles reliably for Japanese.
    font_path = None
    for pattern in [
        "/usr/share/fonts/**/*ipagp*.ttf",   # IPA P Gothic (Japanese, sans-serif)
        "/usr/share/fonts/**/*ipag*.ttf",    # IPA Gothic (Japanese, sans-serif)
        "/usr/share/fonts/**/*CJK*Regular*.ttc",
        "/usr/share/fonts/**/*Noto*CJK*.ttc",
        "/usr/share/fonts/**/*CJK*Regular*.otf",
        "/usr/share/fonts/**/*Noto*CJK*.otf",
        "/usr/share/fonts/**/*.ttf",
        "/usr/share/fonts/**/*.otf",
        "/usr/share/fonts/**/*.ttc",
    ]:
        matches = glob_module.glob(pattern, recursive=True)
        if matches:
            font_path = matches[0]
            break

    pos_map = {
        "top": ("center", 0.05),
        "center": ("center", 0.45),
        "bottom": ("center", 0.85),
    }
    pos = pos_map.get(position, ("center", 0.85))

    try:
        with VideoFileClip(local_input) as clip:
            txt_kwargs = dict(text=text, font_size=font_size, color=color)
            if font_path:
                txt_kwargs["font"] = font_path
            txt_clip = (
                TextClip(**txt_kwargs)
                .with_position(pos, relative=True)
                .with_start(start_sec)
                .with_duration(end_sec - start_sec)
            )
            final = CompositeVideoClip([clip, txt_clip])
            final.write_videofile(local_output, logger=None)

        output_key = _upload_to_s3(local_output, output_filename)
        return json.dumps({"output_key": output_key, "status": "success"})
    finally:
        for path in [local_input, local_output]:
            if os.path.exists(path):
                os.remove(path)


@tool
def add_audio(
    video_key: str,
    audio_key: str,
    volume: float = 0.5,
    loop: bool = False,
) -> str:
    """
    Mix a BGM/sound effect audio track into an existing video's audio.
    The original audio is preserved and the new audio is added on top.

    Args:
        video_key: S3 key of the source video
        audio_key: S3 key of the audio file to mix in (mp3, wav, etc.)
        volume: Volume of the added audio track, 0.0 to 1.0 (default 0.5)
        loop: If True, loop the audio to match the video duration (default False)

    Returns:
        S3 key of the output video with mixed audio
    """
    from moviepy import VideoFileClip, AudioFileClip, CompositeAudioClip, concatenate_audioclips
    from moviepy.audio.fx import MultiplyVolume

    video_suffix = Path(video_key).suffix or ".mp4"
    audio_suffix = Path(audio_key).suffix or ".mp3"
    local_video = _download_from_s3(video_key, video_suffix)
    local_audio = _download_from_s3(audio_key, audio_suffix)
    output_filename = f"mixed_audio_{Path(video_key).name}"
    local_output = f"/tmp/{uuid.uuid4().hex}{video_suffix}"

    try:
        with VideoFileClip(local_video) as clip:
            bgm = AudioFileClip(local_audio)
            if loop and bgm.duration < clip.duration:
                n = int(clip.duration / bgm.duration) + 2
                bgm = concatenate_audioclips([bgm] * n).subclipped(0, clip.duration)
            else:
                bgm = bgm.subclipped(0, min(bgm.duration, clip.duration))
            bgm = bgm.with_effects([MultiplyVolume(volume)])
            if clip.audio is not None:
                combined = CompositeAudioClip([clip.audio, bgm])
            else:
                combined = bgm
            result = clip.with_audio(combined)
            result.write_videofile(local_output, logger=None)
            bgm.close()

        output_key = _upload_to_s3(local_output, output_filename)
        return json.dumps({"output_key": output_key, "status": "success"})
    finally:
        for path in [local_video, local_audio, local_output]:
            if os.path.exists(path):
                os.remove(path)


@tool
def replace_audio(video_key: str, audio_key: str) -> str:
    """
    Replace the audio track of a video with a new audio file.
    The original audio is removed and replaced with the specified audio.

    Args:
        video_key: S3 key of the source video
        audio_key: S3 key of the replacement audio file (mp3, wav, etc.)

    Returns:
        S3 key of the output video with replaced audio
    """
    from moviepy import VideoFileClip, AudioFileClip

    video_suffix = Path(video_key).suffix or ".mp4"
    audio_suffix = Path(audio_key).suffix or ".mp3"
    local_video = _download_from_s3(video_key, video_suffix)
    local_audio = _download_from_s3(audio_key, audio_suffix)
    output_filename = f"replaced_audio_{Path(video_key).name}"
    local_output = f"/tmp/{uuid.uuid4().hex}{video_suffix}"

    try:
        with VideoFileClip(local_video) as clip:
            new_audio = AudioFileClip(local_audio)
            new_audio = new_audio.subclipped(0, min(new_audio.duration, clip.duration))
            result = clip.without_audio().with_audio(new_audio)
            result.write_videofile(local_output, logger=None)
            new_audio.close()

        output_key = _upload_to_s3(local_output, output_filename)
        return json.dumps({"output_key": output_key, "status": "success"})
    finally:
        for path in [local_video, local_audio, local_output]:
            if os.path.exists(path):
                os.remove(path)


@tool
def change_speed(video_key: str, speed: float) -> str:
    """
    Change the playback speed of a video (slow motion or fast forward).

    Args:
        video_key: S3 key of the source video
        speed: Speed multiplier — 0.25 for slow motion, 2.0 for fast forward (range: 0.1–10.0)

    Returns:
        S3 key of the output video with modified speed
    """
    from moviepy import VideoFileClip
    from moviepy.video.fx import MultiplySpeed

    speed = max(0.1, min(10.0, speed))
    suffix = Path(video_key).suffix or ".mp4"
    local_input = _download_from_s3(video_key, suffix)
    output_filename = f"speed{speed}x_{Path(video_key).name}"
    local_output = f"/tmp/{uuid.uuid4().hex}{suffix}"

    try:
        with VideoFileClip(local_input) as clip:
            result = clip.with_effects([MultiplySpeed(speed)])
            result.write_videofile(local_output, logger=None)

        output_key = _upload_to_s3(local_output, output_filename)
        return json.dumps({"output_key": output_key, "status": "success"})
    finally:
        for path in [local_input, local_output]:
            if os.path.exists(path):
                os.remove(path)


@tool
def fade_in_out(
    video_key: str,
    fade_in_sec: float = 0.0,
    fade_out_sec: float = 0.0,
) -> str:
    """
    Apply fade-in and/or fade-out effects to a video (both video and audio tracks).

    Args:
        video_key: S3 key of the source video
        fade_in_sec: Duration of fade-in in seconds (0 = no fade-in, default 0)
        fade_out_sec: Duration of fade-out in seconds (0 = no fade-out, default 0)

    Returns:
        S3 key of the output video with fade effects applied
    """
    from moviepy import VideoFileClip
    from moviepy.video.fx import FadeIn, FadeOut
    from moviepy.audio.fx import AudioFadeIn, AudioFadeOut

    suffix = Path(video_key).suffix or ".mp4"
    local_input = _download_from_s3(video_key, suffix)
    output_filename = f"fade_{Path(video_key).name}"
    local_output = f"/tmp/{uuid.uuid4().hex}{suffix}"

    try:
        with VideoFileClip(local_input) as clip:
            video_effects = []
            audio_effects = []
            if fade_in_sec > 0:
                video_effects.append(FadeIn(fade_in_sec))
                audio_effects.append(AudioFadeIn(fade_in_sec))
            if fade_out_sec > 0:
                video_effects.append(FadeOut(fade_out_sec))
                audio_effects.append(AudioFadeOut(fade_out_sec))

            result = clip.with_effects(video_effects) if video_effects else clip
            if audio_effects and clip.audio is not None:
                result = result.with_audio(clip.audio.with_effects(audio_effects))
            result.write_videofile(local_output, logger=None)

        output_key = _upload_to_s3(local_output, output_filename)
        return json.dumps({"output_key": output_key, "status": "success"})
    finally:
        for path in [local_input, local_output]:
            if os.path.exists(path):
                os.remove(path)


@tool
def crossfade_concat(input_keys: list[str], crossfade_sec: float = 0.5) -> str:
    """
    Concatenate multiple videos with crossfade transition effects between them.

    Args:
        input_keys: List of S3 keys of videos to concatenate, in order
        crossfade_sec: Duration of crossfade transition in seconds (default 0.5)

    Returns:
        S3 key of the concatenated output video with crossfade transitions
    """
    from moviepy import VideoFileClip, concatenate_videoclips
    from moviepy.video.fx import CrossFadeIn, CrossFadeOut

    local_paths = []
    for key in input_keys:
        suffix = Path(key).suffix or ".mp4"
        local_paths.append(_download_from_s3(key, suffix))

    output_filename = "crossfade_concat.mp4"
    local_output = f"/tmp/{uuid.uuid4().hex}.mp4"

    try:
        clips = [VideoFileClip(p) for p in local_paths]
        if len(clips) > 1 and crossfade_sec > 0:
            processed = []
            for i, c in enumerate(clips):
                effects = []
                if i > 0:
                    effects.append(CrossFadeIn(crossfade_sec))
                if i < len(clips) - 1:
                    effects.append(CrossFadeOut(crossfade_sec))
                processed.append(c.with_effects(effects) if effects else c)
            final = concatenate_videoclips(processed, padding=-crossfade_sec)
        else:
            final = concatenate_videoclips(clips)
        final.write_videofile(local_output, logger=None)
        for c in clips:
            c.close()

        output_key = _upload_to_s3(local_output, output_filename)
        return json.dumps({"output_key": output_key, "status": "success"})
    finally:
        for path in local_paths + [local_output]:
            if os.path.exists(path):
                os.remove(path)


@tool
def resize_crop(
    video_key: str,
    width: int | None = None,
    height: int | None = None,
    crop_x1: float = 0,
    crop_y1: float = 0,
    crop_x2: float | None = None,
    crop_y2: float | None = None,
) -> str:
    """
    Resize and/or crop a video to change its resolution or aspect ratio.

    Args:
        video_key: S3 key of the source video
        width: Target width in pixels (None to auto-scale with height)
        height: Target height in pixels (None to auto-scale with width)
        crop_x1: Left edge of crop region in pixels (default 0)
        crop_y1: Top edge of crop region in pixels (default 0)
        crop_x2: Right edge of crop region in pixels (None = full width)
        crop_y2: Bottom edge of crop region in pixels (None = full height)

    Returns:
        S3 key of the output video after resize/crop
    """
    from moviepy import VideoFileClip

    suffix = Path(video_key).suffix or ".mp4"
    local_input = _download_from_s3(video_key, suffix)
    output_filename = f"resized_{Path(video_key).name}"
    local_output = f"/tmp/{uuid.uuid4().hex}{suffix}"

    try:
        with VideoFileClip(local_input) as clip:
            result = clip
            if width is not None or height is not None:
                new_w = width if width is not None else result.w
                new_h = height if height is not None else result.h
                result = result.resized((new_w, new_h))
            if crop_x2 is not None or crop_y2 is not None:
                x2 = crop_x2 if crop_x2 is not None else result.w
                y2 = crop_y2 if crop_y2 is not None else result.h
                result = result.cropped(x1=crop_x1, y1=crop_y1, x2=x2, y2=y2)
            result.write_videofile(local_output, logger=None)

        output_key = _upload_to_s3(local_output, output_filename)
        return json.dumps({"output_key": output_key, "status": "success"})
    finally:
        for path in [local_input, local_output]:
            if os.path.exists(path):
                os.remove(path)


@tool
def rotate_flip(
    video_key: str,
    rotate_deg: float = 0,
    flip_horizontal: bool = False,
    flip_vertical: bool = False,
) -> str:
    """
    Rotate and/or flip a video.

    Args:
        video_key: S3 key of the source video
        rotate_deg: Rotation angle in degrees clockwise (default 0)
        flip_horizontal: Mirror left-right (default False)
        flip_vertical: Mirror top-bottom (default False)

    Returns:
        S3 key of the output video after rotation/flip
    """
    from moviepy import VideoFileClip
    from moviepy.video.fx import Rotate, MirrorX, MirrorY

    suffix = Path(video_key).suffix or ".mp4"
    local_input = _download_from_s3(video_key, suffix)
    output_filename = f"rotated_{Path(video_key).name}"
    local_output = f"/tmp/{uuid.uuid4().hex}{suffix}"

    try:
        effects = []
        if rotate_deg != 0:
            effects.append(Rotate(rotate_deg))
        if flip_horizontal:
            effects.append(MirrorX())
        if flip_vertical:
            effects.append(MirrorY())

        with VideoFileClip(local_input) as clip:
            result = clip.with_effects(effects) if effects else clip
            result.write_videofile(local_output, logger=None)

        output_key = _upload_to_s3(local_output, output_filename)
        return json.dumps({"output_key": output_key, "status": "success"})
    finally:
        for path in [local_input, local_output]:
            if os.path.exists(path):
                os.remove(path)


@tool
def overlay_image(
    video_key: str,
    image_key: str,
    x: int = 0,
    y: int = 0,
    width: int | None = None,
    height: int | None = None,
    opacity: float = 1.0,
    start_sec: float = 0,
    end_sec: float | None = None,
) -> str:
    """
    Overlay an image (logo, watermark, picture-in-picture) onto a video with transparency support.

    Args:
        video_key: S3 key of the source video
        image_key: S3 key of the image to overlay (supports PNG with transparency)
        x: Horizontal position of image top-left corner in pixels (default 0)
        y: Vertical position of image top-left corner in pixels (default 0)
        width: Resize image to this width in pixels (None = original size)
        height: Resize image to this height in pixels (None = original size)
        opacity: Image opacity 0.0 (invisible) to 1.0 (opaque, default 1.0)
        start_sec: Time in seconds when the image starts appearing (default 0)
        end_sec: Time in seconds when the image stops appearing (None = end of video)

    Returns:
        S3 key of the output video with image overlay
    """
    from moviepy import VideoFileClip, ImageClip, CompositeVideoClip

    video_suffix = Path(video_key).suffix or ".mp4"
    image_suffix = Path(image_key).suffix or ".png"
    local_video = _download_from_s3(video_key, video_suffix)
    local_image = _download_from_s3(image_key, image_suffix)
    output_filename = f"overlay_{Path(video_key).name}"
    local_output = f"/tmp/{uuid.uuid4().hex}{video_suffix}"

    try:
        with VideoFileClip(local_video) as clip:
            duration = (end_sec if end_sec is not None else clip.duration) - start_sec
            img_clip = ImageClip(local_image)
            if width is not None or height is not None:
                new_w = width if width is not None else img_clip.w
                new_h = height if height is not None else img_clip.h
                img_clip = img_clip.resized((new_w, new_h))
            img_clip = (
                img_clip
                .with_position((x, y))
                .with_opacity(opacity)
                .with_start(start_sec)
                .with_duration(duration)
            )
            final = CompositeVideoClip([clip, img_clip])
            final.write_videofile(local_output, logger=None)

        output_key = _upload_to_s3(local_output, output_filename)
        return json.dumps({"output_key": output_key, "status": "success"})
    finally:
        for path in [local_video, local_image, local_output]:
            if os.path.exists(path):
                os.remove(path)


@tool
def extract_audio(video_key: str) -> str:
    """
    Extract the audio track from a video and save it as an MP3 file.

    Args:
        video_key: S3 key of the source video

    Returns:
        S3 key of the extracted audio MP3 file
    """
    from moviepy import VideoFileClip

    suffix = Path(video_key).suffix or ".mp4"
    local_input = _download_from_s3(video_key, suffix)
    output_filename = f"{Path(video_key).stem}_audio.mp3"
    local_output = f"/tmp/{uuid.uuid4().hex}.mp3"

    try:
        with VideoFileClip(local_input) as clip:
            if clip.audio is None:
                return json.dumps({"status": "failed", "error": "Video has no audio track"})
            clip.audio.write_audiofile(local_output, logger=None)

        output_key = _upload_to_s3(local_output, output_filename)
        return json.dumps({"output_key": output_key, "status": "success"})
    finally:
        for path in [local_input, local_output]:
            if os.path.exists(path):
                os.remove(path)


@tool
def adjust_volume(video_key: str, factor: float) -> str:
    """
    Adjust the volume of a video's audio track.

    Args:
        video_key: S3 key of the source video
        factor: Volume multiplier — 0.0 (mute), 1.0 (unchanged), 2.0 (double volume)

    Returns:
        S3 key of the output video with adjusted volume
    """
    from moviepy import VideoFileClip
    from moviepy.audio.fx import MultiplyVolume

    factor = max(0.0, min(4.0, factor))
    suffix = Path(video_key).suffix or ".mp4"
    local_input = _download_from_s3(video_key, suffix)
    output_filename = f"vol{factor}x_{Path(video_key).name}"
    local_output = f"/tmp/{uuid.uuid4().hex}{suffix}"

    try:
        with VideoFileClip(local_input) as clip:
            if clip.audio is None:
                return json.dumps({"status": "failed", "error": "Video has no audio track"})
            new_audio = clip.audio.with_effects([MultiplyVolume(factor)])
            result = clip.with_audio(new_audio)
            result.write_videofile(local_output, logger=None)

        output_key = _upload_to_s3(local_output, output_filename)
        return json.dumps({"output_key": output_key, "status": "success"})
    finally:
        for path in [local_input, local_output]:
            if os.path.exists(path):
                os.remove(path)


@tool
def color_filter(
    video_key: str,
    filter_type: str,
    value: float = 1.0,
) -> str:
    """
    Apply a color filter to a video: grayscale, brightness, or contrast adjustment.

    Args:
        video_key: S3 key of the source video
        filter_type: Filter to apply — "grayscale", "brightness", or "contrast"
        value: Filter intensity — ignored for grayscale; 1.0 = no change for brightness/contrast
               (0.5 = darker/lower contrast, 1.5 = brighter/higher contrast)

    Returns:
        S3 key of the output video with color filter applied
    """
    import numpy as np
    from moviepy import VideoFileClip

    suffix = Path(video_key).suffix or ".mp4"
    local_input = _download_from_s3(video_key, suffix)
    output_filename = f"{filter_type}_{Path(video_key).name}"
    local_output = f"/tmp/{uuid.uuid4().hex}{suffix}"

    try:
        with VideoFileClip(local_input) as clip:
            if filter_type == "grayscale":
                from moviepy.video.fx import BlackAndWhite
                result = clip.with_effects([BlackAndWhite()])
            elif filter_type == "brightness":
                def brightness_fn(frame):
                    return np.clip(frame * value, 0, 255).astype("uint8")
                result = clip.image_transform(brightness_fn)
            elif filter_type == "contrast":
                def contrast_fn(frame):
                    mean = frame.mean()
                    return np.clip((frame.astype(float) - mean) * value + mean, 0, 255).astype("uint8")
                result = clip.image_transform(contrast_fn)
            else:
                return json.dumps({"status": "failed", "error": f"Unknown filter_type: '{filter_type}'. Use 'grayscale', 'brightness', or 'contrast'."})
            result.write_videofile(local_output, logger=None)

        output_key = _upload_to_s3(local_output, output_filename)
        return json.dumps({"output_key": output_key, "status": "success"})
    finally:
        for path in [local_input, local_output]:
            if os.path.exists(path):
                os.remove(path)


# ─── AI 生成系ツール ───────────────────────────────────────────────────────────


@tool
def generate_image(
    prompt: str,
    width: int = 1024,
    height: int = 1024,
    cfg_scale: float = 7.0,
    steps: int = 30,
) -> str:
    """
    Generate an image from a text prompt using Stable Diffusion XL on Amazon Bedrock (us-east-1).
    The generated image is saved to S3 as a PNG file.

    Args:
        prompt: Text description of the image to generate
        width: Image width in pixels (default 1024, must be multiple of 64)
        height: Image height in pixels (default 1024, must be multiple of 64)
        cfg_scale: Classifier-free guidance scale — higher = follows prompt more strictly (default 7.0)
        steps: Number of diffusion steps — more = higher quality but slower (default 30)

    Returns:
        S3 key of the generated image (PNG)
    """
    import base64

    local_output = f"/tmp/{uuid.uuid4().hex}.png"
    try:
        response = bedrock_nova.invoke_model(
            modelId="stability.stable-diffusion-xl-v1",
            body=json.dumps({
                "text_prompts": [{"text": prompt, "weight": 1.0}],
                "cfg_scale": cfg_scale,
                "steps": steps,
                "width": width,
                "height": height,
            }),
            contentType="application/json",
            accept="application/json",
        )
        result = json.loads(response["body"].read())
        image_data = base64.b64decode(result["artifacts"][0]["base64"])
        with open(local_output, "wb") as f:
            f.write(image_data)

        output_key = _upload_to_s3(local_output, "generated_image.png")
        return json.dumps({"output_key": output_key, "status": "success"})
    except Exception as e:
        logger.error(f"generate_image failed: {e}")
        return json.dumps({"status": "failed", "error": str(e)})
    finally:
        if os.path.exists(local_output):
            os.remove(local_output)


@tool
def generate_speech(
    text: str,
    voice_id: str = "Takumi",
    engine: str = "neural",
) -> str:
    """
    Generate speech audio from text using Amazon Polly (ap-northeast-1).
    The output is saved as an MP3 file in S3.

    Args:
        text: Text to convert to speech
        voice_id: Polly voice ID — Japanese: "Takumi" (male, default), "Kazuha" (female);
                  English: "Joanna", "Matthew", "Amy", etc.
        engine: Speech synthesis engine — "neural" (default, higher quality) or "standard"

    Returns:
        S3 key of the generated MP3 audio file
    """
    local_output = f"/tmp/{uuid.uuid4().hex}.mp3"
    try:
        response = polly.synthesize_speech(
            Text=text,
            OutputFormat="mp3",
            VoiceId=voice_id,
            Engine=engine,
        )
        with open(local_output, "wb") as f:
            f.write(response["AudioStream"].read())

        output_key = _upload_to_s3(local_output, "speech.mp3")
        return json.dumps({"output_key": output_key, "status": "success"})
    except Exception as e:
        logger.error(f"generate_speech failed: {e}")
        return json.dumps({"status": "failed", "error": str(e)})
    finally:
        if os.path.exists(local_output):
            os.remove(local_output)


# ─── 映像理解・分析ツール ──────────────────────────────────────────────────────


@tool
def analyze_video(
    video_key: str,
    question: str = "",
    sample_fps: float = 0.5,
) -> str:
    """
    Analyze video content by extracting frames and using Claude Vision (claude-sonnet-4-6).
    The agent can "see" what is actually in the video: scenes, people, objects, actions, mood, etc.
    Use this before editing when you need to understand the video content to make decisions.

    Args:
        video_key: S3 key of the video to analyze
        question: Specific question about the video (e.g., "何秒に何が映っていますか？面白いシーンはどこですか？")
                  If empty, returns a general scene-by-scene description with timestamps.
        sample_fps: Frames to extract per second (default 0.5 = every 2 seconds, max 2.0)

    Returns:
        JSON with analysis results: scene descriptions, timestamps, and answers to the question
    """
    import subprocess
    import base64
    import shutil

    sample_fps = max(0.1, min(2.0, sample_fps))
    suffix = Path(video_key).suffix or ".mp4"
    local_input = _download_from_s3(video_key, suffix)
    frames_dir = f"/tmp/frames_{uuid.uuid4().hex}"
    os.makedirs(frames_dir, exist_ok=True)

    try:
        # Extract frames with ffmpeg
        subprocess.run(
            [
                "ffmpeg", "-i", local_input,
                "-vf", f"fps={sample_fps},scale=640:-1",
                "-q:v", "3",
                f"{frames_dir}/frame_%04d.jpg",
            ],
            capture_output=True,
            check=True,
        )

        frame_files = sorted(
            [f for f in os.listdir(frames_dir) if f.endswith(".jpg")]
        )

        if not frame_files:
            return json.dumps({"status": "failed", "error": "No frames could be extracted"})

        # Cap at 12 frames to stay within token limits
        step = max(1, len(frame_files) // 12)
        selected_files = frame_files[::step][:12]

        # Build multimodal content for Claude
        content = []
        for i, fname in enumerate(selected_files):
            frame_index = int(fname.replace("frame_", "").replace(".jpg", ""))
            timestamp = (frame_index - 1) / sample_fps
            content.append({
                "type": "text",
                "text": f"【フレーム {i + 1} / 時刻: {timestamp:.1f}秒】",
            })
            with open(os.path.join(frames_dir, fname), "rb") as f:
                content.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/jpeg",
                        "data": base64.b64encode(f.read()).decode(),
                    },
                })

        if question:
            analysis_prompt = (
                f"以下の動画フレームを分析してください。\n\n質問: {question}\n\n"
                "各フレームの時刻を参照しながら、具体的に答えてください。"
                "編集ツールで使える秒数（例: 3.5秒〜12.0秒）を含めて回答してください。"
            )
        else:
            analysis_prompt = (
                "以下の動画フレームを分析してください。\n\n"
                "シーンごとに時刻（秒）と内容を日本語で説明してください。\n"
                "特に注目すべきシーン、人物の動き、感情、映像の雰囲気なども含めてください。\n"
                "回答はJSON形式で: {\"scenes\": [{\"start_sec\": 0.0, \"description\": \"...\"}], \"summary\": \"...\"}"
            )
        content.append({"type": "text", "text": analysis_prompt})

        response = bedrock_nova.invoke_model(
            modelId="us.anthropic.claude-sonnet-4-6",
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 2000,
                "messages": [{"role": "user", "content": content}],
            }),
            contentType="application/json",
            accept="application/json",
        )
        result = json.loads(response["body"].read())
        analysis_text = result["content"][0]["text"]
        logger.info(f"analyze_video complete: {len(selected_files)} frames analyzed")
        return json.dumps({
            "status": "success",
            "frames_analyzed": len(selected_files),
            "analysis": analysis_text,
        }, ensure_ascii=False)

    except Exception as e:
        logger.error(f"analyze_video failed: {e}")
        return json.dumps({"status": "failed", "error": str(e)})
    finally:
        for path in [local_input]:
            if os.path.exists(path):
                os.remove(path)
        if os.path.exists(frames_dir):
            shutil.rmtree(frames_dir)


@tool
def transcribe_video(
    video_key: str,
    language_code: str = "ja-JP",
) -> str:
    """
    Transcribe speech in a video using Amazon Transcribe.
    Returns word-level timestamps so you can add accurate subtitles or cut by speech content.

    Args:
        video_key: S3 key of the source video
        language_code: Language of the speech — "ja-JP" (Japanese, default), "en-US" (English), etc.

    Returns:
        JSON with full transcript text and word-level timestamps:
        {"transcript": "...", "words": [{"word": "こんにちは", "start": 0.5, "end": 1.2}, ...]}
    """
    import subprocess

    suffix = Path(video_key).suffix or ".mp4"
    local_input = _download_from_s3(video_key, suffix)
    local_audio = f"/tmp/{uuid.uuid4().hex}.mp3"
    job_name = f"video-edit-{TASK_ID}-{uuid.uuid4().hex[:8]}"
    audio_s3_key = f"tasks/{TASK_ID}/temp/audio_{uuid.uuid4().hex}.mp3"
    transcript_s3_key = f"tasks/{TASK_ID}/temp/transcript_{job_name}.json"

    try:
        # Extract audio with ffmpeg
        subprocess.run(
            ["ffmpeg", "-i", local_input, "-q:a", "0", "-map", "a", local_audio],
            capture_output=True,
            check=True,
        )

        # Upload audio to S3 for Transcribe
        s3.upload_file(local_audio, S3_BUCKET, audio_s3_key)
        logger.info(f"Uploaded audio for transcription: {audio_s3_key}")

        # Start transcription job
        transcribe.start_transcription_job(
            TranscriptionJobName=job_name,
            Media={"MediaFileUri": f"s3://{S3_BUCKET}/{audio_s3_key}"},
            MediaFormat="mp3",
            LanguageCode=language_code,
            OutputBucketName=S3_BUCKET,
            OutputKey=transcript_s3_key,
        )
        logger.info(f"Transcription job started: {job_name}")

        # Poll until complete (timeout: 10 minutes)
        for _ in range(120):
            time.sleep(5)
            resp = transcribe.get_transcription_job(TranscriptionJobName=job_name)
            status = resp["TranscriptionJob"]["TranscriptionJobStatus"]
            logger.info(f"Transcription status: {status}")
            if status == "COMPLETED":
                break
            if status == "FAILED":
                reason = resp["TranscriptionJob"].get("FailureReason", "unknown")
                return json.dumps({"status": "failed", "error": f"Transcription failed: {reason}"})
        else:
            return json.dumps({"status": "failed", "error": "Transcription timed out"})

        # Download and parse transcript JSON
        local_transcript = f"/tmp/{uuid.uuid4().hex}.json"
        s3.download_file(S3_BUCKET, transcript_s3_key, local_transcript)
        with open(local_transcript) as f:
            transcript_data = json.load(f)

        results = transcript_data.get("results", {})
        full_text = " ".join(t["transcript"] for t in results.get("transcripts", []))
        words = []
        for item in results.get("items", []):
            if item["type"] == "pronunciation":
                words.append({
                    "word": item["alternatives"][0]["content"],
                    "start": float(item.get("start_time", 0)),
                    "end": float(item.get("end_time", 0)),
                })

        logger.info(f"Transcription complete: {len(words)} words")
        return json.dumps({
            "status": "success",
            "language": language_code,
            "transcript": full_text,
            "words": words,
        }, ensure_ascii=False)

    except Exception as e:
        logger.error(f"transcribe_video failed: {e}")
        return json.dumps({"status": "failed", "error": str(e)})
    finally:
        for path in [local_input, local_audio]:
            if os.path.exists(path):
                os.remove(path)
        # Clean up S3 temp files
        for key in [audio_s3_key, transcript_s3_key]:
            try:
                s3.delete_object(Bucket=S3_BUCKET, Key=key)
            except Exception:
                pass


@tool
def detect_scenes(
    video_key: str,
    threshold: float = 0.4,
) -> str:
    """
    Automatically detect scene change boundaries in a video using ffmpeg.
    Returns a list of timestamps where the scene changes, useful for smart cutting and editing.

    Args:
        video_key: S3 key of the source video
        threshold: Scene change sensitivity 0.0–1.0 (default 0.4).
                   Lower = more sensitive (detects subtle changes),
                   Higher = only detects major scene changes

    Returns:
        JSON with scene list: {"scenes": [{"scene": 1, "start_sec": 0.0, "end_sec": 5.3}, ...]}
    """
    import subprocess
    import re

    threshold = max(0.0, min(1.0, threshold))
    suffix = Path(video_key).suffix or ".mp4"
    local_input = _download_from_s3(video_key, suffix)

    try:
        # Get total duration
        probe = subprocess.run(
            [
                "ffprobe", "-v", "quiet",
                "-show_entries", "format=duration",
                "-of", "json", local_input,
            ],
            capture_output=True,
            text=True,
        )
        probe_data = json.loads(probe.stdout)
        total_duration = float(probe_data["format"]["duration"])

        # Run ffmpeg scene detection
        result = subprocess.run(
            [
                "ffmpeg", "-i", local_input,
                "-vf", f"select='gt(scene,{threshold})',showinfo",
                "-vsync", "vfr",
                "-f", "null", "-",
            ],
            capture_output=True,
            text=True,
            errors="replace",
        )

        # Parse scene change timestamps from stderr
        scene_starts = [0.0]
        for line in result.stderr.split("\n"):
            m = re.search(r"pts_time:([0-9.]+)", line)
            if m:
                ts = float(m.group(1))
                if ts > 0.5:  # ignore very early false positives
                    scene_starts.append(round(ts, 3))

        scene_starts = sorted(set(scene_starts))
        scenes = []
        for i, start in enumerate(scene_starts):
            end = scene_starts[i + 1] if i + 1 < len(scene_starts) else total_duration
            scenes.append({
                "scene": i + 1,
                "start_sec": round(start, 3),
                "end_sec": round(end, 3),
                "duration_sec": round(end - start, 3),
            })

        logger.info(f"detect_scenes: {len(scenes)} scenes detected in {total_duration:.1f}s video")
        return json.dumps({
            "status": "success",
            "total_duration_sec": round(total_duration, 3),
            "scene_count": len(scenes),
            "threshold_used": threshold,
            "scenes": scenes,
        }, ensure_ascii=False)

    except Exception as e:
        logger.error(f"detect_scenes failed: {e}")
        return json.dumps({"status": "failed", "error": str(e)})
    finally:
        if os.path.exists(local_input):
            os.remove(local_input)


@tool
def generate_video_from_image(
    image_key: str,
    prompt: str,
    duration: str = "5s",
    aspect_ratio: str = "16:9",
    resolution: str = "720p",
) -> str:
    """
    Generate a video that starts from a specific image using Luma AI Ray 2 (image-to-video).
    The generated video will begin with the provided image and animate it according to the prompt.
    Use this when you want to bring a still image or AI-generated image to life.

    Args:
        image_key: S3 key of the source image (JPG or PNG) to use as the first frame
        prompt: Text description of how the image should animate (1–5000 characters)
        duration: Video length — "5s" (default) or "9s"
        aspect_ratio: Aspect ratio — "16:9" (default), "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"
        resolution: Output resolution — "720p" (default) or "540p"

    Returns:
        S3 key of the generated output video
    """
    if not LUMA_S3_BUCKET:
        return json.dumps({"status": "failed", "error": "LUMA_S3_BUCKET env var not set"})

    if duration not in ("5s", "9s"):
        try:
            sec = float(duration.rstrip("s"))
        except ValueError:
            sec = 0
        duration = "9s" if sec >= 7 else "5s"

    if resolution not in ("720p", "540p"):
        resolution = "720p"

    valid_ratios = {"16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"}
    if aspect_ratio not in valid_ratios:
        aspect_ratio = "16:9"

    # Generate a presigned URL so Luma AI can fetch the image
    presigned_url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": S3_BUCKET, "Key": image_key},
        ExpiresIn=3600,
    )

    luma_output_prefix = f"s3://{LUMA_S3_BUCKET}/tasks/{TASK_ID}/output/"
    logger.info(
        f"Starting Luma AI image-to-video: image={image_key} prompt='{prompt[:60]}...' "
        f"duration={duration} aspect_ratio={aspect_ratio} resolution={resolution}"
    )

    try:
        response = bedrock_luma.start_async_invoke(
            modelId="luma.ray-v2:0",
            modelInput={
                "prompt": prompt,
                "duration": duration,
                "aspect_ratio": aspect_ratio,
                "resolution": resolution,
                "keyframes": {
                    "frame0": {
                        "type": "image",
                        "url": presigned_url,
                    }
                },
            },
            outputDataConfig={
                "s3OutputDataConfig": {"s3Uri": luma_output_prefix}
            },
        )
    except Exception as e:
        logger.error(f"generate_video_from_image start_async_invoke failed: {e}")
        return json.dumps({"status": "failed", "error": str(e)})

    invocation_arn = response["invocationArn"]
    logger.info(f"Bedrock async invoke started: {invocation_arn}")

    # Poll until completed (timeout: 15 minutes)
    timeout_sec = 900
    poll_interval = 15
    elapsed = 0
    while elapsed < timeout_sec:
        time.sleep(poll_interval)
        elapsed += poll_interval
        status_resp = bedrock_luma.get_async_invoke(invocationArn=invocation_arn)
        status = status_resp["status"]
        logger.info(f"Bedrock job status: {status} (elapsed {elapsed}s)")
        if status == "Completed":
            break
        if status == "Failed":
            failure = status_resp.get("failureMessage", "unknown error")
            return json.dumps({"status": "failed", "error": failure})
    else:
        return json.dumps({"status": "failed", "error": "Timeout waiting for image-to-video generation"})

    invocation_id = invocation_arn.split("/")[-1]
    luma_key = f"tasks/{TASK_ID}/output/{invocation_id}/output.mp4"

    local_output = f"/tmp/{uuid.uuid4().hex}.mp4"
    try:
        logger.info(f"Downloading from Oregon bucket: s3://{LUMA_S3_BUCKET}/{luma_key}")
        s3_luma.download_file(LUMA_S3_BUCKET, luma_key, local_output)
        output_key = _upload_to_s3(local_output, "image_to_video.mp4")
    finally:
        if os.path.exists(local_output):
            os.remove(local_output)

    logger.info(f"Image-to-video complete. Copied to Tokyo: {output_key}")
    return json.dumps({"output_key": output_key, "status": "success"})

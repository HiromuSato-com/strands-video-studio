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
# Amazon Nova Reel and Stable Diffusion XL are available in us-east-1
bedrock_nova = boto3.client("bedrock-runtime", region_name="us-east-1")
s3_nova = boto3.client("s3", region_name="us-east-1")
polly = boto3.client("polly", region_name="ap-northeast-1")

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

    # Locate a CJK-capable font (installed via fonts-noto-cjk in Dockerfile)
    font_path = None
    for pattern in [
        "/usr/share/fonts/**/*CJK*Regular*.otf",
        "/usr/share/fonts/**/*Noto*CJK*.otf",
        "/usr/share/fonts/**/*.ttf",
        "/usr/share/fonts/**/*.otf",
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

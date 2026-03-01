"""
Video editing tools for the Strands Agent.
All file operations use S3 as the storage backend.
Temporary files are written to /tmp/ during processing.
"""

import os
import json
import uuid
import logging
import tempfile
from pathlib import Path

import time

import boto3
from strands import tool

logger = logging.getLogger(__name__)

# Environment variables injected at Fargate task launch
S3_BUCKET = os.environ["S3_BUCKET"]
TASK_ID = os.environ["TASK_ID"]

s3 = boto3.client("s3")
bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")

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
    Generate a video from a text prompt using Luma AI Ray 2 on Amazon Bedrock.

    Args:
        prompt: Text description of the video to generate (1–5000 characters)
        duration: Video length, either "5s" or "9s" (default: "5s")
        aspect_ratio: Aspect ratio — "16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21" (default: "16:9")
        resolution: Output resolution, either "540p" or "720p" (default: "720p")

    Returns:
        S3 key of the generated output video
    """
    bedrock_output_prefix = f"s3://{S3_BUCKET}/tasks/{TASK_ID}/bedrock-output"

    logger.info(f"Starting video generation: prompt='{prompt[:80]}...' duration={duration}")

    response = bedrock.start_async_invoke(
        modelId="luma.ray-v2:0",
        modelInput={
            "prompt": prompt,
            "duration": duration,
            "aspect_ratio": aspect_ratio,
            "resolution": resolution,
        },
        outputDataConfig={
            "s3OutputDataConfig": {"s3Uri": bedrock_output_prefix}
        },
    )
    invocation_arn = response["invocationArn"]
    logger.info(f"Bedrock async invoke started: {invocation_arn}")

    # Poll until completed or failed (timeout: 15 minutes)
    timeout_sec = 900
    poll_interval = 15
    elapsed = 0
    while elapsed < timeout_sec:
        time.sleep(poll_interval)
        elapsed += poll_interval
        status_resp = bedrock.get_async_invoke(invocationArn=invocation_arn)
        status = status_resp["status"]
        logger.info(f"Bedrock job status: {status} (elapsed {elapsed}s)")
        if status == "Completed":
            break
        if status == "Failed":
            failure = status_resp.get("failureMessage", "unknown error")
            return json.dumps({"status": "failed", "error": failure})
    else:
        return json.dumps({"status": "failed", "error": "Timeout waiting for video generation"})

    # Bedrock saves output under {prefix}/{invocation_id}/output.mp4
    invocation_id = invocation_arn.split("/")[-1]
    bedrock_key = f"tasks/{TASK_ID}/bedrock-output/{invocation_id}/output.mp4"

    output_key = _upload_to_s3.__wrapped__ if hasattr(_upload_to_s3, "__wrapped__") else None
    # Copy from Bedrock output location to canonical output path
    output_filename = "generated.mp4"
    local_output = f"/tmp/{uuid.uuid4().hex}.mp4"
    try:
        s3.download_file(S3_BUCKET, bedrock_key, local_output)
        output_key = _upload_to_s3(local_output, output_filename)
    finally:
        if os.path.exists(local_output):
            os.remove(local_output)

    logger.info(f"Video generation complete: {output_key}")
    return json.dumps({"output_key": output_key, "status": "success"})

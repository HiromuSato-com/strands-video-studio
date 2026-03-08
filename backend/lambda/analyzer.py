"""
S3 PUT イベントトリガー: tasks/*/input/* ファイルをアップロード直後に分析する。
- 画像（JPG/PNG/WEBP）: Claude Vision でビジュアル分析
- 動画（MP4/MOV 等）: ファイル名・サイズから Claude がテキスト分析
- 結果は DynamoDB に 24h TTL で保存し、チャット init 時に参照される
"""
import os
import json
import re
import base64
import uuid
import urllib.parse
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta

import boto3

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

S3_BUCKET = os.environ["S3_BUCKET"]
ANALYSIS_TABLE = os.environ["ANALYSIS_TABLE"]
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "us-east-1")
MODEL_ID = "us.anthropic.claude-sonnet-4-6"

s3 = boto3.client("s3")
bedrock = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)
dynamodb = boto3.resource("dynamodb")


def handler(event, context):
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])
        size = record["s3"]["object"].get("size", 0)

        # tasks/*/input/* 以外は無視
        if not re.match(r"^tasks/[^/]+/input/[^/]+$", key):
            logger.info(f"Skipping: {key}")
            continue

        try:
            process_file(bucket, key, size)
        except Exception as e:
            logger.error(f"Failed to process {key}: {e}")


def process_file(bucket: str, key: str, size: int):
    table = dynamodb.Table(ANALYSIS_TABLE)
    ttl = int((datetime.now(timezone.utc) + timedelta(hours=24)).timestamp())
    suffix = Path(key).suffix.lower()

    table.put_item(Item={
        "s3_key": key,
        "status": "processing",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "ttl": ttl,
    })

    try:
        if suffix in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
            analysis = analyze_image(bucket, key)
            file_type = "image"
        elif suffix in (".mp4", ".mov", ".avi", ".mkv", ".webm"):
            analysis = analyze_video_metadata(key, size)
            file_type = "video"
        else:
            analysis = f"ファイル名: {Path(key).name}（形式: {suffix or '不明'}）"
            file_type = "other"

        table.update_item(
            Key={"s3_key": key},
            UpdateExpression="SET #s = :s, analysis_text = :a, file_type = :f",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": "completed", ":a": analysis, ":f": file_type},
        )
        logger.info(f"Analysis stored for {key} (type={file_type})")

    except Exception as e:
        logger.error(f"Analysis failed for {key}: {e}")
        table.update_item(
            Key={"s3_key": key},
            UpdateExpression="SET #s = :s, error_msg = :e",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": "failed", ":e": str(e)},
        )
        raise


def analyze_image(bucket: str, key: str) -> str:
    local_path = f"/tmp/{uuid.uuid4().hex}{Path(key).suffix}"
    s3.download_file(bucket, key, local_path)
    try:
        with open(local_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode()

        media_type_map = {
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
        }
        media_type = media_type_map.get(Path(key).suffix.lower(), "image/jpeg")

        response = bedrock.invoke_model(
            modelId=MODEL_ID,
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 800,
                "messages": [{
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {"type": "base64", "media_type": media_type, "data": image_data},
                        },
                        {
                            "type": "text",
                            "text": (
                                "この画像を日本語で説明してください。"
                                "被写体・色彩・構図・雰囲気を具体的に記述し、"
                                "動画編集での活用方法（オープニング画像・テロップ背景・ロゴオーバーレイなど）"
                                "も提案してください（4〜6文）。"
                            ),
                        },
                    ],
                }],
            }),
            contentType="application/json",
            accept="application/json",
        )
        result = json.loads(response["body"].read())
        return result["content"][0]["text"]
    finally:
        if os.path.exists(local_path):
            os.remove(local_path)


def analyze_video_metadata(key: str, size_bytes: int) -> str:
    filename = Path(key).name
    size_mb = size_bytes / (1024 * 1024)

    response = bedrock.invoke_model(
        modelId=MODEL_ID,
        body=json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 600,
            "messages": [{
                "role": "user",
                "content": (
                    f"動画ファイル「{filename}」（{size_mb:.1f}MB）がアップロードされました。\n"
                    "ファイル名とサイズから想定される動画の内容・用途を推測し、"
                    "どのような編集（トリミング・テロップ追加・BGMミックス・フェード・カラーフィルターなど）"
                    "が効果的か日本語で提案してください（4〜6文）。"
                ),
            }],
        }),
        contentType="application/json",
        accept="application/json",
    )
    result = json.loads(response["body"].read())
    return f"【ファイル: {filename} / {size_mb:.1f}MB】\n{result['content'][0]['text']}"

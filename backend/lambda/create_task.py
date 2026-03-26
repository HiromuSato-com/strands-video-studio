"""
POST /tasks

Body: { "instruction": "...", "input_keys": ["tasks/xxx/input/video.mp4", ...] }

Creates a DynamoDB task record and sends a message to SQS.
SQS triggers runner_lambda.py which calls Amazon Bedrock AgentCore Runtime.
Returns: { "task_id": "..." }
"""

import os
import json
import uuid
from datetime import datetime, timezone

import boto3

S3_BUCKET = os.environ["S3_BUCKET"]
DYNAMODB_TABLE = os.environ["DYNAMODB_TABLE"]
SQS_QUEUE_URL = os.environ["SQS_QUEUE_URL"]
NOVA_REEL_S3_BUCKET = os.environ.get("NOVA_REEL_S3_BUCKET", "")
TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "")

dynamodb = boto3.resource("dynamodb")
sqs = boto3.client("sqs")


def handler(event, context):
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return error_response(400, "Invalid JSON body")

    task_id = body.get("task_id", "").strip()
    instruction = body.get("instruction", "").strip()
    input_keys = body.get("input_keys", [])
    video_model = body.get("video_model", "none")
    if video_model not in ("nova_reel", "none"):
        video_model = "none"

    if not task_id:
        return error_response(400, "task_id is required")
    if not instruction:
        return error_response(400, "instruction is required")
    now = datetime.now(timezone.utc).isoformat()

    # Write PENDING record to DynamoDB
    table = dynamodb.Table(DYNAMODB_TABLE)
    table.put_item(
        Item={
            "task_id": task_id,
            "status": "PENDING",
            "instruction": instruction,
            "input_keys": input_keys,
            "video_model": video_model,
            "created_at": now,
            "updated_at": now,
        }
    )

    # Send task parameters to SQS → runner_lambda → AgentCore Runtime
    sqs.send_message(
        QueueUrl=SQS_QUEUE_URL,
        MessageBody=json.dumps({
            "task_id": task_id,
            "instruction": instruction,
            "input_keys": input_keys,
            "video_model": video_model,
            "s3_bucket": S3_BUCKET,
            "dynamodb_table": DYNAMODB_TABLE,
            "nova_reel_s3_bucket": NOVA_REEL_S3_BUCKET,
            "tavily_api_key": TAVILY_API_KEY,
        }),
    )

    return {
        "statusCode": 201,
        "headers": cors_headers(),
        "body": json.dumps({"task_id": task_id}),
    }


def error_response(status_code: int, message: str):
    return {
        "statusCode": status_code,
        "headers": cors_headers(),
        "body": json.dumps({"error": message}),
    }


def cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
    }

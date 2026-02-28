"""
GET /download-url/{id}

Returns a presigned S3 GET URL for the completed task's output video.
"""

import os
import json

import boto3
from botocore.config import Config

S3_BUCKET = os.environ["S3_BUCKET"]
DYNAMODB_TABLE = os.environ["DYNAMODB_TABLE"]

dynamodb = boto3.resource("dynamodb")
s3 = boto3.client(
    "s3",
    config=Config(signature_version="s3v4"),
    region_name=os.environ.get("AWS_REGION", "ap-northeast-1"),
)


def handler(event, context):
    path_params = event.get("pathParameters") or {}
    task_id = path_params.get("id")

    if not task_id:
        return {
            "statusCode": 400,
            "headers": cors_headers(),
            "body": json.dumps({"error": "task id is required"}),
        }

    table = dynamodb.Table(DYNAMODB_TABLE)
    response = table.get_item(Key={"task_id": task_id})
    item = response.get("Item")

    if not item:
        return {
            "statusCode": 404,
            "headers": cors_headers(),
            "body": json.dumps({"error": "Task not found"}),
        }

    if item.get("status") != "COMPLETED":
        return {
            "statusCode": 409,
            "headers": cors_headers(),
            "body": json.dumps({"error": "Task is not completed yet", "status": item.get("status")}),
        }

    output_key = item.get("output_key")
    if not output_key:
        return {
            "statusCode": 500,
            "headers": cors_headers(),
            "body": json.dumps({"error": "Output key not found in task record"}),
        }

    url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": S3_BUCKET, "Key": output_key},
        ExpiresIn=3600,
    )

    return {
        "statusCode": 200,
        "headers": cors_headers(),
        "body": json.dumps({"download_url": url, "output_key": output_key}),
    }


def cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
    }

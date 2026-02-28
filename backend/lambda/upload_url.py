"""
GET /upload-url?filename=<filename>&task_id=<task_id>

Returns a presigned S3 PUT URL for direct browser-to-S3 upload.
"""

import os
import json
import boto3
from botocore.config import Config

S3_BUCKET = os.environ["S3_BUCKET"]

s3 = boto3.client(
    "s3",
    config=Config(signature_version="s3v4"),
    region_name=os.environ.get("AWS_REGION", "ap-northeast-1"),
)


def handler(event, context):
    params = event.get("queryStringParameters") or {}
    filename = params.get("filename")
    task_id = params.get("task_id")

    if not filename or not task_id:
        return {
            "statusCode": 400,
            "headers": cors_headers(),
            "body": json.dumps({"error": "filename and task_id are required"}),
        }

    key = f"tasks/{task_id}/input/{filename}"

    url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": S3_BUCKET, "Key": key},
        ExpiresIn=3600,
    )

    return {
        "statusCode": 200,
        "headers": cors_headers(),
        "body": json.dumps({"upload_url": url, "key": key}),
    }


def cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
    }

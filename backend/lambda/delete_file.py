"""
DELETE /files?key={s3_key}

アップロード済みの入力ファイルを S3 から削除し、
DynamoDB の分析結果エントリも合わせて削除する。
セキュリティのため tasks/*/input/* のみ削除可能。
"""
import os
import json
import logging

import boto3

logger = logging.getLogger(__name__)

S3_BUCKET = os.environ["S3_BUCKET"]
ANALYSIS_TABLE = os.environ["ANALYSIS_TABLE"]

s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")


def handler(event, context):
    params = event.get("queryStringParameters") or {}
    key = params.get("key", "").strip()

    if not key:
        return error_response(400, "key is required")

    # tasks/*/input/* 以外の削除は禁止
    if not (key.startswith("tasks/") and "/input/" in key):
        return error_response(403, "Forbidden: only input files can be deleted")

    try:
        s3.delete_object(Bucket=S3_BUCKET, Key=key)
        logger.info(f"Deleted from S3: {key}")

        dynamodb.Table(ANALYSIS_TABLE).delete_item(Key={"s3_key": key})
        logger.info(f"Deleted analysis from DynamoDB: {key}")

        return {
            "statusCode": 200,
            "headers": cors_headers(),
            "body": json.dumps({"status": "deleted", "key": key}),
        }
    except Exception as e:
        logger.error(f"Delete failed for {key}: {e}")
        return error_response(500, str(e))


def error_response(code: int, msg: str):
    return {
        "statusCode": code,
        "headers": cors_headers(),
        "body": json.dumps({"error": msg}),
    }


def cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "DELETE,OPTIONS",
    }

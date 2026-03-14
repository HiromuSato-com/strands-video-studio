"""
POST /tasks/{id}/approve

Body: { "approved": true | false }

ユーザーが AI 生成ツールの実行を承認または拒否する。
ECS コンテナが DynamoDB の approval_response をポーリングして結果を受け取る。
"""

import os
import json
from datetime import datetime, timezone

import boto3

DYNAMODB_TABLE = os.environ["DYNAMODB_TABLE"]

dynamodb = boto3.resource("dynamodb")


def handler(event, context):
    path_params = event.get("pathParameters") or {}
    task_id = path_params.get("id")
    if not task_id:
        return error_response(400, "task_id is required")

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return error_response(400, "Invalid JSON body")

    approved = body.get("approved")
    if approved is None:
        return error_response(400, "'approved' (boolean) is required")

    table = dynamodb.Table(DYNAMODB_TABLE)
    item = table.get_item(Key={"task_id": task_id}).get("Item")
    if not item:
        return error_response(404, "Task not found")
    if item.get("status") != "WAITING_APPROVAL":
        return error_response(400, f"Task is not waiting for approval (status: {item.get('status')})")

    approval_response = "APPROVED" if approved else "DENIED"
    now = datetime.now(timezone.utc).isoformat()
    table.update_item(
        Key={"task_id": task_id},
        UpdateExpression="SET approval_response = :r, updated_at = :u",
        ExpressionAttributeValues={":r": approval_response, ":u": now},
    )

    return {
        "statusCode": 200,
        "headers": cors_headers(),
        "body": json.dumps({"status": "ok", "approval": approval_response}),
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

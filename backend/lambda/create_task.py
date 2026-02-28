"""
POST /tasks

Body: { "instruction": "...", "input_keys": ["tasks/xxx/input/video.mp4", ...] }

Creates a DynamoDB task record and triggers an ECS Fargate task.
Returns: { "task_id": "..." }
"""

import os
import json
import uuid
from datetime import datetime, timezone

import boto3

S3_BUCKET = os.environ["S3_BUCKET"]
DYNAMODB_TABLE = os.environ["DYNAMODB_TABLE"]
ECS_CLUSTER = os.environ["ECS_CLUSTER"]
ECS_TASK_DEFINITION = os.environ["ECS_TASK_DEFINITION"]
ECS_SUBNET_IDS = os.environ["ECS_SUBNET_IDS"].split(",")
ECS_SECURITY_GROUP_ID = os.environ["ECS_SECURITY_GROUP_ID"]
CONTAINER_NAME = os.environ.get("CONTAINER_NAME", "video-edit-agent")

dynamodb = boto3.resource("dynamodb")
ecs = boto3.client("ecs")


def handler(event, context):
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return error_response(400, "Invalid JSON body")

    instruction = body.get("instruction", "").strip()
    input_keys = body.get("input_keys", [])

    if not instruction:
        return error_response(400, "instruction is required")
    if not input_keys:
        return error_response(400, "input_keys must not be empty")

    task_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    # Write PENDING record to DynamoDB
    table = dynamodb.Table(DYNAMODB_TABLE)
    table.put_item(
        Item={
            "task_id": task_id,
            "status": "PENDING",
            "instruction": instruction,
            "input_keys": input_keys,
            "created_at": now,
            "updated_at": now,
        }
    )

    # Trigger ECS Fargate task
    ecs.run_task(
        cluster=ECS_CLUSTER,
        taskDefinition=ECS_TASK_DEFINITION,
        launchType="FARGATE",
        networkConfiguration={
            "awsvpcConfiguration": {
                "subnets": ECS_SUBNET_IDS,
                "securityGroups": [ECS_SECURITY_GROUP_ID],
                "assignPublicIp": "ENABLED",
            }
        },
        overrides={
            "containerOverrides": [
                {
                    "name": CONTAINER_NAME,
                    "environment": [
                        {"name": "TASK_ID", "value": task_id},
                        {"name": "S3_BUCKET", "value": S3_BUCKET},
                        {"name": "DYNAMODB_TABLE", "value": DYNAMODB_TABLE},
                        {"name": "INSTRUCTION", "value": instruction},
                        {"name": "INPUT_KEYS", "value": json.dumps(input_keys)},
                    ],
                }
            ]
        },
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

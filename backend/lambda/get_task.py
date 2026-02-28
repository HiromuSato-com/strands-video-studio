"""
GET /tasks/{id}

Returns the current status and metadata of a task from DynamoDB.
"""

import os
import json

import boto3
from boto3.dynamodb.conditions import Key

DYNAMODB_TABLE = os.environ["DYNAMODB_TABLE"]

dynamodb = boto3.resource("dynamodb")


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

    return {
        "statusCode": 200,
        "headers": cors_headers(),
        "body": json.dumps(item, default=str),
    }


def cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
    }

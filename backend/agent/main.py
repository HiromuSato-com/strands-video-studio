"""
Entry point for the ECS Fargate video editing task.

Environment variables (injected at ECS RunTask time):
  TASK_ID        - DynamoDB task ID
  S3_BUCKET      - S3 bucket name
  DYNAMODB_TABLE - DynamoDB table name
  INSTRUCTION    - Natural language editing instruction
  INPUT_KEYS     - JSON array of S3 keys for input files
  AWS_REGION     - AWS region
"""

import os
import json
import logging
from datetime import datetime, timezone

import boto3
from agent import create_agent

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
logger = logging.getLogger(__name__)


def get_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Required environment variable '{name}' is not set")
    return value


def update_task_status(table, task_id: str, **kwargs) -> None:
    kwargs["updated_at"] = datetime.now(timezone.utc).isoformat()
    update_expr = "SET " + ", ".join(f"#{k} = :{k}" for k in kwargs)
    expr_names = {f"#{k}": k for k in kwargs}
    expr_values = {f":{k}": v for k, v in kwargs.items()}
    table.update_item(
        Key={"task_id": task_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )


def main() -> None:
    task_id = get_env("TASK_ID")
    dynamodb_table_name = get_env("DYNAMODB_TABLE")
    instruction = get_env("INSTRUCTION")

    dynamodb = boto3.resource("dynamodb")
    table = dynamodb.Table(dynamodb_table_name)

    logger.info(f"Starting task {task_id}")
    update_task_status(table, task_id, status="RUNNING")

    try:
        agent = create_agent()
        logger.info(f"Executing instruction: {instruction}")
        result = agent(instruction)

        # Extract output_key from the agent's final response if present
        result_text = str(result)
        logger.info(f"Agent result: {result_text}")

        # Try to extract output_key from the result
        output_key = None
        try:
            import re
            match = re.search(r'"output_key"\s*:\s*"([^"]+)"', result_text)
            if match:
                output_key = match.group(1)
        except Exception:
            pass

        update_kwargs = {"status": "COMPLETED", "agent_result": result_text[:4000]}
        if output_key:
            update_kwargs["output_key"] = output_key

        update_task_status(table, task_id, **update_kwargs)
        logger.info(f"Task {task_id} completed. output_key={output_key}")

    except Exception as e:
        logger.exception(f"Task {task_id} failed")
        update_task_status(
            table,
            task_id,
            status="FAILED",
            error_message=str(e)[:2000],
        )
        raise


if __name__ == "__main__":
    main()

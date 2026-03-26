"""
Entry point for the video editing agent.

ECS Fargate (旧): __main__ ブロックから直接起動。
AgentCore Runtime (新): app.py の FastAPI エンドポイントから main() を呼び出す。

Environment variables (set before this module is imported):
  TASK_ID              - DynamoDB task ID
  S3_BUCKET            - S3 bucket name
  DYNAMODB_TABLE       - DynamoDB table name
  INSTRUCTION          - Natural language editing instruction
  INPUT_KEYS           - JSON array of S3 keys for input files
  NOVA_REEL_S3_BUCKET  - S3 bucket for Nova Reel output
  VIDEO_MODEL          - "nova_reel" | "none"
  TAVILY_API_KEY       - Tavily API key (optional)
"""

import os
import json
import logging
from datetime import datetime, timezone

import boto3
from mcp import StdioServerParameters, stdio_client
from strands.tools.mcp import MCPClient
from agent import create_agent
from tools import get_last_output_key

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
    video_model = os.environ.get("VIDEO_MODEL", "luma")

    # Append model hint so the agent picks the correct generation tool
    if video_model == "nova_reel":
        instruction += "\n[AI動画生成モデル: Amazon Nova Reel]"
    elif video_model == "luma":
        instruction += "\n[AI動画生成モデル: Luma AI Ray 2]"
    # "none": no tag appended — agent uses editing tools only

    dynamodb = boto3.resource("dynamodb")
    table = dynamodb.Table(dynamodb_table_name)

    logger.info(f"Starting task {task_id}")
    update_task_status(table, task_id, status="RUNNING")

    tavily_api_key = os.environ.get("TAVILY_API_KEY", "")

    try:
        # Tavily MCP クライアントを起動（API キーがあるときのみ）
        mcp_tools = []
        tavily_client = None
        if tavily_api_key:
            tavily_client = MCPClient(
                lambda: stdio_client(
                    StdioServerParameters(
                        command="tavily-mcp",
                        args=[],
                        env={**os.environ, "TAVILY_API_KEY": tavily_api_key},
                    )
                )
            )
            tavily_client.__enter__()
            mcp_tools = tavily_client.list_tools_sync()
            logger.info(f"Tavily MCP tools loaded: {[t.tool_name for t in mcp_tools]}")

        agent = create_agent(video_model=video_model, extra_tools=mcp_tools)
        logger.info(f"Executing instruction: {instruction}")
        result = agent(instruction)

        result_text = str(result)
        logger.info(f"Agent result: {result_text}")

        # Retrieve the output key recorded by the last tool upload
        output_key = get_last_output_key()
        logger.info(f"output_key from tools: {output_key}")

        if not output_key:
            logger.error(f"Task {task_id}: agent completed but produced no output file")
            update_task_status(
                table,
                task_id,
                status="FAILED",
                error_message="Agent completed but produced no output file. Check agent_result for details.",
                agent_result=result_text[:4000],
            )
            return

        update_task_status(
            table,
            task_id,
            status="COMPLETED",
            output_key=output_key,
            agent_result=result_text[:4000],
        )
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
    finally:
        if tavily_client:
            try:
                tavily_client.__exit__(None, None, None)
            except Exception:
                pass


if __name__ == "__main__":
    main()

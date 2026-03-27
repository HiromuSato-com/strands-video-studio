"""
SQS トリガーで起動し、Amazon Bedrock AgentCore Runtime を同期呼び出しするLambda。

create_task.py が SQS にメッセージを送信 → このLambdaが起動 →
AgentCore Runtime (POST /invocations) を呼び出してエージェントを実行。

タスクのステータス管理（RUNNING → COMPLETED/FAILED）は
AgentCore コンテナ内の app.py / main.py が行う。
このLambdaはAgentCore呼び出し自体が失敗した場合にのみFAILEDを書き込む。

Lambda timeout: 900秒（最大）
SQS visibility timeout: 900秒（Terraformで設定）
"""

import json
import logging
import os
import uuid
from datetime import datetime, timezone

import boto3

AGENTCORE_RUNTIME_ARN = os.environ["AGENTCORE_RUNTIME_ARN"]
AGENTCORE_REGION = os.environ.get("AGENTCORE_REGION", "us-east-1")
DYNAMODB_TABLE = os.environ["DYNAMODB_TABLE"]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
logger = logging.getLogger(__name__)

dynamodb = boto3.resource("dynamodb")


def handler(event, context):
    for record in event["Records"]:
        params = json.loads(record["body"])
        task_id = params.get("task_id", "unknown")
        logger.info(f"runner_lambda: starting task_id={task_id}")

        try:
            agentcore = boto3.client("bedrock-agentcore", region_name=AGENTCORE_REGION)
            response = agentcore.invoke_agent_runtime(
                agentRuntimeArn=AGENTCORE_RUNTIME_ARN,
                # runtimeSessionId はリクエストごとに一意である必要がある（33文字以上）
                runtimeSessionId=str(uuid.uuid4()),
                payload=json.dumps(params).encode("utf-8"),
            )
            # AgentCore Runtime はストリーミングレスポンスを返す
            response_stream = response.get("response") or response.get("body")
            if response_stream:
                response_body = response_stream.read()
                logger.info(
                    f"runner_lambda: task_id={task_id} response="
                    f"{response_body[:500].decode('utf-8', errors='replace')}"
                )
        except Exception as e:
            logger.exception(f"runner_lambda: AgentCore call failed for task_id={task_id}")
            # AgentCore呼び出し自体が失敗した場合にのみDynamoDBをFAILEDに更新
            # （正常な場合はコンテナ内のmain.pyが更新する）
            table = dynamodb.Table(DYNAMODB_TABLE)
            table.update_item(
                Key={"task_id": task_id},
                UpdateExpression="SET #s = :s, error_message = :e, updated_at = :u",
                ExpressionAttributeNames={"#s": "status"},
                ExpressionAttributeValues={
                    ":s": "FAILED",
                    ":e": f"AgentCore invocation failed: {str(e)[:1900]}",
                    ":u": datetime.now(timezone.utc).isoformat(),
                },
            )
            raise  # SQS がDLQに転送できるよう例外を再送出

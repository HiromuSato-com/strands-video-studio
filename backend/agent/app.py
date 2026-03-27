"""
FastAPI entry point for Amazon Bedrock AgentCore Runtime.

AgentCore Runtime は POST /invocations と GET /ping を port 8080 で待ち受ける。
各リクエストで TASK_ID などの環境変数をセットしてから tools/agent を再インポートする。
(tools.py がモジュールレベルで os.environ を読み込むため)
"""

import json
import logging
import os
import sys

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI()


@app.get("/ping")
def ping():
    """AgentCore Runtime のヘルスチェックエンドポイント。"""
    return {"status": "healthy"}


@app.post("/invocations")
async def invocations(request: Request):
    """
    AgentCore Runtime から呼ばれるメインエンドポイント。
    runner_lambda.py が送信したタスクパラメータを受け取り、
    Strands Agent を実行して DynamoDB を更新する。
    """
    body = await request.json()

    task_id = body.get("task_id", "")
    logger.info(f"Received invocation for task_id={task_id}")

    # ── 環境変数を設定（tools.py がモジュールレベルで読み込むため先に設定する）──
    os.environ["TASK_ID"] = task_id
    os.environ["S3_BUCKET"] = body.get("s3_bucket", "")
    os.environ["DYNAMODB_TABLE"] = body.get("dynamodb_table", "")
    os.environ["INSTRUCTION"] = body.get("instruction", "")
    os.environ["INPUT_KEYS"] = json.dumps(body.get("input_keys", []))
    os.environ["NOVA_REEL_S3_BUCKET"] = body.get("nova_reel_s3_bucket", "")
    os.environ["VIDEO_MODEL"] = body.get("video_model", "none")
    os.environ["TAVILY_API_KEY"] = body.get("tavily_api_key", "")

    # ── モジュールキャッシュをクリアして env var を再読み込みさせる ──────────────
    # tools.py は S3_BUCKET / TASK_ID をモジュールレベルで読み込むため、
    # リクエストごとに再インポートが必要。
    for mod_name in ["tools", "agent", "main"]:
        sys.modules.pop(mod_name, None)

    try:
        import main as main_mod  # noqa: PLC0415  (intentional deferred import)
        main_mod.main()
        return JSONResponse({"task_id": task_id, "status": "ok"})
    except Exception as e:
        logger.exception(f"Invocation failed for task_id={task_id}")
        return JSONResponse(
            {"task_id": task_id, "status": "error", "message": str(e)},
            status_code=500,
        )

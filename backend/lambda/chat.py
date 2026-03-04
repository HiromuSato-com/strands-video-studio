"""
POST /chat

action=message: { "session_id": "uuid", "message": "...", "action": "message" }
  -> { "reply": "...", "messages": [...] }

action=confirm: { "session_id": "uuid", "action": "confirm" }
  -> { "instruction": "..." }
"""

import os
import json
from datetime import datetime, timezone

import boto3

CHAT_TABLE = os.environ["CHAT_TABLE"]
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "us-east-1")
MODEL_ID = "us.anthropic.claude-sonnet-4-6"

dynamodb = boto3.resource("dynamodb")
bedrock = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)

SYSTEM_PROMPT_MESSAGE = """あなたはAI動画編集・生成スタジオのアシスタントです。
ユーザーが動画編集や生成の指示内容を固めるお手伝いをしてください。

利用可能な機能: trim_video / insert_image / concat_videos / add_text / \
add_audio / change_speed / fade_in_out / generate_video(Luma AI Ray 2) / \
generate_video_nova_reel(Amazon Nova Reel) / generate_image / generate_speech

応答ルール:
- 日本語で3〜4文以内で簡潔に応答する
- 不明な点（時間範囲・ファイル名・映像イメージ等）は具体的に質問する
- 内容が固まったら「確定しますか？」と提案する"""

CONFIRM_PROMPT = """以下の会話から動画編集・生成の指示文を1〜3文で生成してください。
- 日本語・「〜してください」形式
- 具体的な数値（秒数・ファイル名等）を含める
- 指示文のみ出力（前置き不要）

会話:
{conversation}"""


def handler(event, context):
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return error_response(400, "Invalid JSON body")

    session_id = body.get("session_id", "").strip()
    action = body.get("action", "message")

    if not session_id:
        return error_response(400, "session_id is required")

    if action == "message":
        message = body.get("message", "").strip()
        if not message:
            return error_response(400, "message is required")
        return handle_message(session_id, message)
    elif action == "confirm":
        return handle_confirm(session_id)
    else:
        return error_response(400, f"Unknown action: {action}")


def handle_message(session_id: str, message: str):
    messages = load_messages(session_id)
    messages.append({"role": "user", "content": message})

    reply = invoke_bedrock(messages, SYSTEM_PROMPT_MESSAGE)

    messages.append({"role": "assistant", "content": reply})
    save_messages(session_id, messages)

    return {
        "statusCode": 200,
        "headers": cors_headers(),
        "body": json.dumps({"reply": reply, "messages": messages}, ensure_ascii=False),
    }


def handle_confirm(session_id: str):
    messages = load_messages(session_id)
    if not messages:
        return error_response(400, "No chat history found for this session")

    conversation = "\n".join(
        f"{'ユーザー' if m['role'] == 'user' else 'AI'}: {m['content']}"
        for m in messages
    )
    prompt = CONFIRM_PROMPT.format(conversation=conversation)

    instruction = invoke_bedrock(
        [{"role": "user", "content": prompt}],
        system_prompt=None,
    )

    return {
        "statusCode": 200,
        "headers": cors_headers(),
        "body": json.dumps({"instruction": instruction.strip()}, ensure_ascii=False),
    }


def invoke_bedrock(messages: list, system_prompt: str | None) -> str:
    kwargs = {
        "modelId": MODEL_ID,
        "messages": [{"role": m["role"], "content": [{"text": m["content"]}]} for m in messages],
        "inferenceConfig": {"maxTokens": 512, "temperature": 0.7},
    }
    if system_prompt:
        kwargs["system"] = [{"text": system_prompt}]

    response = bedrock.converse(**kwargs)
    return response["output"]["message"]["content"][0]["text"]


def load_messages(session_id: str) -> list:
    table = dynamodb.Table(CHAT_TABLE)
    result = table.get_item(Key={"session_id": session_id})
    item = result.get("Item")
    if not item:
        return []
    return json.loads(item.get("messages", "[]"))


def save_messages(session_id: str, messages: list):
    now = datetime.now(timezone.utc).isoformat()
    table = dynamodb.Table(CHAT_TABLE)
    table.put_item(
        Item={
            "session_id": session_id,
            "messages": json.dumps(messages, ensure_ascii=False),
            "updated_at": now,
        }
    )


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

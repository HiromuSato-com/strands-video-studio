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

【利用可能な編集機能】
■ カット・結合
- trim_video: 動画を指定秒数でカット（例: 5秒〜30秒の部分を切り出す）
- concat_videos: 複数の動画を順番につなぐ
- crossfade_concat: クロスフェードトランジション付きで動画を結合（デフォルト0.5秒）

■ テキスト・画像合成
- add_text: 字幕・テロップを追加（日本語対応、位置・サイズ・色・表示時間を指定）
- insert_image: 動画の指定時間範囲に画像をフルフレームで挿入
- overlay_image: ロゴ・透過PNG・ピクチャーインピクチャー合成（位置・サイズ・透明度・表示時間を指定）

■ 音声
- add_audio: BGM・効果音を既存の音声にミックス（音量・ループ指定可）
- replace_audio: 音声トラックをまるごと差し替え
- extract_audio: 動画から音声をMP3で抽出
- adjust_volume: 音量調整（0.0〜4.0倍）

■ 速度・エフェクト
- change_speed: スロー・早送り（0.1〜10.0倍）
- fade_in_out: フェードイン・フェードアウト（映像＋音声）
- color_filter: カラーフィルター（grayscale=モノクロ / brightness=明度 / contrast=コントラスト）

■ サイズ・向き
- resize_crop: 解像度変更・クロップ（縦横比変換などに使用）
- rotate_flip: 回転・左右/上下反転

【利用可能なAI生成機能】
- generate_video (Luma AI Ray 2): テキストから動画生成（5秒 or 9秒、720p/540p、16:9など複数アスペクト比対応）
- generate_video_nova_reel (Amazon Nova Reel): テキストから動画生成（最大6秒、1280×720固定）
- generate_image (Stable Diffusion XL): テキストから画像生成（PNG、サイズ指定可）
- generate_speech (Amazon Polly): テキストを音声合成（日本語: Takumi男性/Kazuha女性、英語: Joanna/Matthewなど）

応答ルール:
- 日本語で3〜4文以内で簡潔に応答する
- どんな編集をしたいか聞かれたら、上記の機能一覧をわかりやすく案内する
- 不明な点（時間範囲・ファイル名・映像イメージ・テキスト内容等）は具体的に質問する
- 複数の編集を組み合わせる場合は手順を整理して提案する
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

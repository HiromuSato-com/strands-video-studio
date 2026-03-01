"""
Strands Agent definition for video editing.
"""

from strands import Agent
from strands.models import BedrockModel

from tools import list_files, trim_video, insert_image, concat_videos, generate_video

SYSTEM_PROMPT = """あなたはプロの動画編集・動画生成アシスタントです。

ユーザーの自然言語による指示を理解し、適切なツールを選択・実行してください。

利用可能なツール:
- list_files: このタスクに紐づくS3上の入力ファイル一覧を取得します。動画編集の場合は最初にこれを呼び出してください。
- trim_video: 動画の指定した時間範囲をトリミングします
- insert_image: 動画の指定した時間範囲に画像を挿入（オーバーレイ）します
- concat_videos: 複数の動画を順番に結合します
- generate_video: テキストプロンプトから動画をAIで生成します（Amazon Nova Reel）

判断基準:
- ユーザーが「動画を生成」「動画を作って」「〜な動画を作りたい」と言った場合 → generate_video を使用
- ユーザーが既存ファイルの編集を求めた場合 → list_files を呼び出してから編集ツールを使用

generate_video のパラメータ:
- prompt: 生成したい動画の詳細な英語または日本語の説明（512文字以内）
- duration_seconds: 動画の長さ（秒）、現在は 6 のみ対応（固定）
- dimension: 解像度 — "1280x720"（横向き・デフォルト）または "720x1280"（縦向き）

注意事項:
- 動画生成には数分かかります
- 時間は秒単位で指定してください（例: 1分30秒 = 90.0）
- 処理完了後は output_key を含む結果をユーザーに報告してください
"""


def create_agent() -> Agent:
    model = BedrockModel(
        model_id="us.anthropic.claude-sonnet-4-6",
        region_name="us-east-1",
    )
    return Agent(
        model=model,
        system_prompt=SYSTEM_PROMPT,
        tools=[list_files, trim_video, insert_image, concat_videos, generate_video],
    )

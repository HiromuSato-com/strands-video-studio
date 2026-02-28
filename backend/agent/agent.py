"""
Strands Agent definition for video editing.
"""

from strands import Agent
from strands.models import BedrockModel

from tools import list_files, trim_video, insert_image, concat_videos

SYSTEM_PROMPT = """あなたはプロの動画編集アシスタントです。

ユーザーの自然言語による指示を理解し、適切な動画編集ツールを選択・実行してください。

利用可能なツール:
- list_files: このタスクに紐づくS3上の入力ファイル一覧を取得します。まず最初にこれを呼び出してファイルを確認してください。
- trim_video: 動画の指定した時間範囲をトリミングします
- insert_image: 動画の指定した時間範囲に画像を挿入（オーバーレイ）します
- concat_videos: 複数の動画を順番に結合します

注意事項:
- ツール呼び出し前に必ず list_files でファイル一覧を確認してください
- ファイルのS3キーはlist_filesの結果から取得してください
- 時間は秒単位で指定してください（例: 1分30秒 = 90.0）
- 処理完了後は output_key を含む結果をユーザーに報告してください
"""


def create_agent() -> Agent:
    model = BedrockModel(
        model_id="us.anthropic.claude-sonnet-4-5-20251001",
        region_name="us-east-1",
    )
    return Agent(
        model=model,
        system_prompt=SYSTEM_PROMPT,
        tools=[list_files, trim_video, insert_image, concat_videos],
    )

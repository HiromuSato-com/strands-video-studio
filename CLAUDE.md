# CLAUDE.md — video-edit-by-strands-agents

## プロジェクト概要

Strands Agents + Claude Sonnet 4.6 + MoviePy + Amazon Nova Reel を使った
サーバーレス AI 動画編集・動画生成アプリ（AWS）。

## ディレクトリ構成

```
video-edit-by-strands-agents/
├── backend/
│   ├── agent/              # ECS Fargate で動くコンテナ
│   │   ├── agent.py        # Strands Agent 定義（BedrockModel + system_prompt）
│   │   ├── tools.py        # @tool デコレータ付き S3 操作・動画ツール群
│   │   ├── main.py         # Fargate コンテナ エントリポイント（DynamoDB ステータス管理）
│   │   ├── Dockerfile      # static ffmpeg (mwader/static-ffmpeg) + fonts-noto-cjk (CJK フォント)
│   │   └── requirements.txt
│   └── lambda/             # API Gateway → Lambda
│       ├── create_task.py  # POST /tasks — DynamoDB 書き込み + ECS RunTask
│       ├── get_task.py     # GET /tasks/{id} — ステータスポーリング
│       ├── upload_url.py   # GET /upload-url — S3 presigned PUT URL
│       ├── download_url.py # GET /download-url/{id} — S3 presigned GET URL
│       ├── chat.py         # POST /chat — チャット履歴 DynamoDB 保存・取得
│       ├── analyzer.py     # S3 PUT トリガー — アップロードファイルを Claude Vision で即時分析
│       └── delete_file.py  # DELETE /files — 入力ファイル削除（tasks/*/input/* のみ）
├── frontend/
│   └── src/
│       ├── App.tsx          # メイン 4 ステップ UI（日本語）
│       ├── api/client.ts    # API Gateway クライアント
│       ├── components/      # UploadZone, InstructionBox, TaskStatus, CompletionModal,
│       │                    # ChatModal（AI チャットモード）, ChatBox（チャット本体 + TypingDots）,
│       │                    # ChatPreviewModal（確定前プレビュー）, DownloadButton,
│       │                    # Stepper（水平ステッパー）, WelcomeModal（初回オンボーディング）,
│       │                    # VideoPreview, etc.
│       ├── hooks/useTaskPoller.ts  # タスクポーリング hook
│       └── lib/             # snd-lib サウンドユーティリティ
└── infrastructure/          # Terraform（フラット構成、モジュールなし）
    ├── main.tf              # provider 設定（ap-northeast-1 + us-east-1 alias: useast1）
    ├── variables.tf         # 変数定義（nova_reel_s3_bucket_name 等）
    ├── vpc.tf               # VPC / パブリックサブネット×2 / IGW
    ├── ecs.tf               # ECS クラスター + タスク定義（2vCPU / 4GB）
    ├── lambda.tf            # Lambda 関数×7
    ├── api_gateway.tf       # HTTP API v2
    ├── s3.tf                # assets バケット + frontend バケット
    ├── dynamodb.tf          # tasks / file_analysis / chat_sessions テーブル
    ├── iam.tf               # ECS 実行ロール / タスクロール / Lambda ロール
    ├── cloudfront.tf        # フロントエンド CDN
    ├── ecr.tf               # ECR リポジトリ
    └── outputs.tf           # api_url, frontend_url, s3_bucket, ecr_repository_url 等
```

## アーキテクチャ

```
Browser → CloudFront (S3) → React/Vite UI
            ↓
          API Gateway HTTP API v2
            ↓
          Lambda (Python 3.13)
            ↓  POST /tasks → SQS → runner Lambda → AgentCore Runtime
          AgentCore Runtime (us-east-1)
            └─ Strands Agent (claude-sonnet-4-6, us-east-1)
               ├─ MoviePy: 25種類の動画編集・分析ツール
               ├─ Amazon Nova Reel (amazon.nova-reel-v1:0, us-east-1)
               ├─ Amazon Nova Canvas (amazon.nova-canvas-v1:0, us-east-1)
               └─ Amazon Polly (ap-northeast-1)
            ↕
          DynamoDB (task status)   S3 (assets, ap-northeast-1)
```

## 主要 AWS サービスとリージョン

| サービス | リージョン | 用途 |
|---------|-----------|------|
| AgentCore Runtime | us-east-1 | 動画処理コンテナ（ARM64） |
| Lambda / API GW | ap-northeast-1 | REST API |
| S3 assets | ap-northeast-1 | 入出力ファイル |
| S3 frontend | ap-northeast-1 | React 静的ファイル |
| CloudFront | グローバル | フロントエンド CDN |
| DynamoDB | ap-northeast-1 | タスクステータス / ファイル分析結果 / チャット履歴 |
| Bedrock (Claude) | us-east-1 | `us.anthropic.claude-sonnet-4-6` |
| Bedrock (Nova Reel) | us-east-1 | `amazon.nova-reel-v1:1` |
| Bedrock (Nova Canvas) | us-east-1 | `amazon.nova-canvas-v1:0` |
| Amazon Polly | ap-northeast-1 | 音声合成（generate_speech） |
| S3 Nova 出力 | us-east-1 | Bedrock コンソール自動作成バケット |
| SQS | ap-northeast-1 | タスクキュー（create_task → runner Lambda） |
| Tavily MCP | 外部 API | Web 検索（stdio subprocess, AgentCore コンテナ内） |

## S3 バケット

| バケット名 | リージョン | 管理 |
|-----------|-----------|------|
| `video-edit-assets-{account}` | ap-northeast-1 | Terraform |
| `video-edit-frontend-{account}` | ap-northeast-1 | Terraform |
| `bedrock-video-generation-us-east-1-{id}` | us-east-1 | Bedrock 自動作成（data source 参照） |

バケット名は `infrastructure/variables.tf` の `nova_reel_s3_bucket_name` で管理。

## API エンドポイント

| Method | Path | Lambda | 説明 |
|--------|------|--------|------|
| GET | /upload-url | upload_url.py | S3 presigned PUT URL |
| POST | /tasks | create_task.py | タスク作成 + Fargate 起動 |
| GET | /tasks/{id} | get_task.py | ステータスポーリング |
| POST | /tasks/{id}/approve | approve_task.py | AI 生成承認フロー（承認/拒否） |
| GET | /download-url/{id} | download_url.py | S3 presigned GET URL |
| POST | /chat | chat.py | AI チャット（DynamoDB session 管理） |
| DELETE | /files | delete_file.py | 入力ファイル削除（tasks/*/input/* のみ） |

> `analyzer.py` は API Gateway 経由ではなく S3 PUT イベントトリガー（Lambda）で動作する。

## AgentCore コンテナ 環境変数（SQS メッセージ経由で注入）

| 変数名 | 設定元 | 説明 |
|-------|-------|------|
| `TASK_ID` | create_task.py | DynamoDB タスク ID |
| `S3_BUCKET` | create_task.py | assets バケット名 |
| `DYNAMODB_TABLE` | create_task.py | DynamoDB テーブル名 |
| `INSTRUCTION` | create_task.py | 自然言語指示 |
| `INPUT_KEYS` | create_task.py | JSON 配列の S3 入力キー |
| `NOVA_REEL_S3_BUCKET` | create_task.py | Nova Reel 出力バケット（us-east-1） |
| `VIDEO_MODEL` | create_task.py | `"nova_reel"` / `"none"`（AI生成なし編集のみ） |
| `TAVILY_API_KEY` | create_task.py | Tavily Web 検索 API キー（空の場合は Tavily 無効） |

## Strands Agents コーディングパターン

```python
from strands import Agent, tool
from strands.models import BedrockModel

@tool
def my_tool(param: str) -> str:
    """ツールの説明（Agent が読む）"""
    ...

model = BedrockModel(model_id="us.anthropic.claude-sonnet-4-6", region_name="us-east-1")
agent = Agent(model=model, system_prompt="...", tools=[my_tool])
result = agent("自然言語指示")
```

### ToolContext による承認フロー

```python
from strands import tool
from strands.types.tools import ToolContext

@tool(context=True)
def my_tool(param: str, tool_context: ToolContext = None) -> str:
    """承認が必要なツール"""
    # 初回呼び出し: InterruptException を raise してエージェントを一時停止
    # resume 後の呼び出し: ユーザーの応答（"APPROVED" / "DENIED"）を返す
    response = tool_context.interrupt(
        "approve_generation",
        reason={"tool": "ツール名", "prompt": param},
    )
    if response != "APPROVED":
        return json.dumps({"status": "cancelled"})
    # ... 処理続行
```

### MCP ツール（Tavily Web 検索）

```python
from mcp import StdioServerParameters, stdio_client
from strands.tools.mcp import MCPClient

tavily_client = MCPClient(
    lambda: stdio_client(
        StdioServerParameters(
            command="tavily-mcp",   # Dockerfile で npm install -g tavily-mcp 済み
            args=[],
            env={**os.environ, "TAVILY_API_KEY": api_key},
        )
    )
)
# コンテキストマネージャが必須
tavily_client.__enter__()
mcp_tools = tavily_client.list_tools_sync()   # tavily-search, tavily-extract 等
agent = Agent(tools=[*existing_tools, *mcp_tools])
```

## 動画生成フロー（Amazon Nova Reel）

1. `create_task.py` → SQS に JSON メッセージを送信
2. runner Lambda が SQS を受信 → AgentCore Runtime を同期呼び出し
3. `tools.py: generate_video_nova_reel()` → `bedrock.start_async_invoke("amazon.nova-reel-v1:1", ...)`
4. Nova Reel が `bedrock-video-generation-us-east-1-*` に output.mp4 を書き込む
5. `s3.copy_object()` → `video-edit-assets-{account}` (ap-northeast-1) にコピー
6. `main.py` が `get_last_output_key()` で output_key を取得 → DynamoDB を COMPLETED に更新

output_key が None のまま = FAILED として DynamoDB に書く（バグ修正済み）。

## 開発フロー

詳細は `CONTRIBUTING.md` を参照。概要：

1. **議論・方針決定** — 何を変えるか合意してから実装する
2. **ブランチ作成** — `git checkout -b feature/<name>` で作業ブランチを切る（必須）
3. **既存コードを読む** — Read で対象ファイルを確認してから Edit する
4. **実装** — 最小限の変更。過剰な抽象化・将来への備えは入れない
5. **ローカルビルド** — `cd frontend && npm run build --no-proxy` でエラー確認
6. **コミット & プッシュ** — `git push origin feature/<name>`
7. **PR 作成①** — `feature/<name>` → `origin/main` へ PR を作成・マージ
8. **本番デプロイ**（変更内容に応じて実施）
   - **フロントエンド変更時** — `./scripts/deploy-frontend.sh`（ビルド〜S3〜CloudFront invalidation）
   - **Lambda 変更時** — `aws lambda update-function-code` で直接更新（zip → upload）
   - **インフラ変更時（Terraform）**:
     ```bash
     aws sso login --profile AWSAdministratorAccess-<account-id>
     export AWS_PROFILE=AWSAdministratorAccess-<account-id>
     cd infrastructure && terraform apply
     ```
   - **AgentCore コンテナ変更時** — `./scripts/deploy-agentcore.sh`（ARM64 build → ECR push → AgentCore Runtime 更新）
9. **PR 作成②** — `origin/main` → `public/main` へ PR を作成・マージ
   ```bash
   git checkout -b sync/<feature-name>   # origin/main から sync ブランチを作成
   git push public sync/<feature-name>   # public リポジトリ（strands-video-studio）に push
   # GitHub (strands-video-studio) で sync/<feature-name> → main の PR を作成・マージ
   git branch -d sync/<feature-name>     # ローカルの sync ブランチを削除
   ```

### フロントエンドデプロイ（ワンコマンド）

```bash
./scripts/deploy-frontend.sh
# AWS_PROFILE=<profile> ./scripts/deploy-frontend.sh  # プロファイル指定
# PUSH_PUBLIC=false ./scripts/deploy-frontend.sh       # public push をスキップ
```

## デプロイ手順

### 1. Bedrock モデル有効化（初回のみ）
- us-east-1: `us.anthropic.claude-sonnet-4-6` を有効化
- us-east-1: `amazon.nova-reel-v1:0` を有効化 → 自動作成バケット名を `terraform.tfvars` の `nova_reel_s3_bucket_name` に設定

### 2. Terraform
```bash
# SSO ログイン後、AWS_PROFILE を設定してから実行
aws sso login --profile AWSAdministratorAccess-<account-id>
export AWS_PROFILE=AWSAdministratorAccess-<account-id>
cd infrastructure
terraform init
terraform apply
```
> **注意**: Terraform プロバイダーは `AWS_PROFILE` 環境変数を使用する（`profile` ハードコードなし）。
> `terraform.tfvars` に `aws_profile` は不要。SSO login 後に環境変数で制御する。

### 3. Docker ビルド & ECR プッシュ
```bash
# ECR ログイン（プロファイル名は適宜変更）
aws ecr get-login-password --region ap-northeast-1 --profile <your-aws-profile> \
  | docker login --username AWS --password-stdin <account>.dkr.ecr.ap-northeast-1.amazonaws.com

# ビルド（Windows プロキシを無効化）
docker build \
  --build-arg http_proxy="" --build-arg https_proxy="" \
  --build-arg HTTP_PROXY="" --build-arg HTTPS_PROXY="" \
  -t video-edit-agent ./backend/agent

# タグ & プッシュ
docker tag video-edit-agent:latest <ecr_url>:latest
docker push <ecr_url>:latest
```

### 4. フロントエンドビルド & デプロイ
```bash
cd frontend
# frontend/.env に VITE_API_URL=<api_url> を設定
npm install --no-proxy
npm run build
aws s3 sync dist/ s3://<frontend-bucket>/ --profile <your-aws-profile>
```

## ローカル開発メモ（Windows / Git Bash）

- `python3` は Microsoft Store スタブ → `python` を使う
- Docker build でプロキシが干渉 → `--build-arg http_proxy="" ...` を必ず付ける
- npm install でグローバルプロキシが干渉 → `--no-proxy` フラグを付ける
- AWS CLI で `/ecs/...` 等のパスが Windows パスに変換 → `MSYS_NO_PATHCONV=1` を前置
- ECS ログの絵文字が CP932 端末でエラー → `2>/dev/null | python -c "import sys; print(sys.stdin.buffer.read().decode('utf-8', errors='replace'))"` でデコード
- `frontend/tsconfig.json` に `"types": ["vite/client"]` が必要（`import.meta.env` 型解決）

## Terraform 変数ファイル

- `infrastructure/terraform.tfvars` — 実際の値（`.gitignore` で除外済み、git 管理外）
- `infrastructure/terraform.tfvars.example` — サンプル（git 管理）
- `terraform.tfvars` に必須設定:
  - `nova_reel_s3_bucket_name` — Bedrock コンソールが us-east-1 に自動作成したバケット名
  - `agentcore_runtime_arn` — deploy-agentcore.sh 実行後に自動書き込まれる
  - ※ `aws_profile` は **不要**（`AWS_PROFILE` 環境変数で制御）
- バケット名変更時は `terraform.tfvars` を更新してから `terraform apply`

## フロントエンド UI 設計

- React + Vite + TypeScript + TailwindCSS
- 4 ステップフロー: ファイル選択（任意）→ 創作指示入力 → 処理状況 → 結果プレビュー
- 日本語 UI、温かいリネン系カラーパレット（琥珀・コニャック、accent: `#8B5E34`）
- `snd-lib` によるサウンドフィードバック（RUNNING/COMPLETED/FAILED で異なる音）
- `Stepper.tsx` — ヘッダー直下に表示する水平ステッパー（4ステップ、完了/アクティブ/未来の状態を視覚化）
- `WelcomeModal.tsx` — 初回アクセス時のみ表示する 3 スライドオンボーディングモーダル
  - `localStorage: "welcome_shown_v1"` で表示済み管理
- `InstructionBox.tsx` — 創作指示入力エリア
  - サンプルプロンプトを「編集系」「生成系」に分類し、`hasFiles` prop でファイルあり→編集系優先、なし→生成系優先
  - 「↓ クリックで入力できます」ラベル、「何を作りたいか自由に書いてください」補足テキスト
- 左カラム（ファイル選択）に「任意」バッジ + ファイル 0 件時に「スキップ（テキストから生成）」リンク
- 中カラム上部にセグメントコントロール（「直接入力」/「AIと相談しながら作成」）でモード切替
- CTA ボタン（「創作を開始」）: `instruction` が空の場合 `disabled`（`#C4B8A8` グレー）、入力済みで hover 時 `scale(1.02)`
- AI 動画生成モデル選択ドロップダウン — モデル選択時にその特徴パネルを直下に表示
  - Amazon Nova Reel: ブランド一貫性・カメラコントロール・短尺量産の強みを箇条書き
- `ChatModal.tsx` — AI と対話しながら指示内容を整理するチャットモーダル
  - AI 処理中: メッセージングアプリ風タイピングインジケーター（`TypingDots`）— 小アバター + 吹き出しバブル内に3ドットが順番に浮かぶアニメ（`typingPulse` キーフレーム）
  - AI メッセージ: マークダウンレンダリング対応（見出し `##`、太字 `**`、斜体 `*`、インラインコード `` ` ``、コードブロック ` ``` ` ）
  - ユーザーメッセージを送信直後に楽観的表示（API レスポンス待ちでも即時表示）、エラー時はロールバック
  - 会話リセットボタン（新しいセッション ID を生成してチャット履歴をクリア）
  - 確定ボタン押下時: `confirmChat` API → ChatModal を閉じる → `ChatPreviewModal` で内容確認 → 指示欄に反映
  - `chatSessionId` は localStorage に保存せずアプリ起動ごとに新規生成（ページリロードで自動的に新セッション開始）
  - チャット会話履歴はサーバー側 DynamoDB（`CHAT_TABLE`）に `session_id` キーで保存（`backend/lambda/chat.py`）
- タスク完了時に `CompletionModal` でプレビュー + ダウンロード

## DynamoDB テーブル

| テーブル名 | PK | 用途 |
|-----------|-----|------|
| `{project}-tasks` | `task_id` | タスクステータス管理 |
| `{project}-file-analysis` | `s3_key` | アップロードファイルの分析結果（TTL 24h） |
| `{project}-chat-sessions` | `session_id` | チャット会話履歴（`CHAT_TABLE`） |

### タスクステータス遷移

```
PENDING → RUNNING → WAITING_APPROVAL（AI生成前の承認待ち）
                  ↓ 承認 → RUNNING → COMPLETED（output_key あり）
                  ↓ 拒否 → RUNNING → COMPLETED / FAILED
                  → COMPLETED（output_key あり）
                  → FAILED（output_key なし、または例外）
```

#### 承認フロー（ToolContext）
- `generate_video_nova_reel` / `generate_image` / `generate_speech` は実行前に `tool_context.interrupt()` でユーザー確認を求める
- ECS コンテナが DynamoDB に `WAITING_APPROVAL` を書き込み、`approval_response` フィールドをポーリング（最大3日間）
- フロントエンドが `WAITING_APPROVAL` を検知 → 承認ダイアログを表示
- ユーザーが `POST /tasks/{id}/approve` を呼ぶと ECS が再開

### ファイル分析フロー（analyzer.py）

1. ユーザーがファイルをアップロード → S3 `tasks/*/input/*` に PUT
2. S3 PUT イベント → `analyzer` Lambda が自動起動
3. 画像（JPG/PNG/WEBP）: Claude Vision でビジュアル分析
4. 動画（MP4/MOV 等）: ファイル名・サイズから Claude がテキスト分析
5. 分析結果を `file_analysis` テーブルに保存（TTL 24h）
6. チャット init 時にフロントエンドが分析結果を参照してチャット提案を強化

## ツール一覧（backend/agent/tools.py + Tavily MCP）

### Web 検索（Tavily MCP — stdio subprocess）
| ツール名 | 説明 |
|---------|------|
| `tavily-search` | リアルタイム Web 検索。スタイル参考・BGMジャンル・プロンプトのアイデア調査に使う |
| `tavily-extract` | 指定 URL のページ内容を抽出する |
| `tavily-map` | サイトのページ構造をマッピング |
| `tavily-crawl` | サイトを体系的にクロール |

> `TAVILY_API_KEY` 環境変数が設定されている場合のみ有効。空の場合は Tavily なしで起動。

### ファイル操作
| ツール名 | 説明 |
|---------|------|
| `list_files` | S3 入力ファイル一覧取得（編集タスクの最初に呼ぶ） |

### 動画編集（MoviePy）
| ツール名 | 説明 |
|---------|------|
| `trim_video` | 動画トリミング（start_sec〜end_sec） |
| `insert_image` | 動画への画像挿入（指定時間範囲でフルフレームオーバーレイ） |
| `image_to_clip` | 静止画→動画クリップ変換（スライド風動画作成に使用） |
| `concat_videos` | 複数動画の順番結合 |
| `add_text` | 字幕・テロップのオーバーレイ（日本語/CJK対応、IPA Gothic フォント使用） |
| `add_audio` | BGM・効果音を既存音声にミックス |
| `replace_audio` | 音声トラックを差し替え |
| `change_speed` | 再生速度変更（スロー・早送り、0.1〜10.0倍） |
| `fade_in_out` | フェードイン・フェードアウト（映像＋音声） |
| `crossfade_concat` | クロスフェードトランジション付き動画結合 |
| `resize_crop` | 解像度変更・クロップ |
| `rotate_flip` | 回転・反転（左右/上下） |
| `overlay_image` | 画像の透過合成オーバーレイ（ロゴ・PinP） |
| `extract_audio` | 音声をMP3で抽出 |
| `adjust_volume` | 音量調整（0.0〜4.0倍） |
| `color_filter` | カラーフィルター（grayscale / brightness / contrast） |

### 動画分析
| ツール名 | 説明 |
|---------|------|
| `analyze_video` | フレーム抽出 + Claude Vision で動画内容を分析（シーン・人物・雰囲気等） |
| `transcribe_video` | Amazon Transcribe で動画の音声をテキスト化（語レベルタイムスタンプ付き） |
| `detect_scenes` | ffmpeg でシーンチェンジを自動検出（タイムスタンプ一覧を返す） |

### AI 生成
| ツール名 | 説明 |
|---------|------|
| `generate_video_nova_reel` | Amazon Nova Reel でテキストから動画生成（最大6s, 1280×720固定, us-east-1, `nova-reel-v1:1`）。**実行前に承認フローあり** |
| `generate_image` | Amazon Nova Canvas で画像生成（PNG, us-east-1）。`negative_prompt` でネガティブプロンプト指定可。**実行前に承認フローあり** |
| `generate_speech` | Amazon Polly でテキスト音声合成（MP3, ap-northeast-1）。**実行前に承認フローあり** |

## よくあるトラブル

| 症状 | 原因 / 対処 |
|------|------------|
| `/download-url/{id}` が 500 | DynamoDB に output_key がない（タスク FAILED）→ AgentCore ログを確認 |
| Nova Reel 生成がタイムアウト | 生成に最大 15 分かかる。ポーリング継続 |
| Docker build でネットワークエラー | プロキシ引数 `--build-arg http_proxy=""` を追加 |
| `python3: command not found` | Git Bash では `python` を使う |
| AgentCore ログが文字化け | `MSYS_NO_PATHCONV=1` + UTF-8 デコードスクリプトを使う |
| Bedrock モデルが見つからない | 対象リージョンでモデルを有効化済みか確認 |
| チャットモーダルでメッセージリストがスクロールできない | `ChatModal.tsx` の wrapper div に `flex flex-col` が必要（`overflow-y-auto` が効かない） |
| チャットリセット後も過去の会話が表示される | `chatSessionId` を localStorage で保持すると DynamoDB の過去履歴が復元される → アプリ起動ごとに新規 UUID を生成すること |
| AI 生成タスクが承認待ちのまま進まない | フロントエンドで `WAITING_APPROVAL` ダイアログが表示されているか確認。表示されない場合は AgentCore ログで `approval_request` フィールドを確認 |
| 承認後もタスクが動かない | AgentCore コンテナが DynamoDB の `approval_response` をポーリング中（10秒間隔）。少し待つ。タイムアウトは3日間 |
| Tavily MCP が起動しない | AgentCore ログで `Tavily MCP tools loaded` が出るか確認。`TAVILY_API_KEY` が Lambda 環境変数に設定されているか `terraform apply` 済みか確認 |

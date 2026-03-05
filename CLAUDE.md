# CLAUDE.md — video-edit-by-strands-agents

## プロジェクト概要

Strands Agents + Claude Sonnet 4.6 + MoviePy + Luma AI Ray 2 / Amazon Nova Reel を使った
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
│       └── download_url.py # GET /download-url/{id} — S3 presigned GET URL
├── frontend/
│   └── src/
│       ├── App.tsx          # メイン 4 ステップ UI（日本語）
│       ├── api/client.ts    # API Gateway クライアント
│       ├── components/      # UploadZone, InstructionBox, TaskStatus, CompletionModal,
│       │                    # ChatModal（AI チャットモード）, ChatPreviewModal（確定前プレビュー）,
│       │                    # Stepper（水平ステッパー）, WelcomeModal（初回オンボーディング）,
│       │                    # VideoPreview, etc.
│       ├── hooks/useTaskPoller.ts  # タスクポーリング hook
│       └── lib/             # snd-lib サウンドユーティリティ
└── infrastructure/          # Terraform（フラット構成、モジュールなし）
    ├── main.tf              # provider 設定（ap-northeast-1 + us-west-2 alias: uswest2）
    ├── variables.tf         # 変数定義（luma_s3_bucket_name, nova_reel_s3_bucket_name 等）
    ├── vpc.tf               # VPC / パブリックサブネット×2 / IGW
    ├── ecs.tf               # ECS クラスター + タスク定義（2vCPU / 4GB）
    ├── lambda.tf            # Lambda 関数×4
    ├── api_gateway.tf       # HTTP API v2
    ├── s3.tf                # assets バケット + frontend バケット
    ├── dynamodb.tf          # tasks テーブル（task_id がパーティションキー）
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
            ↓  POST /tasks → ECS RunTask
          ECS Fargate (ap-northeast-1)
            └─ Strands Agent (claude-sonnet-4-6, us-east-1)
               ├─ MoviePy: 20種類の動画編集ツール
               ├─ Luma AI Ray 2 (luma.ray-v2:0, us-west-2)
               ├─ Amazon Nova Reel (amazon.nova-reel-v1:0, us-east-1)
               ├─ Stable Diffusion XL (stability.stable-diffusion-xl-v1, us-east-1)
               └─ Amazon Polly (ap-northeast-1)
            ↕
          DynamoDB (task status)   S3 (assets, ap-northeast-1)
```

## 主要 AWS サービスとリージョン

| サービス | リージョン | 用途 |
|---------|-----------|------|
| ECS Fargate | ap-northeast-1 | 動画処理コンテナ |
| Lambda / API GW | ap-northeast-1 | REST API |
| S3 assets | ap-northeast-1 | 入出力ファイル |
| S3 frontend | ap-northeast-1 | React 静的ファイル |
| CloudFront | グローバル | フロントエンド CDN |
| DynamoDB | ap-northeast-1 | タスクステータス |
| Bedrock (Claude) | us-east-1 | `us.anthropic.claude-sonnet-4-6` |
| Bedrock (Luma) | us-west-2 | `luma.ray-v2:0` |
| Bedrock (Nova) | us-east-1 | `amazon.nova-reel-v1:0` |
| Bedrock (SDXL) | us-east-1 | `stability.stable-diffusion-xl-v1` |
| Amazon Polly | ap-northeast-1 | 音声合成（generate_speech） |
| S3 Luma 出力 | us-west-2 | Bedrock コンソール自動作成バケット |
| S3 Nova 出力 | us-east-1 | Bedrock コンソール自動作成バケット |

## S3 バケット

| バケット名 | リージョン | 管理 |
|-----------|-----------|------|
| `video-edit-assets-{account}` | ap-northeast-1 | Terraform |
| `video-edit-frontend-{account}` | ap-northeast-1 | Terraform |
| `bedrock-video-generation-us-west-2-{id}` | us-west-2 | Bedrock 自動作成（data source 参照） |
| `bedrock-video-generation-us-east-1-{id}` | us-east-1 | Bedrock 自動作成（data source 参照） |

バケット名は `infrastructure/variables.tf` の `luma_s3_bucket_name` / `nova_reel_s3_bucket_name` で管理。

## API エンドポイント

| Method | Path | Lambda | 説明 |
|--------|------|--------|------|
| GET | /upload-url | upload_url.py | S3 presigned PUT URL |
| POST | /tasks | create_task.py | タスク作成 + Fargate 起動 |
| GET | /tasks/{id} | get_task.py | ステータスポーリング |
| GET | /download-url/{id} | download_url.py | S3 presigned GET URL |

## ECS コンテナ 環境変数（RunTask 時に注入）

| 変数名 | 設定元 | 説明 |
|-------|-------|------|
| `TASK_ID` | create_task.py | DynamoDB タスク ID |
| `S3_BUCKET` | create_task.py | assets バケット名 |
| `DYNAMODB_TABLE` | create_task.py | DynamoDB テーブル名 |
| `INSTRUCTION` | create_task.py | 自然言語指示 |
| `INPUT_KEYS` | create_task.py | JSON 配列の S3 入力キー |
| `LUMA_S3_BUCKET` | create_task.py | Luma AI 出力バケット（us-west-2） |
| `NOVA_REEL_S3_BUCKET` | create_task.py | Nova Reel 出力バケット（us-east-1） |
| `VIDEO_MODEL` | create_task.py | `"luma"` / `"nova_reel"` / `"none"`（AI生成なし編集のみ） |

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

## 動画生成フロー（Luma AI Ray 2）

1. `create_task.py` → ECS RunTask（`LUMA_S3_BUCKET` を環境変数で渡す）
2. `tools.py: generate_video()` → `bedrock_luma.start_async_invoke("luma.ray-v2:0", ...)`
3. Luma が `bedrock-video-generation-us-west-2-*` に `tasks/{task_id}/output/{inv_id}/output.mp4` を書き込む
4. `s3_luma.download_file()` → `/tmp/` にダウンロード
5. `s3.upload_file()` → `video-edit-assets-{account}` (ap-northeast-1) にアップロード
6. `main.py` が `get_last_output_key()` で output_key を取得 → DynamoDB を COMPLETED に更新

output_key が None のまま = FAILED として DynamoDB に書く（バグ修正済み）。

## 開発フロー

詳細は `CONTRIBUTING.md` を参照。概要：

1. **議論・方針決定** — 何を変えるか合意してから実装する
2. **既存コードを読む** — Read で対象ファイルを確認してから Edit する
3. **実装** — 最小限の変更。過剰な抽象化・将来への備えは入れない
4. **ローカルビルド** — `cd frontend && npm run build --no-proxy` でエラー確認
5. **本番デプロイ** — `./scripts/deploy-frontend.sh` でビルド〜S3〜CloudFront invalidation〜git push を一括実行
6. **git 操作** — `git push origin main` → `git push public main`

### フロントエンドデプロイ（ワンコマンド）

```bash
./scripts/deploy-frontend.sh
# AWS_PROFILE=<profile> ./scripts/deploy-frontend.sh  # プロファイル指定
# PUSH_PUBLIC=false ./scripts/deploy-frontend.sh       # public push をスキップ
```

## デプロイ手順

### 1. Bedrock モデル有効化（初回のみ）
- us-east-1: `us.anthropic.claude-sonnet-4-6` を有効化
- us-west-2: `luma.ray-v2:0` を有効化 → ダイアログで確認 → バケット名を `variables.tf` の `luma_s3_bucket_name` に設定
- us-east-1: `amazon.nova-reel-v1:0` を有効化 → バケット名を `nova_reel_s3_bucket_name` に設定

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
  - `luma_s3_bucket_name` — Bedrock コンソールが us-west-2 に自動作成したバケット名
  - `nova_reel_s3_bucket_name` — Bedrock コンソールが us-east-1 に自動作成したバケット名
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
  - Luma AI Ray 2: 物理・人物表現・映画的映像の強みを箇条書き
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

## DynamoDB タスクステータス遷移

```
PENDING → RUNNING → COMPLETED（output_key あり）
                  → FAILED（output_key なし、または例外）
```

## ツール一覧（backend/agent/tools.py）

### ファイル操作
| ツール名 | 説明 |
|---------|------|
| `list_files` | S3 入力ファイル一覧取得（編集タスクの最初に呼ぶ） |

### 動画編集（MoviePy）
| ツール名 | 説明 |
|---------|------|
| `trim_video` | 動画トリミング（start_sec〜end_sec） |
| `insert_image` | 動画への画像挿入（指定時間範囲でフルフレームオーバーレイ） |
| `concat_videos` | 複数動画の順番結合 |
| `add_text` | 字幕・テロップのオーバーレイ（日本語/CJK対応） |
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

### AI 生成
| ツール名 | 説明 |
|---------|------|
| `generate_video` | Luma AI Ray 2 でテキストから動画生成（5s/9s, 720p/540p, us-west-2） |
| `generate_video_nova_reel` | Amazon Nova Reel でテキストから動画生成（最大6s, 1280×720固定, us-east-1） |
| `generate_image` | Stable Diffusion XL で画像生成（PNG, us-east-1） |
| `generate_speech` | Amazon Polly でテキスト音声合成（MP3, ap-northeast-1） |

## よくあるトラブル

| 症状 | 原因 / 対処 |
|------|------------|
| `/download-url/{id}` が 500 | DynamoDB に output_key がない（タスク FAILED）→ ECS ログを確認 |
| Luma AI がタイムアウト | 生成に最大 15 分かかる。ポーリング継続 |
| Docker build でネットワークエラー | プロキシ引数 `--build-arg http_proxy=""` を追加 |
| `python3: command not found` | Git Bash では `python` を使う |
| ECS ログが文字化け | `MSYS_NO_PATHCONV=1` + UTF-8 デコードスクリプトを使う |
| Bedrock モデルが見つからない | 対象リージョンでモデルを有効化済みか確認 |
| チャットモーダルでメッセージリストがスクロールできない | `ChatModal.tsx` の wrapper div に `flex flex-col` が必要（`overflow-y-auto` が効かない） |
| チャットリセット後も過去の会話が表示される | `chatSessionId` を localStorage で保持すると DynamoDB の過去履歴が復元される → アプリ起動ごとに新規 UUID を生成すること |

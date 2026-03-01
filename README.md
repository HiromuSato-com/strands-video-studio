# video-edit-by-strands-agents

AI 動画編集・動画生成アプリ — Strands Agents × Amazon Bedrock × AWS ECS Fargate

## UIはこんな感じです

![UI スクリーンショット](docs/images/ui-screenshot.png)

## 生成動画サンプル

**Luma AI Ray 2** — 不死鳥が東京タワーのてっぺんを舞う

[▶ ダウンロード / 再生](docs/videos/ray2_generated.mp4)

**Amazon Nova Reel** — 夕焼けの富士山

[▶ ダウンロード / 再生](docs/videos/nova_generated.mp4)

> GitHubでは動画ファイルのリンクをクリック → **View raw** で再生できます。

---

## アーキテクチャ

```
ブラウザ (React/Vite)
  │
  ├─ S3 Presigned URL → S3 (動画/画像アップロード)
  │
  └─ API Gateway (HTTP API v2)
       ├─ GET  /upload-url       → Lambda
       ├─ POST /tasks            → Lambda → ECS Fargate RunTask
       ├─ GET  /tasks/{id}       → Lambda → DynamoDB
       └─ GET  /download-url/{id}→ Lambda → S3 Presigned URL

ECS Fargate (Strands Agent)
  ├─ Strands Agent + BedrockModel (Claude Sonnet 4.6, us-east-1)
  ├─ MoviePy + ffmpeg による動画編集
  ├─ Luma AI Ray 2 (us-west-2) による AI 動画生成
  │    └─ Oregon S3 (luma-output) → Tokyo S3 (assets) にクロスリージョン転送
  ├─ Amazon Nova Reel (us-east-1) による AI 動画生成
  │    └─ N.Virginia S3 (nova-reel-output) → Tokyo S3 (assets) にクロスリージョン転送
  └─ 処理結果を S3 / DynamoDB に書き込み

フロントエンド配信
  CloudFront → S3 (静的サイト)

S3 バケット構成
  ├─ video-edit-assets-{account}               (ap-northeast-1) — 入出力ファイル・最終動画
  ├─ video-edit-frontend-{account}             (ap-northeast-1) — React 静的ファイル
  ├─ bedrock-video-generation-us-west-2-{id}   (us-west-2)      — Luma AI 生成中間ファイル
  │    ※ Bedrock コンソールで Luma AI Ray 2 を有効化した際に AWS が自動作成
  └─ bedrock-video-generation-us-east-1-{id}   (us-east-1)      — Nova Reel 生成中間ファイル
       ※ Bedrock コンソールで Amazon Nova Reel を有効化した際に AWS が自動作成
```

## 前提条件

- AWS CLI（認証済み）+ Terraform >= 1.6
- Docker（ECR へのプッシュ用）
- Node.js >= 20（フロントエンドビルド）
- Amazon Bedrock で以下のモデルを有効化済み:
  - `us.anthropic.claude-sonnet-4-6` — **us-east-1**（LLM エージェント）
  - `luma.ray-v2:0` — **us-west-2**（AI 動画生成 / Luma AI Ray 2）
    > Bedrock コンソール (us-west-2) で有効化する際、S3 バケットの作成を求めるダイアログが表示されます。
    > 「確認」をクリックして AWS が自動作成するバケット（`bedrock-video-generation-us-west-2-{id}`）をそのまま使用します。
    > 作成されたバケット名を `infrastructure/variables.tf` の `luma_s3_bucket_name` に設定してください。
  - `amazon.nova-reel-v1:0` — **us-east-1**（AI 動画生成 / Amazon Nova Reel）
    > Bedrock コンソール (us-east-1) で有効化する際、同様に S3 バケットの作成を求めるダイアログが表示されます。
    > 「確認」をクリックして AWS が自動作成するバケット（`bedrock-video-generation-us-east-1-{id}`）をそのまま使用します。
    > 作成されたバケット名を `infrastructure/variables.tf` の `nova_reel_s3_bucket_name` に設定してください。

## デプロイ手順

### 1. Terraform でインフラを構築

```bash
cd infrastructure
terraform init
terraform apply
```

VPC・サブネット・S3 バケット（Tokyo）・IAM・Lambda・ECS・CloudFront が自動作成されます。
Luma AI / Nova Reel の出力バケットは Bedrock コンソールで各モデルを有効化した際に AWS が自動作成します。
バケット名を `variables.tf` の `luma_s3_bucket_name` / `nova_reel_s3_bucket_name` に設定してから `apply` を実行してください。

`terraform output` で以下の値を確認する：

| Output | 用途 |
|--------|------|
| `ecr_repository_url` | Docker イメージのプッシュ先 |
| `api_url` | フロントエンドの `VITE_API_URL` |
| `frontend_url` | アプリの公開 URL |
| `s3_bucket` | アセット S3 バケット名（ap-northeast-1） |
| `luma_output_bucket` | Luma AI 出力バケット名（us-west-2） |
| `nova_reel_output_bucket` | Nova Reel 出力バケット名（us-east-1） |
| `vpc_id` | 作成された VPC の ID |
| `public_subnet_ids` | Fargate タスク用パブリックサブネット ID |

---

### 2. Fargate エージェントイメージをビルド & プッシュ

```bash
ECR_URL=$(terraform -chdir=infrastructure output -raw ecr_repository_url)
AWS_REGION=ap-northeast-1
AWS_PROFILE=<your-profile>

aws ecr get-login-password --region $AWS_REGION --profile $AWS_PROFILE \
  | docker login --username AWS --password-stdin $ECR_URL

# プロキシ環境の場合は --build-arg でプロキシを無効化
docker build \
  --build-arg http_proxy="" --build-arg https_proxy="" \
  --build-arg HTTP_PROXY="" --build-arg HTTPS_PROXY="" \
  -t video-edit-agent ./backend/agent

docker tag video-edit-agent:latest $ECR_URL:latest
docker push $ECR_URL:latest
```

---

### 3. フロントエンドをビルド & デプロイ

```bash
cd frontend

# API URL を設定
API_URL=$(terraform -chdir=../infrastructure output -raw api_url)
echo "VITE_API_URL=$API_URL" > .env

# プロキシ環境の場合は --no-proxy を付ける
npm install --no-proxy
npm run build

# S3 に同期（バケット名は terraform output で確認）
FRONTEND_BUCKET="$(terraform -chdir=../infrastructure output -raw s3_bucket | sed 's/assets/frontend/')"
aws s3 sync dist/ s3://$FRONTEND_BUCKET/ \
  --profile <your-profile> --region ap-northeast-1

# CloudFront キャッシュ無効化（再デプロイ時）
# aws cloudfront create-invalidation --distribution-id <id> --paths "/*"
```

---

## 使い方

1. `frontend_url` をブラウザで開く
2. 動画ファイル（MP4 等）や画像ファイルをドラッグ＆ドロップでアップロード（複数可、追加式）
3. 自然言語で編集指示または生成指示を入力
4. AI 動画生成モデルを選択（Luma AI Ray 2 / Amazon Nova Reel）
5. 「編集を開始」をクリック
6. Fargate でエージェントが起動し、処理が完了するとプレビューとダウンロードが表示される

### 指示例（動画編集）

```
最初の10秒をトリミングして
```
```
video1.mp4 と video2.mp4 を結合して
```
```
5秒から15秒の間に logo.png を挿入して
```

### 指示例（AI 動画生成）

```
夕焼けの富士山をドローンで撮影したような動画を生成して
```
```
猫が草原で楽しく遊ぶ縦型動画を作成して
```
```
9秒の横向き動画で、雨の夜の東京の街並みを生成して
```

> ファイルをアップロードしなくても動画生成（テキスト→動画）が可能です。

---

## エージェントのツール

| ツール | 機能 |
|--------|------|
| `list_files` | タスクに紐づく入力ファイル一覧を取得 |
| `trim_video` | 動画の指定時間範囲をトリミング |
| `insert_image` | 動画の指定時間範囲に画像を挿入 |
| `concat_videos` | 複数動画を順番に結合 |
| `generate_video` | テキストプロンプトから AI 動画を生成（Luma AI Ray 2） |
| `generate_video_nova_reel` | テキストプロンプトから AI 動画を生成（Amazon Nova Reel） |

### generate_video パラメータ（Luma AI Ray 2）

| パラメータ | 説明 | デフォルト |
|-----------|------|-----------|
| `prompt` | 生成する動画の説明（最大 5000 文字） | — |
| `duration` | 長さ: `"5s"` または `"9s"` | `"5s"` |
| `aspect_ratio` | アスペクト比: `"16:9"`, `"9:16"`, `"1:1"` など | `"16:9"` |
| `resolution` | 解像度: `"720p"` または `"540p"` | `"720p"` |

### generate_video_nova_reel パラメータ（Amazon Nova Reel）

| パラメータ | 説明 | デフォルト |
|-----------|------|-----------|
| `prompt` | 生成する動画の説明（最大 512 文字） | — |
| `duration_sec` | 長さ（秒）: 1〜6 の整数。解像度は 1280×720 固定 | `6` |

---

## ローカル開発

```bash
# フロントエンド開発サーバー
cd frontend
npm install
VITE_API_URL=https://<your-api-url> npm run dev
```

---

## リソース削除

```bash
cd infrastructure
terraform destroy
```

> **注意**: S3 バケットにオブジェクトが残っている場合は先に手動削除が必要です。
> 削除対象バケット: `video-edit-assets-{account}`, `video-edit-frontend-{account}`
>
> `bedrock-video-generation-us-west-2-{id}` および `bedrock-video-generation-us-east-1-{id}` は
> AWS が管理するバケットのため、Terraform では削除されません。不要な場合は AWS コンソールから手動削除してください。

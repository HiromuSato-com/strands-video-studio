# video-edit-by-strands-agents

AI 動画編集アプリ — Strands Agents × Amazon Bedrock × AWS ECS Fargate

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
  ├─ Strands Agent + BedrockModel (Claude Sonnet, us-east-1)
  ├─ MoviePy + ffmpeg による動画処理
  └─ 処理結果を S3 / DynamoDB に書き込み

フロントエンド配信
  CloudFront → S3 (静的サイト)
```

## 前提条件

- AWS CLI（認証済み）+ Terraform >= 1.6
- Docker（ECR へのプッシュ用）
- Node.js >= 20（フロントエンドビルド）
- Amazon Bedrock で `us.anthropic.claude-sonnet-4-5-20251001` が **us-east-1** で有効化済み

## デプロイ手順

### 1. Terraform でインフラを構築

```bash
cd infrastructure

# tfvars を編集（VPC ID / Subnet IDs を自分の環境に合わせる）
cp terraform.tfvars.example terraform.tfvars
vi terraform.tfvars

terraform init
terraform apply
```

`terraform output` で以下の値を確認する：

| Output | 用途 |
|--------|------|
| `ecr_repository_url` | Docker イメージのプッシュ先 |
| `api_url` | フロントエンドの `VITE_API_URL` |
| `frontend_url` | アプリの公開 URL |
| `s3_bucket` | アセット S3 バケット名 |

---

### 2. Fargate エージェントイメージをビルド & プッシュ

```bash
ECR_URL=$(terraform -chdir=infrastructure output -raw ecr_repository_url)
AWS_REGION=ap-northeast-1
AWS_PROFILE=<your-profile>

aws ecr get-login-password --region $AWS_REGION --profile $AWS_PROFILE \
  | docker login --username AWS --password-stdin $ECR_URL

docker build -t video-edit-agent ./backend/agent
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

npm install
npm run build

# S3 に同期
FRONTEND_BUCKET=$(terraform -chdir=../infrastructure output -raw s3_bucket | sed 's/assets/frontend/')
# ※ バケット名は terraform output で確認してください
aws s3 sync dist/ s3://<frontend-bucket-name>/ \
  --profile <your-profile> --region ap-northeast-1

# CloudFront キャッシュ無効化（必要に応じて）
# aws cloudfront create-invalidation --distribution-id <id> --paths "/*"
```

---

## 使い方

1. `frontend_url` をブラウザで開く
2. 動画ファイル（MP4 等）や画像ファイルをドラッグ＆ドロップでアップロード
3. 自然言語で編集指示を入力（例: 「最初の30秒をカットして」「10秒から20秒に画像を挿入して」）
4. 「編集を開始」をクリック
5. Fargate でエージェントが起動し、処理が完了するとプレビューとダウンロードが表示される

### 指示例

```
最初の10秒をトリミングして
```
```
video1.mp4 と video2.mp4 を結合して
```
```
5秒から15秒の間に logo.png を挿入して
```

---

## エージェントのツール

| ツール | 機能 |
|--------|------|
| `list_files` | タスクに紐づく入力ファイル一覧を取得 |
| `trim_video` | 動画の指定時間範囲をトリミング |
| `insert_image` | 動画の指定時間範囲に画像を挿入 |
| `concat_videos` | 複数動画を順番に結合 |

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

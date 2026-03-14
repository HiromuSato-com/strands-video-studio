# 開発フロー

このドキュメントはこのプロジェクトへの変更を安全にデプロイするためのチェックリストです。

---

## 1. 議論・方針決定

- [ ] 変更したい箇所・理由を言語化する
- [ ] 実装前に「何を変えるか」を合意する（コードを読まずに提案しない）

---

## 2. ブランチ作成

```bash
git checkout main && git pull origin main
git checkout -b feature/<name>
```

---

## 3. 既存コードを読む

- [ ] 変更対象ファイルを `Read` で確認する
- [ ] 関連ファイル（props の渡し方、環境変数の渡し先など）も必要に応じて読む

---

## 4. 実装

- [ ] 最小限の変更のみ加える（過剰な抽象化・将来への備えは入れない）
- [ ] セキュリティ上の懸念（XSS、シークレットの露出など）がないか確認する

---

## 5. ローカルビルド（フロントエンド変更時）

```bash
cd frontend
npm run build --no-proxy
```

- [ ] TypeScript エラーが出ないこと
- [ ] Vite ビルドが成功すること

---

## 6. コミット & プッシュ → PR 作成

```bash
git add <変更ファイル>
git commit -m "feat: ..."
git push origin feature/<name>
# GitHub で feature/<name> → main の PR を作成・マージ
```

### コミットメッセージ規約

| プレフィックス | 用途 |
|--------------|------|
| `feat:`      | 新機能 |
| `fix:`       | バグ修正 |
| `chore:`     | ビルド設定・依存関係 |
| `docs:`      | ドキュメント |
| `refactor:`  | リファクタリング |

---

## 7. 本番デプロイ

変更内容に応じて以下を実施してください。

### フロントエンド変更時（ワンコマンド）

```bash
./scripts/deploy-frontend.sh
# AWS_PROFILE=<profile> ./scripts/deploy-frontend.sh  # プロファイル指定
```

内部で以下を順番に実行します：
1. Terraform outputs からバケット名・CloudFront ID を取得
2. `npm run build`
3. `aws s3 sync dist/ s3://<frontend-bucket>/`
4. `aws cloudfront create-invalidation --paths "/*"`

### Lambda 変更時

```bash
# 変更した Lambda を個別に更新（例: approve_task）
MSYS_NO_PATHCONV=1 aws lambda update-function-code \
  --function-name video-edit-approve-task \
  --zip-file fileb://infrastructure/.lambda_zips/approve_task.zip \
  --profile AWSAdministratorAccess-<account-id>
```

または `terraform apply` で全 Lambda を一括更新。

### インフラ変更時（Terraform）

```bash
aws sso login --profile AWSAdministratorAccess-<account-id>
export AWS_PROFILE=AWSAdministratorAccess-<account-id>
cd infrastructure
terraform apply
```

### ECS コンテナ変更時（backend/agent/）

```bash
# ECR ログイン
aws ecr get-login-password --region ap-northeast-1 --profile <profile> \
  | docker login --username AWS --password-stdin <account>.dkr.ecr.ap-northeast-1.amazonaws.com

# ビルド（プロキシを無効化）
docker build \
  --build-arg http_proxy="" --build-arg https_proxy="" \
  --build-arg HTTP_PROXY="" --build-arg HTTPS_PROXY="" \
  -t video-edit-agent ./backend/agent

# タグ & プッシュ
docker tag video-edit-agent:latest <ecr_url>:latest
docker push <ecr_url>:latest
```

---

## 8. public リポジトリへの同期

origin と public は別リポジトリのため、sync ブランチ経由で運用します。

```bash
git checkout main && git pull origin main
git checkout -b sync/<feature-name>
git push public sync/<feature-name>
# strands-video-studio で sync/<feature-name> → main の PR を作成・マージ
git checkout main
git branch -d sync/<feature-name>
```

---

## 変数・シークレット管理

| ファイル | 用途 | git 管理 |
|---------|------|---------|
| `infrastructure/terraform.tfvars` | 実際の値（API キー等） | **対象外**（.gitignore） |
| `infrastructure/terraform.tfvars.example` | サンプル値 | 管理対象 |
| `frontend/.env` | `VITE_API_URL` | **対象外** |

`terraform.tfvars` に設定が必要な変数：

```hcl
aws_region               = "ap-northeast-1"
project_name             = "video-edit"
bedrock_region           = "us-east-1"
nova_reel_s3_bucket_name = "bedrock-video-generation-us-east-1-xxxxxxx"
tavily_api_key           = "tvly-dev-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

# 開発フロー

このドキュメントはフロントエンド UI 改善を中心とした開発フローのチェックリストです。

---

## 1. 議論・方針決定

- [ ] 変更したい箇所・理由を言語化する
- [ ] 実装前に「何を変えるか」を合意する（コードを読まずに提案しない）

---

## 2. 既存コードを読む

- [ ] 変更対象ファイルを `Read` で確認する
- [ ] 関連ファイル（props の渡し方、スタイル定数など）も必要に応じて読む

---

## 3. 実装

- [ ] `Edit` ツールで最小限の変更を加える
- [ ] 過剰な抽象化・将来への備えは入れない（今必要なものだけ）
- [ ] セキュリティ上の懸念（XSS など）がないか確認する

---

## 4. ローカルビルド

```bash
cd frontend
npm run build --no-proxy
```

- [ ] TypeScript エラーが出ないこと
- [ ] Vite ビルドが成功すること

---

## 5. 本番デプロイ

ワンコマンドで実行できます：

```bash
./scripts/deploy-frontend.sh
```

内部で以下を順番に実行します：

1. Terraform outputs からバケット名・CloudFront ID を取得
2. `npm run build`
3. `aws s3 sync dist/ s3://<frontend-bucket>/`
4. `aws cloudfront create-invalidation --paths "/*"`
5. `git push origin main`
6. `git push public main`（public リモートが存在する場合）

### 手動で実行する場合

```bash
# S3 sync
aws s3 sync frontend/dist/ s3://<frontend-bucket>/ --profile <profile>

# CloudFront invalidation
MSYS_NO_PATHCONV=1 aws cloudfront create-invalidation \
  --distribution-id <dist-id> --paths "/*" --profile <profile>
```

> CloudFront のキャッシュ反映には数分かかります。

---

## 6. git 操作

```bash
# ステージング・コミット
git add <変更ファイル>
git commit -m "feat: ..."

# プライベートリポジトリ
git push origin main

# 一般公開リポジトリ
git push public main
```

### コミットメッセージ規約

| プレフィックス | 用途 |
|--------------|------|
| `feat:`      | 新機能・UI 改善 |
| `fix:`       | バグ修正 |
| `chore:`     | ビルド設定・依存関係 |
| `docs:`      | ドキュメント |
| `refactor:`  | リファクタリング |

---

## インフラ変更時の追加手順

outputs.tf や *.tf を変更した場合：

```bash
cd infrastructure
terraform apply
```

ECS コンテナ（`backend/agent/`）を変更した場合：

```bash
# ECR ログイン
aws ecr get-login-password --region ap-northeast-1 --profile <profile> \
  | docker login --username AWS --password-stdin <account>.dkr.ecr.ap-northeast-1.amazonaws.com

# ビルド & プッシュ
docker build \
  --build-arg http_proxy="" --build-arg https_proxy="" \
  --build-arg HTTP_PROXY="" --build-arg HTTPS_PROXY="" \
  -t video-edit-agent ./backend/agent
docker tag video-edit-agent:latest <ecr_url>:latest
docker push <ecr_url>:latest
```

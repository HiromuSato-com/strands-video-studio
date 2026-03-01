# デプロイ手順書 — AI 動画編集アプリ

AWS を初めて使う方でも、この手順書に沿って進めれば自分の AWS アカウントでアプリを動かせます。

---

## 目次

1. [費用の目安](#1-費用の目安)
2. [必要なツールのインストール](#2-必要なツールのインストール)
3. [AWS アカウントの作成と初期設定](#3-aws-アカウントの作成と初期設定)
4. [IAM ユーザーの作成と AWS CLI の設定](#4-iam-ユーザーの作成と-aws-cli-の設定)
5. [Amazon Bedrock のモデル有効化](#5-amazon-bedrock-のモデル有効化)
6. [リポジトリのクローン](#6-リポジトリのクローン)
7. [Terraform でインフラを構築](#7-terraform-でインフラを構築)
8. [Docker イメージをビルドして ECR にプッシュ](#8-docker-イメージをビルドして-ecr-にプッシュ)
9. [フロントエンドをビルドして S3 にデプロイ](#9-フロントエンドをビルドして-s3-にデプロイ)
10. [動作確認](#10-動作確認)
11. [リソースの削除（料金を止めたい場合）](#11-リソースの削除料金を止めたい場合)

---

## 1. 費用の目安

アプリを使った分だけ課金される従量制です。月々の固定費はほぼ発生しません。

| 操作 | 目安金額 |
|------|---------|
| AI 動画生成（Nova Reel・6秒） | 約 $0.05〜$0.10 / 回 |
| AI 動画生成（Luma AI Ray 2・5秒） | 約 $0.30〜$0.50 / 回 |
| 動画編集（トリミング・結合など） | 約 $0.01〜$0.05 / 回（ECS Fargate 起動時間） |
| S3 ストレージ | 約 $0.025 / GB・月（動画ファイル保存） |
| CloudFront・API Gateway | 数回程度の利用なら $0.01 未満 |

> **💡 ヒント**: 使わないときはアプリを放置しても固定費はほぼかかりません。ただし S3 に保存したファイルはストレージ料金が発生し続けます。

---

## 2. 必要なツールのインストール

以下の 5 つをあなたの PC にインストールします。

### 2-1. Git

ソースコードをダウンロードするために使います。

- **Windows**: https://git-scm.com/download/win からインストーラをダウンロードして実行
- **Mac**: ターミナルで `git --version` を実行 → インストールを促されたら「インストール」をクリック

インストール確認:
```
git --version
# 例: git version 2.47.0
```

### 2-2. AWS CLI

AWS を操作するコマンドラインツールです。

- **Windows**: https://awscli.amazonaws.com/AWSCLIV2.msi をダウンロードして実行
- **Mac**: https://awscli.amazonaws.com/AWSCLIV2.pkg をダウンロードして実行

インストール確認:
```
aws --version
# 例: aws-cli/2.x.x
```

### 2-3. Terraform

AWS のインフラ（サーバーや権限など）を自動で構築するツールです。

**Windows**:
1. https://developer.hashicorp.com/terraform/install にアクセス
2. "Windows" タブの AMD64 版をダウンロード（zip ファイル）
3. zip を解凍して `terraform.exe` を取り出す
4. `C:\terraform\` フォルダを作成して `terraform.exe` を置く
5. スタートメニューで「環境変数」と検索 → 「システム環境変数の編集」→「環境変数」→「Path」を編集 → `C:\terraform` を追加

**Mac**:
```bash
brew tap hashicorp/tap
brew install hashicorp/tap/terraform
```

インストール確認:
```
terraform --version
# 例: Terraform v1.10.x
```

### 2-4. Docker Desktop

コンテナイメージをビルドするために使います。

1. https://www.docker.com/products/docker-desktop/ からダウンロードしてインストール
2. インストール後、Docker Desktop を起動する（タスクバーにクジラのアイコンが表示されれば OK）

インストール確認:
```
docker --version
# 例: Docker version 27.x.x
```

### 2-5. Node.js

フロントエンドをビルドするために使います。

1. https://nodejs.org/ja/ にアクセスして「LTS 版」をダウンロード・インストール

インストール確認:
```
node --version
# 例: v22.x.x
```

---

## 3. AWS アカウントの作成と初期設定

### 3-1. AWS アカウントの作成

1. https://aws.amazon.com/jp/ にアクセスして「AWS アカウント作成」をクリック
2. メールアドレス・パスワード・アカウント名を入力
3. 連絡先情報（住所・電話番号）を入力
4. クレジットカード情報を入力（最初は無料枠の範囲で動作）
5. 電話番号認証を完了
6. サポートプランは「ベーシックサポート（無料）」を選択

> **⚠️ 注意**: クレジットカードの登録は必須ですが、無料枠の範囲内であれば課金されません。このアプリは無料枠超過後も少額です。

### 3-2. 請求アラートの設定（推奨）

予期しない高額請求を防ぐためにアラートを設定します。

1. AWS マネジメントコンソール（https://console.aws.amazon.com/）にサインイン
2. 右上のアカウント名をクリック → 「請求とコスト管理」
3. 左メニュー「Budgets」→「予算を作成」
4. 「使用量予算」→ 月額 $10（約 1,500 円）で設定 → メールアドレスを登録

---

## 4. IAM ユーザーの作成と AWS CLI の設定

AWS CLI から AWS を操作するための「鍵」を発行します。

### 4-1. IAM ユーザーの作成

1. AWS コンソールにサインイン
2. 上部の検索バーで「IAM」と検索してクリック
3. 左メニュー「ユーザー」→「ユーザーを作成」
4. ユーザー名を入力（例: `terraform-deploy`）
5. 「次へ」→「ポリシーを直接アタッチする」
6. 検索欄に「AdministratorAccess」と入力してチェック
7. 「次へ」→「ユーザーを作成」

### 4-2. アクセスキーの発行

1. 作成したユーザーをクリック
2. 「セキュリティ認証情報」タブ
3. 「アクセスキーを作成」→「コマンドラインインターフェース（CLI）」を選択
4. 確認チェックを入れて「次へ」→「アクセスキーを作成」
5. **アクセスキー ID** と **シークレットアクセスキー** をコピーしてメモ帳に保存（この画面でしか表示されません）

### 4-3. AWS CLI の設定

ターミナル（Mac: ターミナル.app、Windows: コマンドプロンプトまたは Git Bash）を開いて実行:

```bash
aws configure --profile deploy
```

以下の項目を入力します:
```
AWS Access Key ID: （4-2 でコピーしたアクセスキー ID）
AWS Secret Access Key: （4-2 でコピーしたシークレットアクセスキー）
Default region name: ap-northeast-1
Default output format: json
```

設定確認:
```bash
aws sts get-caller-identity --profile deploy
# アカウント ID が表示されれば成功
```

---

## 5. Amazon Bedrock のモデル有効化

このアプリで使用する AI モデルを有効化します。**3 つのモデル**を順番に有効化します。

### 5-1. Claude Sonnet 4.6 の有効化（バージニア北部リージョン）

1. AWS コンソールにサインイン
2. **右上のリージョンを「米国東部（バージニア北部）us-east-1」に切り替える**
   - 右上に「東京」などと表示されているドロップダウンをクリック → 「米国東部（バージニア北部）」を選択
3. 検索バーで「Bedrock」と検索してクリック
4. 左メニュー「モデルアクセス」をクリック
5. 右上の「モデルアクセスを管理」ボタンをクリック
6. 一覧から **「Claude」→「Claude Sonnet 4.6」** を探してチェックを入れる
7. 「変更を保存」をクリック
8. ステータスが「アクセス権が付与されました」になるまで数分待つ

### 5-2. Amazon Nova Reel の有効化（バージニア北部リージョン）

引き続き us-east-1 で作業します。

1. 同じ「モデルアクセスを管理」画面で **「Amazon」→「Nova Reel」** を探してチェック
2. 「変更を保存」

有効化後、Nova Reel の出力先 S3 バケットの作成ダイアログが表示されます:

1. 左メニュー「モデルアクセス」に戻る
2. Nova Reel の行をクリック → 「S3 設定」や「出力バケット」のセクションを確認
3. バケットが自動作成されていない場合は、画面の指示に従って S3 バケットを作成
4. **作成されたバケット名をメモ**（例: `bedrock-video-generation-us-east-1-xxxxxx`）

> バケット名は後の手順（[7-2](#7-2-variablestf-の編集)）で必要です。

### 5-3. Luma AI Ray 2 の有効化（オレゴンリージョン）

1. **右上のリージョンを「米国西部（オレゴン）us-west-2」に切り替える**
2. Bedrock → 「モデルアクセスを管理」
3. **「Luma AI」→「Ray 2」** を探してチェック
4. 「変更を保存」
5. S3 バケット作成のダイアログが表示されたら「確認」または「作成」をクリック
6. **作成されたバケット名をメモ**（例: `bedrock-video-generation-us-west-2-xxxxxx`）

---

## 6. リポジトリのクローン

ターミナルを開いて、好きな場所にソースコードをダウンロードします。

```bash
git clone https://github.com/HiromuSato-com/video-edit-by-strands-agents.git
cd video-edit-by-strands-agents
```

---

## 7. Terraform でインフラを構築

### 7-1. プロファイル名の確認

`infrastructure/variables.tf` を開き、`aws_profile` のデフォルト値を **4-3 で設定したプロファイル名**（`deploy`）に変更します。

```bash
# テキストエディタで開く（Windows の場合）
notepad infrastructure/variables.tf

# Mac の場合
open -e infrastructure/variables.tf
```

`variables.tf` を開いたら以下の行を編集:

```hcl
variable "aws_profile" {
  default = "deploy"   ← ここを自分のプロファイル名に変更
}
```

### 7-2. variables.tf の編集

続けて、[手順 5](#5-amazon-bedrock-のモデル有効化) でメモしたバケット名を設定します。

```hcl
variable "luma_s3_bucket_name" {
  default = "bedrock-video-generation-us-west-2-xxxxxx"  ← Luma AI のバケット名に変更
}

variable "nova_reel_s3_bucket_name" {
  default = "bedrock-video-generation-us-east-1-xxxxxx"  ← Nova Reel のバケット名に変更
}
```

ファイルを保存して閉じます。

### 7-3. Terraform を実行

```bash
cd infrastructure
terraform init
```

`Terraform has been successfully initialized!` と表示されれば OK。

```bash
terraform apply
```

変更内容の一覧が表示されるので確認して `yes` と入力:

```
Do you want to perform these actions?
  Enter a value: yes
```

5〜10 分ほどで完了します。`Apply complete!` と表示されたら成功です。

### 7-4. 出力値を記録

デプロイ完了後に表示される値をメモします:

```bash
terraform output
```

以下の値が表示されます（後で使います）:

| 出力項目 | 用途 |
|---------|------|
| `ecr_repository_url` | Docker イメージのプッシュ先 |
| `api_url` | フロントエンドの API URL |
| `frontend_url` | アプリを開く URL |

---

## 8. Docker イメージをビルドして ECR にプッシュ

AI 動画処理を行うコンテナイメージを AWS にアップロードします。

### 8-1. ECR にログイン

`YOUR_ACCOUNT_ID` を自分の AWS アカウント ID に置き換えて実行します（`terraform output ecr_repository_url` の先頭12桁の数字がアカウント ID です）。

```bash
aws ecr get-login-password --region ap-northeast-1 --profile deploy \
  | docker login --username AWS --password-stdin \
    YOUR_ACCOUNT_ID.dkr.ecr.ap-northeast-1.amazonaws.com
```

`Login Succeeded` と表示されれば OK。

### 8-2. イメージをビルド

`video-edit-by-strands-agents` フォルダ直下で実行:

```bash
cd ..   # infrastructure フォルダにいる場合
docker build -t video-edit-agent ./backend/agent
```

`Successfully built ...` または `writing image sha256:...` と表示されれば成功。5〜10 分かかることがあります。

### 8-3. イメージをプッシュ

`ECR_URL` を `terraform output -raw ecr_repository_url` で取得した値に置き換えます。

```bash
ECR_URL=$(cd infrastructure && terraform output -raw ecr_repository_url)

docker tag video-edit-agent:latest $ECR_URL:latest
docker push $ECR_URL:latest
```

`latest: digest: sha256:...` と表示されれば成功です。

---

## 9. フロントエンドをビルドして S3 にデプロイ

Web ブラウザで使う画面を AWS に配置します。

### 9-1. API URL を設定

```bash
cd frontend

# API URL を取得して .env ファイルに書き込む
API_URL=$(cd ../infrastructure && terraform output -raw api_url)
echo "VITE_API_URL=$API_URL" > .env
```

### 9-2. パッケージをインストールしてビルド

```bash
npm install
npm run build
```

`dist/` フォルダにビルド済みファイルが生成されます。

### 9-3. S3 にアップロード

```bash
# フロントエンド用のバケット名を取得
FRONTEND_BUCKET=$(cd ../infrastructure && terraform output -raw s3_bucket | sed 's/assets/frontend/')

# S3 に同期
aws s3 sync dist/ s3://$FRONTEND_BUCKET/ \
  --profile deploy --region ap-northeast-1
```

---

## 10. 動作確認

### 10-1. アプリを開く

```bash
cd infrastructure
terraform output -raw frontend_url
```

表示された URL（例: `https://xxxxxxxx.cloudfront.net`）をブラウザで開きます。

### 10-2. AI 動画生成をテスト

1. ブラウザでアプリが表示されることを確認
2. 指示入力欄に「青空と白い雲が広がる風景の動画を生成して」と入力
3. モデルに「Amazon Nova Reel」を選択
4. 「編集を開始」ボタンをクリック
5. 数分後に動画が表示されれば成功

### 10-3. 動画編集をテスト

1. 動画ファイル（MP4）をドラッグ＆ドロップでアップロード
2. 「最初の5秒をトリミングして」などと入力
3. 「編集を開始」をクリック
4. 処理完了後にプレビューが表示されれば成功

---

## 11. リソースの削除（料金を止めたい場合）

### 11-1. S3 バケット内のファイルを削除

Terraform の削除前に S3 バケット内のファイルを手動で消す必要があります。

```bash
# アセットバケットを空にする
ASSETS_BUCKET=$(cd infrastructure && terraform output -raw s3_bucket)
aws s3 rm s3://$ASSETS_BUCKET --recursive --profile deploy

# フロントエンドバケットを空にする
FRONTEND_BUCKET=$(echo $ASSETS_BUCKET | sed 's/assets/frontend/')
aws s3 rm s3://$FRONTEND_BUCKET --recursive --profile deploy
```

### 11-2. Terraform でインフラを削除

```bash
cd infrastructure
terraform destroy
```

`Do you really want to destroy all resources?` に `yes` と入力。

5〜10 分で完了します。`Destroy complete!` と表示されれば OK。

### 11-3. Bedrock の出力バケットを手動削除（任意）

`bedrock-video-generation-us-west-2-xxxxxx` および `bedrock-video-generation-us-east-1-xxxxxx` は AWS が管理するバケットのため Terraform では削除されません。不要な場合は AWS コンソールから手動削除してください。

1. AWS コンソール → S3
2. バケット名をクリック → 「空にする」→ 「削除」

---

## トラブルシューティング

### Q. `terraform apply` でエラーが出る

**「バケットが見つからない」エラー**:
```
Error: bucket not found: bedrock-video-generation-us-east-1-xxxxxx
```
→ `variables.tf` のバケット名が正しいか確認してください。手順 5 でメモしたバケット名と一致しているか確認します。

**「認証エラー」**:
```
Error: NoCredentialProviders
```
→ `aws configure --profile deploy` を再実行して認証情報を再入力してください。

---

### Q. Docker Desktop が起動していない

```
Cannot connect to the Docker daemon
```
→ Docker Desktop アプリを起動してください（タスクバーにクジラのアイコンが表示されるまで待つ）。

---

### Q. 動画生成が「FAILED」になる

AWS コンソール → CloudWatch → ロググループ → `/ecs/video-edit-agent` でエラーの詳細を確認できます。

よくある原因:
- Bedrock モデルが有効化されていない → 手順 5 を再確認
- `variables.tf` のバケット名が間違っている → 手順 7-2 を再確認
- Terraform を `apply` した後に Docker push していない → 手順 8 を再実行

---

### Q. アプリの画面が表示されない（CloudFront が 403 エラー）

フロントエンドのデプロイが完了していない可能性があります。

```bash
# フロントエンドのデプロイ状況を確認
aws s3 ls s3://$(cd infrastructure && terraform output -raw s3_bucket | sed 's/assets/frontend/')/ --profile deploy
```

ファイルが表示されなければ手順 9 を再実行してください。

---

## 付録：よく使うコマンド

```bash
# アプリの URL を確認
cd infrastructure && terraform output -raw frontend_url

# タスクの状態を確認（TASK_ID は DynamoDB で確認）
aws dynamodb scan --table-name video-edit-tasks --profile deploy --region ap-northeast-1

# ECS のログをリアルタイムで確認
aws logs tail /ecs/video-edit-agent --follow --profile deploy

# ECR にある Docker イメージを更新（コードを変更した後）
docker build -t video-edit-agent ./backend/agent
docker tag video-edit-agent:latest $(cd infrastructure && terraform output -raw ecr_repository_url):latest
docker push $(cd infrastructure && terraform output -raw ecr_repository_url):latest
```

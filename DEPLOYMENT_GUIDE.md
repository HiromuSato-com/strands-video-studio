# デプロイ手順書 — AI 動画編集アプリ

> **このアプリについて**
> 完全に自分だけが使うプライベートアプリです。外部に公開するサービスではないため、
> 生成した動画は自分の AWS アカウント内の S3 にのみ保存され、他人からはアクセスできません。
> インターネット上でフロントエンド画面の URL は公開状態になりますが、
> 認証機能を追加していない点に留意してください（URL を知っている人なら誰でもアクセス可能です）。

AWS を初めて使う方でも、この手順書に沿って進めれば自分の AWS アカウントでアプリを動かせます。

---

## 目次

1. [費用の目安](#1-費用の目安)
2. [必要なツールのインストール](#2-必要なツールのインストール)
3. [AWS アカウントの作成と初期設定](#3-aws-アカウントの作成と初期設定)
4. [AWS CLI の認証設定（IAM Identity Center）](#4-aws-cli-の認証設定iam-identity-center)
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
| 動画編集（トリミング・結合など） | 約 $0.01〜$0.05 / 回（AgentCore Runtime 実行時間） |
| S3 ストレージ | 約 $0.025 / GB・月（動画ファイル保存） |
| CloudFront・API Gateway | 数回程度の利用なら $0.01 未満 |

> **💡 ヒント**: 使わないときに放置しても固定費はほぼかかりません。ただし S3 に保存したファイルはストレージ料金が発生し続けます。

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

### 2-2. AWS CLI（バージョン 2）

AWS を操作するコマンドラインツールです。**バージョン 2** をインストールしてください。

- **Windows**: https://awscli.amazonaws.com/AWSCLIV2.msi をダウンロードして実行
- **Mac**: https://awscli.amazonaws.com/AWSCLIV2.pkg をダウンロードして実行

インストール確認:
```
aws --version
# 例: aws-cli/2.22.0  ← 2.x 系であること
```

### 2-3. Terraform

AWS のインフラ（サーバーや権限など）を自動で構築するツールです。

**Windows**:
1. https://developer.hashicorp.com/terraform/install にアクセス
2. "Windows" タブの AMD64 版をダウンロード（zip ファイル）
3. zip を解凍して `terraform.exe` を取り出す
4. `C:\terraform\` フォルダを作成して `terraform.exe` を置く
5. スタートメニューで「環境変数」と検索 →「システム環境変数の編集」→「環境変数」→「Path」を編集 → `C:\terraform` を追加

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

> **⚠️ 注意**: クレジットカードの登録は必須ですが、無料枠の範囲内であれば課金されません。

### 3-2. 請求アラートの設定（強く推奨）

予期しない高額請求を防ぐためにアラートを設定します。

1. AWS マネジメントコンソール（https://console.aws.amazon.com/）にルートユーザーでサインイン
2. 右上のアカウント名をクリック → 「請求とコスト管理」
3. 左メニュー「Budgets」→「予算を作成」
4. 「月次コスト予算」を選択 → 予算額に `10`（$10、約 1,500 円）を入力
5. アラートのしきい値を `80%`（$8 を超えたら通知）に設定してメールアドレスを登録
6. 「予算を作成」をクリック

---

## 4. AWS CLI の認証設定（IAM Identity Center）

### なぜ IAM ユーザーのアクセスキーを使わないのか

IAM ユーザーに発行するアクセスキーは「有効期限のない長期的な認証情報」であり、
**AWS 公式ドキュメントでも明確に非推奨**とされています。

> *"To avoid security risks, don't use IAM users for authentication when developing
> purpose-built software or working with real data."*
> — [AWS CLI 認証ドキュメント](https://docs.aws.amazon.com/cli/latest/userguide/cli-authentication-user.html)

代わりに **IAM Identity Center（SSO）** を使います。
こちらはログインのたびに短期間（8〜12 時間）のトークンを発行する仕組みで、
万一 PC を紛失しても認証情報が自動的に失効します。

| | IAM ユーザー＋アクセスキー | IAM Identity Center（推奨） |
|--|--------------------------|---------------------------|
| 有効期限 | **なし（永続）** | 8〜12 時間で自動失効 |
| 漏洩リスク | **永続的** | 自動失効するため低リスク |
| ローテーション | 手動で必要 | 不要 |
| AWS 推奨度 | **非推奨** | **最推奨** |

### 4-1. IAM Identity Center の有効化

1. AWS コンソールにルートユーザーでサインイン
2. 上部の検索バーで「IAM Identity Center」と検索してクリック
3. 「有効化」ボタンをクリック
   - AWS Organizations への参加確認が出る場合は「有効化」を選択（自動でシングルアカウント構成になります）
4. 「IAM Identity Center が有効になりました」と表示されれば OK

### 4-2. ユーザーの作成

1. 左メニュー「ユーザー」→「ユーザーを追加」
2. ユーザー名（例: `myname`）・メールアドレス・姓名を入力
3. 「次へ」→「次へ」→「ユーザーを追加」
4. 登録したメールアドレスに招待メールが届くので、リンクからパスワードを設定する

### 4-3. 許可セットの作成

許可セット＝「何ができるか」のセットです。

1. 左メニュー「許可セット」→「許可セットを作成」
2. 「事前定義された許可セット」→「AdministratorAccess」を選択
3. 「次へ」→「次へ」→「作成」

### 4-4. ユーザーをアカウントに割り当て

1. 左メニュー「AWSアカウント」→ 自分のアカウントにチェックを入れる
2. 「ユーザーまたはグループを割り当て」をクリック
3. 「ユーザー」タブで 4-2 で作成したユーザーを選択して「次へ」
4. 「AdministratorAccess」にチェックを入れて「次へ」→「送信」

### 4-5. アクセスポータル URL をメモ

1. 左メニュー「ダッシュボード」
2. 「アクセスポータルの URL」（例: `https://d-xxxxxxxxxx.awsapps.com/start`）をコピーしてメモ

### 4-6. AWS CLI に SSO プロファイルを設定

ターミナル（Mac: ターミナル.app、Windows: コマンドプロンプトまたは Git Bash）を開いて実行:

```bash
aws configure sso
```

以下の項目を入力します:

```
SSO session name (Recommended): my-sso
SSO start URL [None]: https://d-xxxxxxxxxx.awsapps.com/start  ← 4-5 でメモした URL
SSO region [None]: ap-northeast-1
SSO registration scopes [None]: sso:account:access
```

入力後、**ブラウザが自動的に開いて IAM Identity Center のログイン画面**が表示されます。
4-2 で設定したユーザー名・パスワードでサインインして「許可」をクリックします。

ブラウザで認証完了後、ターミナルに戻って続きを入力:

```
CLI default client Region [ap-northeast-1]: ap-northeast-1
CLI default output format [json]: json
Profile name [...]: deploy    ← プロファイル名（何でも OK、この手順書では "deploy" を使用）
```

### 4-7. ログインして動作確認

```bash
# セッション開始（ブラウザで認証）
aws sso login --profile deploy

# 動作確認（アカウント ID が表示されれば成功）
aws sts get-caller-identity --profile deploy
```

> **💡 毎回の使い方**: PC を再起動したり翌日作業するときは `aws sso login --profile deploy` を
> 実行するだけで再認証できます。アクセスキーの管理は一切不要です。

---

## 5. Amazon Bedrock のモデル有効化

このアプリで使用する AI モデルを有効化します。**3 つのモデル**を順番に有効化します。

> **注意**: Bedrock の設定は AWS コンソールのルートユーザーまたは 4-2 で作成した
> IAM Identity Center ユーザーで行います。

### Bedrock コンソールへの共通手順

各モデルの有効化は以下の画面から行います（以降の手順で繰り返し使います）。

1. AWS コンソールにサインイン
2. 右上のリージョンを目的のリージョンに切り替える
3. 検索バーで「Bedrock」と入力してクリック
4. **左ナビゲーション「Bedrock configurations」→「Model access」** をクリック
5. **「Modify model access」** ボタンをクリック

### 5-1. Claude Sonnet 4.6 の有効化（バージニア北部 / us-east-1）

このアプリは `us.anthropic.claude-sonnet-4-6` という**クロスリージョン推論プロファイル**を使用します。
これは us-east-1 で呼び出すと AWS が自動的に最適な米国リージョンへルーティングする仕組みです。
有効化は **us-east-1** で行います。

1. **右上のリージョンを「米国東部（バージニア北部）us-east-1」に切り替える**
2. Bedrock コンソールへの共通手順（上記）を実行
3. モデル一覧から **「Anthropic」→「Claude Sonnet 4.6」** を探してチェックを入れる
4. **「Next」** をクリック
5. Anthropic モデルは利用申請フォームの入力が必要な場合があります
   - **「Submit use case details」** 画面が表示された場合: 利用目的（例: "Personal video editing application for private use"）を英語で入力して **「Submit」** をクリック
   - 画面が表示されない場合: そのまま **「Submit」** をクリック
6. ステータスが **「Access granted」** になるまで数分〜数十分待つ

### 5-2. Amazon Nova Reel の有効化（バージニア北部 / us-east-1）

引き続き us-east-1 で作業します。

1. 再度 **「Modify model access」** をクリック
2. **「Amazon」→「Nova Reel」** を探してチェック
3. **「Next」→「Submit」** をクリック
4. 有効化完了後、**S3 バケットの設定ダイアログ**が表示されます
   - 「S3 バケットを作成」などのボタンが表示されたら **「確認」または「作成」** をクリック
   - AWS が自動的に `bedrock-video-generation-us-east-1-xxxxxx` という名前のバケットを作成します
5. **「Model access」** 画面に戻り、Nova Reel の行または S3 設定セクションで **バケット名を確認してメモ**
   - 確認方法: AWS コンソール → S3 を開き、`bedrock-video-generation-us-east-1` で始まるバケットを探す

> バケット名は後の手順（[7-1](#7-1-variablestf-の編集)）で必要です。

---

## 6. リポジトリのクローン

ターミナルを開いて、好きな場所にソースコードをダウンロードします。

```bash
git clone https://github.com/HiromuSato-com/video-edit-by-strands-agents.git
cd video-edit-by-strands-agents
```

---

## 7. Terraform でインフラを構築

### 7-1. terraform.tfvars の作成

`infrastructure/terraform.tfvars` をテキストエディタで作成します。

```bash
# Windows の場合
notepad infrastructure/terraform.tfvars
```

以下の内容を設定します:

```hcl
nova_reel_s3_bucket_name = "bedrock-video-generation-us-east-1-xxxxxx"  # 5-2 でメモしたバケット名
```

ファイルを保存して閉じます。

> **注意**: `aws_profile` は `terraform.tfvars` に書かず、次のステップで `AWS_PROFILE` 環境変数として設定します。

### 7-2. SSO ログインを確認してから Terraform を実行

```bash
# まず SSO セッションが有効か確認
aws sso login --profile deploy

# AWS_PROFILE 環境変数を設定（Terraform はこれを使用）
export AWS_PROFILE=deploy

# infrastructure フォルダへ移動
cd infrastructure

# Terraform の初期化
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

### 7-3. 出力値を記録

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

```bash
ECR_URL=$(terraform output -raw ecr_repository_url)
ACCOUNT_ID=$(echo $ECR_URL | cut -d. -f1)

aws ecr get-login-password --region ap-northeast-1 --profile deploy \
  | docker login --username AWS --password-stdin \
    $ACCOUNT_ID.dkr.ecr.ap-northeast-1.amazonaws.com
```

`Login Succeeded` と表示されれば OK。

### 8-2. イメージをビルド

```bash
cd ..   # infrastructure フォルダにいる場合はプロジェクトルートへ戻る
docker build -t video-edit-agent ./backend/agent
```

`writing image sha256:...` と表示されれば成功。初回は 5〜10 分かかることがあります。

### 8-3. イメージをプッシュ

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
FRONTEND_BUCKET=$(cd ../infrastructure && terraform output -raw s3_bucket | sed 's/assets/frontend/')

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
cd infrastructure

ASSETS_BUCKET=$(terraform output -raw s3_bucket)
aws s3 rm s3://$ASSETS_BUCKET --recursive --profile deploy

FRONTEND_BUCKET=$(echo $ASSETS_BUCKET | sed 's/assets/frontend/')
aws s3 rm s3://$FRONTEND_BUCKET --recursive --profile deploy
```

### 11-2. Terraform でインフラを削除

```bash
terraform destroy
```

`Do you really want to destroy all resources?` に `yes` と入力。

5〜10 分で完了します。`Destroy complete!` と表示されれば OK。

### 11-3. Bedrock の出力バケットを手動削除（任意）

`bedrock-video-generation-us-east-1-xxxxxx` は
AWS が管理するバケットのため Terraform では削除されません。不要な場合は AWS コンソールから手動削除してください。

1. AWS コンソール → S3
2. バケット名をクリック → 「空にする」→「削除」

---

## トラブルシューティング

### Q. `terraform apply` で認証エラーが出る

```
Error: NoCredentialProviders
```

→ SSO セッションが切れています。再ログインしてから再実行してください:

```bash
aws sso login --profile deploy
terraform apply
```

---

### Q. `terraform apply` でバケットが見つからないエラーが出る

```
Error: bucket not found: bedrock-video-generation-us-east-1-xxxxxx
```

→ `variables.tf` のバケット名が正しいか確認してください。手順 5 でメモしたバケット名と一致しているか確認します。

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
- `variables.tf` のバケット名が間違っている → 手順 7-1 を再確認
- Terraform `apply` 後に Docker push していない → 手順 8 を再実行

---

### Q. アプリの画面が表示されない（CloudFront が 403 エラー）

フロントエンドのデプロイが完了していない可能性があります。手順 9 を再実行してください。

```bash
# デプロイ状況を確認
aws s3 ls s3://$(cd infrastructure && terraform output -raw s3_bucket | sed 's/assets/frontend/')/ --profile deploy
```

ファイルが表示されなければ手順 9 を再実行してください。

---

## 付録：よく使うコマンド

```bash
# SSO ログイン（翌日の作業開始時など）
aws sso login --profile deploy

# アプリの URL を確認
cd infrastructure && terraform output -raw frontend_url

# AgentCore のログをリアルタイムで確認
aws logs tail /agentcore/video-edit-agent --follow --profile deploy

# タスクの状態を確認
aws dynamodb scan --table-name video-edit-tasks \
  --profile deploy --region ap-northeast-1

# ECR のイメージを更新（コードを変更した後）
docker build -t video-edit-agent ./backend/agent
docker tag video-edit-agent:latest \
  $(cd infrastructure && terraform output -raw ecr_repository_url):latest
docker push \
  $(cd infrastructure && terraform output -raw ecr_repository_url):latest
```

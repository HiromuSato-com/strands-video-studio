# AI 創作スタジオ — アプリケーション仕様書

> 作成日: 2026-03-07
> バージョン: 現行コードベース (`fix/add-text-cjk-font` ブランチ)

---

## 1. 概要

**AI 創作スタジオ**は、自然言語の指示から動画編集・動画生成を自動実行する AWS サーバーレスアプリケーションです。

- ユーザーはブラウザ上で指示を入力するだけで、バックエンドの AI エージェントが適切なツールを選択・実行します。
- 動画編集（MoviePy）と AI 動画生成（Luma AI Ray 2 / Amazon Nova Reel）を 1 つの UI から利用できます。

### 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | React 18 + Vite + TypeScript + TailwindCSS |
| API | Amazon API Gateway HTTP API v2 |
| バックエンド（薄い層） | AWS Lambda (Python 3.13) |
| 処理エンジン | ECS Fargate + Strands Agents SDK |
| LLM | Amazon Bedrock — Claude Sonnet 4.6 (`us.anthropic.claude-sonnet-4-6`) |
| 動画編集 | MoviePy + ffmpeg (static build) |
| AI 動画生成 | Luma AI Ray 2 (`luma.ray-v2:0`) / Amazon Nova Reel (`amazon.nova-reel-v1:0`) |
| AI 画像生成 | Stable Diffusion XL (`stability.stable-diffusion-xl-v1`) |
| 音声合成 | Amazon Polly |
| 音声認識 | Amazon Transcribe |
| ストレージ | Amazon S3 |
| DB | Amazon DynamoDB |
| IaC | Terraform（フラット構成、モジュールなし） |

---

## 2. アーキテクチャ

```
ブラウザ
  |
  | HTTPS
  v
CloudFront (CDN)
  |
  | 静的ファイル配信 (S3 frontend バケット)
  v
React/Vite UI (SPA)
  |
  | REST API (HTTPS)
  v
API Gateway HTTP API v2
  |
  +--[GET  /upload-url]----------> Lambda: upload_url.py
  |                                   -> S3 presigned PUT URL 発行
  |
  +--[POST /tasks]---------------> Lambda: create_task.py
  |                                   -> DynamoDB PENDING 書き込み
  |                                   -> ECS RunTask 起動
  |
  +--[GET  /tasks/{id}]----------> Lambda: get_task.py
  |                                   -> DynamoDB からステータス取得
  |
  +--[GET  /download-url/{id}]---> Lambda: download_url.py
  |                                   -> S3 presigned GET URL 発行
  |
  +--[POST /chat]----------------> Lambda: chat.py
                                      -> DynamoDB (CHAT_TABLE) に履歴保存
                                      -> Bedrock Converse API (Claude Sonnet 4.6)

ECS Fargate タスク (ap-northeast-1)
  |
  +-- Strands Agent (claude-sonnet-4-6, us-east-1)
       |
       +-- S3: 入力ファイルダウンロード / 出力ファイルアップロード (ap-northeast-1)
       +-- MoviePy: 動画編集 (/tmp/ ローカル処理)
       +-- Bedrock Luma (us-west-2): generate_video / generate_video_from_image
       +-- Bedrock Nova (us-east-1): generate_video_nova_reel
       +-- Bedrock SDXL (us-east-1): generate_image
       +-- Amazon Polly (ap-northeast-1): generate_speech
       +-- Amazon Transcribe (ap-northeast-1): transcribe_video
       +-- Claude Vision (us-east-1): analyze_video
       +-- ffmpeg: detect_scenes

DynamoDB
  +-- tasks テーブル: タスクステータス管理
  +-- chat テーブル: チャット履歴管理 (session_id キー)
```

---

## 3. AWS リソース一覧

### 3.1 リージョン別サービス

| サービス | リージョン | 役割 |
|---------|-----------|------|
| CloudFront | グローバル | フロントエンド CDN |
| S3 (frontend) | ap-northeast-1 | React 静的ファイル |
| S3 (assets) | ap-northeast-1 | 入出力ファイル |
| API Gateway | ap-northeast-1 | HTTP API v2 |
| Lambda ×5 | ap-northeast-1 | API ハンドラー |
| ECS Fargate | ap-northeast-1 | 動画処理コンテナ |
| DynamoDB (tasks) | ap-northeast-1 | タスクステータス |
| DynamoDB (chat) | ap-northeast-1 | チャット履歴 |
| ECR | ap-northeast-1 | コンテナイメージ |
| VPC | ap-northeast-1 | ネットワーク |
| Amazon Polly | ap-northeast-1 | 音声合成 |
| Amazon Transcribe | ap-northeast-1 | 音声認識 |
| Bedrock (Claude) | us-east-1 | LLM 推論 |
| Bedrock (Nova Reel) | us-east-1 | AI 動画生成 |
| Bedrock (SDXL) | us-east-1 | AI 画像生成 |
| S3 (Nova 出力) | us-east-1 | Nova Reel 生成中間ファイル |
| Bedrock (Luma) | us-west-2 | AI 動画生成 |
| S3 (Luma 出力) | us-west-2 | Luma AI 生成中間ファイル |

### 3.2 S3 バケット

| バケット名 | リージョン | 管理 | 用途 |
|-----------|-----------|------|------|
| `video-edit-assets-{account}` | ap-northeast-1 | Terraform | 入出力ファイル・最終動画 |
| `video-edit-frontend-{account}` | ap-northeast-1 | Terraform | React 静的ファイル |
| `bedrock-video-generation-us-west-2-{id}` | us-west-2 | Bedrock 自動作成 | Luma AI 生成中間ファイル |
| `bedrock-video-generation-us-east-1-{id}` | us-east-1 | Bedrock 自動作成 | Nova Reel 生成中間ファイル |

### 3.3 DynamoDB テーブル

#### tasks テーブル

| 属性 | 型 | 説明 |
|-----|---|------|
| `task_id` | String (PK) | UUID v4 |
| `status` | String | `PENDING` / `RUNNING` / `COMPLETED` / `FAILED` |
| `instruction` | String | 自然言語指示 |
| `input_keys` | List | S3 入力ファイルキーの配列 |
| `video_model` | String | `luma` / `nova_reel` / `none` |
| `output_key` | String | S3 出力ファイルキー（COMPLETED 時のみ） |
| `agent_result` | String | エージェント実行結果テキスト（先頭4000文字） |
| `error_message` | String | エラーメッセージ（FAILED 時のみ） |
| `created_at` | String | ISO 8601 UTC |
| `updated_at` | String | ISO 8601 UTC |

#### chat テーブル

| 属性 | 型 | 説明 |
|-----|---|------|
| `session_id` | String (PK) | UUID v4（アプリ起動ごとに新規生成） |
| `messages` | String | JSON 文字列（role/content 配列） |
| `updated_at` | String | ISO 8601 UTC |

---

## 4. API 仕様

### 4.1 エンドポイント一覧

| Method | Path | Lambda | 説明 |
|--------|------|--------|------|
| GET | `/upload-url` | `upload_url.py` | S3 presigned PUT URL 発行 |
| POST | `/tasks` | `create_task.py` | タスク作成 + Fargate 起動 |
| GET | `/tasks/{id}` | `get_task.py` | タスクステータスポーリング |
| GET | `/download-url/{id}` | `download_url.py` | S3 presigned GET URL 発行 |
| POST | `/chat` | `chat.py` | AI チャット（指示内容の相談） |

### 4.2 GET /upload-url

**クエリパラメータ**

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| `task_id` | Yes | タスク UUID |
| `filename` | Yes | アップロードするファイル名 |

**レスポンス**

```json
{
  "upload_url": "https://s3.amazonaws.com/...",
  "key": "tasks/{task_id}/input/{filename}"
}
```

### 4.3 POST /tasks

**リクエストボディ**

```json
{
  "task_id": "uuid-v4",
  "instruction": "動画をトリミングしてください",
  "input_keys": ["tasks/xxx/input/video.mp4"],
  "video_model": "none"
}
```

| フィールド | 必須 | 型 | 説明 |
|-----------|------|---|------|
| `task_id` | Yes | string | UUID v4（フロントエンドで生成） |
| `instruction` | Yes | string | 自然言語指示 |
| `input_keys` | No | string[] | S3 入力キーの配列（空配列可） |
| `video_model` | No | string | `luma` / `nova_reel` / `none`（デフォルト: `luma`） |

**レスポンス** `201 Created`

```json
{ "task_id": "uuid-v4" }
```

### 4.4 GET /tasks/{id}

**レスポンス**

```json
{
  "task_id": "uuid-v4",
  "status": "COMPLETED",
  "instruction": "...",
  "output_key": "tasks/xxx/output/result.mp4",
  "created_at": "2026-03-07T00:00:00+00:00",
  "updated_at": "2026-03-07T00:05:00+00:00"
}
```

### 4.5 GET /download-url/{id}

**レスポンス**

```json
{
  "download_url": "https://s3.amazonaws.com/...",
  "output_key": "tasks/xxx/output/result.mp4"
}
```

タスクが COMPLETED でない、または output_key がない場合は `500` を返す。

### 4.6 POST /chat

**action=message（メッセージ送信）**

```json
{
  "session_id": "uuid-v4",
  "action": "message",
  "message": "動画をモノクロにしたい"
}
```

レスポンス:

```json
{
  "reply": "AIのメッセージ",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

**action=confirm（指示内容の確定）**

```json
{
  "session_id": "uuid-v4",
  "action": "confirm"
}
```

レスポンス:

```json
{ "instruction": "動画にモノクロフィルターをかけてください。" }
```

---

## 5. ECS コンテナ仕様

### 5.1 Dockerfile

```
ベースイメージ: python:3.13-slim
ffmpeg: mwader/static-ffmpeg:latest からコピー (ffmpeg + ffprobe)
CJK フォント: fonts-noto-cjk (add_text ツールの日本語テロップ用)
エントリポイント: python main.py
```

### 5.2 コンテナ環境変数（RunTask 時注入）

| 変数名 | 必須 | 説明 |
|-------|------|------|
| `TASK_ID` | Yes | DynamoDB タスク ID |
| `S3_BUCKET` | Yes | assets バケット名 |
| `DYNAMODB_TABLE` | Yes | DynamoDB タスクテーブル名 |
| `INSTRUCTION` | Yes | 自然言語指示（VIDEO_MODEL タグ付き） |
| `INPUT_KEYS` | Yes | S3 入力キーの JSON 配列 |
| `LUMA_S3_BUCKET` | No | Luma AI 出力バケット名 (us-west-2) |
| `NOVA_REEL_S3_BUCKET` | No | Nova Reel 出力バケット名 (us-east-1) |
| `VIDEO_MODEL` | No | `luma` / `nova_reel` / `none` |

### 5.3 タスクステータス遷移

```
[DynamoDB 書き込み] PENDING
        |
[ECS 起動・main.py 開始]
        |
      RUNNING
        |
  +-----+-----+
  |           |
output_key あり  output_key なし / 例外
  |           |
COMPLETED   FAILED
```

---

## 6. Strands Agent 仕様

### 6.1 モデル設定

| 項目 | 値 |
|-----|---|
| モデル ID | `us.anthropic.claude-sonnet-4-6` |
| リージョン | `us-east-1` |
| SDK | Strands Agents (`strands.Agent` + `strands.models.BedrockModel`) |

### 6.2 VIDEO_MODEL タグによるモデル選択

`main.py` が指示文末尾にタグを付与し、エージェントが適切な生成ツールを選択します。

| `video_model` 値 | 付与タグ | 呼び出されるツール |
|-----------------|---------|-----------------|
| `luma` | `[AI動画生成モデル: Luma AI Ray 2]` | `generate_video` |
| `nova_reel` | `[AI動画生成モデル: Amazon Nova Reel]` | `generate_video_nova_reel` |
| `none` | なし | 編集ツールのみ使用 |

### 6.3 ツール一覧

#### ファイル操作

| ツール | 説明 |
|-------|------|
| `list_files` | S3 入力ファイル一覧取得（編集タスクの先頭で必ず呼ぶ） |

#### 映像理解・分析

| ツール | 説明 | 使用サービス |
|-------|------|------------|
| `analyze_video` | 動画フレームを Claude Vision で分析（シーン/人物/物体/雰囲気） | Bedrock Claude (us-east-1) |
| `transcribe_video` | 音声を文字起こし（単語レベルのタイムスタンプ付き） | Amazon Transcribe (ap-northeast-1) |
| `detect_scenes` | ffmpeg でシーン転換点を自動検出 | ffmpeg (/tmp/) |

#### 動画編集（MoviePy）

| ツール | 主要パラメータ | 説明 |
|-------|-------------|------|
| `trim_video` | `input_key`, `start_sec`, `end_sec` | 動画トリミング |
| `insert_image` | `video_key`, `image_key`, `start_sec`, `end_sec` | 画像をフルフレームオーバーレイ |
| `concat_videos` | `input_keys[]` | 複数動画の順番結合 |
| `add_text` | `input_key`, `text`, `start_sec`, `end_sec`, `position`, `font_size`, `color` | 字幕・テロップ（日本語/CJK 対応） |
| `add_audio` | `video_key`, `audio_key`, `volume`, `loop` | BGM・効果音のミックス |
| `replace_audio` | `video_key`, `audio_key` | 音声トラックの差し替え |
| `change_speed` | `input_key`, `speed` (0.1〜10.0) | 再生速度変更 |
| `fade_in_out` | `input_key`, `fade_in_sec`, `fade_out_sec` | フェードイン・フェードアウト |
| `crossfade_concat` | `input_keys[]`, `crossfade_sec` | クロスフェードトランジション付き結合 |
| `resize_crop` | `input_key`, `width`, `height`, `crop_x1/y1/x2/y2` | 解像度変更・クロップ |
| `rotate_flip` | `input_key`, `rotate_deg`, `flip_horizontal`, `flip_vertical` | 回転・反転 |
| `overlay_image` | `video_key`, `image_key`, `x`, `y`, `width`, `height`, `opacity`, `start_sec`, `end_sec` | 透過合成オーバーレイ |
| `extract_audio` | `input_key` | 音声を MP3 で抽出 |
| `adjust_volume` | `input_key`, `factor` (0.0〜4.0) | 音量調整 |
| `color_filter` | `input_key`, `filter_type`, `value` | カラーフィルター（grayscale/brightness/contrast） |

#### AI 生成

| ツール | モデル | リージョン | 主要パラメータ | 制約 |
|-------|-------|----------|-------------|------|
| `generate_video` | Luma AI Ray 2 (`luma.ray-v2:0`) | us-west-2 | `prompt`, `duration` (5s/9s), `aspect_ratio`, `resolution` (720p/540p) | プロンプト 5000 文字以内 |
| `generate_video_from_image` | Luma AI Ray 2 (image-to-video) | us-west-2 | `image_key`, `prompt`, `duration`, `aspect_ratio` | 最初のフレームに画像を使用 |
| `generate_video_nova_reel` | Amazon Nova Reel (`amazon.nova-reel-v1:0`) | us-east-1 | `prompt`, `duration_sec` (1〜6) | プロンプト 512 文字以内、解像度 1280×720 固定 |
| `generate_image` | Stable Diffusion XL | us-east-1 | `prompt`, `width`, `height`, `cfg_scale`, `steps` | サイズは 64 の倍数 |
| `generate_speech` | Amazon Polly | ap-northeast-1 | `text`, `voice_id`, `engine` | 日本語: Takumi(男)/Kazuha(女) |

---

## 7. フロントエンド仕様

### 7.1 UI フロー

```
初回アクセス → WelcomeModal（3スライドオンボーディング）
                  ↓
             [Step 1] ファイルを選択（任意）
                  ↓ ファイル選択 or「スキップ」リンク
             [Step 2] 創作指示を入力
                  ↓ 「創作を開始」ボタン（instruction が空の場合 disabled）
          [uploading] ファイルアップロード進捗表示
                  ↓
          [submitted] ECS タスク状況ポーリング
                  ↓ COMPLETED
             [Step 4] CompletionModal（動画プレビュー + ダウンロード）
```

### 7.2 アプリ状態定義

| 状態 (`AppStep`) | 説明 |
|----------------|------|
| `idle` | 初期状態・入力フォーム表示 |
| `uploading` | S3 へのファイルアップロード中 |
| `submitted` | ECS タスク実行中（ポーリング中） |

| フェーズ (`SetupPhase`) | 説明 |
|----------------------|------|
| `file` | ファイル選択前（中・右カラムが 0.35 opacity で非活性） |
| `main` | ファイル選択後 or スキップ後（全カラムが活性） |

### 7.3 カラーパレット

素材感のある温かいリネン系パレット。

| 定数名 | カラーコード | 用途 |
|-------|------------|------|
| `bg` | `#0E0C07` | 背景（ほぼ黒） |
| `card` | `#E2D4B8` | カード（リネン色） |
| `border` | `#9C8660` | ボーダー |
| `accent` | `#7A4E22` | アクセント（琥珀・コニャック） |
| `accentHover` | `#6B4318` | ホバー時アクセント |
| `accentDisabled` | `#B0A080` | 無効状態のアクセント |
| `textMain` | `#1A1308` | メインテキスト |
| `textSub` | `#3D2C18` | サブテキスト |
| `textMuted` | `#6B5438` | ミュートテキスト |
| `badge` | `#C4A86E` | バッジ背景 |
| `badgeText` | `#3A2510` | バッジテキスト |

### 7.4 レイアウト（Step 1-2: `idle` 状態）

3 カラムグリッド（md 以上）。

```
+-------------------+-------------------+-------------------+
| 左カラム           | 中カラム           | 右カラム           |
| [1. ファイルを選択] | [2. 創作指示を入力] | AI動画生成モデル選択 |
| UploadZone        | セグメントコントロール| ドロップダウン      |
| （任意バッジ）      | (直接入力/AI相談)  | モデル情報パネル    |
| スキップリンク      | InstructionBox    | [創作を開始]ボタン  |
+-------------------+-------------------+-------------------+
```

### 7.5 コンポーネント一覧

| コンポーネント | ファイル | 役割 |
|-------------|---------|------|
| `App` | `App.tsx` | メインアプリ（状態管理・フロー制御） |
| `Stepper` | `Stepper.tsx` | 水平ステッパー（4 ステップ、ヘッダー直下表示）|
| `WelcomeModal` | `WelcomeModal.tsx` | 初回オンボーディングモーダル（3スライド、`localStorage: welcome_shown_v1`） |
| `UploadZone` | `UploadZone.tsx` | ドラッグ&ドロップファイル選択エリア |
| `InstructionBox` | `InstructionBox.tsx` | 創作指示入力テキストエリア（`hasFiles` prop でサンプルプロンプト切替） |
| `ChatModal` | `ChatModal.tsx` | AI チャットモーダル（フロントオーバーレイ） |
| `ChatBox` | `ChatBox.tsx` | チャット本体（`TypingDots` コンポーネント内包） |
| `ChatPreviewModal` | `ChatPreviewModal.tsx` | チャット確定後の指示内容プレビューモーダル |
| `TaskStatus` | `TaskStatus.tsx` | タスクステータス表示 |
| `CompletionModal` | `CompletionModal.tsx` | 完成モーダル（動画プレビュー + ダウンロード） |
| `VideoPreview` | `VideoPreview.tsx` | `<video>` タグによる動画再生 |
| `DownloadButton` | `DownloadButton.tsx` | ダウンロードボタン |

### 7.6 AI チャットモード

指示内容を AI と相談しながら整理する機能。

- セグメントコントロールで「直接入力」/「AIと相談しながら作成」を切替。
- 「AIと相談しながら作成」を選択すると `ChatModal` がオーバーレイ表示。
- `chatSessionId` はアプリ起動ごとに新規 UUID を生成（localStorage 非保存）。
- ユーザーメッセージを送信直後に楽観的表示（API 完了前に即時追加）、失敗時はロールバック。
- 「確定して指示欄に反映」ボタン → `/chat` (action=confirm) → `ChatPreviewModal` で確認 → 指示欄に反映。

#### TypingDots コンポーネント

AI 応答待ち中のインジケーター。メッセージングアプリ風の吹き出しバブル内に 3 ドットが順番に浮かぶアニメーション（`typingPulse` キーフレーム）。

### 7.7 サウンドフィードバック（snd-lib）

| イベント | サウンド |
|---------|---------|
| タスク開始（`RUNNING`） | `NOTIFICATION` |
| タスク完了（`COMPLETED`） | `CELEBRATION` |
| タスク失敗（`FAILED`） | `CAUTION` |
| ボタン押下 | `BUTTON` |
| モデル切替 | `TOGGLE_ON` |
| リセット | `TAP` |

### 7.8 AI 動画生成モデル選択

右カラムのドロップダウンで選択。選択時にモデル情報パネルを表示。

**Luma AI Ray 2** の特徴表示:
- 流体・煙・滝など複雑な物理現象を高精度にレンダリング
- 人物の微妙な表情・手の動き・自然なボディランゲージの再現に優れる
- スケール・遠近法・細部まで忠実に映像化する高い指示実行能力
- プロモーション動画・製品モックアップ・VFX プレビズに最適
- 生成スペック: 5s / 9s、540p〜720p、生成: 約2〜8分

**Amazon Nova Reel** の特徴表示:
- カメラアングル・動きのコントロールが優れており、テンポ感のある映像演出が可能
- ロゴやビジュアルアイデンティティをシーン全体で一貫して保持し、ブランド動画制作に強い
- 製品中心のナラティブや企業ブランドのストーリーテリングに最適
- 短尺シーンを低コストで量産でき、ストーリーボード検討の反復に向く
- 生成スペック: 最大6s（〜120s）、1280×720固定、生成: 約90秒〜

注意事項として「日本語テロップを入れたい場合は、動画編集（AI生成なし）をお使いください」を表示。

### 7.9 タスクポーリング（useTaskPoller hook）

`step === "submitted"` かつ `taskId` が設定された状態で定期的に `GET /tasks/{id}` を呼び出し、ステータスが `COMPLETED` または `FAILED` になるまで継続します。

---

## 8. データフロー

### 8.1 動画編集フロー（ファイルあり・AI 生成なし）

```
1. フロントエンド: ファイル選択
2. GET /upload-url?task_id=xxx&filename=video.mp4
   -> presigned PUT URL + S3 key 取得
3. PUT <presigned_url> (ファイル直接 S3 アップロード)
4. POST /tasks { task_id, instruction, input_keys, video_model: "none" }
   -> DynamoDB: PENDING 書き込み
   -> ECS RunTask 起動
5. GET /tasks/{id} (ポーリング)
6. ECS コンテナ (main.py):
   a. DynamoDB: RUNNING に更新
   b. Strands Agent 実行
   c. list_files -> trim_video (等) -> S3 upload
   d. output_key があれば COMPLETED, なければ FAILED に更新
7. フロントエンド: COMPLETED を検知
8. GET /download-url/{id} -> presigned GET URL 取得
9. CompletionModal で動画プレビュー + ダウンロード
```

### 8.2 AI 動画生成フロー（Luma AI Ray 2）

```
4. POST /tasks { video_model: "luma" }
5. main.py: instruction に "[AI動画生成モデル: Luma AI Ray 2]" を付与
6. Strands Agent:
   a. generate_video(prompt) を呼ぶ
   b. bedrock_luma (us-west-2) で luma.ray-v2:0 を非同期起動
   c. 生成完了まで polling (最大 15 分)
   d. bedrock-video-generation-us-west-2-{id}/tasks/{task_id}/output/{inv_id}/output.mp4 からダウンロード
   e. video-edit-assets-{account} (ap-northeast-1) にアップロード
```

### 8.3 AI チャットフロー

```
1. フロントエンド: ChatModal を開く（chatSessionId = 新規 UUID）
2. ユーザーメッセージ入力 → 楽観的表示
3. POST /chat { action: "message", session_id, message }
   -> chat.py: DynamoDB から過去履歴ロード
   -> Bedrock Claude Sonnet 4.6 で返答生成
   -> DynamoDB に履歴保存
   -> messages 配列を返す
4. [繰り返し]
5. 「確定」ボタン → POST /chat { action: "confirm", session_id }
   -> 会話全体を要約して指示文を生成
   -> { instruction: "..." } を返す
6. ChatModal を閉じる → ChatPreviewModal で指示内容確認
7. 確認 → InstructionBox に反映
```

---

## 9. Stepper 仕様

ヘッダー直下に表示する水平 4 ステッパー。

| ステップ番号 | ラベル | アクティブ条件 |
|-----------|-------|-------------|
| 1. ファイルを選択 | Film アイコン | 常に表示（任意ステップ） |
| 2. 創作指示を入力 | PenLine アイコン | `hasInstruction` が true で完了 |
| 3. 処理状況 | Activity アイコン | `isSubmitted` が true でアクティブ |
| 4. 結果プレビュー | Sparkles アイコン | タスク COMPLETED でアクティブ |

表示条件: `step === "idle"` の場合のみ表示（`step === "submitted"` では非表示）。

---

## 10. インフラ仕様（Terraform）

### 10.1 ファイル構成

```
infrastructure/
├── main.tf          # provider 設定 (ap-northeast-1 + us-west-2 alias: uswest2)
├── variables.tf     # 変数定義
├── vpc.tf           # VPC / パブリックサブネット×2 / IGW
├── ecs.tf           # ECS クラスター + タスク定義 (2vCPU / 4GB)
├── lambda.tf        # Lambda 関数×5
├── api_gateway.tf   # HTTP API v2
├── s3.tf            # assets バケット + frontend バケット
├── dynamodb.tf      # tasks テーブル + chat テーブル
├── iam.tf           # ECS 実行ロール / タスクロール / Lambda ロール
├── cloudfront.tf    # フロントエンド CDN
├── ecr.tf           # ECR リポジトリ
└── outputs.tf       # api_url, frontend_url, s3_bucket, ecr_repository_url 等
```

### 10.2 VPC 設定

| 項目 | 値 |
|-----|---|
| CIDR | `10.0.0.0/16` |
| パブリックサブネット | `ap-northeast-1a`, `ap-northeast-1c` |
| Internet Gateway | あり |

### 10.3 ECS タスク定義

| 項目 | 値 |
|-----|---|
| 起動タイプ | Fargate |
| CPU | 2 vCPU |
| メモリ | 4 GB |
| ネットワーク | パブリック IP あり（プライベートサブネット外の Bedrock/S3 アクセス用） |

### 10.4 Terraform 変数

`infrastructure/terraform.tfvars`（git 管理外）に以下を設定:

| 変数名 | 説明 |
|-------|------|
| `luma_s3_bucket_name` | Bedrock コンソールが us-west-2 に自動作成したバケット名 |
| `nova_reel_s3_bucket_name` | Bedrock コンソールが us-east-1 に自動作成したバケット名 |

---

## 11. WelcomeModal 仕様

初回アクセス時のみ表示する 3 スライドオンボーディングモーダル。

- `localStorage` のキー `welcome_shown_v1` で表示済みを管理。
- `shouldShowWelcome()` 関数で表示判定。
- 閉じると `welcome_shown_v1 = "true"` を保存、以降は非表示。

---

## 12. 主要な制約・仕様上の注意点

| 項目 | 内容 |
|-----|------|
| Luma AI 生成時間 | 最大 15 分かかる場合あり |
| Nova Reel 生成時間 | 約 90 秒〜 |
| ECS タスク上限 | Lambda のタイムアウト制限なし（Fargate 使用のため） |
| S3 一時ファイル | ECS コンテナ内 `/tmp/` を使用（コンテナ終了時に削除） |
| チャット履歴 | DynamoDB に session_id キーで保存。ページリロードで新セッション開始（過去履歴は復元されない） |
| CJK フォント | Docker イメージに `fonts-noto-cjk` を含む（日本語テロップ対応） |
| output_key なし = FAILED | エージェントが出力ファイルを生成しなかった場合は FAILED として DynamoDB に記録 |
| CORS | Lambda レスポンスに `Access-Control-Allow-Origin: *` を設定 |
| AI 生成モデルと日本語テロップ | AI 動画生成モデルでは日本語テロップを直接付与できない。別途「動画編集（AI生成なし）」で対応 |

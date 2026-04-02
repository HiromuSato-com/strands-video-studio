# ─── SQS キュー（タスクキュー） ────────────────────────────────────────────────
# create_task Lambda → SQS → runner_lambda → AgentCore Runtime の非同期フロー

resource "aws_sqs_queue" "task_dlq" {
  name                      = "${var.project_name}-task-dlq"
  message_retention_seconds = 1209600 # 14 日間 DLQ に保持

  tags = { Project = var.project_name }
}

resource "aws_sqs_queue" "task_queue" {
  name                       = "${var.project_name}-task-queue"
  visibility_timeout_seconds = 900    # runner Lambda の timeout (900s) に合わせる
  message_retention_seconds  = 86400  # 1 日

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.task_dlq.arn
    maxReceiveCount     = 1  # 1 回失敗したら DLQ へ（動画生成は再試行しない）
  })

  tags = { Project = var.project_name }
}

# ─── AgentCore Runtime 用 IAM ロール ──────────────────────────────────────────
# コンテナコードが使用するロール。
# bedrock-agentcore.amazonaws.com がこのロールを assume し、
# ECR プル・CloudWatch ログ書き込み・Bedrock/S3/DynamoDB 操作を行う。

resource "aws_iam_role" "agentcore_runtime" {
  name = "${var.project_name}-agentcore-runtime"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock-agentcore.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = { Project = var.project_name }
}

resource "aws_iam_role_policy" "agentcore_runtime_policy" {
  name = "${var.project_name}-agentcore-runtime-policy"
  role = aws_iam_role.agentcore_runtime.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # Bedrock: Claude / Nova Reel / Nova Canvas を呼び出す
      {
        Sid    = "BedrockInvoke"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:StartAsyncInvoke",
          "bedrock:GetAsyncInvoke",
        ]
        Resource = "*"
      },
      # S3: 入出力ファイル（assets バケット）
      {
        Sid    = "S3Access"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
        ]
        Resource = [
          aws_s3_bucket.assets.arn,
          "${aws_s3_bucket.assets.arn}/*",
        ]
      },
      # S3: Nova Reel 出力バケット（us-east-1）
      {
        Sid    = "NovaReelS3Access"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
        ]
        Resource = [
          data.aws_s3_bucket.nova_reel_output.arn,
          "${data.aws_s3_bucket.nova_reel_output.arn}/*",
        ]
      },
      # DynamoDB: タスクステータス管理
      {
        Sid    = "DynamoDBAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
        ]
        Resource = aws_dynamodb_table.tasks.arn
      },
      # Amazon Polly: 音声合成
      {
        Sid      = "PollyAccess"
        Effect   = "Allow"
        Action   = ["polly:SynthesizeSpeech"]
        Resource = "*"
      },
      # Amazon Transcribe: 文字起こし
      {
        Sid    = "TranscribeAccess"
        Effect = "Allow"
        Action = [
          "transcribe:StartTranscriptionJob",
          "transcribe:GetTranscriptionJob",
        ]
        Resource = "*"
      },
      # ECR: コンテナイメージのプル
      {
        Sid    = "ECRPull"
        Effect = "Allow"
        Action = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid    = "ECRImagePull"
        Effect = "Allow"
        Action = [
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
        ]
        # AgentCore Runtime は us-east-1 なので us-east-1 の ECR リポジトリを使用
        Resource = aws_ecr_repository.agent_useast1.arn
      },
      # CloudWatch Logs: コンテナログの書き込み
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "arn:aws:logs:*:${data.aws_caller_identity.current.account_id}:log-group:/agentcore/*"
      },
    ]
  })
}

# ─── AgentCore コンテナ用 CloudWatch ロググループ ─────────────────────────────
resource "aws_cloudwatch_log_group" "agentcore_agent" {
  provider          = aws.useast1  # AgentCore Runtime は us-east-1 で動作するため同リージョンに作成
  name              = "/agentcore/${var.project_name}-agent"
  retention_in_days = 30

  tags = { Project = var.project_name }
}

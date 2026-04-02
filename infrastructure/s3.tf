# ─── Assets bucket (video inputs / outputs) ───────────────────────────────────
resource "aws_s3_bucket" "assets" {
  bucket = "${var.project_name}-assets-${data.aws_caller_identity.current.account_id}"

  tags = {
    Project = var.project_name
  }
}

# S3 PUT イベント → Analyzer Lambda トリガー
# aws_lambda_permission.analyzer_s3 が先に作られる必要があるため depends_on を明示
resource "aws_s3_bucket_notification" "assets" {
  bucket = aws_s3_bucket.assets.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.analyzer.arn
    events              = ["s3:ObjectCreated:Put"]
    filter_prefix       = "tasks/"
    filter_suffix       = ".mp4"
  }

  lambda_function {
    lambda_function_arn = aws_lambda_function.analyzer.arn
    events              = ["s3:ObjectCreated:Put"]
    filter_prefix       = "tasks/"
    filter_suffix       = ".mov"
  }

  lambda_function {
    lambda_function_arn = aws_lambda_function.analyzer.arn
    events              = ["s3:ObjectCreated:Put"]
    filter_prefix       = "tasks/"
    filter_suffix       = ".jpg"
  }

  lambda_function {
    lambda_function_arn = aws_lambda_function.analyzer.arn
    events              = ["s3:ObjectCreated:Put"]
    filter_prefix       = "tasks/"
    filter_suffix       = ".jpeg"
  }

  lambda_function {
    lambda_function_arn = aws_lambda_function.analyzer.arn
    events              = ["s3:ObjectCreated:Put"]
    filter_prefix       = "tasks/"
    filter_suffix       = ".png"
  }

  lambda_function {
    lambda_function_arn = aws_lambda_function.analyzer.arn
    events              = ["s3:ObjectCreated:Put"]
    filter_prefix       = "tasks/"
    filter_suffix       = ".webp"
  }

  depends_on = [aws_lambda_permission.analyzer_s3]
}

# ファイル自動クリーンアップ
# - 入力ファイル（Lifecycle=input タグ付き）: 7日後に削除
# - 出力ファイル・その他（タグなし）: 30日後に削除
resource "aws_s3_bucket_lifecycle_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  # 入力ファイル: upload_url.py が presigned URL に Tagging=Lifecycle=input を付与
  rule {
    id     = "expire-input-files"
    status = "Enabled"

    filter {
      and {
        prefix = "tasks/"
        tags = {
          Lifecycle = "input"
        }
      }
    }

    expiration {
      days = 7
    }
  }

  # 出力ファイル・中間ファイル（タグなし）: 30日後に削除
  rule {
    id     = "expire-output-files"
    status = "Enabled"

    filter {
      prefix = "tasks/"
    }

    expiration {
      days = 30
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST", "DELETE", "HEAD"]
    # presigned URL での S3 直接アップロードは S3 ドメインへのクロスオリジンリクエストになるため
    # CloudFront ドメインのみを許可する（ワイルドカード不要）
    allowed_origins = ["https://${aws_cloudfront_distribution.frontend.domain_name}"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# Allow Amazon Bedrock async invoke to write generated videos to the assets bucket
resource "aws_s3_bucket_policy" "assets" {
  bucket = aws_s3_bucket.assets.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowBedrockAsyncInvoke"
        Effect = "Allow"
        Principal = {
          Service = "bedrock.amazonaws.com"
        }
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.assets.arn}/tasks/*"
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ─── Nova Reel output bucket (N. Virginia / us-east-1) ───────────────────────
# This bucket was auto-created by the Bedrock console when enabling Amazon Nova Reel.
# We reference it as a data source rather than managing it with Terraform.
data "aws_s3_bucket" "nova_reel_output" {
  provider = aws.useast1
  bucket   = var.nova_reel_s3_bucket_name
}

# Allow Amazon Bedrock Nova Reel async invoke to write generated videos to this bucket
resource "aws_s3_bucket_policy" "nova_reel_output" {
  provider = aws.useast1
  bucket   = data.aws_s3_bucket.nova_reel_output.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowBedrockNovaReelWrite"
        Effect = "Allow"
        Principal = {
          Service = "bedrock.amazonaws.com"
        }
        Action   = "s3:PutObject"
        Resource = "${data.aws_s3_bucket.nova_reel_output.arn}/*"
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}

# ─── Frontend bucket (React/Vite static files) ───────────────────────────────
resource "aws_s3_bucket" "frontend" {
  bucket = "${var.project_name}-frontend-${data.aws_caller_identity.current.account_id}"

  tags = {
    Project = var.project_name
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_website_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "index.html"
  }
}

# CloudFront Origin Access Control for frontend bucket
resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.project_name}-frontend-oac"
  description                       = "OAC for frontend S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Bucket policy allowing CloudFront OAC to read frontend files
resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontOAC"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.frontend.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn
          }
        }
      }
    ]
  })
}

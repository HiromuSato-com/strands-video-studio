locals {
  lambda_src_dir = "${path.module}/../backend/lambda"

  lambda_common_env = {
    S3_BUCKET      = aws_s3_bucket.assets.bucket
    DYNAMODB_TABLE = aws_dynamodb_table.tasks.name
    AWS_REGION_VAR = var.aws_region
  }
}

# ─── Zip archives ─────────────────────────────────────────────────────────────
data "archive_file" "upload_url" {
  type        = "zip"
  source_file = "${local.lambda_src_dir}/upload_url.py"
  output_path = "${path.module}/.lambda_zips/upload_url.zip"
}

data "archive_file" "create_task" {
  type        = "zip"
  source_file = "${local.lambda_src_dir}/create_task.py"
  output_path = "${path.module}/.lambda_zips/create_task.zip"
}

data "archive_file" "get_task" {
  type        = "zip"
  source_file = "${local.lambda_src_dir}/get_task.py"
  output_path = "${path.module}/.lambda_zips/get_task.zip"
}

data "archive_file" "download_url" {
  type        = "zip"
  source_file = "${local.lambda_src_dir}/download_url.py"
  output_path = "${path.module}/.lambda_zips/download_url.zip"
}

# ─── Lambda functions ─────────────────────────────────────────────────────────
resource "aws_lambda_function" "upload_url" {
  function_name    = "${var.project_name}-upload-url"
  role             = aws_iam_role.lambda.arn
  handler          = "upload_url.handler"
  runtime          = "python3.13"
  filename         = data.archive_file.upload_url.output_path
  source_code_hash = data.archive_file.upload_url.output_base64sha256
  timeout          = 30

  environment {
    variables = local.lambda_common_env
  }

  tags = { Project = var.project_name }
}

resource "aws_lambda_function" "create_task" {
  function_name    = "${var.project_name}-create-task"
  role             = aws_iam_role.lambda.arn
  handler          = "create_task.handler"
  runtime          = "python3.13"
  filename         = data.archive_file.create_task.output_path
  source_code_hash = data.archive_file.create_task.output_base64sha256
  timeout          = 30

  environment {
    variables = merge(local.lambda_common_env, {
      ECS_CLUSTER           = aws_ecs_cluster.main.name
      ECS_TASK_DEFINITION   = aws_ecs_task_definition.agent.arn
      ECS_SUBNET_IDS        = join(",", aws_subnet.public[*].id)
      ECS_SECURITY_GROUP_ID = aws_security_group.ecs_tasks.id
      CONTAINER_NAME        = "video-edit-agent"
      LUMA_S3_BUCKET        = aws_s3_bucket.luma_output.bucket
    })
  }

  tags = { Project = var.project_name }
}

resource "aws_lambda_function" "get_task" {
  function_name    = "${var.project_name}-get-task"
  role             = aws_iam_role.lambda.arn
  handler          = "get_task.handler"
  runtime          = "python3.13"
  filename         = data.archive_file.get_task.output_path
  source_code_hash = data.archive_file.get_task.output_base64sha256
  timeout          = 30

  environment {
    variables = local.lambda_common_env
  }

  tags = { Project = var.project_name }
}

resource "aws_lambda_function" "download_url" {
  function_name    = "${var.project_name}-download-url"
  role             = aws_iam_role.lambda.arn
  handler          = "download_url.handler"
  runtime          = "python3.13"
  filename         = data.archive_file.download_url.output_path
  source_code_hash = data.archive_file.download_url.output_base64sha256
  timeout          = 30

  environment {
    variables = local.lambda_common_env
  }

  tags = { Project = var.project_name }
}

# ─── Lambda permissions for API Gateway ──────────────────────────────────────
resource "aws_lambda_permission" "upload_url" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.upload_url.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "create_task" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.create_task.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "get_task" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_task.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "download_url" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.download_url.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

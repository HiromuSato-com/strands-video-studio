output "frontend_url" {
  description = "CloudFront URL for the frontend"
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

output "api_url" {
  description = "API Gateway URL"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "s3_bucket" {
  description = "S3 bucket name for assets"
  value       = aws_s3_bucket.assets.bucket
}

output "ecr_repository_url" {
  description = "ECR repository URL (ap-northeast-1, for local builds)"
  value       = aws_ecr_repository.agent.repository_url
}

output "ecr_repository_url_useast1" {
  description = "ECR repository URL (us-east-1, for AgentCore Runtime)"
  value       = aws_ecr_repository.agent_useast1.repository_url
}

output "nova_reel_output_bucket" {
  description = "S3 bucket name (us-east-1) for Amazon Nova Reel generated video output"
  value       = data.aws_s3_bucket.nova_reel_output.bucket
}

output "sqs_task_queue_url" {
  description = "SQS task queue URL (create_task Lambda sends messages here)"
  value       = aws_sqs_queue.task_queue.url
}

output "agentcore_runtime_role_arn" {
  description = "IAM role ARN to specify when creating the AgentCore Runtime (scripts/deploy-agentcore.sh で使用)"
  value       = aws_iam_role.agentcore_runtime.arn
}

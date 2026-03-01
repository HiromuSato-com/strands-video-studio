output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "Public subnet IDs for ECS Fargate"
  value       = aws_subnet.public[*].id
}

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
  description = "ECR repository URL for the agent image"
  value       = aws_ecr_repository.agent.repository_url
}

output "luma_output_bucket" {
  description = "S3 bucket name (us-west-2) for Luma AI generated video output"
  value       = data.aws_s3_bucket.luma_output.bucket
}

output "nova_reel_output_bucket" {
  description = "S3 bucket name (us-east-1) for Amazon Nova Reel generated video output"
  value       = data.aws_s3_bucket.nova_reel_output.bucket
}

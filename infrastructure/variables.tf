variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-northeast-1"
}

variable "project_name" {
  description = "Project name prefix for all resources"
  type        = string
  default     = "video-edit"
}

variable "bedrock_region" {
  description = "AWS region for Amazon Bedrock (must support Claude Sonnet)"
  type        = string
  default     = "us-east-1"
}

variable "nova_reel_s3_bucket_name" {
  description = "Existing S3 bucket name (us-east-1) created by Bedrock console for Amazon Nova Reel output. Enable amazon.nova-reel-v1:0 in Bedrock console (us-east-1) to auto-create this bucket."
  type        = string
  default     = ""
}

variable "tavily_api_key" {
  description = "Tavily API key for web search via MCP (https://tavily.com). Leave empty to disable Tavily search."
  type        = string
  default     = ""
  sensitive   = true
}

variable "agentcore_runtime_arn" {
  description = <<-EOT
    Amazon Bedrock AgentCore Runtime ARN.
    初回は空のまま terraform apply → scripts/deploy-agentcore.sh を実行すると
    terraform.tfvars に自動書き込みされる。
    書き込み後に再度 terraform apply を実行すること。
  EOT
  type        = string
  default     = ""
}

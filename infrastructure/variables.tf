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

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
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

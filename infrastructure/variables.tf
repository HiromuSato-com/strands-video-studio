variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-northeast-1"
}

variable "aws_profile" {
  description = "AWS CLI profile name"
  type        = string
  default     = "AWSAdministratorAccess-595351378921"
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

variable "luma_s3_bucket_name" {
  description = "Existing S3 bucket name (us-west-2) created by Bedrock console for Luma AI Ray 2 output"
  type        = string
  default     = "bedrock-video-generation-us-west-2-7rfhed"
}

variable "nova_reel_s3_bucket_name" {
  description = "Existing S3 bucket name (us-east-1) created by Bedrock console for Amazon Nova Reel output"
  type        = string
  default     = "bedrock-video-generation-us-east-1-eynjzo"
}

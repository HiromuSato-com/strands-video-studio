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

variable "vpc_id" {
  description = "VPC ID for ECS Fargate tasks"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs for ECS Fargate tasks (comma-separated)"
  type        = list(string)
}

variable "bedrock_region" {
  description = "AWS region for Amazon Bedrock (must support Claude Sonnet)"
  type        = string
  default     = "us-east-1"
}

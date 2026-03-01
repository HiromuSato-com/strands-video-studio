terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

# Oregon region provider for Luma AI Ray 2 (only available in us-west-2)
provider "aws" {
  alias   = "uswest2"
  region  = "us-west-2"
  profile = var.aws_profile
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

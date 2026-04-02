# ap-northeast-1 の ECR は AgentCore Runtime 移行後に不要となったため削除済み。
# AgentCore Runtime は us-east-1 で動作するため、コンテナイメージも us-east-1 ECR を使用する。

# us-east-1 の ECR（AgentCore Runtime と同リージョン必須）
resource "aws_ecr_repository" "agent_useast1" {
  provider             = aws.useast1
  name                 = "${var.project_name}-agent"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Project = var.project_name
  }
}

resource "aws_ecr_lifecycle_policy" "agent_useast1" {
  provider   = aws.useast1
  repository = aws_ecr_repository.agent_useast1.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep only last 3 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 3
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

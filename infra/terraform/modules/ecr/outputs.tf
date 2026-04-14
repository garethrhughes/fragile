output "backend_repository_url" {
  description = "The ECR repository URL for the backend image (without tag)."
  value       = aws_ecr_repository.backend.repository_url
}

output "frontend_repository_url" {
  description = "The ECR repository URL for the frontend image (without tag)."
  value       = aws_ecr_repository.frontend.repository_url
}

output "backend_repository_arn" {
  description = "The ARN of the backend ECR repository."
  value       = aws_ecr_repository.backend.arn
}

output "frontend_repository_arn" {
  description = "The ARN of the frontend ECR repository."
  value       = aws_ecr_repository.frontend.arn
}

output "backend_repository_name" {
  description = "The name of the backend ECR repository."
  value       = aws_ecr_repository.backend.name
}

output "frontend_repository_name" {
  description = "The name of the frontend ECR repository."
  value       = aws_ecr_repository.frontend.name
}

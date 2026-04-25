output "ecs_execution_role_arn" {
  description = "ARN of the ECS execution role (ECR pull + secrets injection)."
  value       = aws_iam_role.ecs_execution.arn
}

output "ecs_infrastructure_role_arn" {
  description = "ARN of the ECS Express infrastructure role (ALB, target groups, listeners)."
  value       = aws_iam_role.ecs_infrastructure.arn
}

output "backend_task_role_arn" {
  description = "ARN of the backend ECS task role."
  value       = aws_iam_role.backend_task.arn
}

output "frontend_task_role_arn" {
  description = "ARN of the frontend ECS task role."
  value       = aws_iam_role.frontend_task.arn
}

output "ci_user_arn" {
  description = "ARN of the CI IAM user (fragile-ci)."
  value       = aws_iam_user.ci.arn
}

output "ci_user_name" {
  description = "Name of the CI IAM user."
  value       = aws_iam_user.ci.name
}

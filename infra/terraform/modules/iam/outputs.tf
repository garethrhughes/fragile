output "apprunner_build_role_arn" {
  description = "ARN of the App Runner build role (ECR pull on service creation/update)."
  value       = aws_iam_role.apprunner_build.arn
}

output "backend_task_role_arn" {
  description = "ARN of the backend App Runner instance (task) role."
  value       = aws_iam_role.backend_task.arn
}

output "frontend_task_role_arn" {
  description = "ARN of the frontend App Runner instance (task) role."
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

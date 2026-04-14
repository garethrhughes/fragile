# ── Secrets Manager ARNs ─────────────────────────────────────────────────────

output "db_password_secret_arn" {
  description = "ARN of the Secrets Manager secret for the RDS master password."
  value       = aws_secretsmanager_secret.db_password.arn
}

output "jira_api_token_secret_arn" {
  description = "ARN of the Secrets Manager secret for the Jira API token."
  value       = aws_secretsmanager_secret.jira_api_token.arn
}

# ── SSM Parameter ARNs ────────────────────────────────────────────────────────

output "jira_base_url_param_arn" {
  description = "ARN of the SSM parameter for the Jira base URL."
  value       = aws_ssm_parameter.jira_base_url.arn
}

output "jira_user_email_param_arn" {
  description = "ARN of the SSM parameter for the Jira user email."
  value       = aws_ssm_parameter.jira_email.arn
}

output "frontend_url_param_arn" {
  description = "ARN of the SSM parameter for the frontend URL (used for CORS)."
  value       = aws_ssm_parameter.frontend_url.arn
}

output "timezone_param_arn" {
  description = "ARN of the SSM parameter for the application timezone."
  value       = aws_ssm_parameter.app_timezone.arn
}

# ── SSM Parameter names (for reference / manual updates) ─────────────────────

output "jira_base_url_param_name" {
  description = "Name of the SSM parameter for the Jira base URL."
  value       = aws_ssm_parameter.jira_base_url.name
}

output "jira_email_param_name" {
  description = "Name of the SSM parameter for the Jira user email."
  value       = aws_ssm_parameter.jira_email.name
}

output "frontend_url_param_name" {
  description = "Name of the SSM parameter for the frontend URL."
  value       = aws_ssm_parameter.frontend_url.name
}

output "timezone_param_name" {
  description = "Name of the SSM parameter for the application timezone."
  value       = aws_ssm_parameter.app_timezone.name
}

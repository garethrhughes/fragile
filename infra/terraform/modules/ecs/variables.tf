variable "environment" {
  description = "Deployment environment label."
  type        = string
}

# ── Image URIs ────────────────────────────────────────────────────────────────

variable "backend_image_uri" {
  description = "Full ECR image URI for the backend service (including tag)."
  type        = string
}

variable "frontend_image_uri" {
  description = "Full ECR image URI for the frontend service (including tag)."
  type        = string
}

# ── IAM roles ─────────────────────────────────────────────────────────────────

variable "ecs_execution_role_arn" {
  description = "ARN of the ECS execution role (ECR pull + secrets read)."
  type        = string
}

variable "backend_task_role_arn" {
  description = "ARN of the IAM role granted to the running backend container."
  type        = string
}

variable "frontend_task_role_arn" {
  description = "ARN of the IAM role granted to the running frontend container."
  type        = string
}

# ── Network ───────────────────────────────────────────────────────────────────

variable "vpc_id" {
  description = "VPC ID (unused directly but kept for consistency with network module outputs)."
  type        = string
}

variable "private_subnet_ids" {
  description = "List of private subnet IDs where ECS tasks run."
  type        = list(string)
}

variable "backend_security_group_id" {
  description = "ID of the security group for backend ECS tasks (allows inbound 3001 from ALB)."
  type        = string
}

variable "frontend_security_group_id" {
  description = "ID of the security group for frontend ECS tasks (allows inbound 3000 from ALB)."
  type        = string
}

# ── Target Groups ─────────────────────────────────────────────────────────────

variable "backend_target_group_arn" {
  description = "ARN of the ALB target group for the backend service."
  type        = string
}

variable "frontend_target_group_arn" {
  description = "ARN of the ALB target group for the frontend service."
  type        = string
}

# ── RDS ───────────────────────────────────────────────────────────────────────

variable "rds_endpoint" {
  description = "Hostname of the RDS instance endpoint (without port)."
  type        = string
  sensitive   = true
}

# ── Secrets / SSM parameter ARNs ─────────────────────────────────────────────

variable "db_password_secret_arn" {
  description = "ARN of the Secrets Manager secret containing the DB password."
  type        = string
}

variable "jira_api_token_secret_arn" {
  description = "ARN of the Secrets Manager secret containing the Jira API token."
  type        = string
}

variable "jira_base_url_param_arn" {
  description = "ARN of the SSM parameter for the Jira base URL."
  type        = string
}

variable "jira_user_email_param_arn" {
  description = "ARN of the SSM parameter for the Jira user email."
  type        = string
}

variable "timezone_param_arn" {
  description = "ARN of the SSM parameter for the application timezone."
  type        = string
}

# ── URLs (for cross-service env vars) ────────────────────────────────────────

variable "frontend_url" {
  description = "The stable frontend custom domain URL (e.g. https://dashboard.example.com). Used as CORS allowed-origin."
  type        = string
}

variable "dora_snapshot_lambda_name" {
  description = "Name of the DORA snapshot Lambda function. Injected as DORA_SNAPSHOT_LAMBDA_NAME env var."
  type        = string
}

variable "aws_region" {
  description = "AWS region. Injected as AWS_REGION env var and used for CloudWatch Logs config."
  type        = string
}


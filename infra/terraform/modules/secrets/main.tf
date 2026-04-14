locals {
  prefix = "/fragile/${var.environment}"
}

# ── Secrets Manager ──────────────────────────────────────────────────────────
# Secret shells are created here; actual values are set out-of-band by the
# operator via the AWS Console or CLI. Terraform state never holds the secret
# value thanks to lifecycle { ignore_changes = [secret_string] }.

resource "aws_secretsmanager_secret" "db_password" {
  name        = "fragile/${var.environment}/db-password"
  description = "RDS master password for the Fragile PostgreSQL instance."

  tags = {
    Name = "fragile-${var.environment}-db-password"
  }
}

resource "aws_secretsmanager_secret_version" "db_password_placeholder" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = "REPLACE_ME"

  lifecycle {
    # Prevent Terraform from overwriting the real value once it has been set.
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "jira_api_token" {
  name        = "fragile/${var.environment}/jira-api-token"
  description = "Jira API token for the Fragile backend service."

  tags = {
    Name = "fragile-${var.environment}-jira-api-token"
  }
}

resource "aws_secretsmanager_secret_version" "jira_api_token_placeholder" {
  secret_id     = aws_secretsmanager_secret.jira_api_token.id
  secret_string = "REPLACE_ME"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ── SSM Parameters (Standard tier — no cost) ─────────────────────────────────
# Non-sensitive configuration injected into the backend App Runner service.
# Values are placeholder strings; the operator fills them in after first apply.

resource "aws_ssm_parameter" "jira_base_url" {
  name        = "${local.prefix}/jira-base-url"
  description = "Jira Cloud instance URL (e.g. https://your-org.atlassian.net)."
  type        = "String"
  tier        = "Standard"
  value       = "REPLACE_ME"

  lifecycle {
    ignore_changes = [value]
  }

  tags = {
    Name = "fragile-${var.environment}-jira-base-url"
  }
}

resource "aws_ssm_parameter" "jira_email" {
  name        = "${local.prefix}/jira-email"
  description = "Email address of the Jira API user."
  type        = "String"
  tier        = "Standard"
  value       = "REPLACE_ME"

  lifecycle {
    ignore_changes = [value]
  }

  tags = {
    Name = "fragile-${var.environment}-jira-email"
  }
}

resource "aws_ssm_parameter" "frontend_url" {
  name        = "${local.prefix}/frontend-url"
  description = "Public URL of the frontend service (used for CORS on the backend)."
  type        = "String"
  tier        = "Standard"
  value       = "REPLACE_ME"

  lifecycle {
    ignore_changes = [value]
  }

  tags = {
    Name = "fragile-${var.environment}-frontend-url"
  }
}

resource "aws_ssm_parameter" "app_timezone" {
  name        = "${local.prefix}/app-timezone"
  description = "IANA timezone string for the backend service (e.g. Australia/Sydney)."
  type        = "String"
  tier        = "Standard"
  value       = "Australia/Sydney"

  lifecycle {
    ignore_changes = [value]
  }

  tags = {
    Name = "fragile-${var.environment}-app-timezone"
  }
}

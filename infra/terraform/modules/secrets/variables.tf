variable "environment" {
  description = "Deployment environment label (used in secret/parameter names)."
  type        = string
}

variable "aws_region" {
  description = "AWS region (informational only; used in tags)."
  type        = string
}

variable "google_client_id" {
  description = "Google OAuth client ID (public, not a secret). Stored as the secret value so the backend and frontend share one source of truth."
  type        = string
}

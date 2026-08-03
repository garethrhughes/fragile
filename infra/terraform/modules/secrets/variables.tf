variable "environment" {
  description = "Deployment environment label (used in secret/parameter names)."
  type        = string
}

variable "aws_region" {
  description = "AWS region (informational only; used in tags)."
  type        = string
}

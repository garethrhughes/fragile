variable "environment" {
  description = "Deployment environment label."
  type        = string
}

variable "subnet_ids" {
  description = "List of private subnet IDs for the RDS DB subnet group (must span at least 2 AZs)."
  type        = list(string)
}

variable "rds_security_group_id" {
  description = "ID of the security group to attach to the RDS instance."
  type        = string
}

variable "db_password_secret_arn" {
  description = "ARN of the Secrets Manager secret containing the RDS master password."
  type        = string
}

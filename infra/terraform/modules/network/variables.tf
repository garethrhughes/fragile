variable "environment" {
  description = "Deployment environment label."
  type        = string
}

variable "aws_region" {
  description = "AWS region (used to construct AZ names for subnets)."
  type        = string
}

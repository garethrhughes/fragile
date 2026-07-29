variable "domain_name" {
  description = "Root domain name (e.g. 'example.com'). A Route 53 hosted zone must already exist."
  type        = string
}

variable "frontend_subdomain" {
  description = "Subdomain for the frontend (e.g. 'fragile')."
  type        = string
}

variable "backend_subdomain" {
  description = "Subdomain for the backend API (e.g. 'fragile-api')."
  type        = string
}

variable "alb_dns_name" {
  description = "DNS name of the internal ALB. Used as the CloudFront VPC origin domain for both distributions."
  type        = string
}

variable "alb_arn" {
  description = "ARN of the internal ALB created by ECS Express Gateway. Used to create a CloudFront VPC Origin so CloudFront can reach the internal ALB."
  type        = string
}

variable "web_acl_arn" {
  description = "ARN of the CloudFront-scoped WAFv2 WebACL to attach to both distributions."
  type        = string
}

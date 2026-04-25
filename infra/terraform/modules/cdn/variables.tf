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

variable "backend_service_url" {
  description = "ECS Express service URL for the backend (e.g. https://fragile-backend.ecs.ap-southeast-2.on.aws). Used as the CloudFront origin."
  type        = string
}

variable "frontend_service_url" {
  description = "ECS Express service URL for the frontend. Used as the CloudFront origin."
  type        = string
}

variable "web_acl_arn" {
  description = "ARN of the CloudFront-scoped WAFv2 WebACL to attach to both distributions."
  type        = string
}

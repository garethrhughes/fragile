variable "environment" {
  description = "Deployment environment label."
  type        = string
}

variable "domain_name" {
  description = "Root domain name. A Route 53 hosted zone for this domain must already exist."
  type        = string
}

variable "frontend_subdomain" {
  description = "Subdomain for the frontend service (e.g. 'dashboard')."
  type        = string
}

variable "backend_subdomain" {
  description = "Subdomain for the backend API service (e.g. 'api')."
  type        = string
}

variable "backend_service_url" {
  description = "The default App Runner URL for the backend service (e.g. https://<id>.ap-southeast-2.awsapprunner.com)."
  type        = string
}

variable "frontend_service_url" {
  description = "The default App Runner URL for the frontend service."
  type        = string
}

variable "backend_apprunner_service_arn" {
  description = "ARN of the backend App Runner service (for custom domain association)."
  type        = string
}

variable "frontend_apprunner_service_arn" {
  description = "ARN of the frontend App Runner service (for custom domain association)."
  type        = string
}

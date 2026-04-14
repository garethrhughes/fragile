output "backend_service_arn" {
  description = "ARN of the backend App Runner service."
  value       = aws_apprunner_service.backend.arn
}

output "frontend_service_arn" {
  description = "ARN of the frontend App Runner service."
  value       = aws_apprunner_service.frontend.arn
}

output "backend_service_id" {
  description = "The App Runner service ID for the backend (used in custom domain association)."
  value       = aws_apprunner_service.backend.service_id
}

output "frontend_service_id" {
  description = "The App Runner service ID for the frontend (used in custom domain association)."
  value       = aws_apprunner_service.frontend.service_id
}

output "backend_service_url" {
  description = "The default App Runner service URL for the backend (e.g. <id>.ap-southeast-2.awsapprunner.com)."
  value       = "https://${aws_apprunner_service.backend.service_url}"
}

output "frontend_service_url" {
  description = "The default App Runner service URL for the frontend (e.g. <id>.ap-southeast-2.awsapprunner.com)."
  value       = "https://${aws_apprunner_service.frontend.service_url}"
}

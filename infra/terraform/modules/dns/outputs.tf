output "route53_zone_id" {
  description = "The Route 53 hosted zone ID."
  value       = data.aws_route53_zone.main.zone_id
}

output "backend_fqdn" {
  description = "The fully-qualified domain name for the backend service."
  value       = aws_route53_record.backend.fqdn
}

output "frontend_fqdn" {
  description = "The fully-qualified domain name for the frontend service."
  value       = aws_route53_record.frontend.fqdn
}

output "backend_custom_domain_association_id" {
  description = "ID of the backend App Runner custom domain association."
  value       = aws_apprunner_custom_domain_association.backend.id
}

output "frontend_custom_domain_association_id" {
  description = "ID of the frontend App Runner custom domain association."
  value       = aws_apprunner_custom_domain_association.frontend.id
}

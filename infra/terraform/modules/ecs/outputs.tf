output "cluster_name" {
  description = "Name of the ECS cluster."
  value       = aws_ecs_cluster.this.name
}

output "backend_service_name" {
  description = "Name of the backend ECS service."
  value       = aws_ecs_service.backend.name
}

output "frontend_service_name" {
  description = "Name of the frontend ECS service."
  value       = aws_ecs_service.frontend.name
}

# These outputs preserve the same interface the cdn module expects.
# The values are the ECS Express Gateway hostnames that CloudFront uses as
# origin domain names (with a custom Host header injected by CloudFront).
output "backend_service_url" {
  description = "ALB DNS name used as CloudFront origin for the backend."
  value       = data.aws_lb.express_gateway.dns_name
}

output "frontend_service_url" {
  description = "ALB DNS name used as CloudFront origin for the frontend."
  value       = data.aws_lb.express_gateway.dns_name
}

output "alb_arn" {
  description = "ARN of the internal ALB. Used by CloudFront VPC Origin."
  value       = data.aws_lb.express_gateway.arn
}

output "alb_dns_name" {
  description = "DNS name of the internal ALB. Used as CloudFront origin domain."
  value       = data.aws_lb.express_gateway.dns_name
}

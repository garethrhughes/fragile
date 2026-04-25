output "backend_service_url" {
  description = "The ECS Express service URL for the backend (e.g. https://fragile-backend.ecs.<region>.on.aws)."
  value       = module.backend_service.service_url
}

output "frontend_service_url" {
  description = "The ECS Express service URL for the frontend (e.g. https://fragile-frontend.ecs.<region>.on.aws)."
  value       = module.frontend_service.service_url
}

output "cluster_name" {
  description = "Name of the ECS cluster."
  value       = module.ecs_cluster.cluster_name
}

output "backend_service_name" {
  description = "Name of the backend ECS Express service."
  value       = module.backend_service.name
}

output "frontend_service_name" {
  description = "Name of the frontend ECS Express service."
  value       = module.frontend_service.name
}

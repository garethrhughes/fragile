output "db_endpoint" {
  description = "The hostname of the RDS instance endpoint (without port)."
  value       = aws_db_instance.main.address
  sensitive   = true
}

output "db_port" {
  description = "The port the RDS instance listens on."
  value       = aws_db_instance.main.port
}

output "db_name" {
  description = "The name of the default database on the RDS instance."
  value       = aws_db_instance.main.db_name
}

output "db_instance_id" {
  description = "The RDS instance identifier."
  value       = aws_db_instance.main.identifier
}

output "db_instance_arn" {
  description = "The ARN of the RDS instance."
  value       = aws_db_instance.main.arn
}

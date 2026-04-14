output "vpc_id" {
  description = "The ID of the VPC."
  value       = aws_vpc.main.id
}

output "private_subnet_ids" {
  description = "List of private subnet IDs (one per AZ, used by RDS subnet group and VPC connector)."
  value       = [aws_subnet.private_a.id, aws_subnet.private_b.id]
}

output "private_subnet_a_id" {
  description = "ID of the first private subnet (AZ a)."
  value       = aws_subnet.private_a.id
}

output "private_subnet_b_id" {
  description = "ID of the second private subnet (AZ b)."
  value       = aws_subnet.private_b.id
}

output "rds_security_group_id" {
  description = "ID of the RDS security group (allows inbound 5432 from App Runner connector only)."
  value       = aws_security_group.rds.id
}

output "apprunner_connector_security_group_id" {
  description = "ID of the App Runner VPC connector security group."
  value       = aws_security_group.apprunner_connector.id
}

output "vpc_connector_arn" {
  description = "ARN of the App Runner VPC connector (attached to backend service)."
  value       = aws_apprunner_vpc_connector.main.arn
}

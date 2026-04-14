# ── VPC ─────────────────────────────────────────────────────────────────────

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "fragile-vpc"
  }
}

# ── Private subnets (2 AZs — required by RDS subnet group) ──────────────────

resource "aws_subnet" "private_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = false

  tags = {
    Name = "fragile-private-a"
    Tier = "private"
  }
}

resource "aws_subnet" "private_b" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = "${var.aws_region}b"
  map_public_ip_on_launch = false

  tags = {
    Name = "fragile-private-b"
    Tier = "private"
  }
}

# ── Security group: App Runner VPC connector ─────────────────────────────────
# App Runner attaches this SG to the ENIs it places in the private subnets.
# Outbound to RDS on 5432 is controlled by the RDS SG (inbound rule below).

resource "aws_security_group" "apprunner_connector" {
  name        = "fragile-apprunner-connector-sg"
  description = "Security group attached to the App Runner VPC connector ENIs."
  vpc_id      = aws_vpc.main.id

  # Allow all outbound traffic from the connector (needed for RDS + DNS resolution).
  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "fragile-apprunner-connector-sg"
  }
}

# ── Security group: RDS ──────────────────────────────────────────────────────
# Inbound PostgreSQL only from the App Runner VPC connector SG.

resource "aws_security_group" "rds" {
  name        = "fragile-rds-sg"
  description = "Allow inbound PostgreSQL from the App Runner VPC connector only."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from App Runner VPC connector"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.apprunner_connector.id]
  }

  egress {
    description = "Allow all outbound (for RDS patch downloads etc.)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "fragile-rds-sg"
  }
}

# ── App Runner VPC connector ─────────────────────────────────────────────────
# Attached to the backend App Runner service so it can reach RDS in the VPC.
# The frontend service does NOT use a VPC connector.

resource "aws_apprunner_vpc_connector" "main" {
  vpc_connector_name = "fragile-vpc-connector"

  subnets = [
    aws_subnet.private_a.id,
    aws_subnet.private_b.id,
  ]

  security_groups = [aws_security_group.apprunner_connector.id]

  tags = {
    Name = "fragile-vpc-connector"
  }
}

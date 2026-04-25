# ── ECS Cluster ──────────────────────────────────────────────────────────────
# Single cluster for all Fragile services. Uses Fargate capacity provider only.

module "ecs_cluster" {
  source  = "terraform-aws-modules/ecs/aws//modules/cluster"
  version = "~> 6.0"

  cluster_name = "fragile"

  fargate_capacity_providers = {
    FARGATE = {
      default_capacity_provider_strategy = {
        weight = 1
      }
    }
  }

  tags = {
    Name = "fragile-ecs-cluster"
  }
}

# ── Backend ECS Express service ──────────────────────────────────────────────
# NestJS API — 1024 CPU / 2048 MB, port 3001, VPC-attached (RDS + Jira via NAT).

module "backend_service" {
  source  = "terraform-aws-modules/ecs/aws//modules/express-service"
  version = "~> 6.0"

  name    = "fragile-backend"
  cluster = module.ecs_cluster.cluster_name

  cpu    = "1024"
  memory = "2048"

  primary_container = {
    image = var.backend_image_uri
    port  = 3001

    environment = {
      NODE_ENV                  = "production"
      PORT                      = "3001"
      DB_PORT                   = "5432"
      DB_DATABASE               = "fragile"
      DB_USERNAME               = "postgres"
      DB_HOST                   = var.rds_endpoint
      FRONTEND_URL              = var.frontend_url
      DORA_SNAPSHOT_LAMBDA_NAME = var.dora_snapshot_lambda_name
      AWS_REGION                = var.aws_region
      USE_LAMBDA                = "true"
    }

    secrets = {
      DB_PASSWORD     = var.db_password_secret_arn
      JIRA_API_TOKEN  = var.jira_api_token_secret_arn
      JIRA_BASE_URL   = var.jira_base_url_param_arn
      JIRA_USER_EMAIL = var.jira_user_email_param_arn
      TIMEZONE        = var.timezone_param_arn
    }
  }

  health_check_path = "/health"

  network_configuration = {
    subnets         = var.private_subnet_ids
    security_groups = [var.backend_security_group_id]
  }

  scaling_target = {
    min_capacity = 1
    max_capacity = 3
    metric       = "cpu"
    threshold    = 80
  }

  infrastructure_role_arn = var.ecs_infrastructure_role_arn

  task_role_arn      = var.backend_task_role_arn
  execution_role_arn = var.ecs_execution_role_arn

  tags = {
    Name = "fragile-backend"
  }
}

# ── Frontend ECS Express service ─────────────────────────────────────────────
# Next.js standalone — 512 CPU / 1024 MB, port 3000.

module "frontend_service" {
  source  = "terraform-aws-modules/ecs/aws//modules/express-service"
  version = "~> 6.0"

  name    = "fragile-frontend"
  cluster = module.ecs_cluster.cluster_name

  cpu    = "512"
  memory = "1024"

  primary_container = {
    image = var.frontend_image_uri
    port  = 3000

    environment = {
      NODE_ENV = "production"
      HOSTNAME = "0.0.0.0"
    }
  }

  health_check_path = "/api/health"

  network_configuration = {
    subnets         = var.private_subnet_ids
    security_groups = [var.frontend_security_group_id]
  }

  scaling_target = {
    min_capacity = 1
    max_capacity = 3
    metric       = "cpu"
    threshold    = 80
  }

  infrastructure_role_arn = var.ecs_infrastructure_role_arn

  task_role_arn      = var.frontend_task_role_arn
  execution_role_arn = var.ecs_execution_role_arn

  tags = {
    Name = "fragile-frontend"
  }
}

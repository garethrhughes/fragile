data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.name
}

# ── Trust policies ──────────────────────────────────────────────────────────

data "aws_iam_policy_document" "ecs_tasks_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "ecs_infrastructure_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs.amazonaws.com"]
    }
  }
}

# ── ECS execution role (ECR pull + secrets read) ───────────────────────────
# Used by ECS to pull images from ECR and inject secrets at task startup.
# Replaces the former App Runner build role.

resource "aws_iam_role" "ecs_execution" {
  name               = "fragile-ecs-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json

  tags = {
    Name = "fragile-ecs-execution-role"
  }
}

resource "aws_iam_role_policy_attachment" "ecs_execution_ecr" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# The execution role also needs to read secrets and SSM parameters so ECS can
# inject them as environment variables at task startup.
data "aws_iam_policy_document" "ecs_execution_secrets" {
  statement {
    sid    = "ReadSecrets"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = [
      var.db_password_secret_arn,
      var.jira_api_token_secret_arn,
    ]
  }

  statement {
    sid    = "ReadSSMParameters"
    effect = "Allow"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
    ]
    resources = [
      "arn:aws:ssm:${local.region}:${local.account_id}:parameter${var.ssm_parameter_path_prefix}*",
    ]
  }
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name   = "fragile-ecs-execution-secrets-policy"
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.ecs_execution_secrets.json
}

# ── ECS infrastructure role (Express Gateway) ──────────────────────────────
# Used by the ECS Express Gateway to manage ALB, target groups, and listener
# rules on behalf of the service. This role has no App Runner equivalent.

resource "aws_iam_role" "ecs_infrastructure" {
  name               = "fragile-ecs-infrastructure-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_infrastructure_trust.json

  tags = {
    Name = "fragile-ecs-infrastructure-role"
  }
}

resource "aws_iam_role_policy_attachment" "ecs_infrastructure_express" {
  role       = aws_iam_role.ecs_infrastructure.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices"
}

# ── Backend task role ────────────────────────────────────────────────────────
# Grants the running backend container permission to read secrets and SSM params,
# write logs, and invoke the DORA snapshot Lambda.

resource "aws_iam_role" "backend_task" {
  name               = "fragile-backend-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json

  tags = {
    Name = "fragile-backend-task-role"
  }
}

data "aws_iam_policy_document" "backend_task_permissions" {
  # Secrets Manager -- DB password and Jira API token
  statement {
    sid    = "ReadSecrets"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = [
      var.db_password_secret_arn,
      var.jira_api_token_secret_arn,
    ]
  }

  # SSM Parameter Store -- all non-sensitive config under /fragile/<env>/
  statement {
    sid    = "ReadSSMParameters"
    effect = "Allow"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
    ]
    resources = [
      "arn:aws:ssm:${local.region}:${local.account_id}:parameter${var.ssm_parameter_path_prefix}*",
    ]
  }

  # CloudWatch Logs
  statement {
    sid    = "WriteLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams",
    ]
    resources = ["arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/ecs/fragile-backend*"]
  }

  # Lambda invocation -- for DORA snapshot post-sync computation
  statement {
    sid       = "InvokeDoraSnapshotLambda"
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = [var.dora_snapshot_lambda_arn]
  }
}

resource "aws_iam_role_policy" "backend_task" {
  name   = "fragile-backend-task-policy"
  role   = aws_iam_role.backend_task.id
  policy = data.aws_iam_policy_document.backend_task_permissions.json
}

# ── Frontend task role ───────────────────────────────────────────────────────
# The frontend container has no AWS service dependencies at runtime.
# CloudWatch logs only.

resource "aws_iam_role" "frontend_task" {
  name               = "fragile-frontend-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json

  tags = {
    Name = "fragile-frontend-task-role"
  }
}

data "aws_iam_policy_document" "frontend_task_permissions" {
  statement {
    sid    = "WriteLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams",
    ]
    resources = ["arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/ecs/fragile-frontend*"]
  }
}

resource "aws_iam_role_policy" "frontend_task" {
  name   = "fragile-frontend-task-policy"
  role   = aws_iam_role.frontend_task.id
  policy = data.aws_iam_policy_document.frontend_task_permissions.json
}

# ── CI IAM user ──────────────────────────────────────────────────────────────
# Used by GitHub Actions to push images to ECR and trigger ECS Express
# deployments. The owner creates the access key manually in the AWS Console
# and stores it in GitHub Actions secrets -- Terraform only defines the user
# and its permissions.

resource "aws_iam_user" "ci" {
  name = "fragile-ci"
  path = "/ci/"

  tags = {
    Name    = "fragile-ci"
    Purpose = "GitHub Actions CI/CD"
  }
}

data "aws_iam_policy_document" "ci_permissions" {
  # ECR authentication (required before every push)
  statement {
    sid    = "ECRAuthentication"
    effect = "Allow"
    actions = [
      "ecr:GetAuthorizationToken",
    ]
    resources = ["*"]
  }

  # ECR push to both repositories
  statement {
    sid    = "ECRPush"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [
      var.backend_ecr_arn,
      var.frontend_ecr_arn,
    ]
  }

  # ECS Express -- describe and update services for deployment
  statement {
    sid    = "ECSExpressDeploy"
    effect = "Allow"
    actions = [
      "ecs:DescribeServices",
      "ecs:UpdateService",
      "ecs:DescribeClusters",
      "ecs:ListServices",
    ]
    resources = [
      "arn:aws:ecs:${local.region}:${local.account_id}:cluster/fragile",
      "arn:aws:ecs:${local.region}:${local.account_id}:service/fragile/*",
    ]
  }

  # PassRole -- required for CI to pass task/execution/infrastructure roles
  # when triggering ECS deployments. Scoped to the specific role ARNs.
  statement {
    sid    = "PassECSRoles"
    effect = "Allow"
    actions = ["iam:PassRole"]
    resources = [
      aws_iam_role.ecs_execution.arn,
      aws_iam_role.backend_task.arn,
      aws_iam_role.frontend_task.arn,
      aws_iam_role.ecs_infrastructure.arn,
    ]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com", "ecs.amazonaws.com"]
    }
  }
}

resource "aws_iam_policy" "ci" {
  name        = "fragile-ci-policy"
  description = "Permissions for the fragile CI/CD pipeline (ECR push + ECS Express deploy)."
  policy      = data.aws_iam_policy_document.ci_permissions.json
}

resource "aws_iam_user_policy_attachment" "ci" {
  user       = aws_iam_user.ci.name
  policy_arn = aws_iam_policy.ci.arn
}

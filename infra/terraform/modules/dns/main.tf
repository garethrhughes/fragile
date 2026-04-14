# Look up the existing Route 53 hosted zone by domain name.
# The zone must already exist in the AWS account — Terraform will NOT create it.
data "aws_route53_zone" "main" {
  name         = "${var.domain_name}."
  private_zone = false
}

# ── App Runner custom domain associations ─────────────────────────────────────
# These tell App Runner to serve traffic for the custom hostnames.
# App Runner will return DNS validation records that must be added to Route 53
# before the association becomes active.

resource "aws_apprunner_custom_domain_association" "backend" {
  domain_name          = "${var.backend_subdomain}.${var.domain_name}"
  service_arn          = var.backend_apprunner_service_arn
  enable_www_subdomain = false
}

resource "aws_apprunner_custom_domain_association" "frontend" {
  domain_name          = "${var.frontend_subdomain}.${var.domain_name}"
  service_arn          = var.frontend_apprunner_service_arn
  enable_www_subdomain = false
}

# ── CNAME records for App Runner domain validation ────────────────────────────
# App Runner requires CNAME records to verify ownership of the custom domain.
# These are separate from the A/ALIAS records that route traffic.

resource "aws_route53_record" "backend_validation" {
  for_each = {
    for cert in aws_apprunner_custom_domain_association.backend.certificate_validation_records :
    cert.name => cert
  }

  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 300
  records = [each.value.value]
}

resource "aws_route53_record" "frontend_validation" {
  for_each = {
    for cert in aws_apprunner_custom_domain_association.frontend.certificate_validation_records :
    cert.name => cert
  }

  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 300
  records = [each.value.value]
}

# ── CNAME records pointing subdomains → App Runner service URLs ───────────────
# App Runner does not expose a static IP, so we use CNAME records (not ALIAS).
# Strip the leading "https://" from service_url to get the bare hostname.

resource "aws_route53_record" "backend" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "${var.backend_subdomain}.${var.domain_name}"
  type    = "CNAME"
  ttl     = 300

  # service_url from the apprunner module is "https://<host>" — strip the scheme.
  records = [replace(var.backend_service_url, "https://", "")]
}

resource "aws_route53_record" "frontend" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "${var.frontend_subdomain}.${var.domain_name}"
  type    = "CNAME"
  ttl     = 300

  records = [replace(var.frontend_service_url, "https://", "")]
}

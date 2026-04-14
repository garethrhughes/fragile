# Remote state configuration — S3 bucket and DynamoDB table must be created
# manually BEFORE running `terraform init` for the first time.
#
# Bootstrap steps (one-time, run from your terminal with admin credentials):
#
#   aws s3api create-bucket \
#     --bucket <TODO: replace with your state bucket name> \
#     --region ap-southeast-2 \
#     --create-bucket-configuration LocationConstraint=ap-southeast-2
#
#   aws s3api put-bucket-versioning \
#     --bucket <TODO: replace with your state bucket name> \
#     --versioning-configuration Status=Enabled
#
#   aws s3api put-bucket-encryption \
#     --bucket <TODO: replace with your state bucket name> \
#     --server-side-encryption-configuration \
#       '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
#
#   aws dynamodb create-table \
#     --table-name <TODO: replace with your lock table name> \
#     --attribute-definitions AttributeName=LockID,AttributeType=S \
#     --key-schema AttributeName=LockID,KeyType=HASH \
#     --billing-mode PAY_PER_REQUEST \
#     --region ap-southeast-2

terraform {
  backend "s3" {
    # TODO: Replace with your S3 bucket name (created manually during bootstrap)
    bucket = "fragile-terraform-state-TODO"

    # State file path within the bucket
    key = "prod/terraform.tfstate"

    # Must match the region where the bucket was created
    region = "ap-southeast-2"

    # TODO: Replace with your DynamoDB table name (created manually during bootstrap)
    dynamodb_table = "fragile-terraform-locks-TODO"

    encrypt = true
  }
}

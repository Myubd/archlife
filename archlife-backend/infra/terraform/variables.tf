variable "aws_region" {
  type    = string
  default = "ap-northeast-1"
}

variable "project_name" {
  type    = string
  default = "archlife"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "db_username" {
  type    = string
  default = "archlife"
}

variable "db_password" {
  type      = string
  sensitive = true
  # terraform.tfvars か環境変数 TF_VAR_db_password で渡すこと。デフォルト値は入れない。
}

# ECSタスクが使うバックエンドのコンテナイメージ。
# 事前に ECR リポジトリを作成し、docker build & push しておく必要がある。
variable "backend_image" {
  type = string
}

variable "backend_container_port" {
  type    = number
  default = 8080
}

# ローカルLLM(Ollama)をホストするEC2インスタンスタイプ。GPU付きインスタンスを推奨。
variable "llm_instance_type" {
  type    = string
  default = "g4dn.xlarge"
}

# 外部API(Claude/GPT)のキー。Secrets Managerで管理する場合はこの変数は使わず、
# ECSタスク定義側でsecretsブロックから参照する形に置き換えること。
variable "anthropic_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "openai_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

# ---------- ローカルLLM(Qwen)を自己ホストするEC2 ----------
# 外部には公開せず、ECS/Lambdaのセキュリティグループからのみアクセス可能。

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
}

resource "aws_instance" "llm" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.llm_instance_type
  subnet_id              = aws_subnet.private[0].id
  vpc_security_group_ids = [aws_security_group.llm.id]

  root_block_device {
    volume_size = 100 # モデルを複数保持できるように余裕を持たせる
  }

  # Docker + Ollama をインストールし、Qwenモデルを起動時に取得する。
  # 実運用では、コストを抑えるため使わない時間帯は停止する運用(Lambda等での自動起動/停止)を推奨。
  user_data = <<-EOF
    #!/bin/bash
    set -e
    curl -fsSL https://get.docker.com | sh
    docker run -d --restart unless-stopped --gpus all \
      -v /opt/ollama:/root/.ollama -p 11434:11434 --name ollama ollama/ollama
    sleep 10
    docker exec ollama ollama pull qwen3:8b
  EOF

  tags = { Name = "${var.project_name}-llm" }
}

# ---------- 非同期AIパイプライン ----------

resource "aws_sqs_queue" "ai_queue" {
  name                       = "${var.project_name}-ai-queue"
  visibility_timeout_seconds = 120
}

resource "aws_sns_topic" "notifications" {
  name = "${var.project_name}-notifications"
}

resource "aws_cloudwatch_event_bus" "main" {
  name = "${var.project_name}-bus"
}

# ECS側が発行する "ai.requested" イベントをSQSにルーティングする
resource "aws_cloudwatch_event_rule" "ai_requested" {
  name           = "${var.project_name}-ai-requested"
  event_bus_name = aws_cloudwatch_event_bus.main.name
  event_pattern = jsonencode({
    source      = ["archlife.api"],
    detail-type = ["ai.requested"]
  })
}

resource "aws_cloudwatch_event_target" "to_sqs" {
  rule           = aws_cloudwatch_event_rule.ai_requested.name
  event_bus_name = aws_cloudwatch_event_bus.main.name
  arn            = aws_sqs_queue.ai_queue.arn
}

# 定期バッチ(ストリーク再計算/サブスク通知/月次サマリー)
resource "aws_cloudwatch_event_rule" "daily_batch" {
  name                = "${var.project_name}-daily-batch"
  schedule_expression = "cron(0 22 * * ? *)" # UTC 22:00 = JST 7:00
}

resource "aws_cloudwatch_event_target" "daily_batch_lambda" {
  rule = aws_cloudwatch_event_rule.daily_batch.name
  arn  = aws_lambda_function.ai_worker.arn
}

resource "aws_iam_role" "lambda_exec" {
  name = "${var.project_name}-lambda-exec-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Action    = "sts:AssumeRole",
      Effect    = "Allow",
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "lambda_sqs_sns" {
  name = "${var.project_name}-lambda-sqs-sns"
  role = aws_iam_role.lambda_exec.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect   = "Allow",
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
        Resource = aws_sqs_queue.ai_queue.arn
      },
      {
        Effect   = "Allow",
        Action   = ["sns:Publish"],
        Resource = aws_sns_topic.notifications.arn
      }
    ]
  })
}

# NOTE: `lambda_worker.zip` はこのTerraformの外で用意する必要がある。
# 中身は server.js の buildPrompt/callLocalQwen/callClaude/callOpenAI 相当のロジックを
# Lambdaハンドラとして実装したもの(このリポジトリのbackendコードを流用して構築できる)。
resource "aws_lambda_function" "ai_worker" {
  function_name = "${var.project_name}-ai-worker"
  role          = aws_iam_role.lambda_exec.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  filename      = "lambda_worker.zip"
  timeout       = 60

  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      OLLAMA_URL        = "http://${aws_instance.llm.private_ip}:11434"
      SNS_TOPIC_ARN     = aws_sns_topic.notifications.arn
      DATABASE_URL      = "postgres://${var.db_username}:${var.db_password}@${aws_db_instance.main.endpoint}/archlife"
      ANTHROPIC_API_KEY = var.anthropic_api_key
      OPENAI_API_KEY    = var.openai_api_key
    }
  }
}

resource "aws_lambda_event_source_mapping" "sqs_to_lambda" {
  event_source_arn = aws_sqs_queue.ai_queue.arn
  function_name    = aws_lambda_function.ai_worker.arn
  batch_size       = 1
}

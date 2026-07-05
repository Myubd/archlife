output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "cloudfront_domain" {
  value = aws_cloudfront_distribution.frontend.domain_name
}

output "rds_endpoint" {
  value = aws_db_instance.main.endpoint
}

output "llm_private_ip" {
  value = aws_instance.llm.private_ip
}

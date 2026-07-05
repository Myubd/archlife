# RenderのPrivate Service用。外部には公開されず、同じRenderプロジェクト内の
# Webサービスからのみ内部ネットワーク経由でアクセスされる想定。
#
# GPUが使えない(Renderの制約)ため、本来はCPUで動く小型の量子化モデルが無難。
# 既定は qwen3:8b にしているが、8Bクラスなので starter プラン(CPUのみ)だと
# 応答がかなり遅い/メモリ不足になりうる。実用に耐えない場合は qwen2.5:1.5b-instruct や
# qwen2.5:3b-instruct など小型モデルに戻すことを検討する。
FROM ollama/ollama:latest

# 起動時に一度だけモデルを取得してからサーバーを立ち上げる。
ENV OLLAMA_MODEL=qwen3:8b

EXPOSE 11434

CMD ollama serve & \
    sleep 5 && \
    ollama pull ${OLLAMA_MODEL} && \
    wait

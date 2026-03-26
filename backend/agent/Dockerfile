# AgentCore Runtime は ARM64 コンテナが必須
FROM --platform=linux/arm64 python:3.13-slim

COPY --from=mwader/static-ffmpeg:latest /ffmpeg /usr/local/bin/
COPY --from=mwader/static-ffmpeg:latest /ffprobe /usr/local/bin/

# Japanese fonts for TextClip (add_text tool)
# fonts-ipafont-gothic: IPA Gothic/P Gothic .ttf — reliable Japanese TTF for PIL/MoviePy
# fonts-noto-cjk: fallback CJK fonts (.ttc)
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-ipafont-gothic \
    fonts-noto-cjk \
    nodejs \
    npm \
    && npm install -g tavily-mcp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# AgentCore Runtime: port 8080 で FastAPI サーバーを起動
# --workers 1 でシングルスレッド（env var の競合を防ぐ）
EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]

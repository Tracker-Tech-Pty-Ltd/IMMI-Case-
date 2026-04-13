FROM python:3.12-slim
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Build React frontend
RUN cd frontend && npm ci && npm run build 2>/dev/null || true

EXPOSE 8080
ENV APP_ENV=production
ENV PYTHONUNBUFFERED=1

COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

# entrypoint.sh fixes DNS (Cloudflare Containers have no resolver configured)
# then starts Flask with the Supabase backend.
CMD ["./entrypoint.sh"]

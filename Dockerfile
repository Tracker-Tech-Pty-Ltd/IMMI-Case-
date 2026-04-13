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

# Cloudflare Containers override /etc/resolv.conf at startup, so we can't fix DNS there.
# Instead, pre-resolve Supabase hostnames to IPs during the build (when DNS works) and
# write them into /etc/hosts. The container runtime appends to /etc/hosts but never
# overwrites it, so these entries survive and httpx can connect without DNS.
RUN python3 -c "import socket; h='urntbuqczarkuoaosjxd.supabase.co'; ip=socket.gethostbyname(h); open('/etc/hosts','a').write(f'{ip} {h}\n'); print(f'hosts: {ip} {h}')"

CMD ["python", "web.py", "--host", "0.0.0.0", "--port", "8080", "--backend", "supabase"]

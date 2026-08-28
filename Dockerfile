# Active Cloudflare Container image: extraction only.
# It has no database client, object-store binding or catalog writer. The
# pipeline Worker remains the sole owner of durable D1/R2/Vectorize writes.
FROM python:3.12-slim
WORKDIR /app

COPY requirements-extractor.txt constraints-extractor.txt ./
RUN pip install --no-cache-dir -c constraints-extractor.txt -r requirements-extractor.txt

COPY extract_container.py ./
COPY immi_case_downloader/__init__.py ./immi_case_downloader/__init__.py
COPY immi_case_downloader/extraction ./immi_case_downloader/extraction

ENV APP_ENV=production
ENV PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["python", "extract_container.py"]

# Stillgreen cloud image: presence daemon + control surface in one process.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    SG_LOCAL_CONFIG_DIR=/data/config \
    SG_LOCAL_STATE_DIR=/data/state \
    SG_LOCAL_WEB_HOST=0.0.0.0 \
    SG_LOCAL_ALLOW_VERCEL=1

WORKDIR /app

COPY pyproject.toml README.md ./
COPY sg_local ./sg_local
RUN pip install --no-cache-dir . \
    && mkdir -p /data/config /data/state \
    && chmod 700 /data/config /data/state

VOLUME ["/data"]
EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os,urllib.request; p=os.environ.get('PORT') or os.environ.get('SG_LOCAL_WEB_PORT') or '8765'; urllib.request.urlopen('http://127.0.0.1:'+p+'/api/health', timeout=4)"

CMD ["python", "-m", "sg_local", "cloud"]

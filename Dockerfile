# Stillgreen daemon and control page, for a cloud server or any Docker host.
#
#   docker build -t stillgreen .
#   docker run -d -p 127.0.0.1:8765:8765 -v stillgreen-data:/data stillgreen
#
# Put HTTPS in front of port 8765 (see docker-compose.yml): the dashboard is an
# https:// page and browsers block it from calling a plain http:// server.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    SG_LOCAL_CONFIG_DIR=/data/config \
    SG_LOCAL_STATE_DIR=/data/state \
    SG_LOCAL_RUN_AS=stillgreen

WORKDIR /app
COPY pyproject.toml README.md ./
COPY sg_local ./sg_local
RUN pip install . \
    && useradd --create-home --uid 10001 stillgreen \
    && mkdir -p /data \
    && chown stillgreen /data

# Tokens and the access code live on this volume. The container starts as
# root only so `sg-local` can give a freshly mounted, root-owned volume (as on
# Fly.io) to the stillgreen user; every sg-local command then drops to that
# user (SG_LOCAL_RUN_AS) before doing anything else.
VOLUME /data
EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os, urllib.request; port = os.environ.get('PORT') or os.environ.get('SG_LOCAL_WEB_PORT') or '8765'; urllib.request.urlopen('http://127.0.0.1:%s/api/health' % port, timeout=4)"

CMD ["sg-local", "cloud"]

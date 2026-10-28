FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000
WORKDIR /app/backend
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --system --uid 10001 --create-home apexion \
    && mkdir -p .cache/fastf1 \
    && chown -R apexion:apexion /app/backend
COPY --chown=10001:10001 backend/app ./app
USER 10001:10001
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers"]

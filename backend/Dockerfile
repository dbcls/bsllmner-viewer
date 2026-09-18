FROM python:3.12-slim-bookworm

ENV UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PYTHONUNBUFFERED=1

COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /uvx /bin/

WORKDIR /app

COPY pyproject.toml uv.lock* ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project || uv sync --no-install-project

COPY . .
RUN --mount=type=cache,target=/root/.cache/uv uv sync

EXPOSE 8000
CMD ["uv", "run", "uvicorn", "bsllmner_viewer.api.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]

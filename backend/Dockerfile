# compose.yml builds the dev stage: the development tools, and the source that compose.yml mounts over /app.
# deploy/compose.yml builds the runtime stage: only the packages that the api needs.
FROM docker.io/library/python:3.14-slim-trixie AS uv

ENV UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1

COPY --from=ghcr.io/astral-sh/uv:0.13 /uv /uvx /bin/

WORKDIR /app

COPY pyproject.toml uv.lock ./

FROM uv AS dev

RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-install-project

COPY . .
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen

EXPOSE 8000
CMD ["uv", "run", "uvicorn", "bsllmner_viewer.api.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]

# The project is installed as a package and not as a link to the source, so the runtime stage needs only the
# environment. The bytecode is compiled here, because the runtime container cannot write it.
FROM uv AS packages

ENV UV_COMPILE_BYTECODE=1

RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project

COPY README.md ./
COPY src src
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-editable

FROM docker.io/library/python:3.14-slim-trixie AS runtime

ENV PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1

# The api installs no package. pip of the base image carries its own copies of other packages, such as urllib3.
RUN python -m pip uninstall --yes --root-user-action=ignore pip

COPY --from=packages /app/.venv /app/.venv

# The commit that /api/service-info reports. The RUN between ARG and ENV makes podman build the ENV layer again when the value changes.
ARG BSLLMNER_VIEWER_COMMIT=
RUN true
ENV BSLLMNER_VIEWER_COMMIT=${BSLLMNER_VIEWER_COMMIT}

EXPOSE 8000
CMD ["uvicorn", "bsllmner_viewer.api.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]

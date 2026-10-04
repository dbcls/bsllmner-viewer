FROM docker.io/library/node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# Chromium and its system libraries, for the end-to-end tests.
RUN npx playwright install --with-deps chromium

COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

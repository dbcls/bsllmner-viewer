import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { reactRouter } from "@react-router/dev/vite"
import tailwindcss from "@tailwindcss/vite"
import type { Plugin } from "vite"
import { defineConfig } from "vitest/config"

import { buildLlmsFull } from "./scripts/llms-full.ts"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const isTest = process.env.VITEST === "true"

// docs/ of the repository, or /docs in the dev container where /app is frontend/.
const docsDir = path.resolve(__dirname, "../docs")

/** Serves /llms.txt and /llms-full.txt in the dev server as Markdown, as the web image serves them. */
const llmsFull = (): Plugin => ({
  name: "llms-full",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use("/llms.txt", (_request, response) => {
      response.setHeader("Content-Type", "text/markdown; charset=utf-8")
      response.end(readFileSync(path.resolve(__dirname, "public/llms.txt")))
    })
    server.middlewares.use("/llms-full.txt", (_request, response) => {
      try {
        const text = buildLlmsFull(docsDir)
        response.setHeader("Content-Type", "text/markdown; charset=utf-8")
        response.end(text)
      } catch {
        response.statusCode = 404
        response.end("llms-full.txt needs the docs directory next to the frontend directory")
      }
    })
  },
})

export default defineConfig({
  define: {
    __BSLLMNER_VIEWER_COMMIT__: JSON.stringify(process.env.BSLLMNER_VIEWER_COMMIT ?? ""),
  },
  plugins: [
    tailwindcss(),
    llmsFull(),
    ...(isTest ? [] : [reactRouter()]),
  ],
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./app"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: process.env.BSLLMNER_VIEWER_API_URL ?? "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/unit/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/pbt/**/*.test.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**", "build/**", ".react-router/**"],
  },
})

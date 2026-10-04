// @vitest-environment node
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import openapiTS, { astToString, COMMENT_HEADER } from "openapi-typescript"
import { describe, expect, it } from "vitest"

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** The OpenAPI document that the backend tests compare with the api: backend/ of the repository, or /backend in the container. */
const OPENAPI_JSON = path.resolve(HERE, "../../../../backend/openapi.json")

const OPENAPI_TYPES = path.resolve(HERE, "../../../app/lib/api/openapi-types.ts")

/** The text that `npm run gen:api-types` writes for an OpenAPI document. */
const generate = async (document: unknown): Promise<string> => COMMENT_HEADER + astToString(await openapiTS(document as Parameters<typeof openapiTS>[0]))

describe("openapi-types.ts", () => {
  it("equals the types that openapi-typescript generates from backend/openapi.json", async () => {
    expect(existsSync(OPENAPI_JSON), `${OPENAPI_JSON} is not readable. Run the test in a container that mounts backend/.`).toBe(true)
    const generated = await generate(JSON.parse(readFileSync(OPENAPI_JSON, "utf8")))
    expect(readFileSync(OPENAPI_TYPES, "utf8") === generated, "openapi-types.ts differs from backend/openapi.json. Run npm run gen:api-types.").toBe(true)
  }, 30_000)
})

import { ESLint } from "eslint"
import { describe, expect, it } from "vitest"

const eslint = new ESLint({ cwd: process.cwd() })

const rulesOf = async (filePath: string, text: string): Promise<string[]> => {
  const [result] = await eslint.lintText(text, { filePath })
  return (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.message)
}

const HEX = 'export const color = "#fff"\n'
const ARBITRARY = 'export const width = "w-[150px]"\n'

describe("lint rules for colors and sizes", () => {
  it.each(["app/features/x.tsx", "app/routes/x.tsx", "app/ui/x.tsx", "app/shell/x.tsx"])("rejects a raw hex color in %s", async (filePath) => {
    const messages = await rulesOf(filePath, HEX)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(/Raw hex colors/)
  }, 60_000)

  it("accepts a raw hex color in app/lib", async () => {
    expect(await rulesOf("app/lib/x.ts", HEX)).toEqual([])
  }, 60_000)

  it.each(["app/features/x.tsx", "app/routes/x.tsx"])("rejects a Tailwind arbitrary value in %s", async (filePath) => {
    const messages = await rulesOf(filePath, ARBITRARY)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(/arbitrary values/)
  }, 60_000)

  it.each(["app/ui/x.tsx", "app/shell/x.tsx", "app/lib/x.ts"])("accepts a Tailwind arbitrary value in %s", async (filePath) => {
    expect(await rulesOf(filePath, ARBITRARY)).toEqual([])
  }, 60_000)
})

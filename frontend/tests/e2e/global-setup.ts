import type { FullConfig } from "@playwright/test"

type Dataset = { dataset_version: { name: string } }

/** The tests assert on the synthetic dataset; any other store would fail them for the wrong reasons. */
const globalSetup = async (config: FullConfig): Promise<void> => {
  const baseURL = config.projects[0]?.use.baseURL
  if (!baseURL) throw new Error("baseURL is not configured")
  const response = await fetch(new URL("/api/dataset", baseURL))
  if (!response.ok) {
    throw new Error(`GET /api/dataset returned ${response.status}: is the api running behind the dev server at ${baseURL}?`)
  }
  const dataset = (await response.json()) as Dataset
  if (dataset.dataset_version.name !== "synthetic") {
    throw new Error(
      `the api serves the dataset "${dataset.dataset_version.name}"; point BSLLMNER_VIEWER_STORE at the synthetic store`,
    )
  }
}

export default globalSetup

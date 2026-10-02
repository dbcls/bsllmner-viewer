import type { FullConfig } from "@playwright/test"

type ServiceInfo = { store: string }
type Dataset = { datasetVersion: { name: string; createdAt: string; digest: string } }

/** The tests read every expectation from the api of the site, so the site must be up with its store ready. */
const globalSetup = async (config: FullConfig): Promise<void> => {
  const baseURL = config.projects[0]?.use.baseURL
  if (!baseURL) throw new Error("set BSLLMNER_VIEWER_E2E_BASE_URL to the address of the deployment to test")
  const info = await fetch(new URL("/api/service-info", baseURL))
  if (info.status !== 200) throw new Error(`GET /api/service-info returned ${info.status}`)
  const { store } = (await info.json()) as ServiceInfo
  if (store !== "ok") throw new Error(`the store of the deployment is "${store}", expected "ok"`)
  const response = await fetch(new URL("/api/dataset", baseURL))
  if (!response.ok) throw new Error(`GET /api/dataset returned ${response.status}`)
  const { datasetVersion } = (await response.json()) as Dataset
  console.log(`e2e dataset: ${datasetVersion.name} (created ${datasetVersion.createdAt}, digest ${datasetVersion.digest})`)
}

export default globalSetup

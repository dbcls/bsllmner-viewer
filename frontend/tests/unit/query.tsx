import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import { type ReactElement, type ReactNode, useState } from "react"

/** A new client on every call, so that no cache is shared between tests. Retries are off so that an error shows at once. */
export const newQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

/** Provides one client that lives as long as the wrapper stays mounted. */
const QueryWrapper = ({ children }: { children: ReactNode }) => {
  const [client] = useState(newQueryClient)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
export const wrapper = QueryWrapper

/** Provides the given client, for a test that keeps the client to read or share its cache. */
export const wrapperFor = (client: QueryClient) => ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

/** Renders the element under a new client. */
export const renderWithQuery = (ui: ReactElement) => render(ui, { wrapper })

/** The shape that openapi-fetch gives for a successful request. */
export const ok = <T,>(data: T) => ({ data, response: new Response("{}") })

import { index, route,type RouteConfig } from "@react-router/dev/routes"

export default [
  index("routes/landing.tsx"),
  route("/entries", "routes/workspace.tsx"),
  route("/entries/:accession", "routes/sample.tsx"),
] satisfies RouteConfig

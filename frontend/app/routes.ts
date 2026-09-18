import { index, route,type RouteConfig } from "@react-router/dev/routes"

export default [
  index("routes/landing.tsx"),
  route("/w", "routes/workspace.tsx"),
  route("/s/:accession", "routes/sample.tsx"),
] satisfies RouteConfig

import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { directives, evaluateMap, expand, loadTemplate, location, locations, type Node,server } from "./nginx-conf"

const ENV = { BSLLMNER_VIEWER_NOINDEX: "false", NGINX_LOCAL_RESOLVERS: "127.0.0.11" }
const nodes = loadTemplate(ENV)
const withNoindex = (value: string) => loadTemplate({ ...ENV, BSLLMNER_VIEWER_NOINDEX: value })

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OPENAPI_TYPES = path.resolve(HERE, "../../../app/lib/api/openapi-types.ts")

/** The keys of the problem document of the api, read from `ProblemDetails` of the types generated from its OpenAPI. */
const apiProblemKeys = (): string[] => {
  const source = readFileSync(OPENAPI_TYPES, "utf8")
  const model = /^ {8}ProblemDetails: \{\n([\s\S]*?)\n {8}\};/m.exec(source)?.[1] ?? ""
  return [...model.matchAll(/^ {12}(\w+): /gm)].map((match) => match[1] ?? "")
}

const serverDirective = (name: string): string[][] => directives(server(nodes), name)
const headerVariable = (header: string): string | undefined =>
  serverDirective("add_header").find(([name]) => name === header)?.[1]

const vars = (extra: Record<string, string> = {}) => ({
  status: "200",
  uri: "/",
  request_id: "generated-id",
  http_x_request_id: "",
  http_x_forwarded_proto: "",
  csp_script_hashes: "'sha256-AAAA'",
  time_iso8601: "2026-01-01T00:00:00+00:00",
  ...extra,
})

describe("access log of nginx", () => {
  it("ends each line with the request time, the upstream time, and the request ID of the response", () => {
    const format = nodes.find((node) => node.name === "log_format")
    expect(format?.args[0]).toBe("timed")
    const fields = (format?.args ?? []).slice(1).join("").split(" ")
    expect(fields.slice(-3)).toEqual([
      "request_time=$request_time",
      "upstream_time=$upstream_response_time",
      "request_id=$sent_http_x_request_id",
    ])
  })

  it("writes the access log of every request in that format", () => {
    expect(serverDirective("access_log")).toEqual([["/var/log/nginx/access.log", "timed"]])
  })
})

describe("size limit of a request body", () => {
  it("limits the body of a request to 64 KiB", () => {
    expect(serverDirective("client_max_body_size")).toEqual([["64k"]])
  })
})

describe("problem responses of nginx", () => {
  const cases = [
    { name: "@payload_too_large", status: 413, title: "Content Too Large" },
    { name: "@too_many_requests", status: 429, title: "Too Many Requests" },
  ]

  for (const { name, status, title } of cases) {
    const body = (extra: Record<string, string>) => {
      const [code, template = ""] = directives(location(nodes, name), "return")[0] ?? []
      expect(code).toBe(String(status))
      return expand(nodes, template, vars({ status: String(status), ...extra }))
    }

    it(`${status} body is JSON with the keys of the problem document of the api`, () => {
      const parsed = JSON.parse(body({ uri: "/api/dsl/select" })) as Record<string, unknown>
      expect(Object.keys(parsed).sort()).toEqual(apiProblemKeys().sort())
      expect(parsed).toMatchObject({
        type: "about:blank",
        title,
        status,
        instance: "/api/dsl/select",
        requestId: "generated-id",
      })
      expect(typeof parsed.detail).toBe("string")
      expect(typeof parsed.timestamp).toBe("string")
    })

    it(`${status} body is JSON for any path and any request ID header`, () => {
      fc.assert(
        fc.property(fc.string({ unit: "binary" }).filter((s) => !s.includes("\n")), fc.string(), (uri, header) => {
          const parsed = JSON.parse(body({ uri, http_x_request_id: header })) as Record<string, string>
          expect((parsed.instance ?? "").startsWith("/")).toBe(true)
          expect(parsed.requestId).toMatch(/^[A-Za-z0-9._-]+$|^generated-id$/)
        }),
      )
    })

    it(`${status} body has the problem document keys even for a path that needs JSON escaping`, () => {
      const parsed = JSON.parse(body({ uri: "/api/\"\\x" })) as Record<string, unknown>
      expect(Object.keys(parsed).sort()).toEqual(apiProblemKeys().sort())
    })
  }

  it("413 body tells the limit of 64 KiB", () => {
    const template = directives(location(nodes, "@payload_too_large"), "return")[0]?.[1] ?? ""
    const parsed = JSON.parse(expand(nodes, template, vars({ status: "413" }))) as { detail: string }
    expect(parsed.detail).toContain("64 KiB")
  })

  it("429 body names exports for an export path and requests for any other path", () => {
    const template = directives(location(nodes, "@too_many_requests"), "return")[0]?.[1] ?? ""
    const detail = (uri: string) =>
      (JSON.parse(expand(nodes, template, vars({ status: "429", uri }))) as { detail: string }).detail
    expect(detail("/api/export/entries")).toContain("exports")
    expect(detail("/api/entries")).toContain("requests")
  })

  it("the problem document of the api has the keys that this test compares", () => {
    expect(apiProblemKeys().sort()).toEqual(["detail", "instance", "requestId", "status", "timestamp", "title", "type"])
  })
})

describe("limits of the requests in progress of a client", () => {
  const api = location(nodes, "~ ^/api(/|$)")
  const exportLocation = location(nodes, "~ ^/api/export/")

  it("allows 100 requests in progress for /api and answers the excess with 429", () => {
    expect(directives(api, "limit_conn")).toEqual([["per_client", "100"]])
    expect(directives(api, "limit_conn_status")).toEqual([["429"]])
    expect(directives(api, "error_page")).toContainEqual(["429", "@too_many_requests"])
  })

  it("allows 2 exports in progress, besides the 100 requests, because a location with limit_conn does not inherit", () => {
    expect(directives(exportLocation, "limit_conn").sort()).toEqual([["per_client", "100"], ["per_client_export", "2"]])
  })

  it("keeps the count of each client in the zones that the limits name", () => {
    const zones = nodes.filter((node) => node.name === "limit_conn_zone").map((node) => node.args[1])
    expect(zones).toEqual(["zone=per_client:10m", "zone=per_client_export:10m"])
  })

  it("tells a client with too many requests to retry after 1 second and a client with too many exports after 10", () => {
    const retry = (status: string, uri: string) => evaluateMap(nodes, "retry_after", vars({ status, uri }))
    expect(retry("429", "/api/export/entries/biosample")).toBe("10")
    expect(retry("429", "/api/entries/biosample")).toBe("1")
    expect(retry("200", "/api/entries/biosample")).toBe("")
    expect(retry("413", "/api/dsl/select")).toBe("")
  })

  it("sends Retry-After and X-Request-ID with the 413 and 429 responses only", () => {
    expect(headerVariable("Retry-After")).toBe("$retry_after")
    expect(headerVariable("X-Request-ID")).toBe("$nginx_request_id")
    const id = (status: string) => evaluateMap(nodes, "nginx_request_id", vars({ status, http_x_request_id: "abc" }))
    expect(id("413")).toBe("abc")
    expect(id("429")).toBe("abc")
    expect(id("200")).toBe("")
    expect(id("404")).toBe("")
  })
})

describe("client address", () => {
  it("is taken from X-Real-IP only when the peer is a private IPv4, IPv6 unique local, or loopback address", () => {
    const trusted = serverDirective("set_real_ip_from").map(([range]) => range).sort()
    expect(trusted).toEqual(
      ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "::1", "fc00::/7"].sort(),
    )
    expect(serverDirective("real_ip_header")).toEqual([["X-Real-IP"]])
  })
})

describe("request ID of a 413 or 429 response", () => {
  const generated = "generated-id"
  const result = (header: string) =>
    evaluateMap(nodes, "problem_request_id", vars({ http_x_request_id: header, request_id: generated }))
  /** The rule of the docs: at most 128 characters of letters, digits, `.`, `_`, and `-`. */
  const usable = (header: string) => header.length >= 1 && header.length <= 128 && /^[A-Za-z0-9._-]*$/.test(header)

  const valid = fc.constantFrom(..."abcXYZ019._-".split(""))
  const invalid = fc.constantFrom(..." \"'\\/{}$:;,é\u0000\t日".split(""))
  const char = fc.oneof({ weight: 6, arbitrary: valid }, { weight: 1, arbitrary: invalid })

  it("is the header when the header is usable and a generated ID otherwise", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.array(char, { maxLength: 130 }).map((chars) => chars.join("")),
          fc.array(valid, { minLength: 120, maxLength: 130 }).map((chars) => chars.join("")),
        ),
        (header) => {
          expect(result(header)).toBe(usable(header) ? header : generated)
        },
      ),
      { numRuns: 500 },
    )
  })

  it("uses a header of 128 characters and replaces a header of 129 characters", () => {
    expect(result("a".repeat(128))).toBe("a".repeat(128))
    expect(result("a".repeat(129))).toBe(generated)
  })

  it("replaces an empty header and a header with a character outside the allowed set", () => {
    expect(result("")).toBe(generated)
    for (const bad of ["a b", "a\"b", "a\\b", "a/b", "é", "a,b"]) expect(result(bad)).toBe(generated)
  })
})

describe("CORS headers of a 413 or 429 response", () => {
  const origin = (status: string) => evaluateMap(nodes, "cors_origin", vars({ status }))
  const expose = (status: string) => evaluateMap(nodes, "cors_expose", vars({ status }))

  it("allow every origin and expose Retry-After and X-Request-ID", () => {
    for (const status of ["413", "429"]) {
      expect(origin(status)).toBe("*")
      expect(expose(status)).toBe("Retry-After, X-Request-ID")
    }
  })

  it("are empty for the other statuses, which the api answers with its own headers", () => {
    for (const status of ["200", "206", "304", "400", "404", "500", "502"]) {
      expect(origin(status)).toBe("")
      expect(expose(status)).toBe("")
    }
  })

  it("are sent with the names that browsers read", () => {
    expect(headerVariable("Access-Control-Allow-Origin")).toBe("$cors_origin")
    expect(headerVariable("Access-Control-Expose-Headers")).toBe("$cors_expose")
  })
})

describe("Content-Security-Policy", () => {
  const csp = (uri: string) => evaluateMap(nodes, "csp", vars({ uri }))

  it("allows the CDNs of FastAPI in the Swagger UI and ReDoc pages", () => {
    for (const uri of ["/api", "/api/redoc"]) {
      expect(csp(uri)).toContain("https://cdn.jsdelivr.net")
      expect(csp(uri)).toContain("https://cdn.redoc.ly")
    }
  })

  it("is default-src 'none' for the other /api responses", () => {
    for (const uri of ["/api/service-info", "/api/export/x", "/api/", "/api/entries/biosample"]) {
      expect(csp(uri)).toBe("default-src 'none'; frame-ancestors 'none'")
    }
  })

  it("is the policy of the application for the pages and for a path that only starts with /api", () => {
    for (const uri of ["/", "/entries", "/entries/SAMD1", "/apidocs", "/assets/a.js"]) {
      const policy = csp(uri)
      expect(policy).toContain("default-src 'self'")
      expect(policy).toContain("'sha256-AAAA'")
      expect(policy).not.toContain("cdn.jsdelivr.net")
      expect(policy).not.toContain("unsafe-inline")
    }
  })

  it("is sent with every response", () => {
    expect(headerVariable("Content-Security-Policy")).toBe("$csp")
  })
})

describe("Strict-Transport-Security", () => {
  const hsts = (proto: string) => evaluateMap(nodes, "hsts", vars({ http_x_forwarded_proto: proto }))

  it("is max-age=31536000 only when the request came through https", () => {
    expect(hsts("https")).toBe("max-age=31536000")
    expect(hsts("http")).toBe("")
    expect(hsts("")).toBe("")
  })

  it("sets neither includeSubDomains nor preload for any value of the request header", () => {
    fc.assert(
      fc.property(fc.string(), (proto) => {
        const value = hsts(proto)
        expect(["", "max-age=31536000"]).toContain(value)
      }),
    )
  })

  it("is sent with the header name of the standard", () => {
    expect(headerVariable("Strict-Transport-Security")).toBe("$hsts")
  })
})

describe("Cache-Control", () => {
  const cache = (status: string, uri: string) => evaluateMap(nodes, "cache_control_v", vars({ status, uri }))

  it("makes a file under /assets/ cacheable for a year when the response has the file", () => {
    for (const status of ["200", "206", "304"]) {
      expect(cache(status, "/assets/index-abc.js")).toBe("public, max-age=31536000, immutable")
    }
  })

  it("does not make an error under /assets/ cacheable", () => {
    for (const status of ["404", "500", "502"]) expect(cache(status, "/assets/x.js")).toBe("no-cache")
  })

  it("does not set the header for /api, so the api decides", () => {
    for (const status of ["200", "400", "404", "429"]) expect(cache(status, "/api/entries/biosample")).toBe("")
  })

  it("makes the pages revalidate", () => {
    expect(cache("200", "/")).toBe("no-cache")
    expect(cache("200", "/entries")).toBe("no-cache")
    expect(cache("200", "/robots.txt")).toBe("no-cache")
  })

  it("is sent with every response", () => {
    expect(headerVariable("Cache-Control")).toBe("$cache_control_v")
  })
})

describe("headers of the server", () => {
  it("sets every header at the server level, since a location with its own add_header drops the headers of the server", () => {
    for (const { match, node } of locations(server(nodes))) {
      expect(directives(node, "add_header"), `location ${match}`).toEqual([])
    }
    expect(readFileSync(path.resolve(HERE, "../../../nginx/proxy.inc"), "utf8")).not.toMatch(/\badd_header\b/)
  })
})

describe("map of nginx", () => {
  const exampleMap = (): Node[] => [{
    name: "map",
    args: ["$source", "$result"],
    children: [
      { name: "exact", args: ["by-key"] },
      { name: "~^$", args: ["by-empty-regex"] },
      { name: "~^.{0,8}$", args: ["by-short-regex"] },
      { name: "default", args: ["by-default"] },
    ],
  }]

  it("does not try a regular expression for an empty source", () => {
    expect(evaluateMap(exampleMap(), "result", { source: "" })).toBe("by-default")
  })

  it("tries the regular expressions for a source that is not empty", () => {
    expect(evaluateMap(exampleMap(), "result", { source: "abc" })).toBe("by-short-regex")
  })

  it("returns the exact key before the default for an empty source", () => {
    const map = exampleMap()
    map[0]?.children?.push({ name: "", args: ["by-empty-key"] })
    expect(evaluateMap(map, "result", { source: "" })).toBe("by-empty-key")
  })
})

describe("routes of the single-page application", () => {
  const routesSource = readFileSync(path.resolve(HERE, "../../../app/routes.ts"), "utf8")
  const routePaths = [
    ...(/\bindex\(/.test(routesSource) ? ["/"] : []),
    ...[...routesSource.matchAll(/\broute\(\s*"([^"]+)"/g)].map((match) => match[1] ?? ""),
  ]
  const found = locations(server(nodes)).find((candidate) =>
    directives(candidate.node, "try_files").some((args) => args[0] === "/index.html"),
  )
  if (!found) throw new Error("no location serves index.html")
  const page = found
  const accepts = (uri: string) => {
    const [flag, pattern = ""] = page.match.split(" ")
    expect(flag).toBe("~")
    return new RegExp(pattern).test(uri)
  }

  it("reads the paths of app/routes.ts", () => {
    expect(routePaths).toContain("/")
    expect(routePaths).toContain("/entries")
    expect(routePaths).toContain("/entries/:accession")
  })

  it("serves index.html for every route of the application", () => {
    for (const route of routePaths) {
      const uri = (route ?? "").replace(/:\w+/g, "SAMD00000001")
      expect(accepts(uri), uri).toBe(true)
    }
  })

  it("answers a path that is neither a file nor a route with 404", () => {
    for (const uri of ["/foo", "/entries/a/b", "/entriesx", "/entries/a/b/"]) {
      expect(accepts(uri), uri).toBe(false)
    }
    expect(directives(page.node, "try_files")).toEqual([["/index.html", "=404"]])
  })

  it("does not serve index.html as a route", () => {
    expect(accepts("/index.html")).toBe(false)
  })
})

describe("X-Robots-Tag", () => {
  const tag = (noindex: string, uri: string) =>
    evaluateMap(withNoindex(noindex), "x_robots_tag", vars({ uri }))
  const uris = fc.oneof(
    fc.string({ unit: "binary" }).map((s) => `/${s.replace(/\n/g, "")}`),
    fc.constantFrom("/", "/api", "/api/entries/biosample", "/assets/a.js", "/api/export/entries/biosample", "/missing"),
  )

  it("is noindex for every path when the deployment must not be indexed", () => {
    fc.assert(fc.property(uris, (uri) => {
      expect(tag("true", uri)).toBe("noindex")
    }))
  })

  it("is noindex for every export path and empty for any other path when the deployment may be indexed", () => {
    fc.assert(fc.property(fc.constantFrom("false", ""), uris, (noindex, uri) => {
      expect(tag(noindex, uri)).toBe(uri.startsWith("/api/export/") ? "noindex" : "")
    }))
  })

  it("is noindex for an export of any format, such as an error response of an export", () => {
    for (const uri of ["/api/export/entries/biosample", "/api/export/accessions", "/api/export/"]) {
      expect(tag("false", uri)).toBe("noindex")
    }
    expect(tag("false", "/api/entries/biosample")).toBe("")
    expect(tag("false", "/api/exports")).toBe("")
  })

  it("is sent with every response", () => {
    expect(headerVariable("X-Robots-Tag")).toBe("$x_robots_tag")
  })
})

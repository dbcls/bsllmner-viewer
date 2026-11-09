import { fc, test } from "@fast-check/vitest"
import { describe, expect, it } from "vitest"

import { archivePath, CRATE_CONTENTS, CRATE_PARTS, crateFilePath, crateOfModel, CRATES, datasetsPath, downloadCommands, partPath } from "~/lib/crate"

const MODELS = new Set(CRATES.map((crate) => crate.model))
const ORIGIN = "https://viewer.example.org"

describe("CRATES", () => {
  it("names each RO-Crate by its own fragment, release, and model", () => {
    for (const key of ["id", "release", "model"] as const) {
      expect(new Set(CRATES.map((crate) => crate[key])).size, key).toBe(CRATES.length)
    }
  })

  it("has fragments that an address keeps as they are", () => {
    for (const crate of CRATES) {
      expect(encodeURIComponent(crate.id)).toBe(crate.id)
      expect(new URL(datasetsPath(crate), ORIGIN).hash).toBe(`#${crate.id}`)
    }
  })

  it("names each release after the date on which the RO-Crate was published, so that another RO-Crate has another name", () => {
    for (const crate of CRATES) expect(crate.release.endsWith(`-${crate.datePublished}`), crate.release).toBe(true)
  })

  it("has a release that is one component of a path", () => {
    for (const crate of CRATES) expect(crate.release).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  })

  it("has an archive smaller than the RO-Crate, and an archive of each directory smaller than the whole archive", () => {
    for (const crate of CRATES) {
      expect(crate.archiveBytes, crate.release).toBeGreaterThan(0)
      expect(crate.archiveBytes, crate.release).toBeLessThan(crate.bytes)
      for (const part of CRATE_PARTS) {
        expect(crate.partBytes[part], part).toBeGreaterThan(0)
        expect(crate.partBytes[part], part).toBeLessThan(crate.archiveBytes)
      }
    }
  })
})

describe("CRATE_PARTS", () => {
  it("are the directories of the contents of an RO-Crate", () => {
    const directories = CRATE_CONTENTS.map(({ path }) => path).filter((path) => path.endsWith("/")).map((path) => path.slice(0, -1))
    expect([...CRATE_PARTS]).toEqual(directories)
  })
})

describe("crateOfModel", () => {
  it("finds every RO-Crate by its model", () => {
    for (const crate of CRATES) expect(crateOfModel(crate.model)).toBe(crate)
  })

  test.prop({ model: fc.string().filter((model) => !MODELS.has(model)) })("finds no RO-Crate for a model that no RO-Crate has", ({ model }) => {
    expect(crateOfModel(model)).toBeUndefined()
    expect(datasetsPath(crateOfModel(model))).toBe("/datasets")
  })

  it("does not match a model by its case or by a part of it", () => {
    for (const crate of CRATES) {
      for (const model of [crate.model.toUpperCase(), crate.model.split(":")[0] ?? "", ` ${crate.model}`]) {
        expect(crateOfModel(model), model).toBeUndefined()
      }
    }
  })
})

describe("downloadCommands", () => {
  it("downloads the archive from the given host, unpacks it, and checks the files in the directory that the archive makes", () => {
    for (const crate of CRATES) {
      const [download, unpack, check] = downloadCommands(crate, ORIGIN).split("\n")
      expect(download).toBe(`curl -f -C - -O ${ORIGIN}${archivePath(crate)}`)
      expect(unpack).toBe(`tar xzf ${crate.release}.tar.gz`)
      expect(check).toBe(`cd ${crate.release} && sha256sum -c provenance/checksums.sha256`)
    }
  })
})

describe("the paths of the files of an RO-Crate", () => {
  it("are under /datasets/, in the directory of the release, next to the archive of the whole RO-Crate", () => {
    for (const crate of CRATES) {
      expect(archivePath(crate)).toBe(`/datasets/${crate.release}.tar.gz`)
      for (const part of CRATE_PARTS) expect(partPath(crate, part)).toBe(`/datasets/${crate.release}/${part}.tar.gz`)
      expect(crateFilePath(crate, "README.md")).toBe(`/datasets/${crate.release}/README.md`)
    }
  })
})

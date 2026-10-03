/** Client-side downloads: TSV tables, SVG markup, and PNG renderings of SVG elements. */

/** Text for the content or an attribute value of an SVG element. */
export const escapeXml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")

const download = (name: string, content: Blob): void => {
  const url = URL.createObjectURL(content)
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

const tsvCell = (value: string | number | null | undefined): string =>
  value === null || value === undefined ? "" : String(value).replaceAll("\t", " ").replaceAll("\n", " ")

export const downloadTsv = (name: string, header: string[], rows: (string | number | null | undefined)[][]): void => {
  const lines = [header, ...rows].map((row) => row.map(tsvCell).join("\t"))
  download(name, new Blob([`${lines.join("\n")}\n`], { type: "text/tab-separated-values" }))
}

const serializeSvg = (svg: SVGSVGElement): string => {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  const width = svg.viewBox.baseVal.width || svg.clientWidth
  const height = svg.viewBox.baseVal.height || svg.clientHeight
  clone.setAttribute("width", String(width))
  clone.setAttribute("height", String(height))
  return new XMLSerializer().serializeToString(clone)
}

export const downloadSvg = (name: string, svg: SVGSVGElement): void => {
  downloadSvgMarkup(name, serializeSvg(svg))
}

export const downloadSvgMarkup = (name: string, markup: string): void => {
  download(name, new Blob([markup], { type: "image/svg+xml" }))
}

export const downloadPng = (name: string, svg: SVGSVGElement, scale = 2): Promise<void> =>
  downloadPngMarkup(
    name,
    serializeSvg(svg),
    svg.viewBox.baseVal.width || svg.clientWidth,
    svg.viewBox.baseVal.height || svg.clientHeight,
    scale,
  )

export const downloadPngMarkup = (name: string, markup: string, width: number, height: number, scale = 2): Promise<void> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement("canvas")
      canvas.width = width * scale
      canvas.height = height * scale
      const context = canvas.getContext("2d")
      if (!context) {
        reject(new Error("canvas is not available"))
        return
      }
      context.fillStyle = "white"
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.scale(scale, scale)
      context.drawImage(image, 0, 0)
      canvas.toBlob((blob) => {
        if (blob) download(name, blob)
        resolve()
      }, "image/png")
    }
    image.onerror = () => reject(new Error("could not render the SVG"))
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  })

export const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

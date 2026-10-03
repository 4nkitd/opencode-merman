import { DiagramCanvas } from "../core/canvas.js"
import { diagramTextGraphemes, diagramTextWidth } from "../core/text.js"
import { MermaidSyntaxError } from "../diagnostics.js"
import { finish, type ExtraDiagram, type ExtraOptions } from "./shared.js"

type Kind = "xychart" | "pie" | "quadrant" | "sankey"
type SourceLine = { text: string; raw: string; number: number }
type Context = { kind: Kind; header: SourceLine; lines: SourceLine[] }
type Run = { text: string; style?: string }
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
const MARKERS = "123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

function fail(ctx: Context, line: SourceLine, reason: string): never {
  throw new MermaidSyntaxError(ctx.kind, line.number, line.raw.trim(), reason)
}

function stripComment(text: string): string {
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\" && quoted) { i++; continue }
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') { i++; continue }
      quoted = !quoted
    }
    if (!quoted && text.slice(i, i + 2) === "%%") return text.slice(0, i).trim()
  }
  return text.trim()
}

function number(ctx: Context, line: SourceLine, text: string): number {
  const value = Number(text)
  if (!NUMBER.test(text) || !Number.isFinite(value) || Math.abs(value) > 1e100 ||
      (value !== 0 && Math.abs(value) < 1e-100) || (value === 0 && /[1-9]/.test(text.split(/e/i)[0]))) {
    fail(ctx, line, "Expected a finite number between -1e100 and 1e100, with nonzero magnitude at least 1e-100")
  }
  if (decimalKey(text) !== decimalKey(String(value))) fail(ctx, line, "Number loses precision; use fewer significant digits")
  return value
}

function decimalKey(text: string): string {
  const [mantissa, exponent = "0"] = text.toLowerCase().split("e")
  const digits = mantissa.replace(/[+.\-]/g, "")
  const significant = digits.replace(/^0+|0+$/g, "")
  if (!significant) return "0"
  const power = Number(exponent) - (mantissa.split(".")[1]?.length ?? 0) + (digits.match(/0+$/)?.[0].length ?? 0)
  return `${mantissa.startsWith("-") ? "-" : ""}${significant}e${power}`
}

function label(ctx: Context, line: SourceLine, text: string): string {
  const value = text.trim()
  let result = value
  if (value.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\["\\]|"")*"$/.test(value)) fail(ctx, line, "Malformed quoted label")
    result = value.slice(1, -1).replace(/""/g, '"').replace(/\\(["\\])/g, "$1")
  } else if (value.includes('"')) fail(ctx, line, "Malformed quoted label")
  if (!result.trim() || result.length > 256 || /[\x00-\x1f\x7f-\x9f]/.test(result)) {
    fail(ctx, line, "Labels must contain 1–256 printable characters")
  }
  return result
}

function split(ctx: Context, line: SourceLine, text: string, delimiter: string): string[] {
  const parts: string[] = []
  let start = 0
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\" && quoted) { i++; continue }
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') { i++; continue }
      quoted = !quoted
    }
    if (!quoted && text.startsWith(delimiter, i)) {
      parts.push(text.slice(start, i).trim())
      i += delimiter.length - 1
      start = i + 1
    }
  }
  if (quoted) fail(ctx, line, "Unclosed quoted label")
  parts.push(text.slice(start).trim())
  return parts
}

function list(ctx: Context, line: SourceLine, text: string): string[] {
  if (!text.startsWith("[") || !text.endsWith("]")) fail(ctx, line, "Expected a bracketed list")
  const values = split(ctx, line, text.slice(1, -1), ",")
  if (!values.length || values.length > 256 || values.some((value) => !value)) {
    fail(ctx, line, "Lists must contain 1–256 nonempty entries")
  }
  return values
}

class Page {
  readonly width: number
  private rows: Run[][] = []

  constructor(private ctx: Context, private options: ExtraOptions) {
    if (!Number.isFinite(options.width) || options.width < 1) fail(ctx, ctx.header, "Width must be a positive finite number")
    this.width = Math.min(240, Math.floor(options.width))
  }

  text(text: string, style = "text"): void {
    const rows: Run[][] = []
    let current = ""
    let width = 0
    for (const char of diagramTextGraphemes(text)) {
      const size = Math.max(1, diagramTextWidth(char))
      if (size > this.width) fail(this.ctx, this.ctx.header, "Width is too narrow for a label grapheme")
      if (width + size > this.width) {
        rows.push([{ text: current, style }])
        current = ""
        width = 0
      }
      current += char
      width += size
    }
    rows.push([{ text: current, style }])
    this.append(rows)
  }

  plot(grid: DiagramCanvas<string>): void {
    const rows: Run[][] = [[]]
    grid.forEachRun((run) => rows[rows.length - 1].push({ text: run.text, style: run.style }), () => rows.push([]))
    this.append(rows)
  }

  private append(rows: Run[][]): void {
    if ((this.rows.length + rows.length) * this.width > 240_000 || this.rows.length + rows.length > 12_000) {
      fail(this.ctx, this.ctx.header, "Chart exceeds the terminal output size limit")
    }
    this.rows.push(...rows)
  }

  finish(): ExtraDiagram {
    const grid = new DiagramCanvas<string>(this.width, this.rows.length)
    this.rows.forEach((runs, y) => {
      let x = 0
      for (const run of runs) {
        grid.setText(x, y, run.text, run.style)
        x += diagramTextWidth(run.text)
      }
    })
    return finish(grid, this.options)
  }
}

function segment(grid: DiagramCanvas<string>, x0: number, y0: number, x1: number, y1: number, char: string, style: string): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps
    grid.setCell(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), char, style)
  }
}

type Axis = { title?: string; categories?: string[]; range?: [number, number]; line: SourceLine }

function axis(ctx: Context, line: SourceLine, text: string, categorical: boolean): Axis {
  let body = text.trim()
  let title: string | undefined
  const quoted = /^"(?:[^"\\]|\\["\\]|"")*"/.exec(body)
  if (quoted) {
    title = label(ctx, line, quoted[0])
    body = body.slice(quoted[0].length).trim()
  }
  if (categorical && body.startsWith("[")) {
    return { title, categories: list(ctx, line, body).map((value) => label(ctx, line, value)), line }
  }
  if (!categorical && body.startsWith("[")) fail(ctx, line, "The y-axis must be numeric")
  if (body.includes("-->")) {
    const values = split(ctx, line, body, "-->")
    if (values.length !== 2) fail(ctx, line, "Expected one increasing axis range")
    const low = number(ctx, line, values[0])
    const high = number(ctx, line, values[1])
    if (low >= high) fail(ctx, line, "Axis minimum must be less than its maximum")
    return { title, range: [low, high], line }
  }
  if (!title && body) return { title: label(ctx, line, body), line }
  if (title && !body) return { title, line }
  fail(ctx, line, "Expected an axis label, category list, or numeric range")
}

function xy(ctx: Context, options: ExtraOptions): ExtraDiagram {
  if (!/^xychart(?:-beta)?$/.test(ctx.header.text)) {
    fail(ctx, ctx.header, /\bhorizontal\b/.test(ctx.header.text) ? "Horizontal XY charts are not supported" : "Unsupported XY chart header")
  }
  let title: string | undefined
  let xAxis: Axis | undefined
  let yAxis: Axis | undefined
  const series: { type: "line" | "bar"; values: number[]; line: SourceLine }[] = []
  for (const line of ctx.lines) {
    const match = /^(title|x-axis|y-axis|line|bar)\s+(.+)$/.exec(line.text)
    if (!match) fail(ctx, line, "Unsupported XY chart statement")
    const [, keyword, body] = match
    if (keyword === "title") {
      if (title !== undefined) fail(ctx, line, "Duplicate title")
      title = label(ctx, line, body)
    } else if (keyword === "x-axis" || keyword === "y-axis") {
      if (keyword === "x-axis") {
        if (xAxis) fail(ctx, line, "Duplicate x-axis")
        xAxis = axis(ctx, line, body, true)
      } else {
        if (yAxis) fail(ctx, line, "Duplicate y-axis")
        yAxis = axis(ctx, line, body, false)
      }
    } else {
      if (series.length >= 16) fail(ctx, line, "At most 16 series are supported")
      series.push({ type: keyword as "line" | "bar", values: list(ctx, line, body).map((value) => number(ctx, line, value)), line })
    }
  }
  if (!series.length) fail(ctx, ctx.header, "An XY chart requires at least one series")
  const count = series[0].values.length
  for (const item of series) {
    if (item.values.length !== count) fail(ctx, item.line, "All series must contain the same number of values")
  }
  if (xAxis?.categories && xAxis.categories.length !== count) fail(ctx, xAxis.line, "Category count must match the series length")
  const all = series.flatMap((item) => item.values)
  let low = yAxis?.range?.[0] ?? Math.min(0, ...all)
  let high = yAxis?.range?.[1] ?? Math.max(0, ...all)
  if (low === high) { low -= 1; high += 1 }
  for (const item of series) {
    if (item.values.some((value) => value < low || value > high)) fail(ctx, item.line, "Series value is outside the declared y-axis range")
  }
  const page = new Page(ctx, options)
  if (title) page.text(title, "primary")
  page.text(`${yAxis?.title ?? "y"}: ${low} → ${high}`, "secondary")
  const categories = xAxis?.categories ?? Array.from({ length: count }, (_, i) => {
    if (!xAxis?.range) return String(i + 1)
    return String(xAxis.range[0] + (xAxis.range[1] - xAxis.range[0]) * (count === 1 ? 0 : i / (count - 1)))
  })
  if (page.width >= 18) {
    const grid = new DiagramCanvas<string>(page.width, 15)
    const left = Math.min(10, Math.max(String(low).length, String(high).length) + 1)
    const right = page.width - 1
    const bottom = 12
    const bars = series.filter((item) => item.type === "bar")
    const py = (value: number) => Math.round((high - value) / (high - low) * bottom)
    const px = (i: number) => Math.round(left + 1 + (right - left - 2) * (bars.length ? (i + 0.5) / count : count === 1 ? (xAxis?.range ? 0 : 0.5) : i / (count - 1)))
    segment(grid, left, 0, left, bottom, "│", "line")
    const baseline = py(Math.max(low, Math.min(high, 0)))
    segment(grid, left, baseline, right, baseline, "─", "line")
    grid.setCell(left, baseline, "┼", "line")
    for (const [value, y] of [[high, 0], [low, bottom]]) {
      const text = String(value)
      if (text.length < left) grid.setText(left - text.length - 1, y, text, "secondary")
    }
    const barWidth = Math.max(1, Math.floor((Math.floor((right - left - 2) / count) - 1) / Math.max(1, bars.length)))
    let barIndex = 0
    series.forEach((item, index) => {
      if (item.type !== "bar") return
      item.values.forEach((value, i) => {
        if (value === 0) return
        const offset = barIndex * barWidth - Math.floor(bars.length * barWidth / 2)
        for (let dx = 0; dx < barWidth; dx++) {
          const x = Math.max(left + 1, Math.min(right, px(i) + offset + dx))
          segment(grid, x, baseline, x, py(value), "█", `series${index}`)
        }
      })
      barIndex++
    })
    series.forEach((item, index) => {
      if (item.type !== "line") return
      item.values.forEach((value, i) => {
        if (i) segment(grid, px(i - 1), py(item.values[i - 1]), px(i), py(value), "•", `series${index}`)
      })
      item.values.forEach((value, i) => grid.setCell(px(i), py(value), "●", `series${index}`))
    })
    let end = left
    categories.forEach((_, i) => {
      const text = String(i + 1)
      const x = Math.min(right - text.length + 1, px(i))
      if (x > end) { grid.setText(x, 14, text, "secondary"); end = x + text.length }
    })
    page.plot(grid)
  } else page.text("XY values", "secondary")
  page.text(`${xAxis?.title ?? "x"}${xAxis?.range ? ` (${xAxis.range[0]} → ${xAxis.range[1]})` : ""}:`, "secondary")
  categories.forEach((value, i) => page.text(`${i + 1}: ${value}`, "secondary"))
  series.forEach((item, index) => page.text(`${item.type} ${index + 1}: [${item.values.join(", ")}]`, `series${index}`))
  return page.finish()
}

function pie(ctx: Context, options: ExtraOptions): ExtraDiagram {
  const header = /^pie(?:\s+(showData))?(?:\s+title\s+(.+))?$/.exec(ctx.header.text)
  if (!header) fail(ctx, ctx.header, "Unsupported pie chart header")
  let title = header[2] ? label(ctx, ctx.header, header[2]) : undefined
  const slices: { label: string; value: number }[] = []
  for (const line of ctx.lines) {
    if (line.text.startsWith("title ")) {
      if (title !== undefined) fail(ctx, line, "Duplicate title")
      title = label(ctx, line, line.text.slice(6))
      continue
    }
    const parts = split(ctx, line, line.text, ":")
    if (parts.length !== 2 || !parts[0].startsWith('"')) fail(ctx, line, "Expected a quoted slice label and a value")
    const name = label(ctx, line, parts[0])
    const value = number(ctx, line, parts[1])
    if (value < 0) fail(ctx, line, "Pie values must be nonnegative")
    if (slices.some((slice) => slice.label === name)) fail(ctx, line, "Duplicate pie label")
    if (slices.length >= MARKERS.length) fail(ctx, line, `At most ${MARKERS.length} pie slices are supported`)
    slices.push({ label: name, value })
  }
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  if (!slices.length || total <= 0) fail(ctx, ctx.header, "A pie chart requires a positive total")
  const page = new Page(ctx, options)
  if (title) page.text(title, "primary")
  if (page.width >= 12) {
    const width = Math.min(page.width, 36)
    const height = Math.max(5, Math.round(width / 2.2))
    const grid = new DiagramCanvas<string>(page.width, height)
    const boundaries: number[] = []
    slices.reduce((sum, slice) => { boundaries.push(sum + slice.value / total); return sum + slice.value / total }, 0)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = (x + 0.5 - width / 2) / (width / 2)
        const dy = (y + 0.5 - height / 2) / (height / 2)
        if (dx * dx + dy * dy > 1) continue
        const fraction = ((Math.atan2(dy, dx) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)
        const index = Math.max(0, boundaries.findIndex((end) => fraction < end))
        grid.setCell(x, y, MARKERS[index], `series${index}`)
      }
    }
    page.plot(grid)
  }
  page.text(`Total: ${total}`, "secondary")
  slices.forEach((slice, index) => {
    page.text(`${MARKERS[index]} ${slice.label}: ${slice.value} (${Number((slice.value / total * 100).toPrecision(4))}%)`, `series${index}`)
    if (page.width < 12 && slice.value > 0) page.text("█".repeat(Math.max(1, Math.round(slice.value / total * page.width))), `series${index}`)
  })
  return page.finish()
}

function quadrant(ctx: Context, options: ExtraOptions): ExtraDiagram {
  if (ctx.header.text !== "quadrantChart") fail(ctx, ctx.header, "Unsupported quadrant chart header")
  let title: string | undefined
  let xAxis: [string, string] | undefined
  let yAxis: [string, string] | undefined
  const quadrants = new Map<number, string>()
  const points: { label: string; x: number; y: number }[] = []
  for (const line of ctx.lines) {
    const statement = /^(title|x-axis|y-axis|quadrant-[1-4])\s+(.+)$/.exec(line.text)
    if (statement) {
      const [, keyword, body] = statement
      if (keyword === "title") {
        if (title !== undefined) fail(ctx, line, "Duplicate title")
        title = label(ctx, line, body)
      } else if (keyword.endsWith("-axis")) {
        const parts = split(ctx, line, body, "-->")
        if (parts.length !== 2) fail(ctx, line, "Expected low --> high axis labels")
        const names = parts.map((part) => label(ctx, line, part)) as [string, string]
        if (keyword === "x-axis") {
          if (xAxis) fail(ctx, line, "Duplicate x-axis")
          xAxis = names
        } else {
          if (yAxis) fail(ctx, line, "Duplicate y-axis")
          yAxis = names
        }
      } else {
        const id = Number(keyword.slice(-1))
        if (quadrants.has(id)) fail(ctx, line, "Duplicate quadrant label")
        quadrants.set(id, label(ctx, line, body))
      }
      continue
    }
    const parts = split(ctx, line, line.text, ":")
    if (parts.length !== 2) fail(ctx, line, "Expected a point label: [x, y]")
    const name = label(ctx, line, parts[0])
    const values = list(ctx, line, parts[1]).map((value) => number(ctx, line, value))
    if (values.length !== 2 || values.some((value) => value < 0 || value > 1)) fail(ctx, line, "Point coordinates must be two numbers in [0, 1]")
    if (points.length >= MARKERS.length) fail(ctx, line, `At most ${MARKERS.length} quadrant points are supported`)
    points.push({ label: name, x: values[0], y: values[1] })
  }
  const page = new Page(ctx, options)
  if (title) page.text(title, "primary")
  if (yAxis) page.text(`y: ${yAxis[0]} → ${yAxis[1]}`, "secondary")
  if (page.width >= 9) {
    const grid = new DiagramCanvas<string>(page.width, 17)
    const right = page.width - 1
    const center = Math.floor(right / 2)
    for (const x of [0, center, right]) segment(grid, x, 0, x, 16, "│", "line")
    for (const y of [0, 8, 16]) segment(grid, 0, y, right, y, "─", "line")
    for (const [x, y, text] of [[1, 1, "Q2"], [center + 1, 1, "Q1"], [1, 9, "Q3"], [center + 1, 9, "Q4"]] as const) grid.setText(x, y, text, "secondary")
    const occupied = new Set<string>()
    points.forEach((point, index) => {
      const x = Math.round(1 + point.x * (right - 2))
      const y = Math.round(15 - point.y * 14)
      const key = `${x},${y}`
      grid.setCell(x, y, occupied.has(key) ? "◆" : MARKERS[index], `series${index}`)
      occupied.add(key)
    })
    page.plot(grid)
    page.text("◆ = overlapping points", "secondary")
  } else page.text("Quadrants: Q2 Q1 / Q3 Q4", "secondary")
  if (xAxis) page.text(`x: ${xAxis[0]} → ${xAxis[1]}`, "secondary")
  for (const id of [1, 2, 3, 4]) if (quadrants.has(id)) page.text(`Q${id}: ${quadrants.get(id)}`, "secondary")
  points.forEach((point, index) => {
    const id = point.y >= 0.5 ? (point.x >= 0.5 ? 1 : 2) : (point.x >= 0.5 ? 4 : 3)
    page.text(`${MARKERS[index]} ${point.label}: [${point.x}, ${point.y}] Q${id}`, `series${index}`)
  })
  return page.finish()
}

function sankey(ctx: Context, options: ExtraOptions): ExtraDiagram {
  if (ctx.header.text !== "sankey-beta") fail(ctx, ctx.header, "Unsupported Sankey chart header")
  const nodes: string[] = []
  const edges: { from: number; to: number; value: number; line: SourceLine }[] = []
  const node = (name: string, line: SourceLine) => {
    const existing = nodes.indexOf(name)
    if (existing >= 0) return existing
    if (nodes.length >= 64) fail(ctx, line, "At most 64 Sankey nodes are supported")
    nodes.push(name)
    return nodes.length - 1
  }
  for (const line of ctx.lines) {
    const parts = split(ctx, line, line.text, ",")
    if (parts.length !== 3) fail(ctx, line, "Expected source,target,value CSV with exactly three fields")
    const from = node(label(ctx, line, parts[0]), line)
    const to = node(label(ctx, line, parts[1]), line)
    const value = number(ctx, line, parts[2].startsWith('"') ? label(ctx, line, parts[2]) : parts[2])
    if (value <= 0) fail(ctx, line, "Sankey flow values must be positive")
    if (from === to) fail(ctx, line, "Sankey self-loops are not supported")
    if (edges.length >= 256) fail(ctx, line, "At most 256 Sankey flows are supported")
    edges.push({ from, to, value, line })
  }
  if (!edges.length) fail(ctx, ctx.header, "A Sankey chart requires at least one flow")
  const degree = nodes.map((_, index) => edges.filter((edge) => edge.to === index).length)
  const queue = nodes.map((_, index) => index).filter((index) => degree[index] === 0)
  const depth = nodes.map(() => 0)
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor]
    for (const edge of edges.filter((edge) => edge.from === current)) {
      depth[edge.to] = Math.max(depth[edge.to], depth[current] + 1)
      if (--degree[edge.to] === 0) queue.push(edge.to)
    }
  }
  if (queue.length !== nodes.length) fail(ctx, edges.find((edge) => degree[edge.from] && degree[edge.to])!.line, "Cyclic Sankey flows are not supported")
  const page = new Page(ctx, options)
  const layers = Math.max(...depth) + 1
  if (page.width >= layers * 8) {
    const positions: { x: number; y: number }[] = []
    const layerCounts = Array.from({ length: layers }, () => 0)
    nodes.forEach((_, i) => { positions[i] = { x: Math.round(depth[i] * (page.width - 5) / (layers - 1)), y: layerCounts[depth[i]]++ * 3 + 1 } })
    const grid = new DiagramCanvas<string>(page.width, Math.max(...layerCounts) * 3)
    edges.forEach((edge, i) => {
      const a = positions[edge.from]
      const b = positions[edge.to]
      const start = a.x + String(edge.from + 1).length + 2
      const middle = Math.floor((start + b.x) / 2)
      segment(grid, start, a.y, middle, a.y, "─", `series${i}`)
      segment(grid, middle, a.y, middle, b.y, "│", `series${i}`)
      segment(grid, middle, b.y, b.x - 1, b.y, "─", `series${i}`)
      grid.setCell(b.x - 1, b.y, "▶", `series${i}`)
    })
    nodes.forEach((_, i) => grid.setText(positions[i].x, positions[i].y, `[${i + 1}]`, "primary"))
    page.plot(grid)
  }
  nodes.forEach((name, index) => page.text(`[${index + 1}] ${name}`, "primary"))
  page.text("Flows (shared scale):", "secondary")
  const max = Math.max(...edges.map((edge) => edge.value))
  edges.forEach((edge, index) => {
    page.text(`[${edge.from + 1}] ${nodes[edge.from]} → [${edge.to + 1}] ${nodes[edge.to]}: ${edge.value}`, `series${index}`)
    const width = Math.max(1, Math.round(edge.value / max * Math.min(40, Math.max(1, page.width - 1))))
    page.text(`${"━".repeat(width)}${page.width > 1 ? "▶" : ""}`, `series${index}`)
  })
  return page.finish()
}

export function renderCharts(source: string, options: ExtraOptions): ExtraDiagram | undefined {
  const raw = source.split(/\r?\n/)
  const headerIndex = raw.findIndex((line) => line.trim() && !line.trim().startsWith("%%"))
  if (headerIndex < 0) return undefined
  const text = stripComment(raw[headerIndex])
  const match = /^(xychart(?:-beta)?|pie|quadrantChart|sankey-beta)\b/.exec(text)
  if (!match) return undefined
  const kind: Kind = match[1].startsWith("xychart") ? "xychart" : match[1] === "quadrantChart" ? "quadrant" : match[1] === "sankey-beta" ? "sankey" : "pie"
  const header = { text, raw: raw[headerIndex], number: headerIndex + 1 }
  const ctx: Context = { kind, header, lines: [] }
  if (source.length > 100_000 || raw.length > 1_024) fail(ctx, header, "Chart source exceeds 100,000 characters or 1,024 lines")
  const directive = raw.findIndex((line) => line.trim().startsWith("%%{"))
  if (directive >= 0) fail(ctx, { text: raw[directive], raw: raw[directive], number: directive + 1 }, "Inline configuration directives are not supported by the chart parser")
  for (let i = headerIndex + 1; i < raw.length; i++) {
    const line = { text: stripComment(raw[i]), raw: raw[i], number: i + 1 }
    if (raw[i].length > 8_192) fail(ctx, line, "Chart statement exceeds 8,192 characters")
    if (line.text) ctx.lines.push(line)
  }
  if (kind === "xychart") return xy(ctx, options)
  if (kind === "pie") return pie(ctx, options)
  if (kind === "quadrant") return quadrant(ctx, options)
  return sankey(ctx, options)
}

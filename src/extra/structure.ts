import { DiagramCanvas } from "../core/canvas.js"
import { diagramTextGraphemes, diagramTextWidth } from "../core/text.js"
import { MermaidSyntaxError } from "../diagnostics.js"
import { finish, type ExtraDiagram, type ExtraOptions } from "./shared.js"

type Kind = "block" | "packet" | "architecture"
type Line = { text: string; number: number }
type Context = { kind: Kind; header: Line; lines: Line[]; width: number }
type Port = "L" | "R" | "T" | "B"
type Node = { id: string; label: string; span: number; line: Line; rounded?: boolean }
type Edge = { from: string; to: string; start?: Port; end?: Port; head: boolean; tail: boolean; label?: string; line: Line }
type Box = { node: Node; x: number; y: number; width: number; height: number; lines: string[] }
type Point = { x: number; y: number }
const vectors: Record<Port, Point> = { L: { x: -1, y: 0 }, R: { x: 1, y: 0 }, T: { x: 0, y: -1 }, B: { x: 0, y: 1 } }
const opposite: Record<Port, Port> = { L: "R", R: "L", T: "B", B: "T" }
const arrows: Record<Port, string> = { L: "▶", R: "◀", T: "▼", B: "▲" }
const identifier = "[A-Za-z_][\\w-]*"

function fail(context: Context, line: Line, reason: string): never {
  throw new MermaidSyntaxError(context.kind, line.number, line.text, reason)
}

function stripComment(text: string): string {
  let quote = false
  let depth = 0
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === "\\" && quote) { index++; continue }
    if (char === '"') quote = !quote
    if (!quote && (char === "[" || char === "(")) depth++
    if (!quote && (char === "]" || char === ")")) depth--
    if (!quote && depth === 0 && text.slice(index, index + 2) === "%%") return text.slice(0, index).trim()
  }
  return text.trim()
}

function label(context: Context, line: Line, raw: string): string {
  const value = raw.trim()
  if (!value.startsWith('"')) {
    if (value.includes('"')) fail(context, line, "Unmatched label quote")
    return value
  }
  try {
    const decoded: unknown = JSON.parse(value)
    if (typeof decoded !== "string") fail(context, line, "Expected a quoted label")
    return decoded as string
  } catch { return fail(context, line, "Invalid quoted label") }
}

function wrap(context: Context, line: Line, text: string, width: number): string[] {
  const result: string[] = []
  for (const paragraph of text.replace(/<br\s*\/?\s*>/gi, "\n").split("\n")) {
    let current = ""
    let size = 0
    for (const char of diagramTextGraphemes(paragraph)) {
      if (/[\x00-\x1f\x7f]/.test(char)) fail(context, line, "Control characters are not supported in labels")
      const next = Math.max(1, diagramTextWidth(char))
      if (next > width) fail(context, line, "Terminal is too narrow for this label")
      if (size + next > width) { result.push(current); current = ""; size = 0 }
      current += char
      size += next
    }
    result.push(current)
  }
  return result
}

function labelWidth(text: string): number {
  return Math.max(0, ...text.replace(/<br\s*\/?\s*>/gi, "\n").split("\n").map(diagramTextWidth))
}

function canvas(context: Context, width: number, height: number): DiagramCanvas<string> {
  if (width > context.width || height > 8_000 || width * height > 200_000) {
    fail(context, context.header, "Diagram exceeds terminal width or rendering resource limits")
  }
  return new DiagramCanvas<string>(width, height)
}

function drawBox(grid: DiagramCanvas<string>, box: Box, style: string): void {
  const { x, y, width, height } = box
  const corners = box.node.rounded ? ["╭", "╮", "╰", "╯"] : ["┌", "┐", "└", "┘"]
  grid.setText(x, y, corners[0]! + "─".repeat(width - 2) + corners[1]!, style)
  grid.setText(x, y + height - 1, corners[2]! + "─".repeat(width - 2) + corners[3]!, style)
  for (let row = 1; row < height - 1; row++) {
    grid.setCell(x, y + row, "│", style)
    grid.setCell(x + width - 1, y + row, "│", style)
  }
  box.lines.forEach((text, index) => grid.setText(x + 1 + Math.floor((width - 2 - diagramTextWidth(text)) / 2), y + 1 + index, text, "boxText"))
}

function validateGraph(context: Context, nodes: Node[], edges: Edge[]): void {
  if (nodes.length > 128 || edges.length > 256) fail(context, context.header, "At most 128 nodes and 256 connections are supported")
  const byId = new Map<string, Node>()
  for (const node of nodes) {
    if (byId.has(node.id)) fail(context, node.line, `Duplicate node ${node.id}`)
    byId.set(node.id, node)
  }
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) fail(context, edge.line, "Connection references an undeclared node")
    if (edge.from === edge.to && edge.start && edge.start === edge.end) fail(context, edge.line, "Self-connections require distinct ports")
  }
}

function portPoint(box: Box, port: Port): Point {
  if (port === "L" || port === "R") return { x: port === "L" ? box.x - 1 : box.x + box.width, y: box.y + Math.floor(box.height / 2) }
  return { x: box.x + Math.floor(box.width / 2), y: port === "T" ? box.y - 1 : box.y + box.height }
}

function route(context: Context, grid: DiagramCanvas<string>, boxes: Box[], edges: Edge[]): void {
  const blocked = new Uint8Array(grid.width * grid.height)
  const byId = new Map(boxes.map((box) => [box.node.id, box]))
  for (const box of boxes) {
    for (let y = box.y; y < box.y + box.height; y++) {
      for (let x = box.x; x < box.x + box.width; x++) blocked[y * grid.width + x] = 1
    }
  }
  const masks = new Map<number, number>()
  const heads: { point: Point; port: Port }[] = []
  const add = (point: Point, bit: number) => {
    const key = point.y * grid.width + point.x
    masks.set(key, (masks.get(key) ?? 0) | bit)
  }
  for (const edge of edges) {
    const from = byId.get(edge.from)!
    const to = byId.get(edge.to)!
    const horizontal = from.y === to.y
    const startPort = edge.start ?? (horizontal ? (from.x < to.x ? "R" : "L") : (from.y < to.y ? "B" : "T"))
    const endPort = edge.end ?? opposite[startPort]
    const start = portPoint(from, startPort)
    const end = portPoint(to, endPort)
    const startKey = start.y * grid.width + start.x
    const endKey = end.y * grid.width + end.x
    const previous = new Int32Array(blocked.length).fill(-1)
    const queue = new Int32Array(blocked.length)
    let read = 0
    let written = 1
    queue[0] = startKey
    previous[startKey] = startKey
    const order = [startPort, ...(["R", "B", "L", "T"] as Port[]).filter((port) => port !== startPort)]
    while (read < written && previous[endKey] === -1) {
      const key = queue[read++]!
      const x = key % grid.width
      const y = Math.floor(key / grid.width)
      for (const port of order) {
        const nextX = x + vectors[port].x
        const nextY = y + vectors[port].y
        if (nextX < 0 || nextY < 0 || nextX >= grid.width || nextY >= grid.height) continue
        const next = nextY * grid.width + nextX
        if (blocked[next] || previous[next] !== -1) continue
        previous[next] = key
        queue[written++] = next
      }
    }
    if (previous[endKey] === -1) fail(context, edge.line, "Cannot route connection at this terminal width")
    const points: Point[] = []
    let cursor = endKey
    while (true) {
      points.push({ x: cursor % grid.width, y: Math.floor(cursor / grid.width) })
      if (cursor === startKey) break
      cursor = previous[cursor]!
    }
    points.reverse()
    add(start, startPort === "L" ? 2 : startPort === "R" ? 8 : startPort === "T" ? 4 : 1)
    add(end, endPort === "L" ? 2 : endPort === "R" ? 8 : endPort === "T" ? 4 : 1)
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1]!
      const b = points[index]!
      const bit = b.x > a.x ? 2 : b.x < a.x ? 8 : b.y > a.y ? 4 : 1
      add(a, bit)
      add(b, bit === 1 ? 4 : bit === 2 ? 8 : bit === 4 ? 1 : 2)
    }
    if (edge.head) heads.push({ point: end, port: endPort })
    if (edge.tail) heads.push({ point: start, port: startPort })
  }
  const glyphs = [" ", "│", "─", "└", "│", "│", "┌", "├", "─", "┘", "─", "┴", "┐", "┤", "┬", "┼"]
  for (const [key, mask] of masks) grid.setCell(key % grid.width, Math.floor(key / grid.width), glyphs[mask]!, "line")
  for (const { point, port } of heads) grid.setCell(point.x, point.y, arrows[port], "marker")
}

function graphFinish(context: Context, boxes: Box[], edges: Edge[], options: ExtraOptions): ExtraDiagram {
  if (!boxes.length) return finish(canvas(context, 1, 0), options)
  const nodes = new Map(boxes.map((box) => [box.node.id, box.node]))
  const quote = (text: string) => JSON.stringify(text.replace(/<br\s*\/?\s*>/gi, "\n"))
  const endpoint = (id: string, port?: Port) => {
    const label = nodes.get(id)!.label
    return id + (port ? `:${port}` : "") + (label === id ? "" : ` [${quote(label)}]`)
  }
  const entries = edges.map((edge, index) => {
    const from = endpoint(edge.from, edge.start)
    const to = endpoint(edge.to, edge.end)
    const arrow = edge.tail ? (edge.head ? "↔" : "←") : edge.head ? "→" : "─"
    return `${index + 1}. ${from} ${arrow} ${to}${edge.label === undefined ? "" : `: ${quote(edge.label)}`}`
  })
  const width = Math.max(1, ...boxes.map((box) => box.x + box.width + 2), Math.min(context.width, Math.max(0, ...entries.map((entry) => diagramTextWidth(entry) + 2))))
  const bottom = Math.max(0, ...boxes.map((box) => box.y + box.height + 2))
  const annotations = entries.length ? ["Edges", ...entries.flatMap((entry, index) => wrap(context, edges[index]!.line, entry, width - 2).map((text, row) => row ? `  ${text}` : text))] : []
  const grid = canvas(context, width, bottom + annotations.length)
  route(context, grid, boxes, edges)
  boxes.forEach((box, index) => drawBox(grid, box, `series${index}`))
  annotations.forEach((text, index) => grid.setText(0, bottom + index, text, "text"))
  return finish(grid, options)
}

function block(context: Context, options: ExtraOptions): ExtraDiagram {
  const nodes: Node[] = []
  const slots: (Node | number)[] = []
  const edges: Edge[] = []
  let columns: number | undefined
  let declaredColumns = false
  for (const line of context.lines) {
    const columnMatch = /^columns\s+(auto|\d+)$/.exec(line.text)
    if (columnMatch) {
      if (declaredColumns || slots.length) fail(context, line, "Declare columns once before blocks")
      declaredColumns = true
      columns = columnMatch[1] === "auto" ? undefined : Number(columnMatch[1])
      if (columns !== undefined && (columns < 1 || columns > 32)) fail(context, line, "Column count must be between 1 and 32")
      continue
    }
    const connection = new RegExp(`^(${identifier}?)\\s*(<-->|-->|---|--)\\s*(?:\\|([^|]*)\\|\\s*)?(${identifier})$`).exec(line.text)
    if (connection) {
      edges.push({ from: connection[1]!, to: connection[4]!, head: connection[2]!.endsWith(">"), tail: connection[2]!.startsWith("<"), label: connection[3], line })
      continue
    }
    const labeled = new RegExp(`^(${identifier})\\s+--\\s+("(?:[^"\\\\]|\\\\.)*")\\s+-->\\s*(${identifier})$`).exec(line.text)
    if (labeled) {
      edges.push({ from: labeled[1]!, to: labeled[3]!, head: true, tail: false, label: label(context, line, labeled[2]!), line })
      continue
    }
    let rest = line.text
    while (rest) {
      const space = /^space(?::(\d+))?(?=\s|$)/.exec(rest)
      if (space) {
        const span = Number(space[1] ?? 1)
        if (span < 1 || span > 32) fail(context, line, "Space span must be between 1 and 32")
        slots.push(span)
        if (slots.length > 256) fail(context, line, "At most 256 block slots are supported")
        rest = rest.slice(space[0].length).trimStart()
        continue
      }
      const id = new RegExp(`^(${identifier})`).exec(rest)
      if (!id || /^(columns|block|end|style|classDef|class)$/.test(id[1]!)) fail(context, line, "Unsupported block syntax")
      rest = rest.slice(id[0].length)
      let text = id[1]!
      let rounded = false
      if (rest.startsWith("[") || rest.startsWith("(")) {
        rounded = rest[0] === "("
        const close = rounded ? ")" : "]"
        let quoted = false
        let index = 1
        for (; index < rest.length; index++) {
          if (rest[index] === "\\" && quoted) { index++; continue }
          if (rest[index] === '"') quoted = !quoted
          if (!quoted && rest[index] === close) break
          if (!quoted && /[\[\](){}]/.test(rest[index]!)) fail(context, line, "Unsupported block shape")
        }
        if (index === rest.length) fail(context, line, "Unclosed block label")
        text = label(context, line, rest.slice(1, index))
        rest = rest.slice(index + 1)
      }
      const spanMatch = /^:(\d+)/.exec(rest)
      const span = Number(spanMatch?.[1] ?? 1)
      if (spanMatch) rest = rest.slice(spanMatch[0].length)
      if (span < 1 || span > 32) fail(context, line, "Block span must be between 1 and 32")
      if (rest && !/^\s/.test(rest)) fail(context, line, "Unsupported block syntax")
      const node: Node = { id: id[1]!, label: text, span, rounded, line }
      nodes.push(node)
      slots.push(node)
      if (slots.length > 256) fail(context, line, "At most 256 block slots are supported")
      rest = rest.trimStart()
    }
  }
  validateGraph(context, nodes, edges)
  columns ??= Math.max(1, slots.reduce<number>((total, slot) => total + (typeof slot === "number" ? slot : slot.span), 0))
  if (columns > 32) fail(context, context.header, "Automatic layout exceeds 32 columns; declare a column count")
  if (!slots.length) return finish(canvas(context, 1, 0), options)
  const gap = columns * 4 + (columns - 1) * 3 + 4 <= context.width ? 3 : 1
  const desired = Math.max(4, ...nodes.map((node) => Math.ceil((labelWidth(node.label) + 2 - gap * (node.span - 1)) / node.span)))
  const cellWidth = Math.min(desired, 24, Math.floor((context.width - 4 - gap * (columns - 1)) / columns))
  if (cellWidth < 4) fail(context, context.header, `Terminal is too narrow for ${columns} block columns`)
  const placed: { node: Node; column: number; row: number; width: number; lines: string[] }[] = []
  let row = 0
  let column = 0
  for (const slot of slots) {
    const span = typeof slot === "number" ? slot : slot.span
    if (span > columns) fail(context, typeof slot === "number" ? context.header : slot.line, "Block span exceeds column count")
    if (column + span > columns) { row++; column = 0 }
    if (typeof slot !== "number") {
      const width = cellWidth * span + gap * (span - 1)
      placed.push({ node: slot, row, column, width, lines: wrap(context, slot.line, slot.label, width - 2) })
    }
    column += span
  }
  const heights = Array.from({ length: row + 1 }, () => 3)
  for (const item of placed) heights[item.row] = Math.max(heights[item.row]!, item.lines.length + 2)
  const offsets = [2]
  for (let index = 1; index < heights.length; index++) offsets[index] = offsets[index - 1]! + heights[index - 1]! + gap
  return graphFinish(context, placed.map((item) => ({ node: item.node, x: 2 + item.column * (cellWidth + gap), y: offsets[item.row]!, width: item.width, height: heights[item.row]!, lines: item.lines })), edges, options)
}

type Field = { start: number; end: number; label: string; line: Line }

function packet(context: Context, options: ExtraOptions): ExtraDiagram {
  const fields: Field[] = []
  let next = 0
  for (const line of context.lines) {
    const match = /^(?:(\d+)(?:\s*-\s*(\d+))?|\+(\d+))\s*:\s*("(?:[^"\\]|\\.)*")$/.exec(line.text)
    if (!match) fail(context, line, "Expected a bit range or +length followed by a quoted field label")
    const start = match[3] ? next : Number(match[1])
    const end = match[3] ? start + Number(match[3]) - 1 : Number(match[2] ?? match[1])
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < next || end < start || end > 4095) {
      fail(context, line, "Bit ranges must be ordered, non-overlapping, and within 0-4095")
    }
    fields.push({ start, end, label: label(context, line, match[4]!), line })
    if (fields.length > 128) fail(context, line, "At most 128 packet fields are supported")
    next = end + 1
  }
  if (!fields.length) return finish(canvas(context, 1, 0), options)
  if (context.width < 9) fail(context, context.header, "Packet diagrams require at least 9 terminal columns")
  let bits = 32
  while (bits * 2 + 1 > context.width) bits /= 2
  const width = bits * 2 + 1
  const rows: { offset: number; count: number; segments: { field?: Field; start: number; end: number; lines: string[]; index: number }[]; height: number }[] = []
  for (let offset = 0; offset < next; offset += bits) {
    const count = Math.min(bits, next - offset)
    const segments: typeof rows[number]["segments"] = []
    let start = offset
    while (start < offset + count) {
      const index = fields.findIndex((field) => field.start <= start && field.end >= start)
      const field = fields[index]
      const following = fields.find((candidate) => candidate.start > start)
      const end = Math.min(offset + count - 1, field?.end ?? ((following?.start ?? next) - 1))
      const innerWidth = (end - start + 1) * 2 - 1
      const lines = wrap(context, field?.line ?? context.header, field && diagramTextWidth(field.label) <= innerWidth ? field.label : field ? String(index + 1) : "·", innerWidth)
      segments.push({ field, start, end, lines, index })
      start = end + 1
    }
    rows.push({ offset, count, segments, height: Math.max(...segments.map((segment) => segment.lines.length)) + 3 })
  }
  const legend = fields.flatMap((field, index) => wrap(context, field.line, `${index + 1}. [${field.start}-${field.end}] ${field.label}`, width))
  const headings = rows.map((row) => wrap(context, context.header, `bits ${row.offset}-${row.offset + row.count - 1}`, width))
  const totalHeight = rows.reduce((total, row, index) => total + row.height + headings[index]!.length, 0) + legend.length
  const grid = canvas(context, width, totalHeight)
  let y = 0
  rows.forEach((row, rowIndex) => {
    for (const heading of headings[rowIndex]!) grid.setText(0, y++, heading, "muted")
    for (const segment of row.segments) {
      const x = (segment.start - row.offset) * 2
      const segmentWidth = (segment.end - segment.start + 1) * 2 + 1
      drawBox(grid, { node: { id: "", label: "", span: 1, line: context.header }, x, y, width: segmentWidth, height: row.height - 1, lines: segment.lines }, segment.field ? `series${segment.index}` : "muted")
      if (x > 0) {
        grid.setCell(x, y, "┬", "boxBorder")
        grid.setCell(x, y + row.height - 2, "┴", "boxBorder")
      }
    }
    y += row.height
  })
  for (const text of legend) grid.setText(0, y++, text, "text")
  return finish(grid, options)
}

function architecture(context: Context, options: ExtraOptions): ExtraDiagram {
  const nodes: Node[] = []
  const edges: Edge[] = []
  for (const line of context.lines) {
    const service = new RegExp(`^service\\s+(${identifier})(?:\\(([^()]+)\\))?(?:\\[("(?:[^"\\\\]|\\\\.)*"|[^\\]"]*)\\])?$`).exec(line.text)
    if (service) {
      const icon = service[2]
      const text = service[3] === undefined ? service[1]! : label(context, line, service[3])
      nodes.push({ id: service[1]!, label: icon ? `${text}\n(${icon})` : text, span: 1, line })
      continue
    }
    const junction = new RegExp(`^junction\\s+(${identifier})$`).exec(line.text)
    if (junction) {
      nodes.push({ id: junction[1]!, label: `◇ ${junction[1]}`, span: 1, line, rounded: true })
      continue
    }
    const edge = new RegExp(`^(${identifier}):([LRTB])\\s*(<)?--(>)?\\s*([LRTB]):(${identifier})$`).exec(line.text)
    if (edge) {
      edges.push({ from: edge[1]!, start: edge[2] as Port, tail: Boolean(edge[3]), head: Boolean(edge[4]), end: edge[5] as Port, to: edge[6]!, line })
      continue
    }
    fail(context, line, "Unsupported architecture syntax; expected service, junction, or a port connection")
  }
  validateGraph(context, nodes, edges)
  if (!nodes.length) return finish(canvas(context, 1, 0), options)
  const positions = new Map<string, Point>()
  let componentY = 0
  for (const node of nodes) {
    if (positions.has(node.id)) continue
    positions.set(node.id, { x: 0, y: componentY })
    const queue = [node.id]
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index]!
      const position = positions.get(id)!
      for (const edge of edges) {
        const forward = edge.from === id
        if (!forward && edge.to !== id) continue
        const other = forward ? edge.to : edge.from
        if (positions.has(other)) continue
        const own = vectors[(forward ? edge.start : edge.end)!]
        const target = vectors[(forward ? edge.end : edge.start)!]
        const dx = Math.sign(own.x - target.x) || (own.y === target.y ? 1 : 0)
        const dy = Math.sign(own.y - target.y)
        const desired = { x: position.x + dx, y: position.y + dy }
        while ([...positions.values()].some((point) => point.x === desired.x && point.y === desired.y)) desired.y++
        positions.set(other, desired)
        queue.push(other)
      }
    }
    const minimum = Math.min(...queue.map((id) => positions.get(id)!.y))
    for (const id of queue) positions.get(id)!.y += componentY - minimum
    componentY = Math.max(...[...positions.values()].map((point) => point.y)) + 2
  }
  const xs = [...new Set([...positions.values()].map((point) => point.x))].sort((a, b) => a - b)
  const ys = [...new Set([...positions.values()].map((point) => point.y))].sort((a, b) => a - b)
  const columns = Math.max(1, xs.length)
  const gap = 5
  const desired = Math.max(4, ...nodes.map((node) => labelWidth(node.label) + 2))
  const cellWidth = Math.min(desired, 26, Math.floor((context.width - 4 - gap * (columns - 1)) / columns))
  if (cellWidth < 4) fail(context, context.header, "Terminal is too narrow to preserve architecture port directions")
  const wrapped = nodes.map((node) => ({ node, lines: wrap(context, node.line, node.label, cellWidth - 2) }))
  const heights = ys.map(() => 3)
  for (const item of wrapped) {
    const row = ys.indexOf(positions.get(item.node.id)!.y)
    heights[row] = Math.max(heights[row]!, item.lines.length + 2)
  }
  const offsets = [2]
  for (let index = 1; index < heights.length; index++) offsets[index] = offsets[index - 1]! + heights[index - 1]! + gap
  const boxes = wrapped.map(({ node, lines }) => {
    const point = positions.get(node.id)!
    const row = ys.indexOf(point.y)
    return { node, x: 2 + xs.indexOf(point.x) * (cellWidth + gap), y: offsets[row]!, width: cellWidth, height: heights[row]!, lines }
  })
  return graphFinish(context, boxes, edges, options)
}

export function renderStructure(source: string, options: ExtraOptions): ExtraDiagram | undefined {
  const raw = source.split(/\r?\n/)
  const first = raw.findIndex((text) => text.trim() && !text.trim().startsWith("%%"))
  if (first < 0) return undefined
  const header = { text: stripComment(raw[first]!), number: first + 1 }
  const match = /^(block|packet|architecture)(?:-beta)?\b/.exec(header.text)
  if (!match) return undefined
  const kind = match[1] as Kind
  const context: Context = { kind, header, lines: [], width: Math.min(500, Math.floor(options.width)) }
  if (!Number.isFinite(options.width) || context.width < 1) fail(context, header, "Terminal width must be a positive finite number")
  if (!new RegExp(`^${kind}(?:-beta)?$`).test(header.text)) fail(context, header, "Unexpected content after diagram header")
  if (source.length > 128_000 || raw.length > 2_000) fail(context, header, "Diagram source exceeds rendering resource limits")
  for (let index = first + 1; index < raw.length; index++) {
    const text = stripComment(raw[index]!)
    if (!text) continue
    const line = { text, number: index + 1 }
    if (text.length > 4_096) fail(context, line, "Diagram statement is too long")
    context.lines.push(line)
  }
  if (kind === "block") return block(context, options)
  if (kind === "packet") return packet(context, options)
  return architecture(context, options)
}

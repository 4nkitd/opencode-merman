import { decodeHTML } from "entities"
import { parseDocument } from "yaml"
import { DiagramCanvas } from "../core/canvas.js"
import { diagramTextGraphemes, diagramTextWidth } from "../core/text.js"
import { MermaidSyntaxError } from "../diagnostics.js"
import { finish, type ExtraDiagram, type ExtraOptions } from "./shared.js"

type Kind = "mindmap" | "journey" | "kanban"
type Line = { text: string; number: number; indent: number }
type Row = { text: string; style: string; segments?: { x: number; text: string; style: string }[] }
type Node = { label: string; id: string; rest: string }
type TreeNode = { label: string; line: Line; parent: number; depth: number; path: string; children: number }
type Card = { id: string; label: string; line: Line; metadata: Record<string, string> }
type Column = Card & { cards: Card[] }

const MAX_SOURCE = 200_000
const MAX_CELLS = 250_000

function fail(kind: Kind, line: Line, reason: string): never {
  throw new MermaidSyntaxError(kind, line.number, line.text, reason)
}

function label(value: string, kind: Kind, line: Line): string {
  let text = value.trim()
  if (text.startsWith('"') || text.startsWith("'")) {
    const quote = text[0]!
    if (text.length < 2 || !text.endsWith(quote)) fail(kind, line, "Unclosed quoted label")
    text = text.slice(1, -1).replace(/\\([\\"'])/g, "$1")
    if (text.startsWith("`") && text.endsWith("`")) text = text.slice(1, -1)
  }
  return textValue(text, kind, line)
}

function textValue(value: string, kind: Kind, line: Line): string {
  const text = decodeHTML(value).replace(/<br\s*\/?>/gi, "\n")
  if (!text.trim()) fail(kind, line, "Expected a nonempty label")
  if (/[\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(text)) fail(kind, line, "Control characters are not supported in labels")
  return text
}

function splitOutsideQuotes(value: string, delimiter: string, kind: Kind, line: Line): string[] {
  const parts: string[] = []
  let quote = ""
  let start = 0
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!
    if (quote) {
      if (char === "\\") index++
      else if (char === quote) quote = ""
    } else if ((char === '"' || char === "'") && /(?:^|[:,])\s*$/.test(value.slice(0, index))) quote = char
    else if (char === delimiter) {
      parts.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  if (quote) fail(kind, line, "Unclosed quoted value")
  parts.push(value.slice(start).trim())
  return parts
}

function parseNode(text: string, kind: Kind, line: Line): Node {
  if (kind === "mindmap" && (text.startsWith('"') || text.startsWith("'"))) {
    return { id: "", label: label(text, kind, line), rest: "" }
  }
  if (kind === "kanban") {
    const match = /^([\p{L}\p{N}_-]+)(.*)$/u.exec(text)
    if (!match) fail(kind, line, "Expected a node identifier and optional [label]")
    const rest = match[2]!.trim()
    if (!rest.startsWith("[")) return { id: match[1]!, label: match[1]!, rest }
  }
  const shapes = kind === "mindmap"
    ? [["((", "))"], ["{{", "}}"], ["))", "(("], ["[", "]"], ["(", ")"], [")", "("]]
    : [["[", "]"]]
  const start = kind === "kanban" ? text.indexOf("[") : text.search(/[\[({)]/)
  if (start >= 0) {
    const id = text.slice(0, start).trim()
    if (id && !/^[\p{L}\p{N}_-]+$/u.test(id)) fail(kind, line, "Invalid node identifier")
    const shape = shapes.find(([open]) => text.startsWith(open!, start))
    if (!shape) fail(kind, line, "Unsupported node shape")
    const [open, close] = shape as [string, string]
    let quote = ""
    let end = -1
    for (let index = start + open.length; index < text.length; index++) {
      const char = text[index]!
      if (quote) {
        if (char === "\\") index++
        else if (char === quote) quote = ""
      } else if ((char === '"' || char === "'") && !text.slice(start + open.length, index).trim()) quote = char
      else if (text.startsWith(close, index)) {
        end = index
        break
      }
    }
    if (end < 0) fail(kind, line, "Unclosed node shape")
    return { id, label: label(text.slice(start + open.length, end), kind, line), rest: text.slice(end + close.length).trim() }
  }
  if (/::|@\{|-->|[\]{}]/.test(text)) fail(kind, line, "Unsupported mindmap syntax")
  return { id: "", label: label(text, kind, line), rest: "" }
}

function wrap(text: string, width: number, kind: Kind, line: Line): string[] {
  const result: string[] = []
  for (const paragraph of text.split("\n")) {
    let current = ""
    let cells = 0
    for (const grapheme of diagramTextGraphemes(paragraph)) {
      const size = Math.max(1, diagramTextWidth(grapheme))
      if (size > width) fail(kind, line, "Terminal width is too narrow for a label character")
      if (cells + size > width) {
        result.push(current)
        current = ""
        cells = 0
      }
      current += grapheme
      cells += size
    }
    result.push(current)
  }
  return result
}

function cellWidth(text: string): number {
  let width = 0
  for (const grapheme of diagramTextGraphemes(text)) width += Math.max(1, diagramTextWidth(grapheme))
  return width
}

function makeRows(width: number, kind: Kind, header: Line) {
  const rows: Row[] = []
  function push(text: string, style = "text", line = header) {
    for (const part of wrap(text, width, kind, line)) {
      if ((rows.length + 1) * width > MAX_CELLS) fail(kind, line, "Diagram exceeds the terminal cell limit")
      rows.push({ text: part, style })
    }
  }
  return { rows, push }
}

function mindmap(lines: Line[], width: number, header: Line): Row[] {
  const nodes: TreeNode[] = []
  const stack: number[] = []
  for (const line of lines) {
    if (/^(?:::|classDef\b|style\b|accTitle\b|accDescr\b)/.test(line.text)) {
      fail("mindmap", line, "Mindmap annotations are not supported")
    }
    const node = parseNode(line.text, "mindmap", line)
    if (node.rest) fail("mindmap", line, "Unsupported text after node label")
    while (stack.length && nodes[stack.at(-1)!]!.line.indent >= line.indent) stack.pop()
    const parent = stack.at(-1) ?? -1
    if (nodes.length && parent < 0) fail("mindmap", line, "A mindmap must have exactly one root")
    const depth = stack.length
    if (depth > 128) fail("mindmap", line, "Mindmap nesting exceeds 128 levels")
    const ancestor = nodes[parent]
    if (ancestor) ancestor.children++
    const path = ancestor ? `${ancestor.path}.${ancestor.children}` : "1"
    nodes.push({ label: node.label, line, parent, depth, path, children: 0 })
    stack.push(nodes.length - 1)
  }
  if (!nodes.length) fail("mindmap", header, "Expected a root node")
  const output = makeRows(width, "mindmap", header)
  const compact = nodes.some((node) => node.depth * 3 + 4 >= width)
  const lastChildren = new Map<number, number>()
  nodes.forEach((node, index) => lastChildren.set(node.parent, index))
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!
    if (compact) {
      output.push(`${node.path} ${node.label}`, node.depth ? `series${node.depth - 1}` : "primary", node.line)
      continue
    }
    let prefix = ""
    let ancestor = node.parent
    const parents: number[] = []
    while (ancestor >= 0) {
      parents.unshift(ancestor)
      ancestor = nodes[ancestor]!.parent
    }
    for (const parent of parents.slice(1)) {
      prefix += lastChildren.get(nodes[parent]!.parent) !== parent ? "│  " : "   "
    }
    const branch = node.depth ? lastChildren.get(node.parent) !== index ? "├─ " : "└─ " : ""
    const continuation = prefix + (branch === "├─ " ? "│  " : branch ? "   " : "")
    const parts = wrap(node.label, width - prefix.length - branch.length, "mindmap", node.line)
    parts.forEach((part, partIndex) => output.push((partIndex ? continuation : prefix + branch) + part, node.depth ? `series${node.depth - 1}` : "primary", node.line))
  }
  return output.rows
}

function journey(lines: Line[], width: number, header: Line): Row[] {
  const output = makeRows(width, "journey", header)
  const actors = new Map<string, number>()
  let title = false
  let tasks = 0
  output.push("Journey", "primary")
  for (const line of lines) {
    if (/^(?:accTitle|accDescr)\s*[:{]/.test(line.text)) fail("journey", line, "Accessibility annotations are not supported")
    const heading = /^(title|section)\s+(.+)$/.exec(line.text)
    if (heading) {
      const text = label(heading[2]!, "journey", line)
      if (heading[1] === "title") {
        if (title) fail("journey", line, "Duplicate journey title")
        title = true
        output.push(text, "primary", line)
      } else {
        output.push("", "text", line)
        output.push(`── ${text} ──`, "groupText", line)
      }
      continue
    }
    const fields = splitOutsideQuotes(line.text, ":", "journey", line)
    if (fields.length < 2 || fields.length > 3 || !/^[0-5]$/.test(fields[1]!)) {
      fail("journey", line, "Expected task: score from 0 to 5: optional comma-separated actors")
    }
    const task = label(fields[0]!, "journey", line)
    const score = Number(fields[1])
    const names = fields.length === 3 ? splitOutsideQuotes(fields[2]!, ",", "journey", line).map((name) => label(name, "journey", line)) : []
    output.push(`${++tasks}. ${task}`, "text", line)
    output.push(`   ${"●".repeat(score)}${"○".repeat(5 - score)} ${score}/5`, "series" + score, line)
    for (const actor of names) {
      if (!actors.has(actor)) actors.set(actor, actors.size)
      output.push(`   Actor: ${actor}`, `series${actors.get(actor)}`, line)
    }
  }
  if (!tasks) fail("journey", header, "Expected at least one journey task")
  return output.rows
}

function metadata(text: string, line: Line): Record<string, string> {
  if (!text.startsWith("@{") || !text.endsWith("}")) fail("kanban", line, "Expected @{ key: value } metadata")
  try {
    const document = parseDocument(text.slice(1), { uniqueKeys: true })
    if (document.errors.length || document.warnings.length) fail("kanban", line, "Invalid kanban metadata")
    const value: unknown = document.toJS({ maxAliasCount: 0 })
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("kanban", line, "Expected a metadata object")
    const entries = Object.entries(value)
    if (!entries.length) fail("kanban", line, "Expected at least one metadata field")
    const result: Record<string, string> = Object.create(null)
    for (const [key, item] of entries) {
      if (!/^[\w-]+$/.test(key) || !["string", "number", "boolean"].includes(typeof item)) {
        fail("kanban", line, "Metadata fields must have scalar text, number, or boolean values")
      }
      result[key] = textValue(String(item), "kanban", line)
    }
    return result
  } catch (error) {
    if (error instanceof MermaidSyntaxError) throw error
    fail("kanban", line, "Invalid kanban metadata")
  }
}

function kanban(lines: Line[], width: number, header: Line): Row[] {
  const columns: Column[] = []
  const ids = new Set<string>()
  let columnIndent: number | undefined
  let cardIndent: number | undefined
  let last: Card | undefined
  for (const line of lines) {
    if (line.text.startsWith("@{")) {
      if (!last) fail("kanban", line, "Metadata must follow a column or task")
      const fields = metadata(line.text, line)
      for (const [key, value] of Object.entries(fields)) {
        if (Object.hasOwn(last.metadata, key)) fail("kanban", line, "Duplicate metadata field")
        last.metadata[key] = value
      }
      continue
    }
    const parsed = parseNode(line.text, "kanban", line)
    if (!parsed.id) fail("kanban", line, "Kanban nodes require an identifier")
    if (ids.has(parsed.id)) fail("kanban", line, "Duplicate kanban identifier")
    ids.add(parsed.id)
    const card: Card = { id: parsed.id, label: parsed.label, line, metadata: parsed.rest ? metadata(parsed.rest, line) : Object.create(null) }
    columnIndent ??= line.indent
    if (line.indent === columnIndent) {
      columns.push({ ...card, cards: [] })
      cardIndent = undefined
      last = columns.at(-1)!
    } else {
      if (line.indent < columnIndent || !columns.length) fail("kanban", line, "Invalid column indentation")
      cardIndent ??= line.indent
      if (line.indent !== cardIndent) fail("kanban", line, "Kanban tasks cannot be nested; align tasks within their column")
      columns.at(-1)!.cards.push(card)
      last = card
    }
  }
  if (!columns.length) fail("kanban", header, "Expected at least one kanban column")
  const output = makeRows(width, "kanban", header)
  output.push("Kanban", "primary")
  const across = Math.max(1, Math.min(columns.length, Math.floor((width + 2) / 22)))
  for (let start = 0; start < columns.length; start += across) {
    const batch = columns.slice(start, start + across)
    const laneWidth = Math.floor((width - (batch.length - 1) * 2) / batch.length)
    const boxed = laneWidth >= 6
    const inner = boxed ? laneWidth - 4 : laneWidth
    const lanes = batch.map((column) => {
      const content = makeRows(inner, "kanban", column.line)
      const display = (card: Card) => card.label === card.id ? card.label : `${card.label} [${card.id}]`
      content.push(display(column), "groupText", column.line)
      for (const [key, value] of Object.entries(column.metadata)) content.push(`${key}: ${value}`, "secondary", column.line)
      content.push("─".repeat(inner), "boxBorder", column.line)
      for (const card of column.cards) {
        content.push(`□ ${display(card)}`, "text", card.line)
        for (const [key, value] of Object.entries(card.metadata)) content.push(`  ${key}: ${value}`, "secondary", card.line)
        content.push("", "text", card.line)
      }
      if (!boxed) return content.rows
      return [
        { text: `┌${"─".repeat(laneWidth - 2)}┐`, style: "boxBorder" },
        ...content.rows.map((row) => ({ text: `│ ${row.text}${" ".repeat(inner - cellWidth(row.text))} │`, style: row.style })),
        { text: `└${"─".repeat(laneWidth - 2)}┘`, style: "boxBorder" },
      ]
    })
    const height = Math.max(...lanes.map((lane) => lane.length))
    for (let row = 0; row < height; row++) {
      const text = lanes.map((lane) => {
        const text = lane[row]?.text ?? ""
        return text + " ".repeat(laneWidth - cellWidth(text))
      }).join("  ").trimEnd()
      output.push(text, "text", batch[0]!.line)
      output.rows.at(-1)!.segments = lanes.flatMap((lane, index) => lane[row] ? [{
        x: index * (laneWidth + 2), text: lane[row]!.text, style: lane[row]!.style,
      }] : [])
    }
    if (start + across < columns.length) output.push("")
  }
  return output.rows
}

export function renderHierarchy(source: string, options: ExtraOptions): ExtraDiagram | undefined {
  const raw = source.slice(0, MAX_SOURCE + 1).replace(/^\uFEFF/, "").split(/\r?\n/)
  const first = raw.findIndex((line) => line.trim() && !line.trim().startsWith("%%"))
  if (first < 0) return undefined
  const match = /^(mindmap|journey|kanban)\b/.exec(raw[first]!.trim())
  if (!match) return undefined
  const kind = match[1] as Kind
  const header: Line = { text: raw[first]!.trim(), number: first + 1, indent: 0 }
  if (!new RegExp(`^${kind}(?:\\s+%%.*)?$`).test(header.text)) fail(kind, header, "Unsupported diagram header")
  if (source.length > MAX_SOURCE || raw.length > 4_000) fail(kind, header, "Diagram source is too large")
  for (let index = 0; index < first; index++) {
    if (raw[index]!.trim().startsWith("%%{")) fail(kind, { text: raw[index]!.trim(), number: index + 1, indent: 0 }, "Diagram configuration directives are not supported")
  }
  if (!Number.isFinite(options.width) || options.width < 1) throw new RangeError("Terminal width must be a positive finite number")
  const width = Math.min(240, Math.floor(options.width))
  const lines: Line[] = []
  for (let index = first + 1; index < raw.length; index++) {
    const text = raw[index]!.trim()
    if (!text || (text.startsWith("%%") && !text.startsWith("%%{"))) continue
    const indentation = /^\s*/.exec(raw[index]!)![0]
    const line = { text, number: index + 1, indent: indentation.replace(/\t/g, "    ").length }
    if (text.length > 8_192) fail(kind, line, "Diagram statement is too long")
    if (text.startsWith("%%{")) fail(kind, line, "Diagram configuration directives are not supported")
    lines.push(line)
  }
  const rows = kind === "mindmap" ? mindmap(lines, width, header) : kind === "journey" ? journey(lines, width, header) : kanban(lines, width, header)
  const canvas = new DiagramCanvas<string>(width, rows.length)
  rows.forEach((row, index) => {
    canvas.setText(0, index, row.text, row.style)
    for (const segment of row.segments ?? []) canvas.setText(segment.x, index, segment.text, segment.style)
  })
  return finish(canvas, options)
}

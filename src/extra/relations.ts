import { DiagramCanvas, DiagramCanvasSizeError } from "../core/canvas.js"
import { diagramTextGraphemes, diagramTextWidth } from "../core/text.js"
import { MermaidSyntaxError } from "../diagnostics.js"
import { drawFlowchartDiagramGrid } from "../flowchart/drawing.js"
import type { FlowchartDirection } from "../flowchart/types.js"
import { finish, type ExtraDiagram, type ExtraOptions } from "./shared.js"

type Kind = "class" | "er" | "requirement"
interface SourceLine { text: string; raw: string; number: number }
interface Node {
  id: string
  label: string
  members: string[]
  type?: string
  declared?: boolean
  fields: Set<string>
}
interface Relation {
  from: string
  to: string
  symbol: string
  label: string
  left: string
  right: string
  source: SourceLine
}
interface Model {
  kind: Kind
  nodes: Map<string, Node>
  relations: Relation[]
  direction: FlowchartDirection
  header: SourceLine
}

const identifier = "[\\p{L}\\p{N}_][\\p{L}\\p{N}_-]*"
const quoted = '"(?:[^"\\\\]|\\\\["\\\\])*"'
const classID = `(?:${identifier}|\`[^\`]+\`)`
const entityID = `(?:${identifier}|${quoted})`
const classDeclaration = new RegExp(`^class\\s+(${classID})(?:\\s*\\[(${quoted})\\])?\\s*(\\{\\s*\\}?)?$`, "u")
const classMember = new RegExp(`^(${classID})\\s*:\\s*(.+)$`, "u")
const classRelation = new RegExp(`^(${classID})(?:\\s+(${quoted}))?\\s*(<\\|--|--\\|>|<\\|\\.\\.|\\.\\.\\|>|\\*--|--\\*|o--|--o|-->|<--|\\.\\.>|<\\.\\.|--|\\.\\.)(?:\\s*(${quoted}))?\\s*(${classID})(?:\\s*:\\s*(.+))?$`, "u")
const entityDeclaration = new RegExp(`^(${entityID})(?:\\s*\\[(${quoted})\\])?\\s*(\\{\\s*\\}?)?$`, "u")
const entityRelation = new RegExp(`^(${entityID})\\s+(\\|\\||o\\||\\|o|\\}o|\\}\\|)(--|\\.\\.)(\\|\\||o\\||\\|o|o\\{|\\|\\{)\\s+(${entityID})\\s*:\\s*(.+)$`, "u")
const requirementDeclaration = new RegExp(`^(requirement|functionalRequirement|interfaceRequirement|performanceRequirement|physicalRequirement|designConstraint|element)\\s+(${entityID})\\s*\\{\\s*(\\})?$`, "u")
const requirementRelation = new RegExp(`^(${entityID})\\s+(-|<-)\\s+(contains|copies|derives|satisfies|verifies|refines|traces)\\s+(->|-)\\s+(${entityID})$`, "u")

function fail(model: Pick<Model, "kind">, source: SourceLine, reason: string): never {
  throw new MermaidSyntaxError(model.kind, source.number, source.raw, reason)
}

function unquote(value: string): string {
  if (value.startsWith('"')) return value.slice(1, -1).replace(/\\(["\\])/g, "$1")
  if (value.startsWith("`")) return value.slice(1, -1)
  return value
}

function stripComment(value: string): string {
  let quote = ""
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!
    if (quote && char === "\\") { index++; continue }
    if (quote && char === quote) { quote = ""; continue }
    if (!quote && (char === '"' || char === "`")) { quote = char; continue }
    if (!quote && value.slice(index, index + 2) === "%%") return value.slice(0, index)
  }
  return value
}

function valueText(model: Model, line: SourceLine, value: string): string {
  const text = value.trim()
  if (!text || (text.startsWith('"') && !new RegExp(`^${quoted}$`, "u").test(text))) {
    fail(model, line, "Expected text or a complete quoted string")
  }
  if (!text.startsWith('"') && /["{};]/.test(text)) fail(model, line, "Quote text containing quotes, braces, or semicolons")
  return unquote(text)
}

function node(model: Model, id: string, line: SourceLine): Node {
  id = unquote(id)
  let result = model.nodes.get(id)
  if (!result) {
    if (model.nodes.size >= 64) fail(model, line, "At most 64 nodes are supported")
    result = { id, label: id, members: [], fields: new Set() }
    model.nodes.set(id, result)
  }
  return result
}

function addRelation(model: Model, line: SourceLine, from: string, to: string, symbol: string, label = "", left = "", right = ""): void {
  if (model.relations.length >= 128) fail(model, line, "At most 128 relationships are supported")
  model.relations.push({ from: unquote(from), to: unquote(to), symbol, label, left: unquote(left), right: unquote(right), source: line })
  if (model.kind !== "requirement") { node(model, from, line); node(model, to, line) }
}

function addClassMember(model: Model, target: Node, line: SourceLine, text: string): void {
  if (/^<<[\p{L}_][\p{L}\p{N}_ -]*>>$/u.test(text)) {
    target.members.push(text)
    return
  }
  const member = text.replace(/^[+\-#~]/, "")
  const method = /^[\p{L}_][\p{L}\p{N}_~<>,.\[\] ]*\([^(){};]*\)(?:[\s\p{L}\p{N}_~<>,.\[\]*$]*)$/u.test(member)
  const attribute = /^[\p{L}_][\p{L}\p{N}_~<>,.\[\] ]*\$?$/u.test(member)
  if ((!method && !attribute) || /["`{};]|<<|>>/.test(member)) fail(model, line, "Expected a class attribute, method, or <<annotation>>")
  target.members.push(text)
}

function addEntityMember(model: Model, target: Node, line: SourceLine): void {
  const match = new RegExp(`^([\\p{L}_][\\p{L}\\p{N}_\\[\\]().-]*)\\s+([\\p{L}_*][\\p{L}\\p{N}_-]*)(?:\\s+((?:PK|FK|UK)(?:\\s*,\\s*(?:PK|FK|UK))*))?(?:\\s+(${quoted}))?$`, "u").exec(line.text)
  if (!match) fail(model, line, "Expected attribute type, name, optional PK/FK/UK keys and quoted comment")
  if (target.fields.has(match[2]!)) fail(model, line, "Duplicate entity attribute")
  target.fields.add(match[2]!)
  target.members.push(`${match[1]} ${match[2]}${match[3] ? ` ${match[3].replace(/\s*,\s*/g, ", ")}` : ""}${match[4] ? ` ${match[4]}` : ""}`)
}

function addRequirementField(model: Model, target: Node, line: SourceLine): void {
  const match = /^(id|text|risk|verifymethod|type|docref)\s*:\s*(.+)$/.exec(line.text)
  if (!match) fail(model, line, "Expected a supported requirement or element field")
  const key = match[1]!
  const allowed = target.type === "element" ? ["type", "docref"] : ["id", "text", "risk", "verifymethod"]
  if (!allowed.includes(key)) fail(model, line, `Field ${key} is not valid for ${target.type}`)
  if (target.fields.has(key)) fail(model, line, `Duplicate field ${key}`)
  const value = valueText(model, line, match[2]!)
  if (key === "risk" && !["low", "medium", "high"].includes(value)) fail(model, line, "Risk must be low, medium, or high")
  if (key === "verifymethod" && !["analysis", "inspection", "test", "demonstration"].includes(value)) fail(model, line, "Unknown verification method")
  target.fields.add(key)
  target.members.push(`${key}: ${value}`)
}

function parse(source: string): Model | undefined {
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/).map((raw, index) => ({ raw, number: index + 1, text: stripComment(raw).trim() }))
  const headerIndex = lines.findIndex((line) => line.text.length > 0)
  const header = lines[headerIndex]
  if (!header) return undefined
  const match = /^(classDiagram|erDiagram|requirementDiagram)\b/.exec(header.text)
  if (!match) return undefined
  const model: Model = { kind: match[1] === "classDiagram" ? "class" : match[1] === "erDiagram" ? "er" : "requirement", nodes: new Map(), relations: [], direction: "TB", header }
  if (header.text !== match[1]) fail(model, header, "Unexpected content after diagram header")
  if (source.length > 50_000 || lines.length > 2_000) fail(model, header, "Diagram exceeds the 50,000 character or 2,000 line limit")
  for (const line of lines) {
    if (line.raw.slice(stripComment(line.raw).length).startsWith("%%{")) fail(model, line, "Mermaid configuration directives are not supported")
  }
  let block: { target: Node; source: SourceLine } | undefined
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line.text) continue
    if (/[\x00-\x1f\x7f-\x9f]/.test(line.text)) fail(model, line, "Control characters within statements are not supported")
    if (line.text.endsWith(";")) line.text = line.text.slice(0, -1).trim()
    if (block) {
      if (line.text === "}") { block = undefined; continue }
      if (model.kind === "class") addClassMember(model, block.target, line, line.text)
      else if (model.kind === "er") addEntityMember(model, block.target, line)
      else addRequirementField(model, block.target, line)
      continue
    }
    const direction = /^direction\s+(TB|TD|BT|LR|RL)$/.exec(line.text)
    if (direction && model.kind !== "requirement") { model.direction = direction[1] as FlowchartDirection; continue }
    if (model.kind === "class") {
      const declaration = classDeclaration.exec(line.text)
      if (declaration) {
        const target = node(model, declaration[1]!, line)
        if (declaration[2]) target.label = unquote(declaration[2])
        if (declaration[3] && !declaration[3].includes("}")) block = { target, source: line }
        continue
      }
      const relation = classRelation.exec(line.text)
      if (relation) {
        addRelation(model, line, relation[1]!, relation[5]!, relation[3]!, relation[6] ? valueText(model, line, relation[6]) : "", relation[2], relation[4])
        continue
      }
      const member = classMember.exec(line.text)
      if (member) { addClassMember(model, node(model, member[1]!, line), line, member[2]!); continue }
      const annotation = new RegExp(`^(<<[\\p{L}_][\\p{L}\\p{N}_ -]*>>)\\s+(${classID})$`, "u").exec(line.text)
      if (annotation) { addClassMember(model, node(model, annotation[2]!, line), line, annotation[1]!); continue }
    } else if (model.kind === "er") {
      const relation = entityRelation.exec(line.text)
      if (relation) {
        addRelation(model, line, relation[1]!, relation[5]!, relation[2]! + relation[3]! + relation[4]!, valueText(model, line, relation[6]!))
        continue
      }
      const declaration = entityDeclaration.exec(line.text)
      if (declaration) {
        const target = node(model, declaration[1]!, line)
        if (declaration[2]) target.label = unquote(declaration[2])
        if (declaration[3] && !declaration[3].includes("}")) block = { target, source: line }
        continue
      }
    } else {
      const declaration = requirementDeclaration.exec(line.text)
      if (declaration) {
        const target = node(model, declaration[2]!, line)
        if (target.declared) fail(model, line, "Duplicate requirement or element declaration")
        target.declared = true
        target.type = declaration[1]!
        if (!declaration[3]) block = { target, source: line }
        continue
      }
      const relation = requirementRelation.exec(line.text)
      if (relation) {
        if ((relation[2] === "-") !== (relation[4] === "->")) fail(model, line, "Relationship must have exactly one arrowhead")
        const reversed = relation[2] === "<-"
        addRelation(model, line, reversed ? relation[5]! : relation[1]!, reversed ? relation[1]! : relation[5]!, "-->", relation[3]!)
        continue
      }
    }
    fail(model, line, "Unsupported or malformed statement")
  }
  if (block) fail(model, block.source, "Unclosed declaration block")
  if (!model.nodes.size) fail(model, header, "Diagram must contain at least one declaration or relationship")
  for (const relation of model.relations) {
    if (!model.nodes.has(relation.from) || !model.nodes.has(relation.to)) fail(model, relation.source, "Relationship refers to an undeclared requirement or element")
  }
  return model
}

function nodeTitle(value: Node): string {
  return value.label === value.id ? value.label : `${value.label} [${value.id}]`
}

function nodeLines(value: Node): string[] {
  return [value.type ? `<<${value.type}>>` : "", nodeTitle(value), ...value.members].filter(Boolean)
}

function relationText(model: Model, edge: Relation): string {
  const from = nodeTitle(model.nodes.get(edge.from)!)
  const to = nodeTitle(model.nodes.get(edge.to)!)
  return `${from}${edge.left ? ` "${edge.left}"` : ""} ${edge.symbol}${edge.right ? ` "${edge.right}"` : ""} ${to}${edge.label ? ` : ${edge.label}` : ""}`
}

function wrap(model: Model, value: string, width: number): string[] {
  const result: string[] = []
  let line = ""
  let size = 0
  for (const char of diagramTextGraphemes(value)) {
    const next = Math.max(1, diagramTextWidth(char))
    if (next > width) fail(model, model.header, "Terminal is too narrow for a label grapheme")
    if (size + next > width) { result.push(line); line = ""; size = 0 }
    line += char
    size += next
  }
  result.push(line)
  return result
}

function compactGrid(model: Model, width: number): DiagramCanvas<string> {
  const rows: { text: string; style: string }[] = []
  const boxed = width >= 6
  const inner = boxed ? width - 4 : width
  const push = (text: string, style = "text") => {
    if ((rows.length + 1) * width > 250_000) fail(model, model.header, "Wrapped diagram exceeds the 250,000 cell limit")
    rows.push({ text, style })
  }
  const border = (left: string, right: string, style: string) => push(left + "─".repeat(width - 2) + right, style)
  let index = 0
  for (const value of model.nodes.values()) {
    const style = `series${index++ % 6}`
    if (rows.length) push("")
    if (boxed) border("┌", "┐", style)
    const titles = nodeLines(value)
    const titleCount = titles.length - value.members.length
    for (const [position, text] of titles.entries()) {
      if (boxed && position === titleCount) border("├", "┤", style)
      for (const part of wrap(model, text, inner)) {
        push(boxed ? `│ ${part}${" ".repeat(inner - diagramTextWidth(part))} │` : part, position < titleCount ? style : "boxText")
      }
    }
    if (boxed) border("└", "┘", style)
    for (const edge of model.relations.filter((relation) => relation.from === value.id)) {
      if (boxed) push("  │", "line")
      for (const [part, text] of wrap(model, relationText(model, edge), boxed ? width - 4 : width).entries()) {
        push(boxed ? (part === 0 ? "  ├ " : "  │ ") + text : text, "marker")
      }
    }
  }
  const grid = new DiagramCanvas<string>(width, rows.length)
  for (const [y, row] of rows.entries()) grid.setText(0, y, row.text, row.style)
  return grid
}

export function renderRelations(source: string, options: ExtraOptions): ExtraDiagram | undefined {
  const model = parse(source)
  if (!model) return undefined
  if (!Number.isFinite(options.width) || options.width < 1) throw new RangeError("Diagram width must be a positive finite number")
  const width = Math.min(500, Math.floor(options.width))
  const labels = [...model.nodes.values()].flatMap(nodeLines)
  const edges = model.relations.map((edge) => relationText(model, edge))
  // The upstream flowchart text parser treats HTML as markup; the card renderer preserves it literally.
  if (width < 24 || [...labels, ...edges].some((text) => diagramTextWidth(text) > width - 8 || /<\/?(?:i|em|br)\b/i.test(text) || text.trim() !== text)) {
    return finish(compactGrid(model, width), options)
  }
  try {
    const diagram = drawFlowchartDiagramGrid({
      direction: model.direction,
      nodes: [...model.nodes.values()].map((value) => ({ id: value.id, label: nodeLines(value).join("<br>"), shape: "box" })),
      edges: model.relations.map((edge) => ({ from: edge.from, to: edge.to, label: relationText(model, edge), arrowhead: false, ...(edge.symbol.includes("..") ? { style: "dashed" as const } : {}) })),
    }, { layoutMaxWidth: width, borderStyle: "single", compact: true })
    if (diagram.width > width) return finish(compactGrid(model, width), options)
    const grid = new DiagramCanvas<string>(diagram.width, diagram.height)
    for (const [y, row] of diagram.rows.entries()) {
      for (const [x, cell] of row.entries()) {
        const style = cell.style === undefined ? undefined : cell.style === "node" ? "boxText" : cell.style === "nodeBorder" ? "boxBorder" : cell.style === "label" ? "series0" : "line"
        grid.setCell(x, y, cell.char, style)
      }
    }
    return finish(grid, options)
  } catch (error) {
    if (!(error instanceof DiagramCanvasSizeError)) throw error
    return finish(compactGrid(model, width), options)
  }
}

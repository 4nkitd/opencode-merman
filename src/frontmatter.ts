import { parseDocument } from "yaml"
import type { MermaidMarkdownRendererOptions } from "./markdown.js"

export class MermaidConfigError extends Error {}

function record(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  if (typeof value !== "object" || Array.isArray(value)) throw new MermaidConfigError("Expected a YAML mapping")
  return value as Record<string, unknown>
}

export function normalizeMermaid(source: string): { source: string; config: Record<string, unknown>; title?: string } {
  if (source.length > 100_000) throw new MermaidConfigError("Diagram source exceeds 100,000 characters")
  source = source.replace(/^\uFEFF/, "")
  if (!/^\s*---\s*\r?\n/.test(source)) return { source, config: {} }
  const lines = source.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === "---")
  const end = lines.findIndex((line, index) => index > start && /^(---|\.\.\.)$/.test(line.trim()))
  if (end < 0) throw new MermaidConfigError("Unterminated YAML frontmatter")
  try {
    const document = parseDocument(lines.slice(start + 1, end).join("\n"), { schema: "core", uniqueKeys: true })
    if (document.errors.length || document.warnings.length) throw new MermaidConfigError("Invalid YAML frontmatter")
    const data = record(document.toJS({ maxAliasCount: 50 }))
    if (data.title !== undefined && (typeof data.title !== "string" || data.title.length > 1024 || /[\x00-\x1f\x7f-\x9f]/.test(data.title))) {
      throw new MermaidConfigError("Expected a printable title of at most 1,024 characters")
    }
    return { source: lines.slice(end + 1).join("\n"), config: record(data.config), title: data.title as string | undefined }
  } catch (error) {
    if (error instanceof MermaidConfigError) throw error
    throw new MermaidConfigError("Invalid YAML frontmatter")
  }
}

function cssColor(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new MermaidConfigError("Expected a color string")
  const names = /^(?:transparent|black|white|red|green|blue|yellow|cyan|magenta|silver|gr[ae]y|maroon|olive|lime|aqua|teal|navy|fuchsia|purple|orange|bright(?:black|white|red|green|blue|yellow|cyan|magenta))$/i
  if (!/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value) && !names.test(value)) {
    throw new MermaidConfigError(`Invalid color: ${value}`)
  }
  return value
}

export function configuredOptions(
  config: Record<string, unknown>,
  input: MermaidMarkdownRendererOptions,
): MermaidMarkdownRendererOptions {
  const colors = { ...input.colors }
  if (config.theme !== undefined) {
    if (typeof config.theme !== "string" || !["dark", "default", "neutral", "base", "forest"].includes(config.theme)) {
      throw new MermaidConfigError("Unknown Mermaid theme")
    }
    const dark = config.theme === "dark"
    Object.assign(colors, {
      text: dark ? "#e5e7eb" : "#1f2937",
      primary: dark ? "#e5e7eb" : "#1f2937",
      boxText: dark ? "#e5e7eb" : "#1f2937",
      background: dark ? "#111827" : "#ffffff",
      muted: dark ? "#9ca3af" : "#6b7280",
      boxBorder: dark ? "#9ca3af" : "#6b7280",
      line: dark ? "#9ca3af" : "#6b7280",
    })
  }
  const variables = record(config.themeVariables)
  for (const [from, to] of [
    ["textColor", "text"], ["primaryTextColor", "boxText"],
    ["primaryBorderColor", "boxBorder"], ["lineColor", "line"], ["background", "background"],
  ] as const) {
    if (variables[from] !== undefined) colors[to] = cssColor(variables[from])
  }
  const xy = record(variables.xyChart)
  let seriesColors = input.seriesColors
  if (xy.plotColorPalette !== undefined) {
    if (typeof xy.plotColorPalette !== "string") throw new MermaidConfigError("Expected a comma-separated palette")
    seriesColors = xy.plotColorPalette.split(",").map((color) => cssColor(color.trim()))
    if (seriesColors.length > 64) throw new MermaidConfigError("Palette exceeds 64 colors")
  }
  return { ...input, colors, seriesColors }
}

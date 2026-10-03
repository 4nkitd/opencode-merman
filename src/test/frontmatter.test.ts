import { expect, test } from "bun:test"
import { configuredOptions, MermaidConfigError, normalizeMermaid } from "../frontmatter.js"

test("strips YAML without changing the diagram and applies its palette", () => {
  const normalized = normalizeMermaid('---\nconfig:\n  themeVariables:\n    xyChart:\n      plotColorPalette: "#3b82f6, #f97316"\n---\nxychart-beta\nline [1, 2]')
  expect(normalized.source).toBe("xychart-beta\nline [1, 2]")
  expect(configuredOptions(normalized.config, {}).seriesColors).toEqual(["#3b82f6", "#f97316"])
})

test("BOM, CRLF and blank lines before YAML work", () => {
  const normalized = normalizeMermaid('\uFEFF\r\n---\r\nconfig:\r\n  theme: dark\r\n---\r\nflowchart LR\r\nA --> B')
  expect(normalized.source).toBe("flowchart LR\nA --> B")
  expect(configuredOptions(normalized.config, {}).colors?.text).toBe("#e5e7eb")
})

test("incomplete or malformed frontmatter fails without partial rendering", () => {
  for (const source of ["---\nconfig:", "---\nconfig: [\n---\nflowchart LR", "---\nconfig: [1, 2]\n---\nflowchart LR", "---\nconfig: {}\nconfig: {}\n---\nflowchart LR"]) {
    expect(() => normalizeMermaid(source)).toThrow(MermaidConfigError)
  }
})

test("invalid palettes and YAML types are rejected", () => {
  for (const value of ["", "#nope", "#f00,", [], 12]) {
    expect(() => configuredOptions({ themeVariables: { xyChart: { plotColorPalette: value } } }, {})).toThrow(MermaidConfigError)
  }
})

test("configuration is local to a fence", () => {
  const defaults = { colors: { text: "#fafafa" }, seriesColors: ["#f00"] }
  configuredOptions({ theme: "default", themeVariables: { xyChart: { plotColorPalette: "#0f0" } } }, defaults)
  expect(defaults).toEqual({ colors: { text: "#fafafa" }, seriesColors: ["#f00"] })
  expect(configuredOptions({}, defaults)).toEqual(defaults)
})

test("theme must be a scalar string without object coercion", () => {
  for (const theme of [{ toString: "dark" }, ["dark"], 1, true]) {
    expect(() => configuredOptions({ theme }, {})).toThrow(MermaidConfigError)
  }
})

test("top-level titles are retained and bounded", () => {
  expect(normalizeMermaid('---\ntitle: Production failure rate\n---\npie\n"Failed": 5').title).toBe("Production failure rate")
  expect(() => normalizeMermaid('---\ntitle: {toString: title}\n---\npie\n"Failed": 5')).toThrow(MermaidConfigError)
})

test("oversized source and alias expansion are bounded", () => {
  expect(() => normalizeMermaid("x".repeat(100_001))).toThrow(MermaidConfigError)
  expect(() => normalizeMermaid("---\na: &a [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]\nb: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]\nconfig: {themeVariables: [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]}\n---\nflowchart LR")).toThrow(MermaidConfigError)
})

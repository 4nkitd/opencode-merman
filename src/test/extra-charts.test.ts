import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import stringWidth from "string-width"
import { MermaidSyntaxError } from "../diagnostics.js"
import { renderCharts } from "../extra/charts.js"
import type { ExtraOptions } from "../extra/shared.js"

const options: ExtraOptions = { width: 72, colors: { text: "#eeeeee", line: "#777777" } }
const samples = {
  line: 'xychart-beta\n title "Line test"\n x-axis [Mon, Tue, Wed]\n y-axis "Score" 0 --> 100\n line [30, 80, 50]',
  bar: 'xychart-beta\n title "Bar test"\n x-axis [Mon, Tue, Wed]\n y-axis "Count" 0 --> 100\n bar [30, 80, 50]',
  pie: 'pie title Test results\n "Passed" : 70\n "Failed" : 30',
  quadrant: "quadrantChart\n title Task priority\n x-axis Low effort --> High effort\n y-axis Low impact --> High impact\n quadrant-1 Plan\n quadrant-2 Do now\n quadrant-3 Later\n quadrant-4 Reconsider\n Fix: [0.2, 0.8]\n Rewrite: [0.8, 0.6]",
  sankey: "sankey-beta\n\nSource,Process,100\nProcess,Success,80\nProcess,Failure,20",
}

function render(source: string, overrides: Partial<ExtraOptions> = {}) {
  const result = renderCharts(source, { ...options, ...overrides })
  expect(result).toBeDefined()
  const text = result!.text.chunks.map((chunk) => chunk.text).join("")
  expect(text.split("\n")).toHaveLength(result!.height)
  for (const line of text.split("\n")) expect(stringWidth(line)).toBeLessThanOrEqual(overrides.width ?? options.width)
  return { result: result!, text }
}

function error(source: string) {
  try { renderCharts(source, options) } catch (cause) {
    expect(cause).toBeInstanceOf(MermaidSyntaxError)
    return cause as MermaidSyntaxError
  }
  throw new Error("Expected chart syntax error")
}

describe("native XY charts", () => {
  test("renders the exact line and bar samples with labels and values", () => {
    const line = render(samples.line).text
    expect(line).toContain("Line test")
    expect(line).toContain("Score: 0 → 100")
    expect(line).toContain("1: Mon")
    expect(line).toContain("line 1: [30, 80, 50]")
    expect(line).toContain("●")
    const bar = render(samples.bar).text
    expect(bar).toContain("Bar test")
    expect(bar).toContain("Count: 0 → 100")
    expect(bar).toContain("bar 1: [30, 80, 50]")
    expect(bar).toContain("█")
  })

  test("retains all eight categories and every value in the original three-series chart", () => {
    const source = `xychart-beta
      x-axis [Sep24, Sep25, Sep26, Sep27, Sep28, Sep29, Oct1, Oct2]
      line [84,80,80.5,87,84.5,62,81.5,84]
      line [57,60,55,75,77.5,62,73,78.5]
      line [90,90,90,90,90,90,90,90]`
    const { text, result } = render(source, { seriesColors: ["#ff0000", "#00ff00", "#0000ff"] })
    expect(text).toContain("8: Oct2")
    expect(text).toContain("line 1: [84, 80, 80.5, 87, 84.5, 62, 81.5, 84]")
    expect(text).toContain("line 2: [57, 60, 55, 75, 77.5, 62, 73, 78.5]")
    expect(text).toContain("line 3: [90, 90, 90, 90, 90, 90, 90, 90]")
    for (const [index, color] of ["#ff0000", "#00ff00", "#0000ff"].entries()) {
      expect(result.text.chunks.find((chunk) => chunk.text.startsWith(`line ${index + 1}:`))?.fg?.equals(RGBA.fromHex(color))).toBe(true)
      expect(result.text.chunks.some((chunk) => /[●•]/.test(chunk.text) && chunk.fg?.equals(RGBA.fromHex(color)))).toBe(true)
    }
  })

  test("handles numeric axes, mixed series, negatives and decimals", () => {
    const { text } = render('xychart\nx-axis "Time" -2 --> 2\ny-axis "Delta" -10 --> 10\nbar [-5.25, 0, 4.5]\nline [-2, 0, 9]')
    expect(text).toContain("Time (-2 → 2):")
    expect(text).toContain("1: -2\n2: 0\n3: 2")
    expect(text).toContain("bar 1: [-5.25, 0, 4.5]")
    expect(text).toContain("line 2: [-2, 0, 9]")
    expect(text).toContain("█")
    expect(text).toContain("●")
  })

  test("plots increasing numeric values upward and retains a zero bar as zero", () => {
    const rows = render("xychart-beta\ny-axis -10 --> 10\nline [-10, 0, 10]").text.split("\n")
    const points = rows.flatMap((row, y) => [...row].flatMap((char, x) => char === "●" ? [{ x, y }] : []))
    expect(points).toHaveLength(3)
    const ordered = points.sort((a, b) => a.x - b.x)
    expect(ordered[0].y).toBeGreaterThan(ordered[1].y)
    expect(ordered[1].y).toBeGreaterThan(ordered[2].y)
    expect(render("xychart-beta\nbar [0]").text).not.toContain("█")
  })

  test("keeps grouped bars equally wide at the chart edges", () => {
    const { result } = render("xychart-beta\nbar [10,10,10]\nbar [10,10,10]", { seriesColors: ["#ff0000", "#00ff00"] })
    const bars = result.text.chunks.filter((chunk) => /^█+$/.test(chunk.text))
    const red = bars.filter((chunk) => chunk.fg?.equals(RGBA.fromHex("#ff0000")))
    const green = bars.filter((chunk) => chunk.fg?.equals(RGBA.fromHex("#00ff00")))
    expect(red.length).toBeGreaterThan(0)
    expect(red.map((chunk) => chunk.text.length)).toEqual(green.map((chunk) => chunk.text.length))
    expect(new Set(bars.map((chunk) => chunk.text.length)).size).toBe(1)
  })

  test("rejects mismatched lengths and out-of-range data instead of clipping", () => {
    expect(error("xychart-beta\nx-axis [A, B]\nline [1]").lineNumber).toBe(2)
    expect(error("xychart-beta\nline [1, 2]\nbar [1]").lineNumber).toBe(3)
    expect(error("xychart-beta\ny-axis 0 --> 2\nline [-1]").message).toContain("outside")
    expect(error("xychart-beta\ny-axis [a,b]\nline [1]").message).toContain("numeric")
    expect(error("xychart-beta horizontal\nline [1]").message).toContain("Horizontal")
    expect(error("xychart-beta\nx-axis 2 --> 1\nline [1]").message).toContain("minimum")
  })
})

describe("native pie charts", () => {
  test("draws a proportional pie and exact values for the sample", () => {
    const { text } = render(samples.pie)
    expect(text).toContain("Test results")
    expect(text).toContain("1 Passed: 70 (70%)")
    expect(text).toContain("2 Failed: 30 (30%)")
    const plot = text.slice(text.indexOf("\n") + 1, text.indexOf("Total:"))
    const a = [...plot].filter((char) => char === "1").length
    const b = [...plot].filter((char) => char === "2").length
    expect(a / (a + b)).toBeCloseTo(0.7, 1)
  })

  test("parses showData, quoted punctuation and zero slices without losing data", () => {
    const { text } = render('%% comment\npie showData\ntitle "Results: 100%%"\n"A: B, C" : 2.5 %% annotation\n"Empty": 0\n"D": 7.5')
    expect(text).toContain("Results: 100%%")
    expect(text).toContain("A: B, C: 2.5 (25%)")
    expect(text).toContain("Empty: 0 (0%)")
    expect(text).toContain("D: 7.5 (75%)")
  })

  test("rejects negative slices, duplicate labels and zero totals", () => {
    expect(error('pie\n"A": -1').lineNumber).toBe(2)
    expect(error('pie\n"A": 1\n"A": 2').message).toContain("Duplicate")
    expect(error('pie\n"A": 0').message).toContain("positive total")
  })
})

describe("native quadrant charts", () => {
  test("plots the sample in the correct quadrants and retains all labels", () => {
    const { text } = render(samples.quadrant)
    for (const label of ["Task priority", "Low effort", "High effort", "Low impact", "High impact", "Q1: Plan", "Q2: Do now", "Q3: Later", "Q4: Reconsider"]) expect(text).toContain(label)
    expect(text).toContain("1 Fix: [0.2, 0.8] Q2")
    expect(text).toContain("2 Rewrite: [0.8, 0.6] Q1")
    const rows = text.split("\n")
    const topLeft = rows.findIndex((row) => row.includes("1") && row.includes("│") && !row.includes("Q1"))
    const topRight = rows.findIndex((row) => row.includes("2") && row.includes("│") && !row.includes("Q2"))
    expect(topLeft).toBeGreaterThan(1)
    expect(topLeft).toBeLessThan(topRight)
    expect(rows[topLeft].indexOf("1")).toBeLessThan(36)
    expect(rows[topRight].indexOf("2")).toBeGreaterThan(36)
  })

  test("preserves coincident points and boundary values", () => {
    const { text } = render('quadrantChart\n"same: one": [0.5, 0.5]\n"same: two": [0.5, 0.5]\nOrigin: [0,0]\nEnd: [1,1]')
    expect(text).toContain("◆")
    expect(text).toContain("same: one: [0.5, 0.5] Q1")
    expect(text).toContain("same: two: [0.5, 0.5] Q1")
    expect(text).toContain("Origin: [0, 0] Q3")
    expect(text).toContain("End: [1, 1] Q1")
    expect(error("quadrantChart\nOutside: [1.01, 0]").lineNumber).toBe(2)
    expect(error("quadrantChart\nPoint: [0.1,0.2,0.3]").lineNumber).toBe(2)
  })
})

describe("native Sankey charts", () => {
  test("retains sample topology, exact quantities and proportional flow lengths", () => {
    const { text } = render(samples.sankey)
    expect(text).toContain("[1] Source → [2] Process: 100")
    expect(text).toContain("[2] Process → [3] Success: 80")
    expect(text).toContain("[2] Process → [4] Failure: 20")
    const ribbons = text.split("\n").filter((line) => /^━+▶$/.test(line))
    expect(ribbons.map((line) => line.length - 1)).toEqual([40, 32, 8])
    expect(text.slice(0, text.indexOf("[1] Source"))).toContain("▶[2]")
  })

  test("handles quoted CSV, converging paths, duplicate flows and disconnected components", () => {
    const { text } = render('sankey-beta\n"A, one","B ""quoted""",2.5\nC,"B ""quoted""",1.5\n"A, one","B ""quoted""",1\nD,E,"4"')
    expect(text).toContain('[1] A, one → [2] B "quoted": 2.5')
    expect(text).toContain('[3] C → [2] B "quoted": 1.5')
    expect(text).toContain('[1] A, one → [2] B "quoted": 1')
    expect(text).toContain("[4] D → [5] E: 4")
  })

  test("rejects cycles, self-loops, invalid CSV and nonpositive weights", () => {
    expect(error("sankey-beta\nA,B,1\nB,A,1").message).toContain("Cyclic")
    expect(error("sankey-beta\nA,A,1").message).toContain("self-loops")
    for (const row of ["A,B,0", "A,B,-1", "A,B,1,extra", '"A,B,2', "A,B,NaN", "A,,1"]) expect(error(`sankey-beta\n${row}`).lineNumber).toBe(2)
  })
})

describe("chart parser boundaries", () => {
  test("returns undefined only for other headers", () => {
    for (const source of ["flowchart LR\nA-->B", "sequenceDiagram", "", "%% comment"]) expect(renderCharts(source, options)).toBeUndefined()
    for (const source of ["xychart-beta extra", "pie extra", "quadrantChart extra", "sankey-beta extra"]) expect(error(source).lineNumber).toBe(1)
  })

  test("reports source locations and rejects every unsupported meaningful statement", () => {
    for (const [header, statement] of [["xychart-beta", "style line red"], ["pie", "garbage"], ["quadrantChart", "classDef point red"], ["sankey-beta", "title Flow"]]) {
      const problem = error(`%% leading\n${header}\n\n  ${statement} %% note`)
      expect(problem.lineNumber).toBe(4)
      expect(problem.sourceLine).toBe(`${statement} %% note`)
    }
    expect(error('%%{init: {}}%%\npie\n"A": 1').lineNumber).toBe(1)
  })

  test("validates finite numbers without coercion or underflow", () => {
    for (const value of ["NaN", "Infinity", "1e309", "1e-400", "0x10", "", "1foo", "1e101", "9007199254740993", "0.1000000000000000001"]) {
      expect(error(`xychart-beta\nline [${value}]`).lineNumber).toBe(2)
    }
    expect(render("xychart-beta\nline [-.5, +2.5e1]").text).toContain("[-0.5, 25]")
    expect(render("xychart-beta\nline [0001.000, -0.0, 1e100]").text).toContain("[1, 0, 1e+100]")
  })

  test("wraps narrow output while retaining labels and values", () => {
    for (const width of [1, 4, 8, 17, 24, 40]) {
      for (const source of Object.values(samples)) {
        const { text } = render(source, { width })
        expect(text.length).toBeGreaterThan(20)
      }
    }
    const source = 'xychart-beta\nx-axis ["東京", "👩‍💻, café", "é"]\nline [1,2,3]'
    const text = render(source, { width: 8 }).text.replaceAll("\n", "")
    for (const name of ["東京", "👩‍💻, café", "é"]) expect(text).toContain(name)
    expect(() => renderCharts(source, { ...options, width: 1 })).toThrow("grapheme")
  })

  test("preserves escaped quotes and literal comment markers", () => {
    const { text } = render('xychart-beta\ntitle "say \\"hi\\""\nx-axis ["a,b", "100%%", "arrow -->"]\nline [1, 2, 3] %% values')
    expect(text).toContain('say "hi"')
    expect(text).toContain("1: a,b")
    expect(text).toContain("2: 100%%")
    expect(text).toContain("3: arrow -->")
  })

  test("enforces source, label, data and output resource bounds", () => {
    expect(error(`pie\n"${"a".repeat(257)}":1`).message).toContain("256")
    expect(error(`xychart-beta\nline [${Array(257).fill(1).join(",")}]`).message).toContain("256")
    expect(error(`xychart-beta\n${Array(17).fill("line [1]").join("\n")}`).message).toContain("16 series")
    expect(error(`pie\n${"\n".repeat(1024)}`).message).toContain("source exceeds")
    expect(error(`pie\n"a":1\n%% ${"a".repeat(100000)}`).message).toContain("source exceeds")
    expect(error(`sankey-beta\n${Array.from({ length: 64 }, (_, i) => `N${i},N${i + 1},1`).join("\n")}`).message).toContain("64 Sankey nodes")
    expect(() => renderCharts(samples.pie, { ...options, width: 0 })).toThrow(MermaidSyntaxError)
    expect(() => renderCharts(samples.pie, { ...options, width: Infinity })).toThrow(MermaidSyntaxError)
    const large = `quadrantChart\n${Array.from({ length: 61 }, (_, i) => `${i}${"a".repeat(250)}: [0,0]`).join("\n")}`
    expect(() => renderCharts(large, { ...options, width: 1 })).toThrow("output size limit")
  })
})

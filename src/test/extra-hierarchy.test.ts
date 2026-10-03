import { describe, expect, test } from "bun:test"
import stringWidth from "string-width"
import { RGBA } from "@opentui/core"
import { MermaidSyntaxError, type MermaidDiagramKind } from "../diagnostics.js"
import { renderHierarchy } from "../extra/hierarchy.js"

function render(source: string, width = 80) {
  const result = renderHierarchy(source, { width, colors: {} })!
  const text = result.text.chunks.map((chunk) => chunk.text).join("")
  expect(result.height).toBe(text.split("\n").length)
  for (const line of text.split("\n")) expect(stringWidth(line)).toBeLessThanOrEqual(width)
  return text
}

function invalid(source: string, kind: MermaidDiagramKind, number: number, reason?: string) {
  try {
    render(source)
    throw new Error("Expected syntax error")
  } catch (error) {
    expect(error).toBeInstanceOf(MermaidSyntaxError)
    if (!(error instanceof MermaidSyntaxError)) throw error
    expect(error.kind).toBe(kind)
    expect(error.lineNumber).toBe(number)
    expect(error.sourceLine).toBe(source.split("\n")[number - 1]!.trim())
    if (reason) expect(error.message).toContain(reason)
  }
}

describe("native hierarchy diagrams", () => {
  test("only declines unrelated diagram families", () => {
    expect(renderHierarchy("flowchart LR\nA --> B", { width: 80, colors: {} })).toBeUndefined()
    for (const kind of ["mindmap", "journey", "kanban"] as const) invalid(kind, kind, 1)
    invalid("mindmap LR\nroot", "mindmap", 1)
  })

  test("mindmap branches preserve parents and sibling order", () => {
    expect(render(`mindmap
 root((Project))
  Frontend
   UI
  Backend
   API`)).toBe("Project\n├─ Frontend\n│  └─ UI\n└─ Backend\n   └─ API")
  })

  test("mindmap supports shapes, quoted delimiters, comments and labels", () => {
    const text = render(`%% comment
mindmap
 root(("Project &amp; team"))
  a["Array [index]"]
  b(Rounded)
  c{{Hexagon}}
  d))Bang((
  e)Cloud(
  %% another comment
  "Unicode café 👩🏽‍💻"`)
    for (const label of ["Project & team", "Array [index]", "Rounded", "Hexagon", "Bang", "Cloud", "Unicode café 👩🏽‍💻"]) expect(text).toContain(label)
  })

  test("narrow mindmaps retain explicit parent paths and all Unicode graphemes", () => {
    const text = render("mindmap\n root\n  界面👩🏽‍💻\n   子节点\n  end", 8)
    const compact = text.replace(/\s/g, "")
    expect(compact).toBe("1root1.1界面👩🏽‍💻1.1.1子节点1.2end")
    expect(render("mindmap\n ab", 1)).toBe("1\n \na\nb")
  })

  test("mindmaps reject multiple roots, incomplete shapes and unsupported annotations", () => {
    invalid("mindmap\n root\n sibling", "mindmap", 3, "one root")
    invalid("mindmap\n root((bad)", "mindmap", 2, "Unclosed")
    invalid("mindmap\n root\n  ::icon(fa fa-book)", "mindmap", 3, "annotations")
    invalid("mindmap\n root[Hello] trailing", "mindmap", 2)
  })

  test("journeys retain sections, task order, actors and scores including zero", () => {
    const text = render(`journey
 title Checkout
 section Purchase
  Browse: 5: Customer
  Pay: 3: Customer, Bank
 section Delivery
  Receive: 0: Customer`)
    for (const value of ["Checkout", "Purchase", "Delivery", "1. Browse", "2. Pay", "3. Receive", "●●●●● 5/5", "●●●○○ 3/5", "○○○○○ 0/5", "Actor: Bank"]) expect(text).toContain(value)
    expect(text.match(/Actor: Customer/g)).toHaveLength(3)
    expect(text.indexOf("2. Pay")).toBeLessThan(text.indexOf("Delivery"))
  })

  test("journeys accept quoted delimiters and wrap long labels without truncation", () => {
    const text = render('journey\n "Pay: card": 4: "Customer, Inc.", Bank\n AReallyLongTaskLabel: 1', 12).replace(/\s/g, "")
    for (const value of ["Pay:card", "4/5", "Customer,Inc.", "Bank", "AReallyLongTaskLabel", "1/5"]) expect(text).toContain(value)
  })

  test("apostrophes in natural labels and quoted shapes remain text", () => {
    expect(render('mindmap\n "Plan (draft)"\n  a[Customer\'s account]')).toContain("Customer's account")
    expect(render("journey\n Read customer's order: 3: O'Reilly")).toContain("O'Reilly")
    expect(render("kanban\n todo@{ owner: 'Alice' }\n  a[Customer's account]")).toContain("owner: Alice")
    expect(render('journey\n Pay: 3: Alice, "Bank: QA, Inc."')).toContain("Actor: Bank: QA, Inc.")
    expect(render('kanban\n todo@{ owner: \'Team [A]\', note: \'"quoted"\' }')).toContain('note: "quoted"')
  })

  test("journeys reject invalid scores, malformed actors and unknown statements", () => {
    for (const task of ["Pay: 6: Customer", "Pay: -1: Customer", "Pay: 3.5: Customer", "Pay: 3: Customer,", "Pay: 3: Customer: lost", "section", "unknown"]) {
      invalid(`journey\n ${task}`, "journey", 2)
    }
    invalid("journey\n title A\n title B", "journey", 3, "Duplicate")
  })

  test("kanban board retains column ownership, task IDs, labels and metadata", () => {
    const text = render(`kanban
 todo[Todo]
  task1[Build chart]@{ assigned: 'Alice', ticket: 'OPS-123', priority: 'High', estimate: 3 }
 done[Done]
  task2[Test flowchart]
  @{ custom: 'Preserve this' }`)
    for (const value of ["Todo [todo]", "Done [done]", "Build chart [task1]", "Test flowchart [task2]", "assigned: Alice", "ticket: OPS-123", "priority: High", "estimate: 3", "custom: Preserve this"]) expect(text).toContain(value)
    const header = text.split("\n").find((line) => line.includes("Todo [todo]"))!
    expect(header).toContain("Done [done]")
    const tasks = text.split("\n").find((line) => line.includes("Build chart"))!
    expect(tasks.indexOf("Build chart")).toBeLessThan(tasks.indexOf("Test flowchart"))
  })

  test("kanban stacks narrow boards and preserves long Unicode labels", () => {
    const text = render("kanban\n todo[待办]\n  a[构建👩🏽‍💻长标题]\n done[完成]\n  b[验证]", 5).replace(/\s/g, "")
    for (const value of ["待办[todo]", "构建👩🏽‍💻长标题[a]", "完成[done]", "验证[b]"]) expect(text).toContain(value)
    expect(text.indexOf("构建")).toBeLessThan(text.indexOf("完成"))
    const invisible = render("kanban\n todo\n  a[A\u200bB\u200bC]", 12)
    expect(invisible).toContain("A\u200bB\u200bC")
    expect(invisible.match(/\u200b/g)).toHaveLength(2)
  })

  test("kanban rejects nested tasks, duplicate IDs and malformed metadata", () => {
    invalid("kanban\n todo[Todo]\n  a[A]\n   b[B]", "kanban", 4, "nested")
    invalid("kanban\n todo[Todo]\n  todo[Task]", "kanban", 3, "Duplicate")
    for (const suffix of ["garbage", "@{ priority: [High] }", "@{ assigned: Alice, assigned: Bob }", "@{ ticket: }", "@{ invalid", "@{}", "@{ x: &a hello, y: *a }"]) {
      invalid(`kanban\n todo[Todo]\n  a[A]${suffix}`, "kanban", 3)
    }
  })

  test("bounded rendering rejects excessive input and impossible Unicode widths", () => {
    invalid(`mindmap\n ${"x".repeat(8_193)}`, "mindmap", 2, "too long")
    expect(() => render("mindmap\n 界", 1)).toThrow("too narrow")
    expect(() => renderHierarchy("mindmap\n root", { width: Infinity, colors: {} })).toThrow(RangeError)
    expect(() => render("mindmap\n root\n" + Array.from({ length: 130 }, (_, index) => `${" ".repeat(index + 2)}child`).join("\n"))).toThrow("128")
    expect(() => render("mindmap\n root\n" + "  child\n".repeat(1_100), 240)).toThrow("cell limit")
    invalid("%%{init: {}}%%\nmindmap\n root", "mindmap", 1, "configuration")
  })

  test("series and board palette colors reach rendered text", () => {
    const red = RGBA.fromInts(255, 0, 0)
    const tree = renderHierarchy("mindmap\n root\n  child", { width: 80, colors: {}, seriesColors: ["#ff0000"] })!
    expect(tree.text.chunks.find((chunk) => chunk.text.includes("child"))?.fg?.equals(red)).toBe(true)
    const board = renderHierarchy("kanban\n todo[Todo]\n  a[Task]", { width: 80, colors: { groupText: red } })!
    expect(board.text.chunks.find((chunk) => chunk.text.includes("Todo"))?.fg?.equals(red)).toBe(true)
  })
})

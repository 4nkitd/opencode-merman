import { describe, expect, test } from "bun:test"
import { diagramTextWidth } from "../core/text.js"
import { MermaidSyntaxError } from "../diagnostics.js"
import { renderStructure } from "../extra/structure.js"

const blockSample = `block-beta
 columns 3
 A["Input"] B["Process"] C["Output"]
 A --> B
 B --> C`
const packetSample = `packet-beta
 0-7: "Header"
 8-15: "Flags"
 16-31: "Payload"`
const architectureSample = `architecture-beta
 service api(server)[API]
 service db(database)[Database]
 api:R -- L:db`

function render(source: string, width = 80): string {
  const result = renderStructure(source, { width, colors: {} })
  expect(result).toBeDefined()
  const text = result!.text.chunks.map((chunk) => chunk.text).join("")
  expect(result!.height).toBe(text ? text.split("\n").length : 0)
  for (const line of text.split("\n")) expect(diagramTextWidth(line)).toBeLessThanOrEqual(width)
  return text
}

function syntax(source: string, kind: "block" | "packet" | "architecture", lineNumber: number, reason?: string): void {
  try {
    renderStructure(source, { width: 80, colors: {} })
    throw new Error("Expected a syntax diagnostic")
  } catch (error) {
    expect(error).toBeInstanceOf(MermaidSyntaxError)
    if (!(error instanceof MermaidSyntaxError)) throw error
    expect(error.kind).toBe(kind)
    expect(error.lineNumber).toBe(lineNumber)
    expect(error.sourceLine).toBe(source.split("\n")[lineNumber - 1]!.trim())
    if (reason) expect(error.message).toContain(reason)
  }
}

describe("native structure diagrams", () => {
  test("only declines unrelated headers", () => {
    for (const source of ["", "%% comment", "flowchart LR\n A --> B", "pie\n\"A\": 1"]) {
      expect(renderStructure(source, { width: 80, colors: {} })).toBeUndefined()
    }
    for (const kind of ["block", "packet", "architecture"] as const) {
      expect(render(`${kind}-beta`)).toBe("")
      syntax(`${kind}-beta nonsense`, kind, 1)
      syntax(`${kind}-beta\nnonsense !!!`, kind, 2)
    }
  })

  test("renders the exact block sample with ordered columns and two arrowheads", () => {
    const text = render(blockSample)
    expect(text).toBe(`

  ┌───────┐   ┌───────┐   ┌───────┐
  │ Input │──▶│Process│──▶│Output │
  └───────┘   └───────┘   └───────┘


Edges
1. A ["Input"] → B ["Process"]
2. B ["Process"] → C ["Output"]`)
  })

  test("block spans and spaces occupy declared columns across rows", () => {
    const text = render(`block-beta
columns 3
A[Wide]:2 space
B[Left] C[Middle] D[Right]
A --> C`)
    const lines = text.split("\n")
    const upper = lines.findIndex((line) => line.includes("Wide"))
    const lower = lines.findIndex((line) => line.includes("Left"))
    expect(upper).toBeLessThan(lower)
    expect(lines[lower]!.indexOf("Left")).toBeLessThan(lines[lower]!.indexOf("Middle"))
    expect(lines[lower]!.indexOf("Middle")).toBeLessThan(lines[lower]!.indexOf("Right"))
    expect(text).toContain("▼")
    expect(lines[upper - 1]!.match(/─/g)!.length).toBeGreaterThan(12)
  })

  test("block connections retain bidirectionality, reverse edges, and labels", () => {
    const text = render(`block-beta
columns 2
A(Alpha) B[Beta]
A <--> B
B -- "reply 😀" --> A`)
    expect(text).toContain("╭")
    expect(text).toContain("▶")
    expect(text).toContain("◀")
    expect(text).toContain('B ["Beta"] → A ["Alpha"]: "reply 😀"')
    expect(render('block-beta\nA B\nA -->|next| B')).toContain('A → B: "next"')
    expect(render("block-beta\nfirst-node last-node\nfirst-node---last-node")).toContain("│───│")
    expect(render("block-beta\nA B\nA-->B")).toContain("▶")
  })

  test("block edge ledgers distinguish crossing independent edges from a complete bipartite graph", () => {
    const declarations = "block-beta\ncolumns 2\nA B C D\n"
    const independent = render(declarations + "A --> D\nB --> C", 60)
    const complete = render(declarations + "A --> C\nA --> D\nB --> C\nB --> D", 60)
    expect(independent).not.toBe(complete)
    expect(independent.split("Edges\n")[1]).toBe("1. A → D\n2. B → C")
    expect(complete.split("Edges\n")[1]).toBe("1. A → C\n2. A → D\n3. B → C\n4. B → D")
  })

  test("block ledgers bind swapped node IDs to their displayed labels", () => {
    const edges = "\na --> c\na --> d\nb --> c"
    const original = render("block-beta\ncolumns 2\na[Alpha] b[Beta] c[Gamma] d[Delta]" + edges, 60)
    const swapped = render("block-beta\ncolumns 2\nb[Alpha] a[Beta] c[Gamma] d[Delta]" + edges, 60)
    expect(original).not.toBe(swapped)
    expect(original.split("Edges\n")[1]).toBe('1. a ["Alpha"] → c ["Gamma"]\n2. a ["Alpha"] → d ["Delta"]\n3. b ["Beta"] → c ["Gamma"]')
    expect(swapped.split("Edges\n")[1]).toBe('1. a ["Beta"] → c ["Gamma"]\n2. a ["Beta"] → d ["Delta"]\n3. b ["Alpha"] → c ["Gamma"]')
  })

  test("block Unicode labels wrap without splitting wide graphemes or losing columns", () => {
    const text = render('block-beta\ncolumns 3\nA["界面"] B["👩‍💻"] C["é"]\nA --> B\nB --> C', 20)
    expect(text).toContain("界")
    expect(text).toContain("面")
    expect(text).toContain("👩‍💻")
    expect(text).toContain("é")
    expect((text.match(/▶/g) ?? []).length).toBe(2)
    render(blockSample, 20)
  })

  test("does not silently accept unsupported block declarations or partial syntax", () => {
    for (const line of ['A((Circle))', 'block:group', 'style A fill:red', 'A[Open', 'A:::class', 'A --> B trailing', 'A; B']) {
      syntax(`block-beta\n${line}`, "block", 2)
    }
    syntax("block-beta\ncolumns 0", "block", 2)
    syntax("block-beta\ncolumns 2\nA:3", "block", 3, "span exceeds")
    syntax("block-beta\nA\nA", "block", 3, "Duplicate")
    syntax("block-beta\nA\nA --> B", "block", 3, "undeclared")
  })

  test("renders the exact packet sample at proportional field widths", () => {
    const text = render(packetSample)
    expect(text).toBe(`bits 0-31
┌───────────────┬───────────────┬───────────────────────────────┐
│    Header     │     Flags     │            Payload            │
└───────────────┴───────────────┴───────────────────────────────┘

1. [0-7] Header
2. [8-15] Flags
3. [16-31] Payload`)
    const border = text.split("\n")[1]!
    expect(border.indexOf("┬")).toBe(16)
    expect(border.lastIndexOf("┬")).toBe(32)
    expect(border.indexOf("┐")).toBe(64)
  })

  test("packet rows retain absolute positions when fields cross row boundaries", () => {
    const text = render('packet-beta\n0-3: "Prefix"\n4-39: "Body"\n+8: "Suffix"')
    expect(text).toContain("bits 0-31")
    expect(text).toContain("bits 32-47")
    expect(text).toContain("[4-39] Body")
    expect(text).toContain("[40-47] Suffix")
    expect(text.split("\n").filter((line) => line.startsWith("│") && line.includes("Body"))).toHaveLength(2)
  })

  test("single-bit fields, gaps, Unicode labels and narrow packets preserve every field", () => {
    const text = render('packet-beta\n2: "標識😀"\n4-7: "Data"', 17)
    expect(text).toContain("bits 0-7")
    expect(text).toContain("·")
    expect(text).toContain("[2-2]")
    expect(text).toContain("標識😀")
    expect(text).toContain("[4-7] Data")
    render(packetSample, 9)
  })

  test("packet rejects overlapping, reversed, oversized and malformed fields", () => {
    for (const line of ['8-7: "Wrong"', '0-4096: "Huge"', '+0: "Empty"', '0-7: unquoted', '0-7: "Fine" extra', 'bitsPerRow 16']) {
      syntax(`packet-beta\n${line}`, "packet", 2)
    }
    syntax('packet-beta\n0-7: "One"\n7-8: "Two"', "packet", 3, "non-overlapping")
  })

  test("renders the exact architecture sample as a right-to-left port connection", () => {
    const text = render(architectureSample)
    expect(text).toBe(`

  ┌──────────┐     ┌──────────┐
  │   API    │     │ Database │
  │ (server) │─────│(database)│
  └──────────┘     └──────────┘


Edges
1. api:R ["API\\n(server)"] ─ db:L ["Database\\n(database)"]`)
    expect(text).not.toMatch(/[▶◀▲▼]/)
  })

  test("architecture edge ledgers preserve every endpoint, port, and direction", () => {
    const declarations = "architecture-beta\nservice A\nservice B\nservice C\nservice D\n"
    const independent = render(declarations + "A:B --> T:D\nB:B --> T:C", 60)
    const complete = render(declarations + "A:B --> T:C\nA:B --> T:D\nB:B --> T:C\nB:B --> T:D", 60)
    expect(independent).not.toBe(complete)
    expect(independent.split("Edges\n")[1]).toBe("1. A:B → D:T\n2. B:B → C:T")
    expect(complete.split("Edges\n")[1]).toBe("1. A:B → C:T\n2. A:B → D:T\n3. B:B → C:T\n4. B:B → D:T")
    const directions = render("architecture-beta\nservice a\nservice b\na:R -- L:b\na:T <-- B:b\na:B <--> T:b")
    expect(directions.split("Edges\n")[1]).toBe("1. a:R ─ b:L\n2. a:T ← b:B\n3. a:B ↔ b:T")
  })

  test("architecture ledgers bind swapped service IDs to their displayed labels and ports", () => {
    const edges = "\nservice c[Gamma]\nservice d[Delta]\na:B --> T:c\na:B --> T:d\nb:B --> T:c"
    const original = render("architecture-beta\nservice a[Alpha]\nservice b[Beta]" + edges, 60)
    const swapped = render("architecture-beta\nservice b[Alpha]\nservice a[Beta]" + edges, 60)
    expect(original).not.toBe(swapped)
    expect(original.split("Edges\n")[1]).toBe('1. a:B ["Alpha"] → c:T ["Gamma"]\n2. a:B ["Alpha"] → d:T ["Delta"]\n3. b:B ["Beta"] → c:T ["Gamma"]')
    expect(swapped.split("Edges\n")[1]).toBe('1. a:B ["Beta"] → c:T ["Gamma"]\n2. a:B ["Beta"] → d:T ["Delta"]\n3. b:B ["Alpha"] → c:T ["Gamma"]')
  })

  test("narrow ledgers retain long endpoint identities and separate duplicate connections", () => {
    const text = render('block-beta\ncolumns 1\nlong_source_id[A]\nlong_target_id[B]\nlong_source_id -->|first| long_target_id\nlong_source_id -->|second| long_target_id', 12)
    const ledger = text.split("Edges\n")[1]!.replace(/\n  /g, "")
    expect(ledger).toBe('1. long_source_id ["A"] → long_target_id ["B"]: "first"\n2. long_source_id ["A"] → long_target_id ["B"]: "second"')
  })

  test("narrow ledgers retain Unicode labels and escape line breaks, quotes, and edge controls", () => {
    for (const kind of ["block", "architecture"] as const) {
      const label = '界面\n"API"<br>Ready'
      const source = kind === "block"
        ? `block-beta\ncolumns 1\na[${JSON.stringify(label)}]\nb[Target]\na --> b`
        : `architecture-beta\nservice a[${JSON.stringify(label)}]\nservice b[Target]\na:B --> T:b`
      const text = render(source, 12)
      const ledger = text.split("Edges\n")[1]!.replace(/\n  /g, "")
      const from = kind === "block" ? "a" : "a:B"
      const to = kind === "block" ? "b" : "b:T"
      expect(ledger).toBe(`1. ${from} ["界面\\n\\"API\\"\\nReady"] → ${to} ["Target"]`)
      for (const control of ["\t", "\r", "\u001b"]) {
        const invalid = kind === "block" ? `block-beta\na[${JSON.stringify(control)}]` : `architecture-beta\nservice a[${JSON.stringify(control)}]`
        syntax(invalid, kind, 2, "Control characters")
      }
    }
    const edgeLabel = 'reply\n"quoted"\t\u001b<br>done'
    const text = render(`block-beta\nA B\nA -- ${JSON.stringify(edgeLabel)} --> B`, 18)
    const ledger = text.split("Edges\n")[1]!.replace(/\n  /g, "")
    expect(ledger).toBe('1. A → B: "reply\\n\\"quoted\\"\\t\\u001b\\ndone"')
    expect(text).not.toMatch(/[\t\r\u001b]/)
  })

  test("architecture keeps vertical port directions and incoming arrowheads", () => {
    const text = render(`architecture-beta
service top(server)[Top]
service bottom(database)[Bottom]
top:B --> T:bottom`)
    expect(text.indexOf("Top")).toBeLessThan(text.indexOf("Bottom"))
    expect(text).toContain("▼")
    const reverse = render(`architecture-beta
service top[Top]
service bottom[Bottom]
top:T <-- B:bottom`)
    expect(reverse.indexOf("Bottom")).toBeLessThan(reverse.indexOf("Top"))
    expect(reverse).toContain("▼")
  })

  test("architecture routes different, equal, and opposing port pairs", () => {
    const heads: Record<string, string> = { L: "▶", R: "◀", T: "▼", B: "▲" }
    for (const from of ["L", "R", "T", "B"]) {
      for (const to of ["L", "R", "T", "B"]) {
        const text = render(`architecture-beta\nservice a[Alpha]\nservice b[Beta]\na:${from} <--> ${to}:b`)
        expect((text.match(/[▶◀▲▼]/g) ?? []).length).toBe(2)
        const rows = text.split("\n")
        for (const [label, port] of [["Alpha", from], ["Beta", to]]) {
          const y = rows.findIndex((row) => row.includes(label!))
          const labelX = rows[y]!.indexOf(label!)
          const left = rows[y]!.lastIndexOf("│", labelX)
          const right = rows[y]!.indexOf("│", labelX)
          const x = port === "L" ? left - 1 : port === "R" ? right + 1 : left + Math.floor((right - left + 1) / 2)
          const arrowY = port === "T" ? y - 2 : port === "B" ? y + 2 : y
          expect(rows[arrowY]![x]).toBe(heads[port!]!)
        }
      }
    }
  })

  test("architecture supports junctions, disconnected services, and quoted Unicode labels", () => {
    const text = render(`architecture-beta
service api(server)["界面 [API]"]
junction hub
service db(database)
service cache[Cache]
api:R -- L:hub
hub:B --> T:db`, 40)
    expect(text).toContain("界面 [API]")
    expect(text).toContain("hub")
    expect(text).toContain("db")
    expect(text).toContain("Cache")
    expect(text).toContain("▼")
  })

  test("architecture rejects unimplemented groups and malformed connections", () => {
    for (const line of ['group cloud(cloud)[Cloud]', 'service api(server)[API] in cloud', 'api:X -- L:db', 'api:R -- L:db trailing']) {
      syntax(`architecture-beta\n${line}`, "architecture", 2)
    }
    syntax("architecture-beta\nservice a[A]\na:R -- L:b", "architecture", 3, "undeclared")
    syntax("architecture-beta\nservice a[A]\nservice a[B]", "architecture", 3, "Duplicate")
    syntax("architecture-beta\nservice a[A]\na:R -- R:a", "architecture", 3, "distinct ports")
    expect(render("architecture-beta\nservice a[A]\na:R --> L:a")).toContain("▶")
  })

  test("comments preserve diagnostic line numbers and quoted percent signs", () => {
    expect(render('%% before\n\nblock-beta\nA["100%% done"] %% after')).toContain("100%% done")
    syntax("%% before\n\npacket-beta\n%% comment\nwrong", "packet", 5)
  })

  test("resource limits and impossible terminal widths give structured diagnostics", () => {
    for (const source of [blockSample, packetSample, architectureSample]) {
      expect(() => renderStructure(source, { width: 1, colors: {} })).toThrow(MermaidSyntaxError)
      expect(() => renderStructure(source, { width: Infinity, colors: {} })).toThrow(MermaidSyntaxError)
    }
    syntax(`block-beta\n${"a".repeat(4097)}`, "block", 2, "too long")
    const nodes = Array.from({ length: 129 }, (_, index) => `service n${index}[${index}]`).join("\n")
    syntax(`architecture-beta\n${nodes}`, "architecture", 1, "128 nodes")
    expect(() => renderStructure(`packet-beta\n0-4095: "${"x".repeat(3000)}"`, { width: 9, colors: {} })).not.toThrow()
  })

  test("uses caller series colors for native borders", () => {
    const result = renderStructure(blockSample, { width: 80, colors: {}, seriesColors: ["#ff0000"] })!
    const border = result.text.chunks.find((chunk) => chunk.text.includes("┌"))!
    expect(border.fg?.r).toBe(1)
    expect(border.fg?.g).toBe(0)
    expect(border.fg?.b).toBe(0)
  })
})

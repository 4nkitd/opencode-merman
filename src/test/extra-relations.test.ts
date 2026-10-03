import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { diagramTextWidth } from "../core/text.js"
import { MermaidSyntaxError } from "../diagnostics.js"
import { renderRelations } from "../extra/relations.js"
import type { ExtraOptions } from "../extra/shared.js"
import { expectDiagram } from "./diagram.js"

const options: ExtraOptions = { width: 80, colors: { text: "#eeeeee", boxBorder: "#777777", line: "#888888", marker: "#00ff00" }, seriesColors: ["#ff0000", "#0000ff"] }
const classSample = `classDiagram
 class Animal {
 +String name
 +speak()
 }
 class Dog
 Animal <|-- Dog`
const erSample = `erDiagram
 CUSTOMER ||--o{ ORDER : places
 CUSTOMER {
 int id PK
 string name
 }
 ORDER {
 int id PK
 int customer_id FK
 }`
const requirementSample = `requirementDiagram
 requirement rendering {
 id: 1
 text: Display a diagram
 risk: low
 verifymethod: test
 }
 element client {
 type: application
 }
 client - satisfies -> rendering`

function render(source: string, width = 80): string {
  const result = renderRelations(source, { ...options, width })!
  const output = result.text.chunks.map((chunk) => chunk.text).join("")
  expect(result.height).toBe(output.split("\n").length)
  for (const line of output.split("\n")) expect(diagramTextWidth(line)).toBeLessThanOrEqual(width)
  return output.split("\n").map((line) => line.trimEnd()).join("\n")
}

describe("native relation diagrams", () => {
  test("class sample preserves members and inheritance in connected boxes", () => {
    expectDiagram(render(classSample)).toEqualDiagram(`
      ┌──────────────┐
      │    Animal    │
      │ +String name │
      │   +speak()   │
      └──────┬───────┘
             │
             │ Animal <|-- Dog
             │
          ┌─────┐
          │ Dog │
          └─────┘
    `)
  })

  test("ER sample preserves both cardinalities, relation label, attributes and keys", () => {
    expectDiagram(render(erSample)).toEqualDiagram(`
         ┌─────────────┐
         │  CUSTOMER   │
         │  int id PK  │
         │ string name │
         └───────┬─────┘
                 │
                 │ CUSTOMER ||--o{ ORDER : places
                 │
      ┌────────────────────┐
      │       ORDER        │
      │     int id PK      │
      │ int customer_id FK │
      └────────────────────┘
    `)
  })

  test("requirement sample connects an element to the requirement", () => {
    expectDiagram(render(requirementSample)).toEqualDiagram(`
         ┌───────────────────┐
         │    <<element>>    │
         │      client       │
         │ type: application │
         └─────────┬─────────┘
                   │
                   │ client --> rendering : satisfies
                   │
      ┌─────────────────────────┐
      │     <<requirement>>     │
      │        rendering        │
      │          id: 1          │
      │ text: Display a diagram │
      │        risk: low        │
      │   verifymethod: test    │
      └─────────────────────────┘
    `)
  })

  test.each(["<|--", "--|>", "*--", "--*", "o--", "--o", "-->", "<--", "--", "..", "..>", "<..", "..|>", "<|.."]) ("keeps class relationship %s and multiplicities", (symbol) => {
    const output = render(`classDiagram\n A "1" ${symbol} "0..*" B : uses`)
    expect(output).toContain(`A "1" ${symbol} "0..*" B : uses`)
  })

  test("class aliases, Unicode, annotations, generic members, comments and direct members", () => {
    const output = render(`%% leading comment
classDiagram
class Animal["動物 🐶"] {
<<interface>>
+List~String~ names
+getName() String
}
Animal : -int age
class Dog
Animal <|.. Dog : "implements %% interface" %% comment`)
    for (const text of ["動物 🐶 [Animal]", "<<interface>>", "+List~String~ names", "+getName() String", "-int age", "implements %% interface"]) expect(output).toContain(text)
  })

  test("quoted entity names, aliases, composite keys, escaped attribute comments", () => {
    const output = render(`erDiagram
"Customer account" }o..|{ 注文 : "contains: items"
"Customer account"["顧客"] {
varchar(255) name PK, FK "a \\"quoted\\" name"
string[] tags
}`)
    expect(output).toContain("顧客 [Customer account]")
    expect(output).toContain('varchar(255) name PK, FK "a \\"quoted\\" name"')
    expect(output).toContain("string[] tags")
    expect(output).toContain("顧客 [Customer account] }o..|{ 注文 : contains: items")
  })

  test.each(["||--||", "|o--o|", "}o--o{", "}|..|{"])("preserves ER cardinality %s", (symbol) => {
    expect(render(`erDiagram\nA ${symbol} B : relation`)).toContain(`A ${symbol} B : relation`)
  })

  test.each(["contains", "copies", "derives", "satisfies", "verifies", "refines", "traces"])("supports reversed requirement %s relationships", (relation) => {
    expect(render(`requirementDiagram
functionalRequirement feature {
id: "REQ-1"
text: "Show \\"hello\\" to 世界"
risk: high
verifymethod: demonstration
}
element app {
type: "application"
docref: https://example.com/spec
}
feature <- ${relation} - app`)).toContain(`app --> feature : ${relation}`)
  })

  test("comments retain diagnostic source line numbers", () => {
    const source = '\n%% comment\nclassDiagram\nclass A\n  click A "https://example.com"'
    try { render(source); throw new Error("Expected syntax error") } catch (error) {
      expect(error).toBeInstanceOf(MermaidSyntaxError)
      expect(error).toMatchObject({ kind: "class", lineNumber: 5, sourceLine: '  click A "https://example.com"' })
    }
  })

  test("self, parallel and cyclic relationships all remain visible", () => {
    const output = render(`classDiagram
A --> A : self
A --> B : first
A ..> B : second
B *-- A : third`)
    for (const edge of ["A --> A : self", "A --> B : first", "A ..> B : second", "B *-- A : third"]) expect(output).toContain(edge)
  })

  test("identical aliases remain distinguishable in relationship labels", () => {
    expect(render('classDiagram\nclass A["Same"]\nclass B["Same"]\nA --> B')).toContain("Same [A] --> Same [B]")
  })

  test.each([
    "classDiagram\nclass A {\n+int value",
    "classDiagram\nclass A\nA <=> B",
    "classDiagram\nclass A {\n+broken(\n}",
    "classDiagram\nclass A {\n+broken())\n}",
    "classDiagram\nclass A\nstyle A fill:red",
    "classDiagram\nnamespace N {\nclass A\n}",
    "classDiagram\nA --> B : \"unterminated",
    "classDiagram\nclass A {} trailing",
    "classDiagram unexpected",
    'classDiagram\nclass A["tab\tlabel"]',
    'classDiagram\nclass A["escape\u001b[31m"]',
    '%%{init: {"theme":"dark"}}%%\nclassDiagram\nclass A',
    'classDiagram\nclass A %%{init: {"theme":"dark"}}%%',
    "erDiagram\nA ||--?{ B : relation",
    "erDiagram\nA ||--o{ B",
    "erDiagram\nA {\nint id BAD\n}",
    "erDiagram\nA {\nint id PK\nint id FK\n}",
    "erDiagram\nA {\nint id PK unquoted comment\n}",
    "requirementDiagram\nrequirement req {\nrisk: extreme\n}",
    "requirementDiagram\nrequirement req {\nverifymethod: magic\n}",
    "requirementDiagram\nrequirement req {\nid: 1\nid: 2\n}",
    "requirementDiagram\nelement app {\nrisk: low\n}",
    "requirementDiagram\nrequirement req {\npriority: low\n}",
    "requirementDiagram\nrequirement req {}\napp - satisfies -> req",
    "requirementDiagram\nrequirement req {}\nelement app {}\napp <- satisfies -> req",
    "requirementDiagram\nrequirement req {}\nrequirement req {}",
    "requirementDiagram\nrequirement req {}\nelement app {}\napp - guesses -> req",
    "classDiagram",
    "erDiagram",
    "requirementDiagram",
  ])("rejects malformed or unsupported meaningful syntax: %s", (source) => {
    expect(() => render(source)).toThrow(MermaidSyntaxError)
  })

  test.each([1, 2, 5, 6, 12, 24, 40])("wraps without overflow at width %d", (width) => {
    for (const sample of [classSample, erSample, requirementSample]) {
      const output = render(sample, width)
      expect(output.length).toBeGreaterThan(0)
      const content = output.replace(/[┌┐└┘├┤│─\s]/g, "")
      for (const token of sample === classSample ? ["+Stringname", "+speak()", "Animal<|--Dog"] : sample === erSample ? ["customer_idFK", "CUSTOMER||--o{ORDER:places"] : ["risk:low", "verifymethod:test", "client-->rendering:satisfies"]) {
        expect(content).toContain(token)
      }
    }
  })

  test("wraps Unicode by terminal cells and preserves literal HTML", () => {
    const output = render('classDiagram\nclass A["世界 👩‍💻"]\nA : String value', 12)
    expect(output).toContain("世界")
    expect(output).toContain("👩‍💻")
    expect(render('classDiagram\nclass A["<i>literal</i>"]')).toContain("<i>literal</i>")
    expect(() => render('classDiagram\nclass A["界"]', 1)).toThrow(MermaidSyntaxError)
  })

  test("produces native colored StyledText", () => {
    const result = renderRelations(classSample, options)!
    const foregrounds = new Set(result.text.chunks.filter((chunk) => chunk.fg).map((chunk) => chunk.fg!.toString()))
    expect(foregrounds.size).toBeGreaterThanOrEqual(3)
    expect(result.text.chunks.some((chunk) => chunk.fg?.equals(RGBA.fromHex("#ff0000")))).toBe(true)
  })

  test("caps node, source and output allocations", () => {
    expect(() => render(`classDiagram\n${Array.from({ length: 65 }, (_, index) => `class N${index}`).join("\n")}`)).toThrow(MermaidSyntaxError)
    expect(() => render(`classDiagram\nclass A["${"a".repeat(50_001)}"]`)).toThrow(MermaidSyntaxError)
    expect(() => render(`classDiagram\n${"A --> B\n".repeat(129)}`)).toThrow(MermaidSyntaxError)
    expect(() => render(`classDiagram\nclass A["${"a".repeat(3_000)}"]\n${"A --> B\n".repeat(100)}`)).toThrow(MermaidSyntaxError)
    expect(() => render(classSample, Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => render(classSample, 0)).toThrow(RangeError)
  })

  test("returns undefined only for unrelated headers", () => {
    for (const source of ["", "flowchart TD\nA-->B", "pie\n\"A\": 1"]) expect(renderRelations(source, options)).toBeUndefined()
  })
})

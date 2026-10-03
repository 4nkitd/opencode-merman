import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { BoxRenderable, MarkdownRenderable, RGBA, SyntaxStyle, TextRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { createMermaidMarkdownRenderer } from "../markdown.js"
import { diagramTextWidth } from "../core/text.js"

const document = readFileSync(new URL("../../examples/verification.md", import.meta.url), "utf8")
const samples = [...document.matchAll(/## (\d+)\. ([^\n]+)\n\n```mermaid\n([\s\S]*?)\n```/g)]
const labels = ["Ready?", "Hello", "Running", "Animal", "CUSTOMER", "Line test", "Bar test", "Passed", "Release plan", "Browse", "feature", "Frontend", "Prototype", "Rewrite", "satisfies", "Success", "Input", "Payload", "API", "Build chart", "Ready?", "Configured line test"]
const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: RGBA.fromHex("#ffffff") } })

test("fixture preserves all 22 user-tested fences", () => expect(samples.length).toBe(22))

for (const width of [60, 120]) {
  for (const [index, sample] of samples.entries()) {
    test(`${sample[1]}. ${sample[2]} renders through Markdown at ${width} columns`, async () => {
      const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width, height: 180 })
      try {
        const markdown = new MarkdownRenderable(renderer, {
          id: `verify-${sample[1]}-${width}`,
          content: `\`\`\`mermaid\n${sample[3]}\n\`\`\``,
          syntaxStyle,
          renderNode: createMermaidMarkdownRenderer(renderer),
        })
        renderer.root.add(markdown)
        await renderOnce()
        const frame = captureCharFrame()
        expect(frame).toContain(labels[index])
        const first = sample[3].trim().split("\n")[0]
        expect(frame).not.toContain(first)
        expect(markdown.getChildren()[0]?.constructor.name).toBe("StaticDiagramRenderable")
      } finally {
        renderer.destroy()
      }
    })
  }
}

test("YAML titles reach the real Markdown output and unsafe theme values fall back", async () => {
  for (const [yaml, succeeds] of [
    ["title: Production failure rate", true],
    ["config:\n  theme:\n    toString: dark", false],
    ["config:\n  theme: [dark]", false],
  ] as const) {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: 60, height: 80 })
    try {
      const markdown = new MarkdownRenderable(renderer, {
        id: "frontmatter-rendering",
        content: `\`\`\`mermaid\n---\n${yaml}\n---\npie\n"Failed": 5\n"Passed": 95\n\`\`\``,
        syntaxStyle,
        renderNode: createMermaidMarkdownRenderer(renderer),
      })
      renderer.root.add(markdown)
      await renderOnce()
      if (succeeds) {
        expect(captureCharFrame()).toContain("Production failure rate")
        expect(markdown.getChildren()[0]?.constructor.name).toBe("StaticDiagramRenderable")
      } else {
        expect(markdown.getChildren()[0]?.constructor.name).not.toBe("StaticDiagramRenderable")
        expect(captureCharFrame()).toContain("theme:")
      }
    } finally {
      renderer.destroy()
    }
  }
})

test("an unfit Unicode title also falls back during interrupted-diagram recovery", async () => {
  const { renderer, renderOnce } = await createTestRenderer({ width: 1, height: 80 })
  try {
    const markdown = new MarkdownRenderable(renderer, {
      id: "narrow-title",
      content: '```mermaid\n---\ntitle: 界\n---\nflowchart TD\nA --> B\nB -->\n```',
      syntaxStyle,
      renderNode: createMermaidMarkdownRenderer(renderer),
    })
    renderer.root.add(markdown)
    await renderOnce()
    expect(markdown.getChildren()[0]?.constructor.name).not.toBe("StaticDiagramRenderable")
  } finally {
    renderer.destroy()
  }
})

test("charts reflow to the Markdown container rather than the full terminal", async () => {
  const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 100 })
  try {
    const container = new BoxRenderable(renderer, { width: 70, paddingLeft: 5, paddingRight: 5 })
    const markdown = new MarkdownRenderable(renderer, {
      id: "inset-chart", width: "100%",
      content: '```mermaid\nxychart-beta\nx-axis [Mon, Tue, Wed]\nline [30, 80, 50]\n```',
      syntaxStyle, renderNode: createMermaidMarkdownRenderer(renderer),
    })
    container.add(markdown)
    renderer.root.add(container)
    for (const width of [70, 50, 90]) {
      container.width = width
      await renderOnce()
      await renderOnce()
      const diagram = markdown.getChildren()[0] as TextRenderable
      expect(diagram.width).toBe(width - 10)
      const text = diagram.content.chunks.map((chunk) => chunk.text).join("")
      expect(Math.max(...text.split("\n").map(diagramTextWidth))).toBeLessThanOrEqual(diagram.width)
      expect(text).toContain("3: Wed")
    }
  } finally {
    renderer.destroy()
  }
})

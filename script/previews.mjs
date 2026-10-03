import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const screen = readFileSync(resolve(root, "artifacts/opencode-plugin.txt"), "utf8")
const output = resolve(root, "examples/output")
mkdirSync(output, { recursive: true })
const escape = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")

for (const [name, first, last] of [["flowchart", "1. Flowchart", "2. Sequence"], ["line-chart", "6. XY line chart", "7. XY bar chart"], ["bar-chart", "7. XY bar chart", "8. Pie"], ["pie", "8. Pie", "9. Gantt"]]) {
  const start = screen.indexOf(first)
  const end = screen.indexOf(last, start)
  if (start < 0 || end <= start) throw new Error(`Missing rendered terminal capture for ${name}`)
  const lines = screen.slice(screen.lastIndexOf("\n", start) + 1, end).split("\n")
  while (lines.length && !lines.at(-1).trim()) lines.pop()
  const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => line.match(/^ */)[0].length))
  const content = lines.map((line) => line.slice(indent))
  const width = Math.max(...content.map((line) => [...line].length)) * 9 + 48
  const height = content.length * 21 + 48
  const text = content.map((line, index) => `<text x="24" y="${36 + index * 21}" xml:space="preserve">${escape(line)}</text>`).join("\n")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title"><title id="title">OpenCode V2 terminal output: ${escape(first)}</title><rect width="100%" height="100%" rx="8" fill="#101820"/><g fill="#e5edf5" font-family="Menlo,DejaVu Sans Mono,monospace" font-size="15">${text}</g></svg>\n`
  writeFileSync(resolve(output, `${name}.svg`), svg)
  writeFileSync(resolve(output, `${name}.txt`), `${content.join("\n")}\n`)
}
console.log("Generated four monochrome previews from the real OpenCode terminal capture.")

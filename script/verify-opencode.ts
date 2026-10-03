import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const directory = resolve(import.meta.dir, "..")
const pluginDirectory = resolve(process.argv[2] ?? directory)
const artifacts = resolve(directory, "artifacts")
await mkdir(artifacts, { recursive: true })

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const args = ["opencode", "api", method, path]
  if (body !== undefined) args.push("--data", JSON.stringify(body))
  const process = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exit] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited])
  if (exit) throw new Error(`${method} ${path}: ${stderr || stdout}`)
  return stdout.trim() ? JSON.parse(stdout) : undefined
}

const markdown = await readFile(resolve(directory, "examples/verification.md"), "utf8")
const samples = [...markdown.matchAll(/## (\d+)\. ([^\n]+)\n\n```mermaid\n([\s\S]*?)\n```/g)]
const labels = ["Ready?", "Hello", "Running", "Animal", "CUSTOMER", "Line test", "Bar test", "Passed", "Release plan", "Browse", "feature", "Frontend", "Prototype", "Rewrite", "satisfies", "Success", "Input", "Payload", "API", "Build chart", "Ready?", "Configured line test"]
function renderedSamples(screen: string): number[] {
  return samples.filter((sample, index) => {
    const start = screen.indexOf(`${sample[1]}. ${sample[2]}`)
    const next = samples[index + 1]
    const end = next ? screen.indexOf(`${next[1]}. ${next[2]}`) : screen.length
    const region = screen.slice(start, end)
    const lines = new Set(region.split("\n").map((line) => line.trim()))
    return start >= 0 && end > start && region.includes(labels[index])
      && !lines.has(sample[3].trim().split("\n")[0])
  }).map((sample) => Number(sample[1]))
}
const runner = (await api("post", "/api/session", {
  title: "Merman integration verification",
  location: { directory },
})).data
const now = Date.now()
const sessionID = `ses_${crypto.randomUUID().replaceAll("-", "")}`
const model = runner.model ?? { providerID: "fixture", id: "fixture" }
await api("post", "/api/experimental/session/import", {
  info: {
    id: sessionID, projectID: runner.projectID, title: "Merman 22-diagram fixture",
    agent: "build", model, cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: now, updated: now }, location: { directory },
  },
  messages: [{
    id: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
    type: "assistant", agent: "build", model,
    time: { created: now, completed: now }, finish: "stop",
    content: [{ type: "text", text: markdown }],
  }],
  location: { directory },
})

const results: Record<string, unknown> = { runnerID: runner.id, sessionID }
for (const enabled of [false, true]) {
  const mode = enabled ? "plugin" : "builtin"
  const terminal = (await api("post", `/api/experimental/session/${runner.id}/terminal`, {
    command: "opencode", args: [directory, "--session", sessionID],
    cwd: directory, title: `Merman ${mode} verification`,
    env: {
      OPENCODE_CLI_CONFIG_CONTENT: JSON.stringify({
        animations: false,
        attention: { notifications: false, sound: false },
        session: { sidebar: "hide", markdown: "rendered" },
        plugins: enabled ? ["-opencode.merman", pluginDirectory] : [],
      }),
    },
    size: { cols: 120, rows: 900 },
  })).data
  try {
    let screen = ""
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const snapshot = (await api("get", `/api/experimental/persistent-pty/${terminal.id}/snapshot`)).data
      screen = snapshot.text
      if (screen.includes("Configured line test") && screen.includes("1. Flowchart") && (!enabled || renderedSamples(screen).length === 22)) break
      await Bun.sleep(500)
    }
    await writeFile(resolve(artifacts, `opencode-${mode}.txt`), screen)
    const rawXY = screen.includes("xychart-beta")
    const rawClass = screen.includes("classDiagram")
    const complete = samples.every((sample) => screen.includes(`${sample[1]}. ${sample[2]}`))
    const rendered = renderedSamples(screen)
    results[mode] = { terminalID: terminal.id, complete, rendered, rawXY, rawClass }
    console.log(mode, JSON.stringify(results[mode]))
    if (!complete || JSON.stringify(rendered) !== JSON.stringify(enabled ? samples.map((sample) => Number(sample[1])) : [1, 2, 3, 9, 11, 13])) {
      throw new Error(`${mode} screen did not match expected rendering; see artifacts/opencode-${mode}.txt`)
    }
  } finally {
    await api("delete", `/api/experimental/persistent-pty/${terminal.id}`)
    await writeFile(resolve(artifacts, "opencode-verification.json"), JSON.stringify(results, null, 2))
  }
}

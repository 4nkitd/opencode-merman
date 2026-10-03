import { test } from "node:test"
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { execFileSync, spawnSync } from "node:child_process"
import { parse } from "jsonc-parser"
import { assertVersion, configure } from "../bin/install.mjs"

const plugin = "opencode-merman@0.1.1"
const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), "merman-installer-"))
  return { directory, config: join(directory, "cli.json") }
}

test("accepts supported stable V2 versions only", () => {
  for (const value of ["2.0.22", "opencode v2.0.22\n", "2.1.0", "v2.10.1"]) assertVersion(value)
  for (const value of ["1.17.18", "2.0.21", "0.0.0-beta-19271", "2.0.22-beta.1", "3.0.0", "unexpected"]) {
    assert.throws(() => assertVersion(value), /V2 only/)
  }
})

test("creates settings with owner-only permissions", () => {
  const { config } = fixture()
  const result = configure(config, plugin)
  assert.equal(result.backup, undefined)
  assert.deepEqual(parse(readFileSync(config, "utf8")), { plugins: ["-opencode.merman", plugin] })
  if (process.platform !== "win32") assert.equal(statSync(config).mode & 0o777, 0o600)
})

test("preserves settings, comments, other plugins and an exact backup", () => {
  const { directory, config } = fixture()
  const original = '{\n  // keep my settings\n  "theme": { "name": "custom" },\n  "plugins": ["other@1", {"package":"team.plugin","options":{"enabled":true}},],\n}\n'
  writeFileSync(config, original, { mode: 0o640 })
  const result = configure(config, plugin)
  const updated = readFileSync(config, "utf8")
  assert.ok(updated.includes("// keep my settings"))
  assert.ok(updated.includes('"theme": { "name": "custom" }'))
  assert.deepEqual(parse(updated).plugins, ["other@1", { package: "team.plugin", options: { enabled: true } }, "-opencode.merman", plugin])
  assert.equal(readFileSync(result.backup, "utf8"), original)
  if (process.platform !== "win32") assert.equal(statSync(config).mode & 0o777, 0o640)
  assert.equal(readdirSync(directory).filter((name) => name.endsWith(".tmp")).length, 0)
})

test("repeated installs are no-ops without extra backups", () => {
  const { directory, config } = fixture()
  configure(config, plugin)
  const original = readFileSync(config, "utf8")
  assert.equal(configure(config, plugin).changed, false)
  assert.equal(readFileSync(config, "utf8"), original)
  assert.deepEqual(readdirSync(directory), ["cli.json"])
})

test("upgrades npm and checkout entries without disabling other plugins", () => {
  const { config } = fixture()
  writeFileSync(config, JSON.stringify({ plugins: ["*", "opencode-merman@0.1.0", { package: "opencode-merman@0.1.0" }, "/somewhere/opencode-merman", "file:///somewhere/opencode-merman", "-opencode-merman", "-opencode.merman", "other"] }))
  configure(config, plugin)
  assert.deepEqual(parse(readFileSync(config, "utf8")).plugins, ["*", "other", "-opencode.merman", plugin])
})

test("keeps a config symlink and updates its target", () => {
  if (process.platform === "win32") return
  const { directory, config } = fixture()
  const target = join(directory, "actual.json")
  writeFileSync(target, '{"mouse":false}')
  symlinkSync(target, config)
  configure(config, plugin)
  assert.equal(readFileSync(config, "utf8"), readFileSync(target, "utf8"))
  assert.equal(parse(readFileSync(target, "utf8")).mouse, false)
})

test("invalid settings are never overwritten", () => {
  for (const original of ['{"bad":', '[]', 'null', '{"plugins":"other"}', '{"plugins":["first"],"plugins":["other"]}']) {
    const { directory, config } = fixture()
    writeFileSync(config, original)
    assert.throws(() => configure(config, plugin), /No settings were changed/)
    assert.equal(readFileSync(config, "utf8"), original)
    assert.deepEqual(readdirSync(directory), ["cli.json"])
  }
})

test("preserves comments inside unrelated plugin entries", () => {
  const { config } = fixture()
  const original = '{\n"plugins":[\n// another plugin\n{"package":"other", "options":{\n// important option rationale\n"enabled":true}},\n"opencode-merman@0.1.0"\n]\n}'
  writeFileSync(config, original)
  configure(config, plugin)
  const updated = readFileSync(config, "utf8")
  assert.ok(updated.includes("// another plugin"))
  assert.ok(updated.includes("// important option rationale"))
  assert.deepEqual(parse(updated).plugins, [{ package: "other", options: { enabled: true } }, "-opencode.merman", plugin])
  assert.equal(configure(config, plugin).changed, false)
})

test("preserves comments around removed entries and at the array end", () => {
  for (const entries of [
    '"opencode-merman@0.1.0",\n// Important rationale for another plugin\n"other"',
    '"other", // Important inline rationale\n"opencode-merman@0.1.0"',
    '"other" // Important final rationale\n',
    '"opencode-merman@0.1.0", /* Important comma, in comment */ "other", // Important trailing rationale\n',
    '// Important empty array rationale\n',
  ]) {
    const { config } = fixture()
    writeFileSync(config, `{ "plugins": [${entries}] }`)
    configure(config, plugin)
    const updated = readFileSync(config, "utf8")
    assert.ok(updated.includes(entries.match(/(?:\/\/[^\n]*|\/\*.*?\*\/)/)[0]))
    assert.deepEqual(parse(updated).plugins, [...(entries.includes('"other"') ? ["other"] : []), "-opencode.merman", plugin])
    assert.equal(configure(config, plugin).changed, false)
  }
})

test("refuses dangling symlinks without replacing them", () => {
  if (process.platform === "win32") return
  const { directory, config } = fixture()
  const target = join(directory, "missing.json")
  symlinkSync(target, config)
  assert.throws(() => configure(config, plugin), /symlink target is missing/)
  assert.equal(existsSync(target), false)
  assert.deepEqual(readdirSync(directory), ["cli.json"])
})

test("CLI respects XDG_CONFIG_HOME and refuses V1 before any config write", () => {
  if (process.platform === "win32") return
  const { directory } = fixture()
  const command = join(directory, "opencode")
  writeFileSync(command, '#!/bin/sh\nprintf "opencode v2.0.22\\n"\n')
  chmodSync(command, 0o755)
  const env = { ...process.env, PATH: `${directory}:${process.env.PATH}`, XDG_CONFIG_HOME: join(directory, "xdg") }
  const cli = resolve("bin/cli.mjs")
  const output = execFileSync(process.execPath, [cli, "install"], { env, encoding: "utf8" })
  assert.ok(output.includes(plugin))
  const config = join(env.XDG_CONFIG_HOME, "opencode", "cli.json")
  assert.deepEqual(parse(readFileSync(config, "utf8")).plugins, ["-opencode.merman", plugin])
  writeFileSync(command, '#!/bin/sh\nprintf "1.17.18\\n"\n')
  env.XDG_CONFIG_HOME = join(directory, "v1")
  const rejected = spawnSync(process.execPath, [cli, "install"], { env, encoding: "utf8" })
  assert.equal(rejected.status, 1)
  assert.match(rejected.stderr, /V2 only/)
  assert.equal(existsSync(env.XDG_CONFIG_HOME), false)
})

test("local installation points to this checkout", () => {
  if (process.platform === "win32") return
  const { directory } = fixture()
  const command = join(directory, "opencode")
  writeFileSync(command, '#!/bin/sh\nprintf "2.0.22\\n"\n')
  chmodSync(command, 0o755)
  const env = { ...process.env, PATH: `${directory}:${process.env.PATH}`, XDG_CONFIG_HOME: join(directory, "xdg") }
  execFileSync(process.execPath, [resolve("bin/cli.mjs"), "install", "--local"], { env })
  assert.deepEqual(parse(readFileSync(join(env.XDG_CONFIG_HOME, "opencode", "cli.json"), "utf8")).plugins, ["-opencode.merman", resolve(".")])
})

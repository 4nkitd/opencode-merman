import { execFileSync } from "node:child_process"
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { applyEdits, createScanner, findNodeAtLocation, modify, parse, parseTree, SyntaxKind } from "jsonc-parser"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))

export function assertVersion(output) {
  const match = output.trim().match(/^(?:opencode\s+)?v?(\d+)\.(\d+)\.(\d+)$/)
  if (!match || Number(match[1]) !== 2 || (Number(match[2]) === 0 && Number(match[3]) < 22)) {
    throw new Error("OpenCode V2 only: install stable OpenCode 2.0.22 or later in the 2.x series. V1 and pre-release builds are not supported by this installer.")
  }
}

function isMerman(entry, plugin) {
  const value = typeof entry === "string" ? entry : entry?.package
  if (typeof value !== "string") return false
  if (value === plugin || /^-?opencode-merman(?:@.*)?$/.test(value)) return true
  if (value.startsWith("file://")) return basename(fileURLToPath(value)) === "opencode-merman"
  return (value.startsWith("/") || value.startsWith(".")) && basename(value) === "opencode-merman"
}

function removePlugin(text, index) {
  const array = findNodeAtLocation(parseTree(text), ["plugins"])
  const node = array.children[index]
  const scanner = createScanner(text, true)
  scanner.setPosition(node.offset + node.length)
  let comma
  if (scanner.scan() === SyntaxKind.CommaToken) comma = scanner.getTokenOffset()
  else if (index > 0) {
    const previous = array.children[index - 1]
    scanner.setPosition(previous.offset + previous.length)
    if (scanner.scan() !== SyntaxKind.CommaToken) throw new Error("Cannot safely locate a plugin separator. No settings were changed.")
    comma = scanner.getTokenOffset()
  }
  const ranges = [{ offset: node.offset, length: node.length }]
  if (comma !== undefined) ranges.push({ offset: comma, length: 1 })
  for (const range of ranges.sort((a, b) => b.offset - a.offset)) text = text.slice(0, range.offset) + text.slice(range.offset + range.length)
  return text
}

export function configure(configPath, plugin) {
  const entry = lstatSync(configPath, { throwIfNoEntry: false })
  if (entry?.isSymbolicLink() && !existsSync(configPath)) {
    throw new Error(`Cannot safely edit ${configPath}: its symlink target is missing. No settings were changed.`)
  }
  const target = existsSync(configPath) ? realpathSync(configPath) : configPath
  const exists = existsSync(target)
  const original = exists ? readFileSync(target, "utf8") : "{}\n"
  const errors = []
  const config = parse(original, errors, { allowTrailingComma: true })
  if (errors.length || !config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`Cannot safely edit ${configPath}: expected a valid JSON/JSONC object. No settings were changed.`)
  }
  if (config.plugins !== undefined && !Array.isArray(config.plugins)) {
    throw new Error(`Cannot safely edit ${configPath}: plugins must be an array. No settings were changed.`)
  }
  const properties = parseTree(original)?.children ?? []
  if (properties.filter((property) => property.children?.[0]?.value === "plugins").length > 1) {
    throw new Error(`Cannot safely edit ${configPath}: duplicate plugins keys. No settings were changed.`)
  }
  const previous = config.plugins ?? []
  const remove = previous.map((entry, index) => entry === "-opencode.merman" || isMerman(entry, plugin) ? index : -1).filter((index) => index >= 0)
  const plugins = previous.filter((_, index) => !remove.includes(index))
  plugins.push("-opencode.merman", plugin)
  if (JSON.stringify(config.plugins) === JSON.stringify(plugins)) return { configPath, changed: false }
  const options = {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: original.includes("\r\n") ? "\r\n" : "\n" },
  }
  let updated = original
  if (config.plugins === undefined) {
    updated = applyEdits(updated, modify(updated, ["plugins"], plugins, options))
  } else {
    for (const index of remove.reverse()) updated = removePlugin(updated, index)
    const array = findNodeAtLocation(parseTree(updated), ["plugins"])
    const last = array.children.at(-1)
    const scanner = createScanner(updated, true)
    if (last) scanner.setPosition(last.offset + last.length)
    const separator = last && scanner.scan() !== SyntaxKind.CommaToken ? "," : ""
    const closing = array.offset + array.length - 1
    const eol = options.formattingOptions.eol
    const insertion = `${separator}${eol}    "-opencode.merman",${eol}    ${JSON.stringify(plugin)}${eol}  `
    updated = updated.slice(0, closing) + insertion + updated.slice(closing)
  }
  const validationErrors = []
  const validated = parse(updated, validationErrors, { allowTrailingComma: true })
  if (validationErrors.length || JSON.stringify(validated?.plugins) !== JSON.stringify(plugins)) {
    throw new Error("Could not safely update the plugins array. No settings were changed.")
  }
  mkdirSync(dirname(target), { recursive: true })
  const suffix = `${Date.now()}-${process.pid}-${crypto.randomUUID()}`
  const temporary = `${target}.${suffix}.tmp`
  const backup = exists ? `${target}.${suffix}.bak` : undefined
  try {
    if (backup) copyFileSync(target, backup, constants.COPYFILE_EXCL)
    writeFileSync(temporary, updated, { flag: "wx", mode: exists ? statSync(target).mode & 0o777 : 0o600 })
    if (exists && readFileSync(target, "utf8") !== original) {
      throw new Error("CLI settings changed during installation. No settings were overwritten; run the installer again.")
    }
    renameSync(temporary, target)
  } finally {
    rmSync(temporary, { force: true })
  }
  return { configPath, backup, changed: true }
}

export function install({ local = false } = {}) {
  let version
  try {
    version = execFileSync("opencode", ["--version"], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] })
  } catch {
    throw new Error("Cannot run opencode --version. Install OpenCode V2 and ensure opencode is on PATH before running this installer.")
  }
  assertVersion(version)
  const configHome = process.env.XDG_CONFIG_HOME ? resolve(process.env.XDG_CONFIG_HOME) : join(homedir(), ".config")
  const plugin = local ? root : `${manifest.name}@${manifest.version}`
  const result = configure(join(configHome, "opencode", "cli.json"), plugin)
  console.log(`${result.changed ? "Configured" : "Already configured"} ${plugin} in ${result.configPath}`)
  if (result.backup) console.log(`Previous settings backed up to ${result.backup}`)
  console.log("Restart the OpenCode terminal client to load the plugin. Installation does not restart services or verify rendering.")
}

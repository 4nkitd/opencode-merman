#!/usr/bin/env node
import { install } from "./install.mjs"

const args = process.argv.slice(2)
if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.log("OpenCode Merman, V2 only\n\nUsage: opencode-merman install [--local]\n\ninstall         Configure the pinned npm release in global cli.json\ninstall --local Configure this persistent checkout instead of npm\n\nRequires Node 20+ and stable OpenCode 2.0.22+ in the 2.x series.")
} else if (args[0] !== "install" || args.slice(1).some((arg) => arg !== "--local") || args.length > 2) {
  console.error("Usage: opencode-merman install [--local]")
  process.exitCode = 1
} else {
  try {
    install({ local: args[1] === "--local" })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

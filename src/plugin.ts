import { Plugin } from "@opencode/plugin/tui"
// OpenCode 2.0.22 maps host renderable classes only when this import names the actual .ts file.
import { createMermaidCodeBlockRenderer } from "./markdown.ts"
import { resolveOpenCodeDiagramPalette } from "./palette.js"

export default Plugin.define({
  id: "opencode-merman",
  setup(context) {
    return context.markdown.registerCodeBlockRenderer(
      "mermaid",
      createMermaidCodeBlockRenderer(context.renderer, () => ({
        colors: resolveOpenCodeDiagramPalette(context.theme, context.themeMode),
      })),
    )
  },
})

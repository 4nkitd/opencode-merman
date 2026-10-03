# OpenCode Merman

Mermaid diagrams rendered directly in the OpenCode terminal.

**V2 only:** stable OpenCode **2.0.22+**, within the **2.x** series. V1 is not supported. Independent project derived from the official Merman renderer. [MIT license](LICENSE) · [Upstream provenance](UPSTREAM.md)

## Install

Requires Node.js 20+, npm, and `opencode` on PATH. Restart the terminal client after installation.

### npm

**Registry publication is pending.** Once published:

```sh
npx --yes opencode-merman@latest install
```

### GitHub with npm, available now

Package-only install; this does **not** activate the OpenCode plugin:

```sh
npm install github:4nkitd/opencode-merman#v0.1.1
```

Or install **and configure OpenCode globally** in one command:

```sh
npm install --prefix "$HOME/.local/share/opencode-merman" --omit=dev --ignore-scripts github:4nkitd/opencode-merman#v0.1.1 && node "$HOME/.local/share/opencode-merman/node_modules/opencode-merman/bin/cli.mjs" install --local
```

Requires Git. Keep the installed directory; OpenCode loads the plugin from there.

<details>
<summary>GitHub CLI alternative</summary>

Requires `gh`. Run once with a destination that does not already exist:

```sh
mkdir -p "$HOME/.local/share" && gh repo clone 4nkitd/opencode-merman "$HOME/.local/share/opencode-merman" -- --branch v0.1.1 && cd "$HOME/.local/share/opencode-merman" && npm install --omit=dev --ignore-scripts && node bin/cli.mjs install --local
```

</details>

The installer preserves settings and comments, backs up existing `cli.json`, respects `XDG_CONFIG_HOME`, and disables the bundled Mermaid renderer. Reruns are safe. No API keys or server restart required; works with remote OpenCode servers too.

## Supported diagrams

Supported basic syntax is listed below. [All 22 examples](examples/verification.md).

| Diagram | Mermaid keyword | Terminal output |
| --- | --- | --- |
| Flowchart | `flowchart`, `graph` | Nodes and connections |
| Sequence | `sequenceDiagram` | Participants and messages |
| State | `stateDiagram-v2` | States and transitions |
| Gantt | `gantt` | Tasks and date ranges |
| Git graph | `gitGraph` | Branches and commits |
| Timeline | `timeline` | Events by period |
| Line / bar chart | `xychart-beta` | Plots, axes and exact values |
| Pie | `pie` | Slices, values and percentages |
| Quadrant | `quadrantChart` | Coordinates and point legend |
| Sankey | `sankey-beta` | Directed flows and scaled bars |
| Class | `classDiagram` | Members and relationships |
| Entity relationship | `erDiagram` | Attributes, keys and cardinalities |
| Requirement | `requirementDiagram` | Requirements and relationships |
| Mindmap | `mindmap` | Indented trees |
| Journey | `journey` | Tasks, scores and actors |
| Kanban | `kanban` | Columns and task cards |
| Block | `block-beta` | Blocks, spans and connections |
| Packet | `packet-beta` | Bit ranges and fields |
| Architecture | `architecture-beta` | Services, ports and connections |

YAML titles, themes and XY palettes are supported. This is a terminal renderer, not the full browser Mermaid engine. Unsupported syntax falls back to the code fence.

## Output previews

Actual OpenCode 2.0.22 terminal captures, shown in monochrome. Your terminal theme supplies colors. [Plain-text previews](examples/output/).

![Flowchart terminal output](examples/output/flowchart.svg)
![Line chart terminal output](examples/output/line-chart.svg)
![Bar chart terminal output](examples/output/bar-chart.svg)
![Pie chart terminal output](examples/output/pie.svg)

## Limitations

- XY is vertical only; Sankey requires positive, acyclic flows.
- Advanced class/ER syntax, nested blocks, architecture groups and browser interactions are not supported.
- Colors and layout follow terminal constraints. Use YAML frontmatter rather than inline configuration directives for the added renderers.

## Uninstall

Remove this package or checkout path and `-opencode.merman` from the `plugins` array in global `cli.json`, then restart the terminal client. Other settings stay unchanged.

## Development

```sh
git clone https://github.com/4nkitd/opencode-merman.git && cd opencode-merman
bun install
bun run check
node bin/cli.mjs install --local
```

Development uses Bun 1.3+, OpenCode 2.0.22 and OpenTUI 0.5.14. [Verification and integration checks](VERIFICATION.md).

import {
  TextRenderable,
  RenderableEvents,
  createMarkdownCodeBlockRenderer,
  parseColor,
  type ColorInput,
  type MarkdownOptions,
  type MarkdownCodeBlockRenderer,
  type MouseEvent,
  type RenderContext,
  type RGBA,
  StyledText,
} from "@opentui/core"
import { MermaidSyntaxError } from "./diagnostics.js"
import type { OpenCodeDiagramPalette } from "./palette.js"
import { DiagramCanvasSizeError } from "./core/canvas.js"
import { detectMermaidDiagram } from "./detect.js"
import { drawFlowchartDiagramGrid } from "./flowchart/drawing.js"
import { parseMermaidFlowchartDiagram } from "./flowchart/parser.js"
import { renderGridStyledText, resolveFlowchartStyleColors } from "./flowchart/style.js"
import { drawGanttDiagramGrid } from "./gantt/drawing.js"
import { parseMermaidGanttDiagram } from "./gantt/parser.js"
import { renderGanttGridStyledText } from "./gantt/render-grid.js"
import { resolveGanttStyleColors } from "./gantt/style.js"
import type { GanttDiagramRenderOptions } from "./gantt/types.js"
import { drawGitGraphDiagramGrid } from "./gitgraph/drawing.js"
import { parseMermaidGitGraphDiagram } from "./gitgraph/parser.js"
import { renderGitGraphGridStyledText } from "./gitgraph/render-grid.js"
import { resolveGitGraphStyleColors } from "./gitgraph/style.js"
import { drawSequenceDiagramGrid } from "./sequence/drawing.js"
import { parseMermaidSequenceDiagram } from "./sequence/parser.js"
import { renderSequenceGridStyledText } from "./sequence/render-grid.js"
import { resolveSequenceStyleColors } from "./sequence/style.js"
import { drawStateDiagramGrid } from "./state/drawing.js"
import { parseMermaidStateDiagram } from "./state/parser.js"
import { renderStateGridStyledText } from "./state/render-grid.js"
import { resolveStateStyleColors } from "./state/style.js"
import { drawTimelineDiagramGrid } from "./timeline/drawing.js"
import { parseMermaidTimelineDiagram } from "./timeline/parser.js"
import { renderTimelineGridStyledText } from "./timeline/render-grid.js"
import { resolveTimelineStyleColors } from "./timeline/style.js"
import { MermaidConfigError, normalizeMermaid, configuredOptions } from "./frontmatter.js"
import { renderExtra } from "./extra/index.js"
import { diagramTextGraphemes, diagramTextWidth } from "./core/text.js"

type DiagramKind = NonNullable<ReturnType<typeof detectMermaidDiagram>>

interface PreparedDiagram {
  readonly kind: DiagramKind
  readonly source: string
  readonly text: StyledText
  readonly height: number
}

export interface MermaidMarkdownRendererOptions {
  /** Use terminal-optimized diagram spacing. Defaults to true. */
  compact?: boolean
  /** Fold responsive horizontal diagrams that exceed this width. Defaults to 120 columns. */
  layoutMaxWidth?: number
  /** Gantt-specific terminal rendering options. */
  gantt?: Omit<GanttDiagramRenderOptions, "layoutMaxWidth">
  colors?: Partial<Record<keyof OpenCodeDiagramPalette, ColorInput>>
  seriesColors?: string[]
}

function color(value: ColorInput | undefined): RGBA | undefined {
  return value === undefined ? undefined : parseColor(value)
}

class StaticDiagramRenderable extends TextRenderable {
  private measuredWidth = 0

  constructor(ctx: RenderContext, prepared: PreparedDiagram, private readonly reflow: (width: number) => PreparedDiagram) {
    super(ctx, {
      content: prepared.text,
      width: "100%",
      height: prepared.height,
      wrapMode: "none",
      selectable: false,
      marginTop: 1,
    })
    let dragX: number | undefined
    this.onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return
      ctx.clearSelection()
      dragX = event.x
      event.preventDefault()
      event.stopPropagation()
    }
    this.onMouseDrag = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (dragX === undefined) return
      const dx = event.x - dragX
      dragX = event.x
      if (dx) this.scrollX -= dx
    }
    this.onMouseDragEnd = (event: MouseEvent) => {
      dragX = undefined
      event.preventDefault()
      event.stopPropagation()
    }
    this.onMouseUp = (event: MouseEvent) => {
      if (event.button !== 0) return
      dragX = undefined
      event.preventDefault()
      event.stopPropagation()
    }
    this.onMouseScroll = (event: MouseEvent) => {
      const scroll = event.scroll
      if (!scroll || (scroll.direction !== "left" && scroll.direction !== "right")) return
      event.preventDefault()
      event.stopPropagation()
    }
  }

  protected override onResize(width: number, height: number): void {
    super.onResize(width, height)
    width = Math.floor(width)
    if (!this.reflow || width <= 0 || width === this.measuredWidth) return
    this.measuredWidth = width
    try {
      const next = this.reflow(width)
      this.content = next.text
      this.height = next.height
    } catch (error) {
      if (!(error instanceof MermaidSyntaxError || error instanceof DiagramCanvasSizeError || error instanceof MermaidConfigError)) throw error
    }
  }
}

function titled(prepared: PreparedDiagram, title: string | undefined, width: number, options: MermaidMarkdownRendererOptions): PreparedDiagram {
  if (!title) return prepared
  let lineWidth = 0
  let caption = ""
  let lines = 1
  for (const grapheme of diagramTextGraphemes(title)) {
    const size = Math.max(1, diagramTextWidth(grapheme))
    if (size > width) throw new MermaidConfigError("Title cannot fit this terminal width")
    if (lineWidth + size > width) {
      caption += "\n"
      lines++
      lineWidth = 0
    }
    caption += grapheme
    lineWidth += size
  }
  return {
    ...prepared,
    text: new StyledText([{ __isChunk: true, text: caption + "\n", fg: color(options.colors?.text) }, ...prepared.text.chunks]),
    height: prepared.height + lines,
  }
}

function prepareDiagram(
  kind: DiagramKind,
  source: string,
  options: MermaidMarkdownRendererOptions,
  layoutMaxWidth: number,
): PreparedDiagram {
  const colors = options.colors ?? {}
  const compact = options.compact ?? true
  const extra = renderExtra(source, { width: layoutMaxWidth, colors, seriesColors: options.seriesColors })
  if (extra) return { kind, source, ...extra }
  switch (kind) {
    case "flowchart": {
      const grid = drawFlowchartDiagramGrid(parseMermaidFlowchartDiagram(source), {
        compact,
        layoutMaxWidth,
      })
      const size = grid.getTextSize({ trimTop: true, trimBottom: true })
      return {
        kind,
        source,
        text: renderGridStyledText(
          grid,
          resolveFlowchartStyleColors({
            node: color(colors.boxText ?? colors.primary),
            nodeBorder: color(colors.boxBorder ?? colors.muted),
            database: color(colors.boxText ?? colors.primary),
            databaseBorder: color(colors.boxBorder ?? colors.muted),
            edge: color(colors.line ?? colors.secondary),
            label: color(colors.text),
            group: color(colors.group ?? colors.muted),
            groupLabel: color(colors.groupText ?? colors.group ?? colors.muted),
          }),
          { label: color(colors.labelBackground) },
        ),
        height: size.height,
      }
    }
    case "gitGraph": {
      const grid = drawGitGraphDiagramGrid(parseMermaidGitGraphDiagram(source))
      const size = grid.getTextSize({ trimBottom: true })
      return {
        kind,
        source,
        text: renderGitGraphGridStyledText(
          grid,
          resolveGitGraphStyleColors({
            primary: color(colors.primary),
            secondary: color(colors.secondary),
            muted: color(colors.muted),
            warning: color(colors.warning),
            text: color(colors.text),
          }),
        ),
        height: size.height,
      }
    }
    case "gantt": {
      const grid = drawGanttDiagramGrid(parseMermaidGanttDiagram(source), { ...options.gantt, layoutMaxWidth })
      const size = grid.getTextSize({ trimBottom: true })
      return {
        kind,
        source,
        text: renderGanttGridStyledText(
          grid,
          resolveGanttStyleColors({
            title: color(colors.text),
            axis: color(colors.muted),
            background: color(colors.background),
            section: color(colors.secondary),
            task: color(colors.primary),
            active: color(colors.primary),
            critical: color(colors.warning),
            done: color(colors.muted),
          }),
        ),
        height: size.height,
      }
    }
    case "sequence": {
      const grid = drawSequenceDiagramGrid(parseMermaidSequenceDiagram(source), { compact })
      const size = grid.getTextSize()
      return {
        kind,
        source,
        text: renderSequenceGridStyledText(
          grid,
          resolveSequenceStyleColors({
            participant: color(colors.primary),
            lifeline: color(colors.muted),
            group: color(colors.secondary),
            request: color(colors.request ?? colors.primary),
            response: color(colors.response ?? colors.primary),
            fragment: color(colors.secondary),
            fragmentLabelBg: color(colors.background),
            note: color(colors.note ?? colors.warning),
            noteBg: color(colors.noteBackground ?? colors.background),
          }),
        ),
        height: size.height,
      }
    }
    case "state": {
      const grid = drawStateDiagramGrid(parseMermaidStateDiagram(source), { layoutMaxWidth })
      const size = grid.getTextSize({ trimTop: true, trimBottom: true })
      return {
        kind,
        source,
        text: renderStateGridStyledText(
          grid,
          resolveStateStyleColors({
            state: color(colors.boxText ?? colors.primary),
            stateBorder: color(colors.boxBorder ?? colors.primary),
            composite: color(colors.group ?? colors.muted),
            compositeLabel: color(colors.groupText ?? colors.group ?? colors.muted),
            transition: color(colors.line ?? colors.secondary),
            label: color(colors.text),
            noteBorder: color(colors.noteBorder ?? colors.warning),
            noteText: color(colors.noteText ?? colors.warning),
            noteConnector: color(colors.noteConnector ?? colors.muted),
            start: color(colors.marker ?? colors.muted),
            end: color(colors.marker ?? colors.muted),
            choice: color(colors.marker ?? colors.secondary),
          }),
          { label: color(colors.labelBackground) },
        ),
        height: size.height,
      }
    }
    case "timeline": {
      const grid = drawTimelineDiagramGrid(parseMermaidTimelineDiagram(source))
      const size = grid.getTextSize({ trimBottom: true })
      return {
        kind,
        source,
        text: renderTimelineGridStyledText(
          grid,
          resolveTimelineStyleColors({
            title: color(colors.text),
            section: color(colors.secondary),
            period: color(colors.warning),
            spine: color(colors.muted),
            event: color(colors.primary),
          }),
        ),
        height: size.height,
      }
    }
  }
  throw new MermaidSyntaxError(kind, 1, source.split("\n")[0], "Unsupported diagram")
}

/** Create an OpenTUI Markdown node renderer for fenced Mermaid diagrams. */
export function createMermaidMarkdownRenderer(
  ctx: RenderContext,
  input: MermaidMarkdownRendererOptions | (() => MermaidMarkdownRendererOptions) = {},
): NonNullable<MarkdownOptions["renderNode"]> {
  return createMarkdownCodeBlockRenderer({ mermaid: createMermaidCodeBlockRenderer(ctx, input) })!
}

export function createMermaidCodeBlockRenderer(
  ctx: RenderContext,
  input: MermaidMarkdownRendererOptions | (() => MermaidMarkdownRendererOptions) = {},
): MarkdownCodeBlockRenderer {
  const lastGood = new Map<string, PreparedDiagram>()
  return (token, context) => {
    let normalized: ReturnType<typeof normalizeMermaid>
    let options: MermaidMarkdownRendererOptions
    try {
      normalized = normalizeMermaid(token.text)
      options = configuredOptions(normalized.config, typeof input === "function" ? input() : input)
    } catch (error) {
      if (error instanceof MermaidConfigError) return undefined
      throw error
    }
    const kind = detectMermaidDiagram(normalized.source)
    if (!kind) return undefined
    // OpenTUI's default block ID is the stable identity available for this fence across streaming updates.
    const key = context.defaultRender()?.id
    const configuredMaxWidth =
      options.layoutMaxWidth === undefined ? 120 : Math.max(1, Math.trunc(options.layoutMaxWidth))
    const layoutMaxWidth = Math.min(configuredMaxWidth, Math.max(1, Math.trunc(ctx.width)))
    const create = (prepared: PreparedDiagram) => new StaticDiagramRenderable(ctx, prepared, (width) => {
      const available = Math.min(configuredMaxWidth, width)
      return titled(prepareDiagram(kind, prepared.source, options, available), normalized.title, available, options)
    })

    try {
      const prepared = titled(prepareDiagram(kind, normalized.source, options, layoutMaxWidth), normalized.title, layoutMaxWidth, options)
      const diagram = create(prepared)
      if (key) claimLastGood(key, prepared, diagram, lastGood)
      return diagram
    } catch (error) {
      if (error instanceof MermaidSyntaxError) {
        const previous = key ? lastGood.get(key) : undefined
        if (previous?.kind === kind) {
          const diagram = create(previous)
          claimLastGood(key!, previous, diagram, lastGood)
          return diagram
        }

        if (!["flowchart", "sequence", "state", "timeline", "gitGraph", "gantt"].includes(kind)) return undefined
        const lines = normalized.source.split("\n")
        if (error.lineNumber <= 2 || lines.slice(error.lineNumber).some((line) => line.trim())) return undefined

        try {
          const prepared = titled(prepareDiagram(
            kind,
            lines.slice(0, error.lineNumber - 1).join("\n"),
            options,
            layoutMaxWidth,
          ), normalized.title, layoutMaxWidth, options)
          if (!prepared.height) return undefined
          const diagram = create(prepared)
          if (key) claimLastGood(key, prepared, diagram, lastGood)
          return diagram
        } catch (error) {
          if (error instanceof MermaidSyntaxError || error instanceof DiagramCanvasSizeError || error instanceof MermaidConfigError) return undefined
          throw error
        }
      }
      if (error instanceof DiagramCanvasSizeError || error instanceof MermaidConfigError) return undefined
      throw error
    }
  }
}

function claimLastGood(
  key: string,
  value: PreparedDiagram,
  owner: StaticDiagramRenderable,
  cache: Map<string, PreparedDiagram>,
): void {
  const claim = { ...value }
  cache.set(key, claim)
  owner.once(RenderableEvents.DESTROYED, () => {
    // Reconciliation destroys the old block before synchronously creating its replacement.
    queueMicrotask(() => {
      if (cache.get(key) === claim) cache.delete(key)
    })
  })
}

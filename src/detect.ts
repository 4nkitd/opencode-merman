import type { MermaidDiagramKind } from "./diagnostics.js"
import { isMermaidFlowchartDiagram } from "./flowchart/parser.js"
import { isMermaidGanttDiagram } from "./gantt/parser.js"
import { isMermaidGitGraphDiagram } from "./gitgraph/parser.js"
import { isMermaidSequenceDiagram } from "./sequence/parser.js"
import { isMermaidStateDiagram } from "./state/parser.js"
import { isMermaidTimelineDiagram } from "./timeline/parser.js"
import { firstMeaningfulMermaidLine } from "./core/mermaid.js"

export function detectMermaidDiagram(content: string): MermaidDiagramKind | undefined {
  if (isMermaidFlowchartDiagram(content)) return "flowchart"
  if (isMermaidGanttDiagram(content)) return "gantt"
  if (isMermaidGitGraphDiagram(content)) return "gitGraph"
  if (isMermaidSequenceDiagram(content)) return "sequence"
  if (isMermaidStateDiagram(content)) return "state"
  if (isMermaidTimelineDiagram(content)) return "timeline"
  const header = firstMeaningfulMermaidLine(content) ?? ""
  const extra: [RegExp, MermaidDiagramKind][] = [
    [/^xychart(?:-beta)?\b/i, "xychart"], [/^pie\b/i, "pie"],
    [/^quadrantChart\b/i, "quadrant"], [/^sankey(?:-beta)?\b/i, "sankey"],
    [/^classDiagram\b/i, "class"], [/^erDiagram\b/i, "er"],
    [/^requirementDiagram\b/i, "requirement"], [/^mindmap\b/i, "mindmap"],
    [/^journey\b/i, "journey"], [/^kanban\b/i, "kanban"],
    [/^block(?:-beta)?\b/i, "block"], [/^packet(?:-beta)?\b/i, "packet"],
    [/^architecture(?:-beta)?\b/i, "architecture"],
  ]
  for (const [pattern, kind] of extra) if (pattern.test(header)) return kind
  return undefined
}

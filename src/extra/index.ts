import { renderCharts } from "./charts.js"
import { renderRelations } from "./relations.js"
import { renderHierarchy } from "./hierarchy.js"
import { renderStructure } from "./structure.js"
import type { ExtraDiagram, ExtraOptions } from "./shared.js"

export function renderExtra(source: string, options: ExtraOptions): ExtraDiagram | undefined {
  return renderCharts(source, options)
    ?? renderRelations(source, options)
    ?? renderHierarchy(source, options)
    ?? renderStructure(source, options)
}

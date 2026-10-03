import { parseColor, type ColorInput, type StyledText } from "@opentui/core"
import { DiagramCanvas } from "../core/canvas.js"
import { renderDiagramGridStyledText } from "../core/render-grid.js"
import type { OpenCodeDiagramPalette } from "../palette.js"

export interface ExtraOptions {
  width: number
  colors: Partial<Record<keyof OpenCodeDiagramPalette, ColorInput>>
  seriesColors?: string[]
}

export interface ExtraDiagram {
  text: StyledText
  height: number
}

export function finish(grid: DiagramCanvas<string>, options: ExtraOptions): ExtraDiagram {
  return {
    text: renderDiagramGridStyledText(grid, (run) => {
      const series = /^series(\d+)$/.exec(run.style ?? "")
      const palette = options.seriesColors ?? ["#3b82f6", "#f97316", "#ef4444", "#22c55e", "#a855f7", "#06b6d4"]
      const input = series
        ? palette[Number(series[1]) % palette.length]
        : options.colors[(run.style ?? "text") as keyof OpenCodeDiagramPalette] ?? options.colors.text
      return input === undefined ? undefined : parseColor(input)
    }, undefined, { trimBottom: true }),
    height: grid.getTextHeight({ trimBottom: true }),
  }
}

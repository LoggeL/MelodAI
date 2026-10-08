/** The six pipeline steps (§10). 01–03 are sound work (red), 04–06 are AI work (blue). */
export const PIPELINE_STEPS = [
  { no: '01', label: 'Suche', text: 'Du findest den Song im Deezer-Katalog.' },
  { no: '02', label: 'Download', text: 'MelodAI lädt die Originalaufnahme.' },
  { no: '03', label: 'Stimmtrennung', text: 'Die KI trennt Gesang und Instrumental in zwei Spuren.' },
  { no: '04', label: 'Transkription', text: 'Jedes gesungene Wort bekommt einen Zeitstempel.' },
  { no: '05', label: 'Zeilen bauen', text: 'Ein Sprachmodell setzt die Wörter zu singbaren Zeilen zusammen.' },
  { no: '06', label: 'Wiedergabe', text: 'Du regelst Gesang und Instrumental und singst mit.' },
] as const

const STAGE_INDEX: Record<string, number> = {
  pending: 1, queued: 1, metadata: 1, downloading: 1,
  splitting: 2, lyrics: 3, processing: 4, complete: 5, ready: 5,
}

/** Index (0–5) of the step that is running for a backend status or progress value. */
export function pipelineIndex(status: string | undefined, progress = 0): number {
  const key = (status || '').toLowerCase()
  if (key in STAGE_INDEX) return STAGE_INDEX[key]
  if (progress >= 100) return 5
  if (progress >= 87) return 4
  if (progress >= 65) return 3
  if (progress >= 35) return 2
  return 1
}

/** „Stimmtrennung 64 %“ */
export function pipelineLabel(status: string | undefined, progress = 0): string {
  const step = PIPELINE_STEPS[pipelineIndex(status, progress)]
  return `${step.label} ${Math.round(Math.max(0, Math.min(100, progress)))} %`
}

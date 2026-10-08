/** German number, time and date formats (§10). */
const NUMBER = new Intl.NumberFormat('de-DE')

export function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function formatInt(value: number | null | undefined): string {
  return NUMBER.format(value ?? 0)
}

/** 3:41 */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** 4,2 s */
export function formatSeconds(seconds: number): string {
  return `${formatNumber(Math.max(0, seconds), 1)} s`
}

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const date = new Date(iso.includes('T') || iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z')
  return Number.isNaN(date.getTime()) ? null : date
}

/** 08.10.26 14:21 */
export function formatDateTime(iso: string | null | undefined): string {
  const date = parse(iso)
  if (!date) return '–'
  return `${date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })} ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
}

/** 08.10.26 */
export function formatDate(iso: string | null | undefined): string {
  const date = parse(iso)
  return date ? date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '–'
}

/** 08.10. */
export function formatShortDate(iso: string | null | undefined): string {
  const date = parse(iso)
  return date ? date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + '.' : '–'
}

/** Oktober 2025 */
export function formatMonthYear(iso: string | null | undefined): string {
  const date = parse(iso)
  return date ? date.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) : '–'
}

/** Number and unit never wrap apart. */
const NBSP = '\u00a0'

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '–'
  if (bytes >= 1073741824) return `${formatNumber(bytes / 1073741824, 2)}${NBSP}GB`
  if (bytes >= 1048576) return `${formatNumber(bytes / 1048576, 1)}${NBSP}MB`
  if (bytes >= 1024) return `${formatNumber(bytes / 1024, 0)}${NBSP}KB`
  return `${bytes}${NBSP}B`
}

export function formatPercent(fraction: number, digits = 0): string {
  return `${formatNumber(fraction * 100, digits)}${NBSP}%`
}

export function plural(count: number, one: string, many: string): string {
  return `${formatInt(count)} ${count === 1 ? one : many}`
}

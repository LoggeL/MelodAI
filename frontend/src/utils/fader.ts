export type Channel = 'vocal' | 'inst'

export const CHANNEL = {
  vocal: { label: 'Gesang', icon: 'mic' as const, description: 'Die Originalstimme – leise als Stütze' },
  inst: { label: 'Instrumental', icon: 'guitar' as const, description: 'Die Musik ohne Gesang' },
}

export function faderValueText(channel: Channel, value: number) {
  return value === 0 ? `${CHANNEL[channel].label} aus` : `${CHANNEL[channel].label} ${value} Prozent`
}

export function faderShort(value: number) {
  return value === 0 ? 'aus' : `${value} %`
}

let verticalSupport: boolean | null = null
/** One-time check whether this browser lays out a vertical range input (§5.11). */
export function supportsVerticalRange(): boolean {
  if (verticalSupport !== null) return verticalSupport
  try {
    const probe = document.createElement('input')
    probe.type = 'range'
    probe.style.cssText = 'position:absolute;visibility:hidden;writing-mode:vertical-lr;width:auto;height:auto'
    document.body.appendChild(probe)
    verticalSupport = probe.offsetHeight > probe.offsetWidth
    probe.remove()
  } catch { verticalSupport = false }
  return verticalSupport
}

/** Album cover → two backdrop gradient stops (hidden canvas, no dependencies). See useAlbumColors. */

/** The two stops for --album-a / --album-b, lightness clamped to 20–80 %, or null for a colourless cover. */
export function backdropStops(img: HTMLImageElement): [string, string] | null {
  const palette = extractColors(img)
  if (!palette) return null
  const [h, s, l] = rgbToHsl(...palette)
  return [
    hslToHex(h, Math.min(s * 1.15, 90), clamp(l, 20, 80)),
    hslToHex((h + 28) % 360, Math.min(s, 80), clamp(l - 18, 20, 80)),
  ]
}

// ── Color extraction ──────────────────────────────────────────

function extractColors(img: HTMLImageElement): [number, number, number] | null {
  const size = 64 // downscale for speed
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  ctx.drawImage(img, 0, 0, size, size)
  const data = ctx.getImageData(0, 0, size, size).data

  // Bucket pixels by hue sector, weighting by saturation * vibrancy.
  // This finds the most *chromatic* color, not just the most common.
  const buckets: { r: number; g: number; b: number; weight: number }[] = Array.from(
    { length: 12 },
    () => ({ r: 0, g: 0, b: 0, weight: 0 })
  )

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const [h, s, l] = rgbToHsl(r, g, b)

    // Skip near-black, near-white, and very desaturated pixels
    if (s < 15 || l < 10 || l > 90) continue

    const bucket = Math.floor(h / 30) % 12
    // Weight by saturation and distance from extremes
    const vibrancy = s * (1 - Math.abs(l - 50) / 50)
    buckets[bucket].r += r * vibrancy
    buckets[bucket].g += g * vibrancy
    buckets[bucket].b += b * vibrancy
    buckets[bucket].weight += vibrancy
  }

  // Find the most vibrant bucket
  let best = buckets[0]
  for (const b of buckets) {
    if (b.weight > best.weight) best = b
  }

  if (best.weight === 0) return null

  return [
    Math.round(best.r / best.weight),
    Math.round(best.g / best.weight),
    Math.round(best.b / best.weight),
  ]
}

// ── Color math ────────────────────────────────────────────────

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6

  return [h * 360, s * 100, l * 100]
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

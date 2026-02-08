import { useEffect, useRef, useState } from 'react'

interface AlbumColors {
  primary: string
  primaryDark: string
  accent: string
  /** raw r,g,b for use in rgba() expressions */
  primaryRgb: string
}

const DEFAULT_COLORS: AlbumColors = {
  primary: '',
  primaryDark: '',
  accent: '',
  primaryRgb: '',
}

/**
 * Extract a dominant vibrant color from an album cover image.
 * Uses a hidden canvas to sample pixels — zero dependencies.
 *
 * Returns derived primary/dark/accent colors and applies them as
 * CSS custom properties on the document root so the entire UI
 * subtly shifts to match the album art.
 */
export function useAlbumColors(thumbnailUrl: string | undefined) {
  const [colors, setColors] = useState<AlbumColors>(DEFAULT_COLORS)
  const prevUrl = useRef<string>('')

  useEffect(() => {
    if (!thumbnailUrl || thumbnailUrl === prevUrl.current) return
    prevUrl.current = thumbnailUrl

    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      try {
        const palette = extractColors(img)
        if (!palette) return

        const [r, g, b] = palette
        const hsl = rgbToHsl(r, g, b)

        // Boost saturation for the primary, keep lightness moderate
        const primary = hslToHex(hsl[0], Math.min(hsl[1] * 1.3, 100), clamp(hsl[2], 35, 55))
        const primaryDark = hslToHex(hsl[0], Math.min(hsl[1] * 1.1, 90), clamp(hsl[2] - 18, 15, 35))
        const accent = hslToHex((hsl[0] + 10) % 360, Math.min(hsl[1] * 1.2, 95), clamp(hsl[2] + 12, 50, 70))

        const pRgb = hexToRgbStr(primary)

        const next: AlbumColors = { primary, primaryDark, accent, primaryRgb: pRgb }
        setColors(next)
        applyToDocument(next)
      } catch {
        // CORS SecurityError on canvas — fall back to defaults
      }
    }

    img.onerror = () => {
      // On failure, clear overrides so defaults show
      clearFromDocument()
      setColors(DEFAULT_COLORS)
    }

    img.src = thumbnailUrl
  }, [thumbnailUrl])

  // Clean up on unmount
  useEffect(() => {
    return () => clearFromDocument()
  }, [])

  return colors
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

// ── CSS property management ───────────────────────────────────

const PROPS = [
  '--primary', '--primary-dark', '--accent',
  '--gradient', '--gradient-hover',
  '--primary-glow', '--primary-glow-strong',
  '--primary-rgb',
] as const

function applyToDocument(c: AlbumColors) {
  const el = document.documentElement.style
  el.setProperty('--primary', c.primary)
  el.setProperty('--primary-dark', c.primaryDark)
  el.setProperty('--accent', c.accent)
  el.setProperty('--gradient', `linear-gradient(135deg, ${c.primary}, ${c.primaryDark})`)
  el.setProperty('--gradient-hover', `linear-gradient(135deg, ${c.accent}, ${c.primary})`)
  el.setProperty('--primary-glow', `rgba(${c.primaryRgb}, 0.15)`)
  el.setProperty('--primary-glow-strong', `rgba(${c.primaryRgb}, 0.35)`)
  el.setProperty('--primary-rgb', c.primaryRgb)
}

function clearFromDocument() {
  const el = document.documentElement.style
  for (const prop of PROPS) {
    el.removeProperty(prop)
  }
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

function hexToRgbStr(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

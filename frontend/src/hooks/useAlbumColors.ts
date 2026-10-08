import { useEffect, useState, type CSSProperties } from 'react'

export type AlbumBackdropStyle = CSSProperties & { '--album-a'?: string; '--album-b'?: string }

/**
 * Extract the most chromatic colour of an album cover (hidden canvas, no
 * dependencies) and return it as the two gradient stops of the stage backdrop.
 *
 * The result only ever feeds `--album-a` / `--album-b` on the player stage.
 * It never touches brand, text, focus or button colours. Lightness is clamped
 * to 20–80 % so the blurred backdrop cannot break lyric contrast.
 */
export function useAlbumColors(thumbnailUrl: string | undefined): AlbumBackdropStyle | undefined {
  const [result, setResult] = useState<{ url: string; style: AlbumBackdropStyle } | null>(null)

  useEffect(() => {
    if (!thumbnailUrl) return
    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (cancelled) return
      // The colour maths is decorative and loads separately from the player chunk.
      import('../utils/albumColors').then(({ backdropStops }) => {
        if (cancelled) return
        const stops = backdropStops(img)
        if (stops) setResult({ url: thumbnailUrl, style: { '--album-a': stops[0], '--album-b': stops[1] } })
      }).catch(() => {
        // Canvas reads can fail for cross-origin covers; the default stage stays.
      })
    }
    img.src = thumbnailUrl
    return () => { cancelled = true; img.onload = null }
  }, [thumbnailUrl])

  return result && result.url === thumbnailUrl ? result.style : undefined
}

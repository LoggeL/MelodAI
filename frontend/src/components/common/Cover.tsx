import { useState } from 'react'
import { CoverFallback } from './Logo'

/** Album cover with a drawn fallback; the logo file is never used as a cover. */
export function Cover({ src, className, alt = '', loading = 'lazy' }: { src?: string | null; className?: string; alt?: string; loading?: 'lazy' | 'eager' }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src) return <CoverFallback className={className} />
  return <img className={className} src={src} alt={alt} loading={loading} onError={() => setFailed(src)} />
}

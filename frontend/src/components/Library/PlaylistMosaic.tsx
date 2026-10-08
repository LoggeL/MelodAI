import { Cover } from '../common/Cover'
import { Icon } from '../common/Icon'
import { mosaicTiles } from './mosaic'
import styles from './PlaylistMosaic.module.css'

/** 2×2 cover mosaic of a playlist's first songs (§4.5). Decorative; the card carries the name. */
export function PlaylistMosaic({ covers, className = '' }: { covers?: string[]; className?: string }) {
  const tiles = mosaicTiles(covers)
  if (tiles.length === 0) {
    return (
      <span className={`${styles.mosaic} ${styles.empty} ${className}`} aria-hidden="true" data-tiles="0">
        <i /><i /><i /><i /><Icon name="list" size={28} />
      </span>
    )
  }
  if (tiles.length === 1) {
    return <span className={`${styles.mosaic} ${styles.single} ${className}`} aria-hidden="true" data-tiles="1"><Cover className={styles.tile} src={tiles[0]} /></span>
  }
  return (
    <span className={`${styles.mosaic} ${className}`} aria-hidden="true" data-tiles={tiles.filter(Boolean).length}>
      {tiles.map((src, i) => src ? <Cover key={i} className={styles.tile} src={src} /> : <i key={i} />)}
    </span>
  )
}

import { lazy, Suspense } from 'react'
import { Icon } from '../common/Icon'
import { Modal } from '../common/Modal'
import { LyricScale } from './LyricScale'
import { DOWNLOADS, type DownloadOption } from './downloads'
import { loadTranslationPanel } from './lazyParts'
import type { TranslationPanelProps } from './TranslationPanel'
import styles from './OptionsSheet.module.css'

const TranslationPanel = lazy(() => loadTranslationPanel().then(module => ({ default: module.TranslationPanel })))

interface Props extends TranslationPanelProps {
  lyricScale: number
  onLyricScale?: (scale: number) => void
  downloading: boolean
  onDownload: (option: DownloadOption) => void
  onShare: () => void
  onClose: () => void
}

/** Mobile „…“ sheet of the now-playing row: Übersetzung, Textgröße, Download, Teilen (§4.2). */
export function OptionsSheet({ lyricScale, onLyricScale, downloading, onDownload, onShare, onClose, ...translation }: Props) {
  return (
    <Modal title="Optionen" variant="sheet" size="small" onClose={onClose}>
      <div className={styles.sheet}>
        <section>
          <h3 className="kicker">Übersetzung</h3>
          <Suspense fallback={<p className={styles.pending} role="status">Lädt …</p>}><TranslationPanel {...translation} /></Suspense>
        </section>
        {onLyricScale && (
          <section>
            <h3 className="kicker">Textgröße</h3>
            <LyricScale value={lyricScale} onChange={onLyricScale} />
          </section>
        )}
        <section>
          <h3 className="kicker">Herunterladen</h3>
          <div className={styles.list}>
            {DOWNLOADS.map(option => (
              <button key={option.type} type="button" className="btn" disabled={downloading} onClick={() => onDownload(option)}>
                <Icon name="download" /> {option.label}
              </button>
            ))}
          </div>
        </section>
        <button type="button" className="btn btn--block" onClick={onShare}><Icon name="share" /> Link kopieren</button>
      </div>
    </Modal>
  )
}

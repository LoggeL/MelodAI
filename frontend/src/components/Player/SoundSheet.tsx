import { useState } from 'react'
import { Icon } from '../common/Icon'
import { Modal } from '../common/Modal'
import { Fader } from './Fader'
import { supportsVerticalRange } from '../../utils/fader'
import styles from './SoundSheet.module.css'

export type Preset = 'karaoke' | 'withVocals' | 'custom'

interface Props {
  preset: Preset
  vocalsVolume: number
  instrumentalVolume: number
  onPreset: (preset: Exclude<Preset, 'custom'>) => void
  onVocalsVolume: (v: number) => void
  onInstrumentalVolume: (v: number) => void
  onClose: () => void
}

/** Mobile „Ton“ sheet (§5.11): preset tiles, two channel strips and the tip row. Loaded on demand. */
export function SoundSheet({ preset, vocalsVolume, instrumentalVolume, onPreset, onVocalsVolume, onInstrumentalVolume, onClose }: Props) {
  const [vertical] = useState(() => typeof document !== 'undefined' && supportsVerticalRange())
  const orientation = vertical ? 'vertical' : 'horizontal'
  return (
    <Modal title="Ton" size="small" variant="sheet" onClose={onClose}
      footer={<button type="button" className="btn btn--primary btn--block" onClick={onClose}>Fertig</button>}>
      <div className={styles.sound}>
        <div className={styles.presetTiles} role="group" aria-label="Voreinstellung">
          <button type="button" aria-pressed={preset === 'karaoke'} onClick={() => onPreset('karaoke')}>
            <strong>Karaoke</strong><span>Gesang aus, du singst allein.</span>
          </button>
          <button type="button" aria-pressed={preset === 'withVocals'} onClick={() => onPreset('withVocals')}>
            <strong>Mit Gesang</strong><span>Originalstimme dabei, zum Reinfinden.</span>
          </button>
        </div>
        <div className={vertical ? styles.strips : styles.stripsHorizontal}>
          <Fader channel="vocal" value={vocalsVolume} onChange={onVocalsVolume} orientation={orientation} />
          <Fader channel="inst" value={instrumentalVolume} onChange={onInstrumentalVolume} orientation={orientation} />
          {!vertical && <span className={styles.endLabels} aria-hidden="true"><i>aus</i><i>voll</i></span>}
        </div>
        <p className={styles.tip}><Icon name={vocalsVolume === 0 ? 'mic-off' : 'mic'} />{vocalsVolume === 0 ? 'Gesang aus · Jetzt du.' : 'Gesang ganz runter, und du bist dran.'}</p>
      </div>
    </Modal>
  )
}

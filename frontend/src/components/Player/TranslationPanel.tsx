import type { LyricTranslation, TranslationLanguage } from '../../types'
import { Icon } from '../common/Icon'
import type { TranslationMode } from './downloads'
import styles from './TranslationPanel.module.css'

const LANGUAGES: Array<{ code: TranslationLanguage; label: string }> = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'Englisch' },
]

export interface TranslationPanelProps {
  translation?: LyricTranslation | null
  translationLanguage: TranslationLanguage
  translationMode: TranslationMode
  translationLoading: boolean
  onTranslationLanguageChange?: (language: TranslationLanguage) => void
  onTranslationModeChange?: (mode: TranslationMode) => void
  onTranslate?: () => void
}

/** Language, display mode and „Übersetzen“ (§4.2). Loaded when the disclosure or the options sheet opens. */
export function TranslationPanel({
  translation, translationLanguage, translationMode, translationLoading,
  onTranslationLanguageChange, onTranslationModeChange, onTranslate,
}: TranslationPanelProps) {
  const available = !!translation?.available
  return (
    <div className={styles.panel}>
      <label className="field">
        <span className="field-label">Sprache</span>
        <select className="input" value={translationLanguage} aria-label="Übersetzungssprache"
          onChange={e => onTranslationLanguageChange?.(e.target.value as TranslationLanguage)}>
          {LANGUAGES.map(lang => <option key={lang.code} value={lang.code}>{lang.label}</option>)}
        </select>
      </label>
      <div className="seg" role="group" aria-label="Anzeige">
        <button type="button" aria-pressed={translationMode === 'original'} onClick={() => onTranslationModeChange?.('original')}>Original</button>
        <button type="button" aria-pressed={translationMode === 'translation'} disabled={!available && !translationLoading} onClick={() => onTranslationModeChange?.('translation')}>Übersetzung</button>
        <button type="button" aria-pressed={translationMode === 'both'} disabled={!available && !translationLoading} onClick={() => onTranslationModeChange?.('both')}>Beide</button>
      </div>
      {!available && (
        <button type="button" className="btn btn--primary" onClick={onTranslate} disabled={translationLoading} aria-busy={translationLoading}>
          {translationLoading ? <><span className="spinner" aria-hidden="true" /><span className="spinner-text">Lädt …</span> Übersetzt …</> : <><Icon name="lang" /> Übersetzen</>}
        </button>
      )}
    </div>
  )
}

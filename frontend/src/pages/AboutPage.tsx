import { Link } from 'react-router-dom'
import { Logo } from '../components/common/Logo'
import { Icon } from '../components/common/Icon'
import { LyricPreview } from '../components/Player/LyricPreview'
import { PIPELINE_STEPS } from '../utils/pipeline'
import styles from './AboutPage.module.css'

const TECH: Array<[string, string]> = [
  ['Stimmtrennung', 'Demucs über Replicate trennt Gesang und Instrumental in zwei Spuren.'],
  ['Transkription', 'WhisperX setzt Wort-Zeitstempel, ein Sprachmodell über OpenRouter baut daraus Zeilen.'],
  ['Katalog', 'Suche und Originalaufnahmen kommen von Deezer, Referenztexte von lrclib.'],
  ['Server', 'Flask und SQLite, die Verarbeitung läuft in Hintergrund-Threads.'],
  ['Oberfläche', 'React mit TypeScript und der Web Audio API für die zwei Spuren.'],
]

export function AboutPage() {
  return (
    <div className={styles.page}>
      <div className={styles.beam} aria-hidden="true" />
      <header className={styles.top}>
        <Link to="/" className={styles.logo} aria-label="MelodAI – zur Bühne"><Logo /></Link>
        <Link to="/" className="btn btn--ghost btn--sm">Zur Bühne <Icon name="chevron-right" size={16} /></Link>
      </header>
      <main className={styles.main}>
        <section className={styles.hero}>
          <span className="kicker">Kapitel III · KI</span>
          <h1 className={styles.headline}><s className={styles.strike}>Gesang</s> raus. <em>Du</em> rein.</h1>
          <p className={styles.dek}>MelodAI macht aus fast jedem Song Karaoke: Stimme trennen, Wörter timen, mitsingen. Die Originalstimme bleibt als leise Stütze, wenn du sie willst.</p>
          <Link to="/" className="btn btn--primary btn--pill">Jetzt singen <Icon name="chevron-right" size={18} /></Link>
        </section>

        <section className={styles.section} aria-labelledby="how">
          <h2 id="how">So funktioniert’s</h2>
          <ol className={styles.steps}>
            {PIPELINE_STEPS.map((step, index) => (
              <li key={step.no} data-tone={index < 3 ? 'vocal' : 'inst'}>
                <b>{step.no}</b>
                <strong>{step.label}</strong>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.section} aria-labelledby="look">
          <h2 id="look">So sieht’s aus</h2>
          <div className={styles.stage}>
            <div className={styles.stageBeam} aria-hidden="true" />
            <LyricPreview past="Wir stellen die Stühle in den Hof" active="und singen lauter als der Regen" next="bis das Licht im Treppenhaus angeht" />
            <p className={styles.caption}>Rot ist schon gesungen, das aktuelle Wort füllt sich im Takt. Darunter kündigt sich die nächste Zeile an.</p>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="tech">
          <h2 id="tech">Technik</h2>
          <dl className={styles.tech}>
            {TECH.map(([term, text]) => <div key={term}><dt>{term}</dt><dd>{text}</dd></div>)}
          </dl>
        </section>
      </main>
      <footer className={styles.footer}>Ein LMF-Projekt · Kapitel III</footer>
    </div>
  )
}

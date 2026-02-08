import { Link } from 'react-router-dom'
import styles from './AboutPage.module.css'

const TECH = ['Flask', 'Deezer API', 'Demucs', 'WhisperX', 'Replicate', 'OpenRouter', 'Web Audio API', 'SQLite']

function LmfLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      version="1.0"
      xmlns="http://www.w3.org/2000/svg"
      width="251"
      height="150"
      viewBox="0 0 2510 1500"
      fill="#d90429"
    >
      <path d="M60 1387c0-4 174-779 210-932l51-222 21-93h129c71 0 129 1 129 3l-49 218c-144 634-172 756-177 772l-5 17h121v13c0 6-12 60-27 120l-28 107H248c-104 0-188-1-188-3z" />
      <path d="M622 858l139-625 21-93h288l2 238 3 237 141-235 140-235 163-3 163-3-4 13c-3 7-49 212-103 456l-98 442h-275l4-17c38-164 74-327 72-329-2-1-43 76-93 172l-90 174H900l-2-166-3-166-74 336-74 336H503l119-532z" />
      <path d="M810 1381c0-16 48-210 55-221l6-10h1280l-5 18-27 120-22 102H810v-9z" />
      <path d="M1550 1048l69-308 68-305 328-3 327-2-5 13c-2 7-15 59-27 115l-23 102h-414l-37 173-43 195-5 22h-119c-65 0-119-1-119-2z" />
      <path d="M1714 318l22-105 16-73h650l-5 23-23 105-17 82h-649l6-32z" />
    </svg>
  )
}

function UiMockupSvg() {
  // Animation duration for the full "playback" cycle
  const cycle = '8s'

  return (
    <svg
      className={styles.uiMockupSvg}
      viewBox="0 0 600 360"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="MelodAI player interface mockup"
    >
      <defs>
        <linearGradient id="mockupAccent" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff2d55" />
          <stop offset="100%" stopColor="#cc0033" />
        </linearGradient>
        <linearGradient id="albumGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff2d55" stopOpacity="0.6" />
          <stop offset="50%" stopColor="#8b0000" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#cc0033" stopOpacity="0.7" />
        </linearGradient>
        <filter id="activeGlow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id="windowClip">
          <rect x="0" y="0" width="600" height="360" rx="12" />
        </clipPath>
      </defs>

      {/* Outer window */}
      <g clipPath="url(#windowClip)">
        {/* Main background */}
        <rect x="0" y="0" width="600" height="360" fill="#06060a" rx="12" />

        {/* Sidebar */}
        <rect x="0" y="0" width="60" height="360" fill="#141420" />
        {/* Sidebar queue items */}
        <rect x="10" y="52" width="40" height="6" rx="3" fill="#e8e8ec" opacity="0.15" />
        <rect x="10" y="66" width="40" height="6" rx="3" fill="#e8e8ec" opacity="0.1" />
        <rect x="10" y="80" width="40" height="6" rx="3" fill="#e8e8ec" opacity="0.1" />
        <rect x="10" y="94" width="36" height="6" rx="3" fill="#e8e8ec" opacity="0.08" />
        <rect x="10" y="108" width="40" height="6" rx="3" fill="#e8e8ec" opacity="0.08" />
        <rect x="10" y="122" width="32" height="6" rx="3" fill="#e8e8ec" opacity="0.06" />
        <rect x="10" y="136" width="40" height="6" rx="3" fill="#e8e8ec" opacity="0.06" />
        {/* Sidebar active item highlight - slides down queue */}
        <rect x="4" y="50" width="52" height="10" rx="4" fill="url(#mockupAccent)" opacity="0.15">
          <animate attributeName="y" values="50;64;78;92;106;120;134;120;106;92;78;64;50" dur="12s" repeatCount="indefinite" />
        </rect>

        {/* Sidebar icon at top */}
        <circle cx="30" cy="24" r="10" fill="url(#mockupAccent)" opacity="0.25" />
        <rect x="24" y="20" width="12" height="8" rx="2" fill="#e8e8ec" opacity="0.3" />

        {/* Header bar */}
        <rect x="60" y="0" width="540" height="44" fill="#0c0c12" />
        <line x1="60" y1="44" x2="600" y2="44" stroke="#e8e8ec" strokeWidth="0.5" opacity="0.08" />

        {/* Header - avatar circle */}
        <circle cx="88" cy="22" r="12" fill="#e8e8ec" opacity="0.1" />
        <circle cx="88" cy="19" r="4" fill="#e8e8ec" opacity="0.2" />
        <ellipse cx="88" cy="28" rx="6" ry="4" fill="#e8e8ec" opacity="0.15" />

        {/* Header - search bar */}
        <rect x="240" y="12" width="200" height="20" rx="10" fill="#e8e8ec" opacity="0.06" />
        <circle cx="254" cy="22" r="5" fill="none" stroke="#e8e8ec" strokeWidth="1.2" opacity="0.2" />
        <line x1="258" y1="26" x2="261" y2="29" stroke="#e8e8ec" strokeWidth="1.2" opacity="0.2" strokeLinecap="round" />
        <rect x="268" y="20" width="48" height="4" rx="2" fill="#e8e8ec" opacity="0.1" />

        {/* Header - right side icons */}
        <circle cx="556" cy="22" r="4" fill="#e8e8ec" opacity="0.12" />
        <circle cx="574" cy="22" r="4" fill="#e8e8ec" opacity="0.12" />

        {/* Main content area */}
        {/* Album art square - breathing pulse */}
        <g>
          <animateTransform
            attributeName="transform"
            type="scale"
            values="1;1.015;1"
            dur="4s"
            repeatCount="indefinite"
            additive="sum"
          />
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0,0;-2.4,-1.6;0,0"
            dur="4s"
            repeatCount="indefinite"
            additive="sum"
          />
          <rect x="270" y="62" width="100" height="100" rx="6" fill="url(#albumGrad)" />
          {/* Album art inner detail - music note */}
          <circle cx="320" cy="108" r="8" fill="#e8e8ec" opacity="0.08" />
          <line x1="328" y1="108" x2="328" y2="88" stroke="#e8e8ec" strokeWidth="2" opacity="0.08" strokeLinecap="round" />
          <rect x="326" y="86" width="8" height="5" rx="2" fill="#e8e8ec" opacity="0.08" />
        </g>

        {/* Lyrics lines - animated karaoke cycling */}
        {/* Each line animates opacity to simulate the active line moving down */}

        {/* Line 1 */}
        <rect x="255" y="180" width="130" height="8" rx="4" fill="#e8e8ec">
          <animate attributeName="opacity" values="0.9;0.2;0.12;0.08;0.06;0.9" dur={cycle} repeatCount="indefinite" />
          <animate attributeName="fill" values="#ff2d55;#e8e8ec;#e8e8ec;#e8e8ec;#e8e8ec;#ff2d55" dur={cycle} repeatCount="indefinite" />
          <animate attributeName="height" values="11;8;8;8;8;11" dur={cycle} repeatCount="indefinite" />
          <animate attributeName="y" values="178;180;180;180;180;178" dur={cycle} repeatCount="indefinite" />
        </rect>

        {/* Line 2 */}
        <rect x="240" y="197" width="160" height="8" rx="4" fill="#e8e8ec">
          <animate attributeName="opacity" values="0.2;0.9;0.2;0.12;0.08;0.2" dur={cycle} repeatCount="indefinite" />
          <animate attributeName="fill" values="#e8e8ec;#ff2d55;#e8e8ec;#e8e8ec;#e8e8ec;#e8e8ec" dur={cycle} repeatCount="indefinite" />
          <animate attributeName="height" values="8;11;8;8;8;8" dur={cycle} repeatCount="indefinite" />
          <animate attributeName="y" values="197;195;197;197;197;197" dur={cycle} repeatCount="indefinite" />
        </rect>

        {/* Line 3 (starts as active) */}
        <rect x="225" y="216" width="190" height="11" rx="5" fill="url(#mockupAccent)" filter="url(#activeGlow)">
          <animate attributeName="opacity" values="0.12;0.2;0.9;0.2;0.12;0.12" dur={cycle} repeatCount="indefinite" />
          <animate attributeName="fill" values="#e8e8ec;#e8e8ec;#ff2d55;#e8e8ec;#e8e8ec;#e8e8ec" dur={cycle} repeatCount="indefinite" />
          <animate attributeName="height" values="8;8;11;8;8;8" dur={cycle} repeatCount="indefinite" />
          <animate attributeName="y" values="216;216;214;216;216;216" dur={cycle} repeatCount="indefinite" />
        </rect>

        {/* Line 4 */}
        <rect x="248" y="237" width="144" height="8" rx="4" fill="#e8e8ec">
          <animate attributeName="opacity" values="0.08;0.12;0.2;0.9;0.2;0.08" dur={cycle} repeatCount="indefinite" />
          <animate attributeName="fill" values="#e8e8ec;#e8e8ec;#e8e8ec;#ff2d55;#e8e8ec;#e8e8ec" dur={cycle} repeatCount="indefinite" />
          <animate attributeName="height" values="8;8;8;11;8;8" dur={cycle} repeatCount="indefinite" />
          <animate attributeName="y" values="237;237;237;235;237;237" dur={cycle} repeatCount="indefinite" />
        </rect>

        {/* Line 5 */}
        <rect x="262" y="254" width="116" height="8" rx="4" fill="#e8e8ec">
          <animate attributeName="opacity" values="0.06;0.08;0.12;0.2;0.9;0.06" dur={cycle} repeatCount="indefinite" />
          <animate attributeName="fill" values="#e8e8ec;#e8e8ec;#e8e8ec;#e8e8ec;#ff2d55;#e8e8ec" dur={cycle} repeatCount="indefinite" />
          <animate attributeName="height" values="8;8;8;8;11;8" dur={cycle} repeatCount="indefinite" />
          <animate attributeName="y" values="254;254;254;254;252;254" dur={cycle} repeatCount="indefinite" />
        </rect>

        {/* Bottom control bar */}
        <rect x="60" y="310" width="540" height="50" fill="#0c0c12" />
        <line x1="60" y1="310" x2="600" y2="310" stroke="#e8e8ec" strokeWidth="0.5" opacity="0.08" />

        {/* Bottom - small track info */}
        <rect x="80" y="325" width="50" height="5" rx="2.5" fill="#e8e8ec" opacity="0.15" />
        <rect x="80" y="335" width="34" height="4" rx="2" fill="#e8e8ec" opacity="0.08" />

        {/* Bottom - playback controls (center) */}
        {/* Previous */}
        <polygon points="290,335 298,330 298,340" fill="#e8e8ec" opacity="0.2" />
        {/* Play button - pulsing glow */}
        <circle cx="320" cy="335" r="13" fill="url(#mockupAccent)" opacity="0.85">
          <animate attributeName="r" values="13;14.5;13" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.85;1;0.85" dur="2s" repeatCount="indefinite" />
        </circle>
        <polygon points="316,329 316,341 327,335" fill="#ffffff" opacity="0.95" />
        {/* Next */}
        <polygon points="350,335 342,330 342,340" fill="#e8e8ec" opacity="0.2" />

        {/* Bottom - progress bar track */}
        <rect x="160" y="350" width="320" height="3" rx="1.5" fill="#e8e8ec" opacity="0.08" />
        {/* Progress bar fill - animates left to right */}
        <rect x="160" y="350" width="0" height="3" rx="1.5" fill="url(#mockupAccent)" opacity="0.7">
          <animate attributeName="width" values="0;320" dur={cycle} repeatCount="indefinite" />
        </rect>
        {/* Progress dot - moves with the bar */}
        <circle cy="351.5" r="5" fill="url(#mockupAccent)">
          <animate attributeName="cx" values="160;480" dur={cycle} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.6;1;1;1;1;1;1;0.6" dur={cycle} repeatCount="indefinite" />
        </circle>

        {/* Bottom - volume area (right side) */}
        <rect x="500" y="334" width="50" height="3" rx="1.5" fill="#e8e8ec" opacity="0.08" />
        <rect x="500" y="334" width="30" height="3" rx="1.5" fill="#e8e8ec" opacity="0.2" />
        <circle cx="530" cy="335.5" r="3" fill="#e8e8ec" opacity="0.3" />

        {/* Subtle second volume slider below */}
        <rect x="500" y="342" width="50" height="3" rx="1.5" fill="#e8e8ec" opacity="0.06" />
        <rect x="500" y="342" width="38" height="3" rx="1.5" fill="url(#mockupAccent)" opacity="0.2" />
        <circle cx="538" cy="343.5" r="3" fill="url(#mockupAccent)" opacity="0.3" />
      </g>

      {/* Window border */}
      <rect x="0" y="0" width="600" height="360" rx="12" fill="none" stroke="#e8e8ec" strokeWidth="0.5" opacity="0.06" />
    </svg>
  )
}

export function AboutPage() {
  return (
    <div className={styles.page}>
      <div className={styles.accentLine} />
      <div className={styles.about}>
        <div className={styles.header}>
          <img src="/logo.svg" alt="MelodAI" />
          <div className={styles.titleRow}>
            <h1 className={styles.headerTitle}>MelodAI</h1>
            <span className={styles.version}>v2.0</span>
          </div>
          <p>AI-Powered Karaoke Experience</p>
        </div>

        <div className={styles.section}>
          <h2>What is MelodAI?</h2>
          <div className={styles.uiMockup}>
            <UiMockupSvg />
          </div>
          <p>MelodAI is a web-based karaoke application that uses AI to create an immersive singing experience. Search for any song, and our pipeline automatically separates vocals from instrumentals, extracts word-level timed lyrics, and presents a synchronized karaoke player.</p>
        </div>

        <div className={styles.section}>
          <h2>How It Works</h2>
          <ul>
            <li><strong>Search</strong> for any song using the Deezer catalog</li>
            <li><strong>Demucs AI</strong> separates vocals from instrumental tracks</li>
            <li><strong>WhisperX</strong> extracts word-level timed lyrics with speaker detection</li>
            <li><strong>LLM post-processing</strong> formats lyrics into natural lines</li>
            <li><strong>Play</strong> with independent volume controls for vocals and instrumental</li>
          </ul>
        </div>

        <div className={styles.section}>
          <h2>Technology</h2>
          <div className={styles.techGrid}>
            {TECH.map(t => <div key={t} className={styles.techItem}>{t}</div>)}
          </div>
        </div>

        <div className={styles.branding}>
          <span className={styles.brandingText}>A project by</span>
          <div className={styles.brandingRow}>
            <LmfLogo className={styles.brandingLogo} />
            <span className={styles.brandingName}>lmf.logge.top</span>
          </div>
        </div>

        <div className={styles.back}>
          <Link to="/" className={styles.backBtn}>Back to Player</Link>
        </div>
      </div>
    </div>
  )
}

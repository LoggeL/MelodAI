import { useId, type CSSProperties, type KeyboardEvent } from 'react'
import { Icon } from '../common/Icon'
import styles from './Fader.module.css'

import { CHANNEL, faderShort, faderValueText, type Channel } from '../../utils/fader'

interface Props {
  channel: Channel
  value: number
  onChange: (value: number) => void
  orientation?: 'horizontal' | 'vertical'
  /** Compact single-row layout for narrow desks. */
  compact?: boolean
  disabled?: boolean
  className?: string
}

/** Native range fader with a console-style cap; ←/→ ±5, PageUp/PageDown ±25, Home/End. */
export function Fader({ channel, value, onChange, orientation = 'horizontal', compact = false, disabled, className }: Props) {
  const id = useId()
  const meta = CHANNEL[channel]
  const vertical = orientation === 'vertical'
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const steps: Record<string, number> = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 25, PageDown: -25 }
    let next: number | null = null
    if (event.key in steps) next = value + steps[event.key]
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = 100
    if (next === null) return
    event.preventDefault()
    event.stopPropagation()
    onChange(Math.max(0, Math.min(100, next)))
  }
  const style = { '--v': `${value}%`, '--vn': value / 100 } as CSSProperties
  return (
    <div className={`${styles.fader} ${styles[channel]} ${vertical ? styles.vertical : ''} ${compact ? styles.compact : ''} ${value === 0 ? styles.off : ''} ${className ?? ''}`} style={style}>
      {vertical && <output className={styles.big} htmlFor={id}>{value === 0 ? 'aus' : <>{value}<small> %</small></>}</output>}
      <label className={styles.label} htmlFor={id}><Icon name={meta.icon} size={vertical ? 20 : 16} /> {meta.label}</label>
      {!vertical && <output className={styles.value} htmlFor={id}>{faderShort(value)}</output>}
      <div className={styles.trackWrap}>
        {vertical && <span className={styles.scale} aria-hidden="true"><i>voll</i><i>½</i><i>aus</i></span>}
        {!vertical && !compact && <span className={styles.ends} aria-hidden="true" />}
        <input id={id} type="range" min={0} max={100} step={1} value={value} disabled={disabled}
          className={styles.range} aria-valuetext={faderValueText(channel, value)}
          aria-orientation={vertical ? 'vertical' : undefined}
          onKeyDown={onKeyDown} onChange={e => onChange(Number(e.target.value))} />
      </div>
      {vertical && <p className={styles.description}>{meta.description}</p>}
    </div>
  )
}

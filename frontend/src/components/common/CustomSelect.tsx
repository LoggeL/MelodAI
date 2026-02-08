import { useState, useRef, useEffect, useCallback } from 'react'
import styles from './CustomSelect.module.css'

interface Option {
  value: string
  label: string
}

interface CustomSelectProps {
  options: Option[]
  value: string
  onChange: (value: string) => void
  className?: string
}

export function CustomSelect({ options, value, onChange, className }: CustomSelectProps) {
  const [open, setOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])

  const selectedLabel = options.find(o => o.value === value)?.label ?? value

  const close = useCallback(() => {
    setOpen(false)
    setFocusedIndex(-1)
  }, [])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        close()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, close])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, close])

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (open) {
          if (focusedIndex >= 0) {
            onChange(options[focusedIndex].value)
            close()
          }
        } else {
          setOpen(true)
          setFocusedIndex(options.findIndex(o => o.value === value))
        }
        break
      case 'ArrowDown':
        e.preventDefault()
        if (!open) {
          setOpen(true)
          setFocusedIndex(options.findIndex(o => o.value === value))
        } else {
          setFocusedIndex(i => (i + 1) % options.length)
        }
        break
      case 'ArrowUp':
        e.preventDefault()
        if (open) {
          setFocusedIndex(i => (i - 1 + options.length) % options.length)
        }
        break
    }
  }

  // Scroll focused option into view
  useEffect(() => {
    if (focusedIndex >= 0 && optionRefs.current[focusedIndex]) {
      optionRefs.current[focusedIndex]!.scrollIntoView({ block: 'nearest' })
    }
  }, [focusedIndex])

  return (
    <div ref={wrapperRef} className={`${styles.wrapper} ${className ?? ''}`}>
      <button
        type="button"
        className={`${styles.trigger} ${open ? styles.triggerOpen : ''}`}
        onClick={() => {
          if (open) {
            close()
          } else {
            setOpen(true)
            setFocusedIndex(options.findIndex(o => o.value === value))
          }
        }}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={styles.triggerLabel}>{selectedLabel}</span>
        <svg className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} viewBox="0 0 16 16" fill="currentColor">
          <path d="M4.646 5.646a.5.5 0 0 1 .708 0L8 8.293l2.646-2.647a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 0 1 0-.708z" />
        </svg>
      </button>

      <div className={`${styles.dropdown} ${open ? styles.dropdownOpen : ''}`} role="listbox">
        {options.map((opt, i) => (
          <button
            key={opt.value}
            ref={el => { optionRefs.current[i] = el }}
            type="button"
            role="option"
            aria-selected={opt.value === value}
            className={[
              styles.option,
              opt.value === value ? styles.optionSelected : '',
              i === focusedIndex ? styles.optionFocused : '',
            ].join(' ')}
            onClick={() => {
              onChange(opt.value)
              close()
            }}
            onMouseEnter={() => setFocusedIndex(i)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

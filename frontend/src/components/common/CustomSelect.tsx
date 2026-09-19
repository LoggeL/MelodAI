import styles from './CustomSelect.module.css'

interface Option { value: string; label: string }
interface CustomSelectProps {
  options: Option[]
  value: string
  onChange: (value: string) => void
  className?: string
  'aria-label'?: string
  id?: string
  disabled?: boolean
}

/** Native select provides consistent keyboard, touch, and screen reader behavior. */
export function CustomSelect({ options, value, onChange, className, 'aria-label': label, id, disabled }: CustomSelectProps) {
  return <select id={id} className={`${styles.trigger} ${className ?? ''}`} value={value}
    aria-label={label || 'Select an option'} disabled={disabled} onChange={event => onChange(event.target.value)}>
    {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>
}

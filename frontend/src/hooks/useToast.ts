import { useCallback, useMemo } from 'react'
import { ICONS, type IconName } from '../components/common/icons'

type ToastType = 'success' | 'error' | 'warning' | 'info'

const ICON: Record<ToastType, IconName> = { success: 'check', error: 'alert', warning: 'alert', info: 'info' }
const VISIBLE = 2
const SVG_NS = 'http://www.w3.org/2000/svg'

interface ToastState { remaining: number; started: number; timer: number | null }
const states = new WeakMap<HTMLElement, ToastState>()

function icon(name: IconName) {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', 'icon')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '20')
  svg.setAttribute('height', '20')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.innerHTML = ICONS[name]
  return svg
}

function remove(toast: HTMLElement) {
  const state = states.get(toast)
  if (state?.timer) clearTimeout(state.timer)
  const container = toast.parentElement
  toast.remove()
  if (container) schedule(container)
}

function start(toast: HTMLElement) {
  const state = states.get(toast)
  if (!state || state.timer !== null) return
  state.started = Date.now()
  state.timer = window.setTimeout(() => remove(toast), state.remaining)
}

function pause(toast: HTMLElement) {
  const state = states.get(toast)
  if (!state || state.timer === null) return
  clearTimeout(state.timer)
  state.timer = null
  state.remaining = Math.max(1500, state.remaining - (Date.now() - state.started))
}

/** At most two toasts are visible; the rest wait their turn (§5.8). */
function schedule(container: Element) {
  Array.from(container.children).forEach((child, index) => {
    const toast = child as HTMLElement
    const visible = index < VISIBLE
    toast.hidden = !visible
    if (visible && !toast.matches(':hover, :focus-within')) start(toast)
  })
}

export function showToast(message: string, type: ToastType = 'success') {
  // A native modal makes the rest of the document inert. Its notifications must
  // live inside the dialog so they remain visible, announced, and dismissible.
  const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]')
  const container = dialogs.item(dialogs.length - 1)?.querySelector('[data-dialog-notifications]')
    || document.getElementById('toast-container')
  if (!container) return
  const toast = document.createElement('div')
  toast.className = `toast toast-${type}`
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status')
  const text = document.createElement('span')
  text.textContent = message
  const dismiss = document.createElement('button')
  dismiss.type = 'button'
  dismiss.setAttribute('aria-label', 'Benachrichtigung schließen')
  dismiss.append(icon('x'))
  dismiss.onclick = () => remove(toast)
  toast.append(icon(ICON[type]), text, dismiss)
  states.set(toast, { remaining: type === 'error' ? 8000 : 4000, started: 0, timer: null })
  toast.addEventListener('mouseenter', () => pause(toast))
  toast.addEventListener('focusin', () => pause(toast))
  toast.addEventListener('mouseleave', () => { if (!toast.matches(':focus-within')) start(toast) })
  toast.addEventListener('focusout', event => { if (!toast.contains(event.relatedTarget as Node | null) && !toast.matches(':hover')) start(toast) })
  container.appendChild(toast)
  // Keep the queue short: drop the oldest waiting toasts beyond six.
  while (container.children.length > 6) (container.children[VISIBLE] as HTMLElement | undefined)?.remove()
  schedule(container)
}

export function useToast() {
  const success = useCallback((msg: string) => showToast(msg, 'success'), [])
  const error = useCallback((msg: string) => showToast(msg, 'error'), [])
  const warning = useCallback((msg: string) => showToast(msg, 'warning'), [])
  const info = useCallback((msg: string) => showToast(msg, 'info'), [])
  return useMemo(() => ({ success, error, warning, info }), [success, error, warning, info])
}

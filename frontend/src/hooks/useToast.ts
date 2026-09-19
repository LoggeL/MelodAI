import { useCallback, useMemo } from 'react'

type ToastType = 'success' | 'error' | 'warning'

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
  dismiss.textContent = '×'
  dismiss.setAttribute('aria-label', 'Dismiss notification')
  const timeout = window.setTimeout(() => toast.remove(), type === 'error' ? 10000 : 5000)
  dismiss.onclick = () => { clearTimeout(timeout); toast.remove() }
  toast.append(text, dismiss)
  container.appendChild(toast)
  while (container.children.length > 4) container.firstElementChild?.remove()
}

export function useToast() {
  const success = useCallback((msg: string) => showToast(msg, 'success'), [])
  const error = useCallback((msg: string) => showToast(msg, 'error'), [])
  const warning = useCallback((msg: string) => showToast(msg, 'warning'), [])
  return useMemo(() => ({ success, error, warning }), [success, error, warning])
}

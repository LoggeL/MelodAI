import { useCallback, useMemo } from 'react'

type ToastType = 'success' | 'error' | 'warning'

function showToast(message: string, type: ToastType = 'success') {
  let container = document.getElementById('toast-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'toast-container'
    document.body.appendChild(container)
  }

  const toast = document.createElement('div')
  toast.style.cssText = `
    pointer-events: auto;
    padding: 14px 20px;
    border-radius: 8px;
    font-size: 0.875rem;
    font-weight: 500;
    color: #fff;
    backdrop-filter: blur(20px);
    box-shadow: 0 8px 30px rgba(0,0,0,0.2);
    max-width: 380px;
    animation: toastIn 0.4s cubic-bezier(0.4,0,0.2,1) forwards;
    font-family: 'Poppins', sans-serif;
  `
  const colors = {
    success: 'rgba(16, 185, 129, 0.9)',
    error: 'rgba(239, 68, 68, 0.9)',
    warning: 'rgba(245, 158, 11, 0.9)',
  }
  toast.style.background = colors[type]
  toast.textContent = message

  // Add keyframes if not exists
  if (!document.getElementById('toast-keyframes')) {
    const style = document.createElement('style')
    style.id = 'toast-keyframes'
    style.textContent = `
      @keyframes toastIn { from { opacity: 0; transform: translateX(100px); } to { opacity: 1; transform: translateX(0); } }
      @keyframes toastOut { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(100px); } }
    `
    document.head.appendChild(style)
  }

  container.appendChild(toast)
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s cubic-bezier(0.4,0,0.2,1) forwards'
    setTimeout(() => toast.remove(), 300)
  }, 3000)
}

export function useToast() {
  const success = useCallback((msg: string) => showToast(msg, 'success'), [])
  const error = useCallback((msg: string) => showToast(msg, 'error'), [])
  const warning = useCallback((msg: string) => showToast(msg, 'warning'), [])
  return useMemo(() => ({ success, error, warning }), [success, error, warning])
}

export { showToast }

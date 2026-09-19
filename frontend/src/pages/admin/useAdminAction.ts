import { useRef, useState } from 'react'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../account/errors'

/** Lock an administrative mutation until its result is known. */
export function useAdminAction() {
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const toast = useToast()

  const run = async (action: () => Promise<unknown>, success: string) => {
    if (pending.current) return false
    pending.current = true
    setBusy(true)
    try {
      const result = await action()
      if (result && typeof result === 'object' && 'success' in result && result.success === false) {
        throw new Error('The change could not be saved. Please try again.')
      }
      toast.success(success)
      return true
    } catch (error) {
      toast.error(errorMessage(error))
      return false
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return { busy, run }
}

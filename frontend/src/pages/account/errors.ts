import { de } from '../../utils/messages'

export function errorMessage(error: unknown, fallback = 'Etwas ist schiefgelaufen. Bitte versuch es noch einmal.') {
  return error instanceof Error ? de(error.message) : fallback
}

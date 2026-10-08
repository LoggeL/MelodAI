/**
 * German UI copy for known backend and client messages. The backend keeps its
 * English contract; the frontend maps the texts it knows. Unknown text passes
 * through unchanged.
 */
const MESSAGES: Record<string, string> = {
  // auth
  'Account pending approval': 'Dein Konto wartet noch auf die Freigabe durch einen Admin.',
  'Admin access required': 'Dafür brauchst du Admin-Rechte.',
  'Authentication required': 'Bitte melde dich an.',
  'Not authenticated': 'Bitte melde dich an.',
  'Both passwords required': 'Bitte fülle beide Passwortfelder aus.',
  'Credentials changed. Please sign in again.': 'Deine Zugangsdaten haben sich geändert. Bitte melde dich neu an.',
  'Password changed on another device. Please sign in again.': 'Das Passwort wurde auf einem anderen Gerät geändert. Bitte melde dich neu an.',
  'Current password is incorrect': 'Das aktuelle Passwort ist falsch.',
  'Email already in use': 'Diese E-Mail-Adresse wird schon verwendet.',
  'Invalid credentials': 'Anmeldung fehlgeschlagen: Benutzername oder Passwort ist falsch.',
  'Invalid invite key': 'Dieser Einladungsschlüssel ist ungültig.',
  'Invalid or expired reset token': 'Der Link zum Zurücksetzen ist ungültig oder abgelaufen.',
  'Token and new password required': 'Bitte gib ein neues Passwort ein.',
  'Too many failed login attempts. Please try again later.': 'Zu viele Fehlversuche. Bitte versuch es später noch einmal.',
  'User not found': 'Nutzer nicht gefunden.',
  'Username already taken': 'Dieser Benutzername ist schon vergeben.',
  'Username and password required': 'Bitte gib Benutzername und Passwort ein.',
  'Username required': 'Bitte gib deinen Benutzernamen ein.',
  'Cannot delete your own account': 'Du kannst dein eigenes Konto nicht löschen.',
  'Cannot demote your own account': 'Du kannst dir die Admin-Rechte nicht selbst entziehen.',
  'If the account exists, a reset email has been sent.': 'Falls das Konto existiert, ist eine E-Mail zum Zurücksetzen unterwegs.',
  'Password changed successfully': 'Passwort geändert.',
  'Password reset successful': 'Passwort zurückgesetzt.',
  'Registration submitted. Waiting for admin approval.': 'Registrierung eingegangen. Sie wartet auf die Freigabe durch einen Admin.',
  'Registration successful': 'Registrierung erfolgreich.',
  // tracks
  'AI lyrics fetch failed': 'Die KI konnte keinen Text liefern.',
  'AI returned no lyrics': 'Die KI hat keinen Text geliefert.',
  'Invalid processing stage': 'Unbekannter Verarbeitungsschritt.',
  'Invalid segment index': 'Ungültige Zeile.',
  'Invalid word index': 'Ungültiges Wort.',
  'Invalid track ID': 'Ungültige Song-ID.',
  'Lyrics fetch failed': 'Der Text konnte nicht geladen werden.',
  'Lyrics not found': 'Kein Text gefunden.',
  'Missing title or artist in metadata': 'Titel oder Interpret fehlen in den Metadaten.',
  'Name required': 'Bitte gib einen Namen ein.',
  'No lyrics found': 'Kein Text gefunden.',
  'No songs available': 'Noch keine fertigen Songs in der Bibliothek.',
  'No translatable lyrics': 'Dieser Song hat keinen Text zum Übersetzen.',
  'No vocals file or raw lyrics available for this track': 'Für diesen Song fehlen Gesangsspur oder Rohtext.',
  'Not found': 'Nicht gefunden.',
  'Processing is temporarily unavailable': 'Die Verarbeitung ist gerade nicht verfügbar.',
  'Search is temporarily unavailable': 'Die Suche ist gerade nicht erreichbar.',
  'Search query must be at most 500 characters': 'Die Suche darf höchstens 500 Zeichen lang sein.',
  'Song is already processing': 'Dieser Song wird schon verarbeitet.',
  'Track already in playlist': 'Der Song ist schon in dieser Playlist.',
  'Track ID required': 'Song-ID fehlt.',
  'Track not found': 'Song nicht gefunden.',
  'Translation failed': 'Die Übersetzung ist fehlgeschlagen.',
  'Unsupported language': 'Diese Sprache wird nicht unterstützt.',
  'Valid Deezer ARL required': 'Bitte gib einen gültigen Deezer-ARL ein.',
  'Wait for processing to finish before deleting this song': 'Warte, bis die Verarbeitung fertig ist, bevor du den Song löschst.',
  // admin / status
  'Compression started in background': 'Komprimierung läuft im Hintergrund.',
  'Deezer login active': 'Deezer-Anmeldung aktiv.',
  'Deezer login failed': 'Deezer-Anmeldung fehlgeschlagen.',
  'No active processing': 'Gerade wird nichts verarbeitet.',
  'No Deezer ARL configured': 'Kein Deezer-ARL hinterlegt.',
  // client
  'Unable to connect. Check your connection and try again.': 'Keine Verbindung. Prüf deine Internetverbindung und versuch es noch einmal.',
  'The server returned an unexpected response. Please try again.': 'Der Server hat unerwartet geantwortet. Bitte versuch es noch einmal.',
}

export function de(message: string): string {
  return MESSAGES[message.trim()] ?? message
}

export function requestFailed(status: number): string {
  return `Anfrage fehlgeschlagen (${status}). Bitte versuch es noch einmal.`
}

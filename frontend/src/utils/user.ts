/** Avatar initials: first letters of the first two words, else the first letter. */
export function initials(displayName: string, username: string) {
  const source = (displayName || username || '?').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : source.slice(0, 1)).toUpperCase()
}

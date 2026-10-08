/** Deezer covers come in several sizes; the library grid asks for 500×500. */
export function hiResCover(url?: string | null): string | null {
  return url ? url.replace(/\/\d+x\d+/, '/500x500') : null
}

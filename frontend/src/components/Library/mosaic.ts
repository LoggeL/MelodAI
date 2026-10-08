/** Which tiles a playlist cover shows: one full cover, or a 2×2 grid where missing covers stay tinted. */
export function mosaicTiles(covers: readonly string[] | undefined): Array<string | null> {
  const list = (covers ?? []).filter(Boolean).slice(0, 4)
  if (list.length <= 1) return list
  return [0, 1, 2, 3].map(i => list[i] ?? null)
}

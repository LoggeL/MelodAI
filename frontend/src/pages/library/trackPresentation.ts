export function hiResCover(url?: string | null): string {
  return url ? url.replace(/\/\d+x\d+/, '/500x500') : '/logo.svg'
}

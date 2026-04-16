export function getQuarterKey(isoDate: string | null, tz: string): string | null {
  if (!isoDate) return null
  const d = new Date(isoDate)
  if (isNaN(d.getTime())) return null
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
  })
  const parts = formatter.format(d).split('-').map(Number)
  const year = parts[0]
  const month = parts[1] ?? 1
  const q = Math.floor((month - 1) / 3) + 1
  return `${year}-Q${q}`
}

export function getCurrentQuarterKey(tz: string): string {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
  })
  const parts = formatter.format(now).split('-').map(Number)
  const year = parts[0]
  const month = parts[1] ?? 1
  const q = Math.floor((month - 1) / 3) + 1
  return `${year}-Q${q}`
}

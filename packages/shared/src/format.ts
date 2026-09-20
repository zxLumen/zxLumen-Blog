export const fmtInt = (n: number) => n.toLocaleString('en-US')

export const fmtCompact = (n: number) => {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

export const fmtCny = (n: number) => '¥' + n.toFixed(n < 1 ? 3 : 2)

export const fmtDate = (iso: string) => iso.slice(0, 10)

export const fmtDateTime = (iso: string) => iso.replace('T', ' ').slice(0, 16)

const nf2 = new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nf4 = new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
const pf = new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export const num = (v: number | string | null | undefined) => nf2.format(Number(v ?? 0))
export const curs = (v: number | string | null | undefined) => (v == null ? '—' : nf4.format(Number(v)))
export const bani = (v: number | string | null | undefined, moneda: string) => `${num(v)} ${moneda === 'RON' ? 'lei' : moneda}`
export const procent = (v: number | string | null | undefined) => `${pf.format(Number(v ?? 0))}%`

export function data(d: string | null | undefined) {
  if (!d) return '—'
  const [y, m, z] = d.slice(0, 10).split('-')
  return `${z}.${m}.${y}`
}

export function iban(v: string) {
  return v.replace(/(.{4})/g, '$1 ').trim()
}

export const STARE_CONTRACT: Record<string, string> = {
  activ: 'Activ', suspendat: 'Suspendat', finalizat: 'Finalizat', reziliat: 'Reziliat',
}

export const MOD_CALCUL: Record<string, string> = {
  plati: 'pe plăți', pontaj: 'pe pontaj', amortizare: 'amortizare', procent: 'procent automat',
}

export const TIP_TRANSA: Record<string, string> = {
  prefinantare: 'Prefinanțare', avans: 'Avans', intermediara: 'Plată intermediară', finala: 'Plată finală', alta: 'Altă tranșă',
}

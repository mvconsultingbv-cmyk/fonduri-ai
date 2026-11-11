// Cititorul de extrase BCR (formatul PDF „EXTRAS DE CONT … pe perioada …”, George / BCR Business).
// Primește textul PDF-ului cu poziții (x, y pe pagină) și scoate antetul, soldurile și operațiunile.
// Nu scrie nimic în baza de date: doar citește. Verificările (lanț, totaluri) se fac înainte de salvare.

export type Element = { pagina: number; x: number; y: number; text: string }

export type OperatiuneCitita = {
  rand: number
  data_operatiune: string        // AAAA-LL-ZZ
  data_valuta: string
  data_tranzactie: string | null // la plățile cu cardul: ziua reală a cumpărăturii
  sens: 'debit' | 'credit'
  suma: number
  referinta: string
  descriere: string
  curs: number | null            // cursul schimbului valutar sau cursul BNR al zilei (conturi în valută)
  tip_propus: string
  parinte_rand: number | null    // comisionul se leagă de plata pentru care a fost perceput
}

export type ExtrasCitit = {
  banca: 'BCR'
  numar: string
  data_emitere: string | null
  data_inceput: string
  data_sfarsit: string
  iban: string
  moneda: string
  titular: string | null
  cui_titular: string | null
  sold_initial: number
  sold_final: number
  total_debit: number
  total_credit: number
  operatiuni: OperatiuneCitita[]
  avertismente: string[]
}

// Coloanele extrasului BCR (poziția x pe pagină, în puncte PDF)
const X_EXPLICATIE = 60
const X_REFERINTA = 345
const X_DEBIT = 455
const X_CREDIT = 540

const reDataOra = /^(\d{2})-(\d{2})-(\d{4}) \d{2}:\d{2}$/

export const isoDinRo = (s: string) => { const m = s.match(/(\d{2})[-.](\d{2})[-.](\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : '' }
export const sumaRo = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'))

type Rand = { pagina: number; y: number; el: Element[] }

// Grupează elementele în rânduri (aceeași linie = același y, cu toleranță de 2 puncte)
function randuri(elemente: Element[]): Rand[] {
  const out: Rand[] = []
  const pePagini = new Map<number, Element[]>()
  for (const e of elemente) if (e.text.trim()) (pePagini.get(e.pagina) ?? pePagini.set(e.pagina, []).get(e.pagina)!).push(e)
  for (const p of [...pePagini.keys()].sort((a, b) => a - b)) {
    const rs: Rand[] = []
    for (const e of pePagini.get(p)!.sort((a, b) => b.y - a.y)) {
      const r = rs.find(r => Math.abs(r.y - e.y) <= 2)
      if (r) r.el.push(e); else rs.push({ pagina: p, y: e.y, el: [e] })
    }
    rs.forEach(r => r.el.sort((a, b) => a.x - b.x))
    out.push(...rs)
  }
  return out
}

const textRand = (r: Rand) => r.el.map(e => e.text.trim()).join(' ')
const intre = (r: Rand, de: number, pana: number) => r.el.filter(e => e.x >= de && e.x < pana).map(e => e.text.trim()).filter(Boolean)

function antetPagina(t: string) {
  return /^BANCA COMERCIALA ROMANA/.test(t) || /^EXTRAS DE CONT Nr\./.test(t) || /^pe perioada:/.test(t) || /^Pagina \d+ din \d+$/.test(t) || reDataOra.test(t)
}

// Conturile contractului: un cont mixt e „al proiectului” doar până la sfârșitul perioadei mixte
export type ContContract = { iban: string; proiect_pana_la?: string | null }

export function citesteExtrasBCR(elemente: Element[], conturiContract: ContContract[] = []): ExtrasCitit {
  const rs = randuri(elemente)
  const toate = rs.map(textRand).join('\n')
  if (!/BANCA COMERCIALA ROMANA/.test(toate) || !/EXTRAS DE CONT/.test(toate)) throw new Error('Fișierul nu pare un extras de cont BCR.')

  const g = (re: RegExp) => toate.match(re)
  const numar = g(/EXTRAS DE CONT Nr\.\s*(\S+)\s+din data:\s*(\d{2}-\d{2}-\d{4})/)
  const per = g(/pe perioada:\s*(\d{2}-\d{2}-\d{4})\s*-\s*(\d{2}-\d{2}-\d{4})/)
  const ib = g(/Cod IBAN(?: Nou)?:\s*(RO\d{2}[A-Z]{4}[0-9A-Z]{16})/)
  const mon = g(/Produse in valuta\s+([A-Z]{3})/)
  if (!numar || !per || !ib) throw new Error('Nu am găsit numărul extrasului, perioada sau IBAN-ul.')
  const moneda = mon ? (mon[1] === 'ROL' ? 'RON' : mon[1]) : ib[1].slice(-3) === 'ROL' ? 'RON' : 'RON'
  const titular = g(/Titular:\s*(.+?)\s+CIC:/)?.[1] ?? null
  const cui = g(/CUI\/CNP:\s*(\d+)/)?.[1] ?? null
  const av: string[] = []

  const ops: OperatiuneCitita[] = []
  let curent: (OperatiuneCitita & { _expl: string[]; _doc: string[] }) | null = null
  let cursZi: number | null = null
  let soldInitial: number | null = null
  let totalD: number | null = null, totalC: number | null = null, soldFinal: number | null = null
  let inZona = false

  const inchide = () => {
    if (!curent) return
    const expl = curent._expl.join(' ').replace(/\s+/g, ' ').trim()
    const [ref, ...doc] = curent._doc
    curent.referinta = ref ?? ''
    curent.descriere = doc.length ? `${expl} [${doc.join(' ')}]` : expl
    const dv = expl.match(/data valutei (\d{2}-\d{2}-\d{4})/)
    if (dv) curent.data_valuta = isoDinRo(dv[1])
    const dt = expl.match(/Data_Ora: (\d{2}-\d{2}-\d{4})/)
    curent.data_tranzactie = dt ? isoDinRo(dt[1]) : null
    const cs = expl.match(/Curs: (\d+[.,]\d+)/)
    if (cs) curent.curs = Number(cs[1].replace(',', '.'))
    const { _expl, _doc, ...op } = curent
    void _expl; void _doc
    ops.push(op)
    curent = null
  }

  for (const r of rs) {
    const t = textRand(r)
    const prim = r.el[0]
    if (/^Data:/.test(t) && /Sold contabil initial:/.test(t)) {
      inchide(); inZona = true
      const s = sumaRo(r.el[r.el.length - 1].text)
      if (soldInitial === null) soldInitial = s
      cursZi = null
      continue
    }
    if (/^Total tranzactii finalizate pe perioada:/.test(t)) {
      inchide(); inZona = false
      const sume = r.el.filter(e => e.x >= X_DEBIT - 20).map(e => sumaRo(e.text))
      ;[totalD, totalC] = [sume[0], sume[1]]
      continue
    }
    if (/^Sold contabil final la:/.test(t)) { soldFinal = sumaRo(r.el[r.el.length - 1].text); continue }
    if (/^Sold contabil initial la:/.test(t) && soldInitial === null) { soldInitial = sumaRo(r.el[r.el.length - 1].text); continue }
    if (!inZona) continue
    if (antetPagina(t)) continue
    if (/^Curs BNR:/.test(t)) { cursZi = sumaRo(r.el[r.el.length - 1].text); continue }
    if (/^Data operatiunii/.test(t) || /^Data Valorii/.test(t) || t === 'Tranzactii finalizate:') continue
    if (/^Tranzactii finalizate:/.test(t) || /^Sold contabil final:/.test(t)) { inchide(); continue }

    if (prim.x < X_EXPLICATIE && reDataOra.test(prim.text.trim())) {
      inchide()
      const zi = isoDinRo(prim.text)
      const deb = r.el.filter(e => e.x >= X_DEBIT && e.x < X_CREDIT).map(e => sumaRo(e.text))[0] ?? 0
      const cre = r.el.filter(e => e.x >= X_CREDIT).map(e => sumaRo(e.text))[0] ?? 0
      if ((deb > 0) === (cre > 0)) av.push(`Rândul din ${prim.text}: nu e clar dacă e debit sau credit.`)
      curent = {
        rand: ops.length + 1, data_operatiune: zi, data_valuta: zi, data_tranzactie: null,
        sens: deb > 0 ? 'debit' : 'credit', suma: deb > 0 ? deb : cre, referinta: '', descriere: '',
        curs: moneda === 'RON' ? null : cursZi, tip_propus: 'altele', parinte_rand: null,
        _expl: intre(r, X_EXPLICATIE, X_REFERINTA), _doc: intre(r, X_REFERINTA, X_DEBIT),
      }
      continue
    }
    if (curent) {
      curent._expl.push(...intre(r, X_EXPLICATIE, X_REFERINTA))
      curent._doc.push(...intre(r, X_REFERINTA, X_DEBIT))
    }
  }
  inchide()

  const sumD = rot(ops.filter(o => o.sens === 'debit').reduce((s, o) => s + o.suma, 0))
  const sumC = rot(ops.filter(o => o.sens === 'credit').reduce((s, o) => s + o.suma, 0))
  if (totalD === null || totalC === null) { totalD = sumD; totalC = sumC; av.push('Nu am găsit rândul cu totalurile perioadei; le-am calculat din operațiuni.') }
  if (soldFinal === null) throw new Error('Nu am găsit soldul final al extrasului.')
  if (soldInitial === null) soldInitial = rot(soldFinal + totalD - totalC)

  clasifica(ops, ib[1], moneda, conturiContract)
  return {
    banca: 'BCR', numar: numar[1], data_emitere: isoDinRo(numar[2]), data_inceput: isoDinRo(per[1]), data_sfarsit: isoDinRo(per[2]),
    iban: ib[1], moneda, titular, cui_titular: cui, sold_initial: soldInitial, sold_final: soldFinal,
    total_debit: totalD, total_credit: totalC, operatiuni: ops, avertismente: av,
  }
}

export const rot = (v: number) => Math.round(v * 100) / 100

// Verificările care trebuie să treacă înainte de salvare
export function verifica(e: ExtrasCitit) {
  const sumD = rot(e.operatiuni.filter(o => o.sens === 'debit').reduce((s, o) => s + o.suma, 0))
  const sumC = rot(e.operatiuni.filter(o => o.sens === 'credit').reduce((s, o) => s + o.suma, 0))
  return [
    { ok: rot(e.sold_initial - e.total_debit + e.total_credit) === rot(e.sold_final), text: 'Sold inițial − debit + credit = sold final' },
    { ok: sumD === rot(e.total_debit), text: `Suma plăților citite (${sumD}) = totalul debit din extras` },
    { ok: sumC === rot(e.total_credit), text: `Suma încasărilor citite (${sumC}) = totalul credit din extras` },
  ]
}

// Propunerea de tip pentru fiecare operațiune. Utilizatorul o confirmă sau o schimbă pe ecranul de validare.
function clasifica(ops: OperatiuneCitita[], ibanPropriu: string, moneda: string, conturiContract: ContContract[]) {
  const alProiectului = (iban: string, zi: string) => conturiContract.some(c => c.iban === iban && iban !== ibanPropriu && (!c.proiect_pana_la || zi <= c.proiect_pana_la))
  for (const o of ops) {
    const d = o.descriere.toUpperCase()
    const benef = d.match(/BENEFICIAR:\s*([^;]*);\s*(RO\d{2}[A-Z0-9]+)?/)
    const platitor = d.match(/PLATITOR:\s*([^;]*);\s*(RO\d{2}[A-Z0-9]+)?/)
    // contul de la / către care merg banii (celălalt cont din operațiune)
    const vir = d.match(/VIRAMENT AUTOMAT DIN CONT (RO\d{2}[A-Z0-9]+).*PRODUS: (RO\d{2}[A-Z0-9]+)/)
    const altIban = vir ? (o.sens === 'debit' ? vir[2] : vir[1]) : (o.sens === 'debit' ? benef?.[2] : platitor?.[2])
    const acelasiTitular = !!(benef?.[1] && platitor?.[1] && sameFirma(benef[1], platitor[1]))
    let tip = o.sens === 'debit' ? 'plata_furnizor' : 'altele'
    if (/^(COMISION|CANAL NETBK|TAXA |ABONAMENT|COMISIOANE)/.test(d) || /COM DR PENTRU TRANZACTIA/.test(d)
      || /^INCASARE (COMISION|CONTRAVALOARE|TAXA|ABONAMENT)/.test(d) || /COMISION ADMINISTRARE|PACHET DE PRODUSE SI SERVICII/.test(d)) tip = 'comision_bancar'
    else if (/^DOBANDA|PLATA DOBANDA|DOBANDA CREDITOARE/.test(d)) tip = 'dobanda'
    else if (/SCHIMB VALUTAR/.test(d)) tip = 'schimb_valutar'
    else if (altIban && alProiectului(altIban, o.data_operatiune)) tip = 'transfer_intern'
    else if (/RETRAGERE NUMERAR|RETRAGERE DE NUMERAR|\bATM\b/.test(d) && o.sens === 'debit') tip = 'retragere_numerar'
    else if (/DEPUNERE NUMERAR/.test(d) && o.sens === 'credit') tip = 'depunere_numerar'
    else if (o.sens === 'credit' && (/^TRANZ CREDITARE/.test(d) || /PLATA GRESITA|\/RETN\//.test(d) || /DIRECTIA CARDURI/.test(d))) tip = 'restituire'
    else if (o.sens === 'debit' && ((benef && /BUGET/.test(benef[1])) || /TIMBRU|IMPOZIT|CONTRIBUTIA ASIGURATORIE/.test(d))) tip = 'plata_taxe'
    else if (o.sens === 'debit' && /SALARIU|SALARII|DREPTURI DE AUTOR|AVANS CHENZINA/.test(d)) tip = 'plata_salarii'
    else if ((acelasiTitular || vir) && altIban && altIban !== ibanPropriu) tip = 'transfer_cont_propriu'
    else if (o.sens === 'credit' && moneda !== 'RON' && o.suma >= 10000 && /ORDONATOR: .*\b(?!RO)[A-Z]{2}\d{2}[A-Z0-9]{10,}/.test(d)) tip = 'incasare_finantare'
    o.tip_propus = tip
  }
  // Comisioanele cu aceeași referință ca o plată se leagă de ea
  for (const o of ops) {
    if (o.tip_propus !== 'comision_bancar') continue
    const voucher = o.descriere.match(/voucherul (\d+)/)?.[1] ?? o.referinta
    const p = ops.find(x => x !== o && x.tip_propus !== 'comision_bancar' && x.referinta === voucher && x.data_operatiune === o.data_operatiune)
    if (p) o.parinte_rand = p.rand
  }
}

const curat = (s: string) => s.toUpperCase().replace(/ASOCIATIA|ASOC\.|AS |&|AND|S\.?R\.?L\.?|[^A-Z]/g, '')
function sameFirma(a: string, b: string) {
  const x = curat(a), y = curat(b)
  return x.length > 5 && (x.includes(y.slice(0, 10)) || y.includes(x.slice(0, 10)))
}

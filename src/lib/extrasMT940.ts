// Cititorul de extrase MT940 (standardul SWIFT, exportat de aproape toate băncile din internet banking).
// Un fișier poate avea mai multe extrase (de exemplu câte unul pe zi). Extrasele aceluiași cont din fișier
// se unesc într-unul singur, după ce se verifică lanțul lor de solduri.
// Nu scrie nimic în baza de date: doar citește. Verificările (lanț, totaluri) se fac înainte de salvare.
//
// Câmpurile folosite:  :20: referința  :25: contul  :28C: numărul extrasului
//   :60F:/:60M: soldul inițial (C/D, data AALLZZ, moneda, suma cu virgulă)   :62F:/:62M: soldul final
//   :61: operațiunea (data valutei, data înregistrării, C/D/RC/RD, suma, codul de tip, referința)
//   :86: explicația operațiunii (poate avea subcâmpuri ?20…?63, ca la băncile germane și unele românești)
//
// Setările formatului (din Biblioteca de bănci, structura formatului):
//   sold_initial_data: 'ziua_anterioara' (implicit; soldul inițial e cel de la sfârșitul zilei dinainte)
//                      sau 'aceeasi_zi' (soldul inițial poartă data primei zile a extrasului)

import type { ExtrasCitit, OperatiuneCitita, ContContract } from './extrasBCR'
import { rot } from './extrasBCR'

export type SetariMT940 = { sold_initial_data?: 'ziua_anterioara' | 'aceeasi_zi' }

type Bloc = { tag: string; val: string }
type Mt = {
  ref: string; cont: string; numar: string
  si: { semn: 1 | -1; data: string; moneda: string; suma: number } | null
  sf: { semn: 1 | -1; data: string; moneda: string; suma: number } | null
  ops: { data_valuta: string; data_inreg: string; sens: 'debit' | 'credit'; storno: boolean; suma: number; cod: string; ref: string; refBanca: string; extra: string; text: string }[]
  totD: number | null; totC: number | null
}

const sumaMt = (s: string) => Number(s.replace(',', '.'))
const dataMt = (s: string) => `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`
const ziInainte = (iso: string, n = 1) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

export function pareMT940(text: string) {
  return /:20:/.test(text) && /:25:/.test(text) && /:6[02][FM]:/.test(text)
}

function blocuri(text: string): Bloc[] {
  // scoate antetele SWIFT {1:…}{2:…}{4: și sfârșitul -}, apoi împarte pe câmpuri :NN[A]:
  const t = text.replace(/\r/g, '').replace(/\{[1-3]:[^}]*\}/g, '').replace(/\{4:/g, '').replace(/^-\}?\s*$/gm, '').replace(/\{5:[^}]*\}/g, '')
  const out: Bloc[] = []
  const re = /^:(\d{2}[A-Z]?):/gm
  const poz: { tag: string; i: number; j: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) poz.push({ tag: m[1], i: m.index, j: m.index + m[0].length })
  poz.forEach((p, k) => out.push({ tag: p.tag, val: t.slice(p.j, k + 1 < poz.length ? poz[k + 1].i : undefined).replace(/\n-\s*$/, '').trimEnd() }))
  return out
}

const reSold = /^([CD])(\d{6})([A-Z]{3})([\d,]+)/
// :61: AALLZZ[LLZZ](C|D|RC|RD)[litera fond]suma N|F|S cod(3) referință[//referința băncii][\n detalii]
const re61 = /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?([\d,]+)([NFS][A-Z0-9]{3})([^\n]*?)(?:\/\/([^\n]*))?(?:\n([\s\S]*))?$/

function citesteBlocuri(bl: Bloc[]): Mt[] {
  const lista: Mt[] = []
  let x: Mt | null = null
  for (const b of bl) {
    const v = b.val
    if (b.tag === '20') { x = { ref: v.trim(), cont: '', numar: '', si: null, sf: null, ops: [], totD: null, totC: null }; lista.push(x); continue }
    if (!x) continue
    if (b.tag === '25') x.cont = v.trim()
    else if (b.tag === '28C' || b.tag === '28') x.numar = v.trim()
    else if (b.tag === '60F' || b.tag === '60M') { const m = v.match(reSold); if (m) x.si = { semn: m[1] === 'C' ? 1 : -1, data: dataMt(m[2]), moneda: m[3], suma: sumaMt(m[4]) } }
    else if (b.tag === '62F' || b.tag === '62M') { const m = v.match(reSold); if (m) x.sf = { semn: m[1] === 'C' ? 1 : -1, data: dataMt(m[2]), moneda: m[3], suma: sumaMt(m[4]) } }
    else if (b.tag === '90D') { const m = v.match(/^\d+[A-Z]{3}([\d,]+)/); if (m) x.totD = sumaMt(m[1]) }
    else if (b.tag === '90C') { const m = v.match(/^\d+[A-Z]{3}([\d,]+)/); if (m) x.totC = sumaMt(m[1]) }
    else if (b.tag === '61') {
      const m = v.match(re61)
      if (!m) throw new Error(`Nu am putut citi operațiunea „${v.slice(0, 40)}…”.`)
      const dv = dataMt(m[1])
      let di = dv
      if (m[2]) { // data înregistrării are doar luna și ziua; anul e cel al datei valutei (sau vecinul, la trecerea dintre ani)
        di = `${dv.slice(0, 4)}-${m[2].slice(0, 2)}-${m[2].slice(2, 4)}`
        if (m[2].slice(0, 2) === '01' && dv.slice(5, 7) === '12') di = `${Number(dv.slice(0, 4)) + 1}${di.slice(4)}`
        if (m[2].slice(0, 2) === '12' && dv.slice(5, 7) === '01') di = `${Number(dv.slice(0, 4)) - 1}${di.slice(4)}`
      }
      // RC = anularea unei încasări (scade soldul, deci debit); RD = anularea unei plăți (crește soldul, deci credit)
      const storno = m[3].startsWith('R')
      const c = m[3] === 'C' || m[3] === 'RD'
      x.ops.push({ data_valuta: dv, data_inreg: di, sens: c ? 'credit' : 'debit', storno, suma: sumaMt(m[5]), cod: m[6], ref: (m[7] ?? '').trim(), refBanca: (m[8] ?? '').trim(), extra: (m[9] ?? '').replace(/\n/g, ' ').trim(), text: '' })
    } else if (b.tag === '86' && x.ops.length) {
      x.ops[x.ops.length - 1].text = textExplicatie(v)
    }
  }
  return lista
}

// Explicația :86:. Cu subcâmpuri (?20 … ?63) le unim curat; altfel unim rândurile.
function textExplicatie(v: string) {
  const plat = v.replace(/\n/g, '')
  if (/\?\d{2}/.test(plat)) {
    const parti: Record<string, string> = {}
    for (const m of plat.matchAll(/\?(\d{2})([^?]*)/g)) parti[m[1]] = (parti[m[1]] ?? '') + m[2]
    const txt = Object.keys(parti).filter(k => +k >= 20 && +k <= 29 || +k >= 60 && +k <= 63).sort().map(k => parti[k]).join('')
    const nume = [parti['32'], parti['33']].filter(Boolean).join('')
    const iban = parti['31'] ?? ''
    return [txt, nume && `Contrapartidă: ${nume}`, iban && `IBAN: ${iban}`].filter(Boolean).join('; ').replace(/\s+/g, ' ').trim()
  }
  return v.split('\n').map(s => s.trim()).join(' ').replace(/\s+/g, ' ').trim()
}

// Contul din :25: poate fi „IBAN”, „BIC/IBAN” sau „IBAN MONEDA”
function ibanDin(cont: string) {
  const t = cont.replace(/\s/g, '').toUpperCase()
  const m = t.match(/[A-Z]{2}\d{2}[A-Z0-9]{10,30}/)
  if (!m) return ''
  if (m[0].startsWith('RO')) return m[0].slice(0, 24)
  return m[0].replace(/(RON|EUR|USD|GBP|CHF|HUF|PLN)$/, '')
}

export function citesteExtrasMT940(text: string, conturiContract: ContContract[] = [], setari: SetariMT940 = {}): ExtrasCitit[] {
  if (!pareMT940(text)) throw new Error('Fișierul nu pare un extras MT940 (lipsesc câmpurile :20:, :25:, :60F:).')
  const lista = citesteBlocuri(blocuri(text))
  if (!lista.length) throw new Error('Nu am găsit niciun extras în fișier.')

  // grupăm pe cont, în ordinea datelor
  const peCont = new Map<string, Mt[]>()
  for (const x of lista) {
    const ib = ibanDin(x.cont)
    if (!ib) throw new Error(`Nu am găsit IBAN-ul în câmpul de cont „${x.cont}”.`)
    peCont.set(ib, [...(peCont.get(ib) ?? []), x])
  }

  const rezultat: ExtrasCitit[] = []
  for (const [iban, xs] of peCont) {
    xs.sort((a, b) => (a.sf?.data ?? '').localeCompare(b.sf?.data ?? ''))
    const av: string[] = []
    const ops: OperatiuneCitita[] = []
    let totD = 0, totC = 0
    for (let k = 0; k < xs.length; k++) {
      const x = xs[k]
      if (!x.si || !x.sf) throw new Error(`Extrasul ${x.numar || x.ref} nu are soldul inițial sau final.`)
      if (x.si.moneda !== x.sf.moneda) throw new Error(`Extrasul ${x.numar || x.ref} are monede diferite la solduri.`)
      if (k > 0) {
        const ant = xs[k - 1].sf!
        if (rot(ant.semn * ant.suma) !== rot(x.si.semn * x.si.suma))
          av.push(`Lanț rupt în fișier: soldul final al extrasului ${xs[k - 1].numar} (${ant.semn * ant.suma}) diferă de soldul inițial al extrasului ${x.numar} (${x.si.semn * x.si.suma}).`)
      }
      let d = 0, c = 0
      for (const o of x.ops) {
        const sens: 'debit' | 'credit' = o.sens
        if (sens === 'debit') d += o.suma; else c += o.suma
        const desc = [o.text || o.extra, o.storno ? '(stornare)' : ''].filter(Boolean).join(' ')
        ops.push({
          rand: ops.length + 1, data_operatiune: o.data_inreg, data_valuta: o.data_valuta, data_tranzactie: null,
          sens, suma: rot(o.suma), referinta: o.refBanca || (o.ref && o.ref !== 'NONREF' ? o.ref : ''), descriere: desc,
          curs: null, tip_propus: 'altele', parinte_rand: null, ...{ _cod: o.cod.slice(1) } as object,
        } as OperatiuneCitita)
      }
      if (x.totD !== null && rot(x.totD) !== rot(d)) av.push(`Extrasul ${x.numar}: totalul debit declarat (${x.totD}) diferă de suma operațiunilor (${rot(d)}).`)
      if (x.totC !== null && rot(x.totC) !== rot(c)) av.push(`Extrasul ${x.numar}: totalul credit declarat (${x.totC}) diferă de suma operațiunilor (${rot(c)}).`)
      if (rot(x.si.semn * x.si.suma - d + c) !== rot(x.sf.semn * x.sf.suma)) av.push(`Extrasul ${x.numar}: soldul nu se închide (${x.si.semn * x.si.suma} − ${rot(d)} + ${rot(c)} ≠ ${x.sf.semn * x.sf.suma}).`)
      totD += d; totC += c
    }
    const prim = xs[0], ultim = xs[xs.length - 1]
    const dataSi = prim.si!.data
    let inceput = setari.sold_initial_data === 'aceeasi_zi' || dataSi >= ultim.sf!.data ? dataSi : ziInainte(dataSi)
    const primaOp = ops.map(o => o.data_operatiune).sort()[0]
    if (primaOp && primaOp < inceput) inceput = primaOp
    const moneda = prim.si!.moneda
    clasificaGeneric(ops, iban, moneda, conturiContract)
    rezultat.push({
      banca: 'MT940',
      numar: xs.length === 1 ? (prim.numar || prim.ref) : `${prim.numar || prim.ref} – ${ultim.numar || ultim.ref}`,
      data_emitere: null, data_inceput: inceput, data_sfarsit: ultim.sf!.data,
      iban, moneda, titular: null, cui_titular: null,
      sold_initial: rot(prim.si!.semn * prim.si!.suma), sold_final: rot(ultim.sf!.semn * ultim.sf!.suma),
      total_debit: rot(totD), total_credit: rot(totC),
      operatiuni: ops.map(o => { const { _cod, ...r } = o as OperatiuneCitita & { _cod?: string }; void _cod; return r }),
      avertismente: xs.length > 1 ? [`Fișierul are ${xs.length} extrase ale contului, unite într-unul singur.`, ...av] : av,
    })
  }
  return rezultat
}

// Propunerea de tip, după codul SWIFT al operațiunii și cuvintele din explicație (comune băncilor din România).
// Utilizatorul o confirmă sau o schimbă pe ecranul de validare.
export function clasificaGeneric(ops: OperatiuneCitita[], ibanPropriu: string, moneda: string, conturiContract: ContContract[]) {
  const alProiectului = (iban: string, zi: string) => conturiContract.some(c => c.iban === iban && iban !== ibanPropriu && (!c.proiect_pana_la || zi <= c.proiect_pana_la))
  for (const o of ops) {
    const cod = ((o as OperatiuneCitita & { _cod?: string })._cod ?? '').toUpperCase()
    const d = o.descriere.toUpperCase()
    const ibanuri = [...d.matchAll(/\b([A-Z]{2}\d{2}[A-Z0-9]{12,30})\b/g)].map(m => m[1]).filter(i => i !== ibanPropriu)
    const altIban = ibanuri[0]
    let tip = o.sens === 'debit' ? 'plata_furnizor' : 'altele'
    if (cod === 'CHG' || cod === 'COM' || /^(COMISION|COMISIOANE|TAXA |ABONAMENT)|COMISION ADMINISTRARE|PACHET/.test(d)) tip = 'comision_bancar'
    else if (cod === 'INT' || /DOBAND/.test(d)) tip = 'dobanda'
    else if (cod === 'FEX' || /SCHIMB VALUTAR|VANZARE VALUTA|CUMPARARE VALUTA|\bFX\b/.test(d)) tip = 'schimb_valutar'
    else if (altIban && alProiectului(altIban, o.data_operatiune)) tip = 'transfer_intern'
    else if (o.sens === 'debit' && /RETRAGERE NUMERAR|RETRAGERE DE NUMERAR|RIDICARE NUMERAR|\bATM\b|CASH WITHDRAWAL/.test(d)) tip = 'retragere_numerar'
    else if (o.sens === 'credit' && /DEPUNERE NUMERAR|CASH DEPOSIT/.test(d)) tip = 'depunere_numerar'
    else if (o.sens === 'credit' && (cod === 'RTI' || /RETUR|RESTITUIRE|STORNARE|PLATA GRESITA/.test(d))) tip = 'restituire'
    else if (o.sens === 'debit' && /TREZORERI|BUGET|IMPOZIT|CONTRIBUTI|TIMBRU|ANAF/.test(d)) tip = 'plata_taxe'
    else if (o.sens === 'debit' && /SALARI|DREPTURI DE AUTOR|AVANS CHENZINA/.test(d)) tip = 'plata_salarii'
    else if (o.sens === 'credit' && moneda !== 'RON' && o.suma >= 10000 && altIban && !altIban.startsWith('RO')) tip = 'incasare_finantare'
    o.tip_propus = tip
  }
  // Un comision cu aceeași referință ca o plată din aceeași zi se leagă de ea
  for (const o of ops) {
    if (o.tip_propus !== 'comision_bancar' || !o.referinta) continue
    const p = ops.find(x => x !== o && x.tip_propus !== 'comision_bancar' && x.referinta === o.referinta && x.data_operatiune === o.data_operatiune)
    if (p) o.parinte_rand = p.rand
  }
}

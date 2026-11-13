// Cititorul de extrase Patria Bank (PDF „Tranzactii decontate in perioada …”, generat din internet banking).
// Particularități:
//   - extrasul nu are număr; numărul se compune din perioadă (de ex. „01.01-22.01.2026”);
//   - fiecare operațiune are două date: data tranzacției (ziua reală, de ex. a cumpărăturii cu cardul)
//     și data decontării (ziua în care banca a mișcat banii) – a doua e data operațiunii în aplicație;
//   - sumele au punct la zecimale (893.00); debitul și creditul sunt în coloane separate;
//   - soldul după fiecare operațiune e tipărit cu „CR” (sold pozitiv) sau „DB” (sold negativ).
//     Cititorul refăce soldul rând cu rând și îl compară cu cel tipărit, ca la ING;
//   - referința băncii e la sfârșitul descrierii (OPRPTI.11839322, ODCR.34005590 …); comisionul
//     unei operațiuni are aceeași referință ca ea, deci se leagă automat de ea.
// Nu scrie nimic în baza de date: doar citește.

import type { ContContract, Element, ExtrasCitit, OperatiuneCitita } from './extrasBCR'
import { clasificaGeneric } from './extrasMT940'

// Coloanele tabelului de operațiuni (poziția x pe pagină, în puncte PDF)
const X_DATA_DECONTARE = 70   // coloana „Data decontare” (înainte: „Data tranzactie”)
const X_DESCRIERE = 130       // coloana „Descriere tranzactie”
const X_DEBIT = 380           // coloana „Rulaj Debit”
const X_CREDIT = 455          // coloana „Rulaj Credit”
const X_SOLD = 535            // coloana „Sold”
const Y_SUBSOL = 50           // dedesubt: datele băncii și numărul paginii

const reData = /^(\d{2})-(\d{2})-(\d{4})$/
const iso = (s: string) => { const m = s.match(/(\d{2})-(\d{2})-(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : '' }
const ro = (s: string) => s.split('-').reverse().join('.')
// 1,234.56 sau 1234.56 → 1234.56
const suma = (s: string) => Number(s.trim().replace(/,/g, ''))
const eSuma = (s: string) => /^\d{1,3}(,?\d{3})*\.\d{2}$/.test(s.trim())
// „893.00 CR” → 893 ; „12.50 DB” → -12.5 ; „0.00” → 0
const sold = (s: string) => { const m = s.trim().match(/^(\d[\d,]*\.\d{2})\s*(CR|DB)?$/); return m ? (m[2] === 'DB' ? -suma(m[1]) : suma(m[1])) : null }
const rot = (v: number) => Math.round(v * 100) / 100
const reRef = /([A-Z][A-Z_]*\.\d{4,})\s*$/
// suma tipărită la dreapta unei etichete, pe același rând vizual (valorile pot sta cu 2–3 puncte mai sus decât eticheta)
const sumaLanga = (el: Element[], y: number, xMin: number, xMax = Infinity) => {
  const v = el.filter(e => e.x >= xMin && e.x < xMax && Math.abs(e.y - y) <= 4 && sold(e.text) !== null).sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y))[0]
  return v ? sold(v.text) : null
}

type Rand = { pagina: number; y: number; el: Element[] }
function randuri(elemente: Element[], toleranta: number): Rand[] {
  const out: Rand[] = []
  const pePagini = new Map<number, Element[]>()
  for (const e of elemente) if (e.text.trim()) (pePagini.get(e.pagina) ?? pePagini.set(e.pagina, []).get(e.pagina)!).push(e)
  for (const p of [...pePagini.keys()].sort((a, b) => a - b)) {
    const rs: Rand[] = []
    for (const e of pePagini.get(p)!.sort((a, b) => b.y - a.y)) {
      const r = rs.find(r => Math.abs(r.y - e.y) <= toleranta)
      if (r) r.el.push(e); else rs.push({ pagina: p, y: e.y, el: [e] })
    }
    rs.forEach(r => r.el.sort((a, b) => a.x - b.x))
    out.push(...rs)
  }
  return out
}

// Patria se recunoaște după subsolul primei pagini („Patria Bank S.A. - …”) și după tabelul „Tranzactii decontate in perioada”.
// Un extras al altei bănci care pomenește Patria într-o plată nu are textul în subsol.
export const parePatria = (elemente: Element[]) => {
  const p1 = elemente.filter(e => e.pagina === 1)
  const subsol = randuri(p1.filter(e => e.y < Y_SUBSOL), 2).map(r => r.el.map(e => e.text.trim()).join(' '))
  return subsol.some(t => /^Patria Bank S\.A\./.test(t)) && randuri(p1, 2).some(r => /^Tranzactii decontate in perioada/.test(r.el.map(e => e.text.trim()).join(' ')))
}

export function citesteExtrasPatria(elemente: Element[], conturiContract: ContContract[] = []): ExtrasCitit {
  if (!parePatria(elemente)) throw new Error('Fișierul nu pare un extras de cont Patria Bank.')
  const av: string[] = []
  const p1 = elemente.filter(e => e.pagina === 1)
  const txt = randuri(p1, 2).map(r => r.el.map(e => e.text.trim()).join(' '))
  const g = (re: RegExp) => txt.map(t => t.match(re)).find(Boolean) ?? null

  const ibanM = g(/^IBAN:\s*([A-Z]{2}\d{2}[A-Z0-9]{10,30})/)
  if (!ibanM) throw new Error('Nu am găsit IBAN-ul contului în antetul extrasului.')
  const iban = ibanM[1]
  const moneda = g(/^Valuta:\s*([A-Z]{3})/)?.[1] ?? 'RON'
  const titular = g(/^Client:\s*(.+)$/)?.[1].trim() ?? null
  const cui = g(/CUI:\s*(?:RO)?\s*(\d+)/)?.[1] ?? null
  const generat = g(/^Data generare extras de cont:\s*(\d{2}-\d{2}-\d{4})/)
  const per = g(/^Tranzactii decontate in perioada\s*(\d{2}-\d{2}-\d{4})\s*-\s*(\d{2}-\d{2}-\d{4})/)
  if (!per) throw new Error('Nu am găsit perioada extrasului („Tranzactii decontate in perioada …”).')
  const dataIn = iso(per[1]), dataSf = iso(per[2])

  // Soldurile și totalurile din antet: eticheta în stânga, valoarea în dreapta, pe același rând (cu 2–3 puncte diferență pe verticală)
  const randuriAntet = randuri(p1.filter(e => e.x < X_SOLD), 1)
  const valoare = (re: RegExp) => {
    const r = randuriAntet.find(r => re.test(r.el.map(e => e.text.trim()).join(' ')))
    return r ? sumaLanga(p1, r.y, X_SOLD) ?? NaN : NaN
  }
  const soldInitial = valoare(/^Sold Initial:/)
  const totalD = valoare(/^Total tranzactii Debit:/)
  const totalC = valoare(/^Total tranzactii Credit:/)
  const soldFinal = valoare(/^Sold Final:/)
  if ([soldInitial, totalD, totalC, soldFinal].some(v => !Number.isFinite(v))) throw new Error('Nu am putut citi soldurile sau totalurile din antetul extrasului.')
  const inCurs = valoare(/^Total tranzactii in curs de decontare/)
  const blocate = valoare(/^Total sume blocate de Banca:/)
  if (inCurs > 0) av.push(`La generarea extrasului erau ${inCurs.toFixed(2)} ${moneda} plăți cu cardul în curs de decontare. Ele nu sunt în acest extras; vor apărea în extrasul următor.`)
  if (blocate > 0) av.push(`La generarea extrasului banca bloca ${blocate.toFixed(2)} ${moneda} în cont.`)

  // Operațiunile: între rândul „Sold Initial” al tabelului și rândul „TOTAL”
  const rs = randuri(elemente, 2)
  const ops: OperatiuneCitita[] = []
  const solduri: (number | null)[] = []
  let cur: (OperatiuneCitita & { _linii: string[]; _sold: number | null }) | null = null
  let inZona = false, gata = false, soldTabel: number | null = null, totalTabel: { d: number; c: number } | null = null
  const inchide = () => {
    if (!cur) return
    let t = cur._linii.join(' ').replace(/\s+/g, ' ').trim()
    const m = t.match(reRef)
    if (m) { cur.referinta = m[1]; t = t.slice(0, m.index).trim() }
    cur.descriere = t
    const { _linii, _sold, ...op } = cur
    void _linii
    ops.push(op); solduri.push(_sold)
    cur = null
  }
  for (const r of rs) {
    if (gata) break
    if (r.y < Y_SUBSOL) continue
    const t = r.el.map(e => e.text.trim()).join(' ')
    if (!inZona) {
      if (/^Sold Initial(?!:)/.test(t)) { inZona = true; soldTabel = sumaLanga(elemente.filter(e => e.pagina === r.pagina), r.y, X_SOLD) }
      continue
    }
    if (/^(Data|tranzactie)\b/.test(t) && r.el.some(e => /^(Rulaj|Debit|Credit|Sold)$/.test(e.text.trim()))) continue // capul de tabel repetat pe pagina următoare
    if (/^TOTAL\b/.test(t)) {
      inchide()
      const pe = elemente.filter(e => e.pagina === r.pagina)
      totalTabel = { d: sumaLanga(pe, r.y, X_DEBIT - 10, X_CREDIT) ?? 0, c: sumaLanga(pe, r.y, X_CREDIT, X_SOLD) ?? 0 }
      gata = true
      continue
    }
    const prim = r.el[0]
    if (prim.x < X_DATA_DECONTARE && reData.test(prim.text.trim())) {
      inchide()
      const dec = r.el.find(e => e.x >= X_DATA_DECONTARE && e.x < X_DESCRIERE && reData.test(e.text.trim()))
      const deb = r.el.filter(e => e.x >= X_DEBIT - 10 && e.x < X_CREDIT && eSuma(e.text))
      const cre = r.el.filter(e => e.x >= X_CREDIT && e.x < X_SOLD && eSuma(e.text))
      const sl = r.el.find(e => e.x >= X_SOLD)
      if (deb.length + cre.length !== 1) av.push(`Operațiunea din ${prim.text.trim()} (rândul ${ops.length + 1}): am găsit ${deb.length + cre.length} sume în loc de una.`)
      const zi = iso(dec?.text ?? prim.text), ziTr = iso(prim.text)
      cur = {
        rand: ops.length + 1, data_operatiune: zi, data_valuta: zi, data_tranzactie: ziTr !== zi ? ziTr : null,
        sens: deb.length ? 'debit' : 'credit', suma: rot(suma((deb[0] ?? cre[0])?.text ?? '0')), referinta: '', descriere: '',
        curs: null, tip_propus: 'altele', parinte_rand: null,
        _linii: r.el.filter(e => e.x >= X_DESCRIERE && e.x < X_DEBIT - 10).map(e => e.text.trim()), _sold: sl ? sold(sl.text) : null,
      }
      continue
    }
    if (cur) cur._linii.push(...r.el.filter(e => e.x >= X_DESCRIERE && e.x < X_DEBIT - 10).map(e => e.text.trim()))
  }
  inchide()
  if (!inZona) throw new Error('Nu am găsit tabelul cu operațiunile extrasului.')
  if (!ops.length && (totalD || totalC)) throw new Error('Nu am găsit operațiunile extrasului.')

  // Verificări proprii acestui extras: soldul inițial din tabel și totalul de la sfârșitul tabelului = cele din antet
  if (soldTabel !== null && rot(soldTabel) !== rot(soldInitial)) av.push(`Soldul inițial din tabel (${soldTabel}) diferă de cel din antet (${soldInitial}).`)
  if (!totalTabel) av.push('Nu am găsit rândul TOTAL de la sfârșitul tabelului de operațiuni.')
  else if (rot(totalTabel.d) !== rot(totalD) || rot(totalTabel.c) !== rot(totalC)) av.push(`Totalul din tabel (debit ${totalTabel.d}, credit ${totalTabel.c}) diferă de cel din antet (debit ${totalD}, credit ${totalC}).`)

  // Verificarea rând cu rând: soldul refăcut din operațiuni = soldul tipărit de bancă după fiecare operațiune
  const gresite: number[] = []
  let s = soldInitial
  ops.forEach((o, i) => {
    s = rot(s + (o.sens === 'credit' ? o.suma : -o.suma))
    if (solduri[i] === null || rot(solduri[i]!) !== s) gresite.push(o.rand)
  })

  clasificaGeneric(ops, iban, moneda, conturiContract)

  return {
    banca: 'Patria Bank', numar: `${ro(dataIn).slice(0, 5)}-${ro(dataSf)}`, data_emitere: generat ? iso(generat[1]) : null,
    data_inceput: dataIn, data_sfarsit: dataSf, iban, moneda, titular, cui_titular: cui,
    sold_initial: soldInitial, sold_final: soldFinal, total_debit: totalD, total_credit: totalC,
    operatiuni: ops, avertismente: av,
    control_randuri: { verificate: ops.length, gresite },
  }
}

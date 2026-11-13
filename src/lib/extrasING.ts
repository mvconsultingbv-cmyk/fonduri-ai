// Cititorul de extrase ING Business (PDF „Extras de cont”, ING Bank N.V. Amsterdam Sucursala București).
// ING nu exportă MT940 pentru conturile de firmă, deci extrasul se citește din PDF.
// Particularități față de BCR:
//   - sumele au virgulă la mii și punct la zecimale (2,150.00); plățile apar cu minus (-1,790.00);
//   - fiecare operațiune are „Sold intermediar”, adică soldul după ea. Cititorul refăce soldul rând cu rând
//     și îl compară cu cel tipărit, deci verificarea e pe fiecare operațiune, nu doar pe totalul lunii;
//   - comisionul pe operațiune e un rând separat, imediat după plată, cu referința următoare (1750 → 1751).
// Nu scrie nimic în baza de date: doar citește.

import type { ContContract, Element, ExtrasCitit, OperatiuneCitita } from './extrasBCR'
import { clasificaGeneric } from './extrasMT940'

const X_DESCRIERE = 140     // coloana „Beneficiar / Ordonator / Descrierea tranzacției”
const X_SUME = 300          // de aici încep sumele (debitări, creditări, sold intermediar)
const Y_ANTET = 735         // deasupra: antetul paginii (banca, titularul, IBAN-ul)
const Y_SUBSOL = 55         // dedesubt: textul de subsol și numărul paginii

const reData = /^(\d{2})\.(\d{2})\.(\d{4})$/
const iso = (s: string) => { const m = s.match(/(\d{2})[.-](\d{2})[.-](\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : '' }
// 2,150.00 → 2150 ; -1,790.00 → -1790
export const sumaIng = (s: string) => Number(s.trim().replace(/,/g, ''))
const eSuma = (s: string) => /^-?\d{1,3}(,\d{3})*\.\d{2}$/.test(s.trim())
const rot = (v: number) => Math.round(v * 100) / 100

type Rand = { pagina: number; y: number; el: Element[] }
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

// Doar antetul primei pagini contează: un extras BCR poate pomeni „ING Bank N.V.” în explicația unei plăți.
export const pareING = (elemente: Element[]) => {
  const antet = elemente.filter(e => e.pagina === 1 && e.y >= Y_ANTET)
  return antet.some(e => /^ING Bank N\.V\./.test(e.text.trim())) && antet.some(e => /^Extras de cont$/.test(e.text.trim()))
}

type InLucru = OperatiuneCitita & { _linii: string[]; _sold: number | null; _refNr: number | null }

export function citesteExtrasING(elemente: Element[], conturiContract: ContContract[] = []): ExtrasCitit {
  if (!pareING(elemente)) throw new Error('Fișierul nu pare un extras de cont ING Business.')
  const p1 = elemente.filter(e => e.pagina === 1)
  const tot = p1.map(e => e.text).join('\n')
  const g = (re: RegExp) => tot.match(re)
  const nr = g(/Nr\.\s*(\S+)\s*\/\s*(\d{2}\.\d{2}\.\d{4})/)
  const ibanTxt = g(/\b(RO\d{2}\s?[A-Z]{4}(?:\s?[0-9A-Z]{4}){4})\b/)
  const mon = g(/\|\s*([A-Z]{3})\s*$/m)
  const tit = g(/^(.+?)\s*\|\s*CUI\s*(\d+)/m)
  if (!nr || !ibanTxt) throw new Error('Nu am găsit numărul extrasului sau IBAN-ul contului.')
  const iban = ibanTxt[1].replace(/\s/g, '')
  const moneda = mon?.[1] ?? 'RON'
  const av: string[] = []

  // Rândul cu soldurile și totalurile (sub etichetele „Sold initial / Total creditari / Total debitari / Sold final / Perioada”)
  const rs = randuri(elemente)
  const iEt = rs.findIndex(r => r.pagina === 1 && r.el.some(e => /^Sold initial:/.test(e.text.trim())))
  if (iEt < 0) throw new Error('Nu am găsit rândul cu soldurile extrasului.')
  const et = rs[iEt], val = rs[iEt + 1]
  const subEticheta = (re: RegExp) => {
    const e = et.el.find(x => re.test(x.text.trim()))
    return e ? val.el.find(v => Math.abs(v.x - e.x) < 15)?.text.trim() ?? null : null
  }
  const soldInitial = sumaIng(subEticheta(/^Sold initial/) ?? 'x')
  const totalC = Math.abs(sumaIng(subEticheta(/^Total creditari/) ?? 'x'))
  const totalD = Math.abs(sumaIng(subEticheta(/^Total debitari/) ?? 'x'))
  const soldFinal = sumaIng(subEticheta(/^Sold final/) ?? 'x')
  const perioada = subEticheta(/^Perioada/) ?? ''
  if ([soldInitial, totalC, totalD, soldFinal].some(v => !Number.isFinite(v))) throw new Error('Nu am putut citi soldurile sau totalurile extrasului.')
  const nrOp = { c: Number(et.el.find(e => /Total creditari/.test(e.text))?.text.match(/\((\d+)\)/)?.[1] ?? NaN), d: Number(et.el.find(e => /Total debitari/.test(e.text))?.text.match(/\((\d+)\)/)?.[1] ?? NaN) }

  // Perioada: „01 - 31.10.2026”, „01.10 - 31.10.2026” sau „01.10.2026 - 31.10.2026”
  const pm = perioada.match(/(\d{2})(?:\.(\d{2}))?(?:\.(\d{4}))?\s*-\s*(\d{2})\.(\d{2})\.(\d{4})/)
  if (!pm) throw new Error(`Nu am înțeles perioada extrasului („${perioada}”).`)
  const dataSf = `${pm[6]}-${pm[5]}-${pm[4]}`
  const dataIn = `${pm[3] ?? pm[6]}-${pm[2] ?? pm[5]}-${pm[1]}`

  // Operațiunile: încep la „Data procesarii” și se termină la „SFARSIT EXTRAS DE CONT”
  const ops: OperatiuneCitita[] = []
  const solduri: (number | null)[] = []
  let cur: InLucru | null = null
  let inZona = false, asteptRef = false
  const inchide = () => {
    if (!cur) return
    let txt = ''
    for (const l of cur._linii) txt += txt === '' ? l : (/\S-$/.test(txt) ? l : ` ${l}`)  // „…3431-” + „a344…” se lipesc
    cur.descriere = txt.trim()
    const dt = txt.match(/\bData:\s*(\d{2}-\d{2}-\d{4})/)
    cur.data_tranzactie = dt ? iso(dt[1]) : null
    const { _linii, _sold, _refNr, ...op } = cur
    void _linii; void _refNr
    ops.push(op); solduri.push(_sold)
    cur = null
  }
  for (const r of rs) {
    if (r.y >= Y_ANTET || r.y < Y_SUBSOL) continue
    const t = r.el.map(e => e.text.trim()).join(' ')
    if (/^Data procesarii/.test(t)) { inZona = true; continue }
    if (!inZona) continue
    if (/^Referinta bancii\s+Descrierea/.test(t)) continue
    if (/SFARSIT EXTRAS DE CONT/.test(t)) { inchide(); inZona = false; continue }
    const prim = r.el[0]
    if (prim.x < X_DESCRIERE && reData.test(prim.text.trim())) {
      inchide()
      const sume = r.el.filter(e => e.x >= X_SUME && eSuma(e.text)).map(e => sumaIng(e.text))
      if (sume.length !== 2) av.push(`Operațiunea din ${prim.text.trim()} (rândul ${ops.length + 1}): am găsit ${sume.length} sume în loc de 2 (suma și soldul după ea).`)
      const suma = sume.length >= 2 ? sume[0] : 0
      const zi = iso(prim.text)
      cur = {
        rand: ops.length + 1, data_operatiune: zi, data_valuta: zi, data_tranzactie: null,
        sens: suma < 0 ? 'debit' : 'credit', suma: rot(Math.abs(suma)), referinta: '', descriere: '',
        curs: null, tip_propus: 'altele', parinte_rand: null,
        _linii: r.el.filter(e => e.x >= X_DESCRIERE && e.x < X_SUME).map(e => e.text.trim()).filter(Boolean),
        _sold: sume.length ? sume[sume.length - 1] : null, _refNr: null,
      }
      asteptRef = true
      continue
    }
    if (!cur) continue
    if (asteptRef && prim.x < X_DESCRIERE && /^\d+$/.test(prim.text.trim())) {
      cur.referinta = prim.text.trim(); asteptRef = false
    }
    cur._linii.push(...r.el.filter(e => e.x >= X_DESCRIERE && e.x < X_SUME).map(e => e.text.trim()).filter(Boolean))
  }
  inchide()
  if (!ops.length && (totalD || totalC)) throw new Error('Nu am găsit operațiunile extrasului.')

  // Verificarea rând cu rând: soldul refăcut din operațiuni = „Sold intermediar” tipărit de bancă
  const gresite: number[] = []
  let sold = soldInitial
  ops.forEach((o, i) => {
    sold = rot(sold + (o.sens === 'credit' ? o.suma : -o.suma))
    if (solduri[i] === null || rot(solduri[i]!) !== sold) gresite.push(o.rand)
  })
  const nD = ops.filter(o => o.sens === 'debit').length, nC = ops.length - nD
  if ((Number.isFinite(nrOp.d) && nrOp.d !== nD) || (Number.isFinite(nrOp.c) && nrOp.c !== nC))
    av.push(`Extrasul anunță ${nrOp.d} plăți și ${nrOp.c} încasări; am citit ${nD} plăți și ${nC} încasări.`)

  clasificaGeneric(ops, iban, moneda, conturiContract)
  // Comisionul pe operațiune se leagă de plata de dinainte: aceeași zi, referința următoare.
  // Taxa lunară a pachetului („Comision pe operatiune” + „Taxa lunara pachet…”) nu ține de nicio plată.
  ops.forEach((o, i) => {
    const p = ops[i - 1]
    if (!p || o.tip_propus !== 'comision_bancar' || p.tip_propus === 'comision_bancar') return
    if (o.descriere.trim().toUpperCase() !== 'COMISION PE OPERATIUNE') return
    if (p.data_operatiune === o.data_operatiune && Number(o.referinta) === Number(p.referinta) + 1) o.parinte_rand = p.rand
  })

  return {
    banca: 'ING', numar: nr[1], data_emitere: iso(nr[2]), data_inceput: dataIn, data_sfarsit: dataSf,
    iban, moneda, titular: tit?.[1].trim() ?? null, cui_titular: tit?.[2] ?? null,
    sold_initial: soldInitial, sold_final: soldFinal, total_debit: totalD, total_credit: totalC,
    operatiuni: ops, avertismente: av,
    control_randuri: { verificate: ops.length, gresite },
  }
}

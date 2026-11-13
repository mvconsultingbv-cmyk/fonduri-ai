// „Bancă nouă din extras”: din fișierul unui extras aflăm contul (IBAN-ul), banca (codul din IBAN)
// și dacă aplicația are deja un cititor pentru acest tip de fișier.
// Totul rulează în browser; fișierul nu se salvează nicăieri.

import type { Element } from './extrasBCR'
import { textCuPozitii } from './pdfText'
import { ePdf, textDinFisier } from './cititoare'
import { citesteExtrasMT940, pareMT940 } from './extrasMT940'
import { pareING } from './extrasING'
import { parePatria } from './extrasPatria'

export type Analiza = {
  tip: 'pdf' | 'mt940'
  iban: string                 // contul extrasului
  tara: string                 // primele 2 litere din IBAN
  cod: string | null           // codul băncii din IBAN (RO: caracterele 5–8)
  alteConturi: string[]        // un MT940 poate avea mai multe conturi
  cititor: 'MT940' | 'ING_PDF_V1' | 'PATRIA_PDF_V1' | null  // cititorul existent potrivit pentru o bancă nouă; null = PDF fără cititor
}

// Cifra de control a IBAN-ului (standardul ISO 13616, modulo 97)
export function ibanValid(iban: string) {
  const s = iban.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false
  const r = s.slice(4) + s.slice(0, 4)
  let rest = 0
  for (const ch of r) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55)
    for (const d of v) rest = (rest * 10 + Number(d)) % 97
  }
  return rest === 1
}

// Lungimile IBAN cunoscute pentru țările cu care lucrăm; pentru altele se încearcă de la cea mai lungă
const LUNGIME: Record<string, number> = { RO: 24, DE: 22, AT: 20, BE: 16, BG: 22, FR: 27, IT: 27, ES: 24, NL: 18, HU: 28, LT: 20, IE: 22, PL: 28 }

// Toate IBAN-urile valide dintr-un text, în ordinea în care apar (IBAN-urile pot fi scrise cu spații din 4 în 4)
export function ibanuriDinText(text: string): string[] {
  const t = text.toUpperCase()
  const gasite: string[] = []
  const start = /[A-Z]{2}\d{2}/g
  let m: RegExpExecArray | null
  while ((m = start.exec(t))) {
    if (m.index > 0 && /[A-Z0-9]/.test(t[m.index - 1])) continue // în mijlocul altui cuvânt
    let s = ''
    for (let i = m.index; i < t.length && s.length < 34; i++) {
      const c = t[i]
      if (/[A-Z0-9]/.test(c)) s += c
      else if (c === ' ' && /[A-Z0-9]/.test(t[i + 1] ?? '') && s.length % 4 === 0) continue // spațiu între grupe de 4
      else break
    }
    const tara = s.slice(0, 2)
    const lungimi = LUNGIME[tara] ? [LUNGIME[tara]] : Array.from({ length: s.length - 14 }, (_, k) => s.length - k)
    const bun = lungimi.map(n => s.slice(0, n)).find(x => x.length === (LUNGIME[tara] ?? x.length) && ibanValid(x))
    if (bun && !gasite.includes(bun)) gasite.push(bun)
  }
  return gasite
}

// Textul unui PDF în ordinea citirii: pagină cu pagină, rând cu rând (de sus în jos), de la stânga la dreapta
export function textOrdonat(el: Element[]) {
  const randuri = new Map<string, Element[]>()
  for (const e of el) {
    const k = `${e.pagina}|${Math.round(e.y / 3)}`
    randuri.set(k, [...(randuri.get(k) ?? []), e])
  }
  return [...randuri.entries()]
    .sort(([a], [b]) => { const [pa, ya] = a.split('|').map(Number), [pb, yb] = b.split('|').map(Number); return pa - pb || yb - ya })
    .map(([, r]) => r.sort((a, b) => a.x - b.x).map(e => e.text).join(' '))
    .join('\n')
}

export async function analizeazaExtras(f: File, buf: ArrayBuffer): Promise<Analiza> {
  const cod = (iban: string) => (iban.startsWith('RO') ? iban.slice(4, 8) : null)
  if (ePdf(f)) {
    const el = await textCuPozitii(buf)
    if (!el.some(e => e.text.trim())) throw new Error('PDF-ul nu are text (pare scanat). Descărcați extrasul direct din internet banking, nu scanat.')
    // contul extrasului e primul IBAN valid din antet (prima pagină); restul sunt de obicei ale partenerilor
    const prima = ibanuriDinText(textOrdonat(el.filter(e => e.pagina === 1)))
    const toate = prima.length ? prima : ibanuriDinText(textOrdonat(el))
    if (!toate.length) throw new Error('Nu am găsit niciun IBAN valid în extras. Verificați că e un extras de cont descărcat din internet banking.')
    const iban = toate[0]
    return { tip: 'pdf', iban, tara: iban.slice(0, 2), cod: cod(iban), alteConturi: [], cititor: pareING(el) ? 'ING_PDF_V1' : parePatria(el) ? 'PATRIA_PDF_V1' : null }
  }
  const text = textDinFisier(buf)
  if (!pareMT940(text)) throw new Error('Fișierul nu e nici PDF, nici MT940.')
  const ibanuri = [...new Set(citesteExtrasMT940(text).map(x => x.iban).filter(Boolean))]
  if (!ibanuri.length) throw new Error('Fișierul MT940 nu are un IBAN valid în câmpul :25: (contul).')
  const iban = ibanuri[0]
  return { tip: 'mt940', iban, tara: iban.slice(0, 2), cod: cod(iban), alteConturi: ibanuri.slice(1), cititor: 'MT940' }
}

// Alegerea cititorului de extras, după Biblioteca de bănci.
// Fiecare bancă are unul sau mai multe formate de extras; fiecare format spune ce cititor folosește:
//   BCR_PDF_V1 – PDF-ul BCR (George / BCR Business)
//   MT940      – standardul SWIFT, comun majorității băncilor (cu setări pe bancă, de ex. data soldului inițial)
// Un fișier PDF merge la cititorul PDF; un fișier text merge la MT940. Banca se află din IBAN-ul extrasului
// (contul contractului), iar formatul trebuie să fie al băncii contului.

import { citesteExtrasBCR, type ContContract, type ExtrasCitit } from './extrasBCR'
import { citesteExtrasMT940, pareMT940, type SetariMT940 } from './extrasMT940'
import { textCuPozitii } from './pdfText'

export type Format = {
  id: string; banca_id: string; versiune: number; denumire: string; tip_fisier: string
  structura: { cititor: 'BCR_PDF_V1' | 'MT940' } & SetariMT940 & Record<string, unknown>
  stare: 'propusa' | 'aprobata' | 'retrasa'; valabil_de_la: string | null
}
export type ContCunoscut = ContContract & { banca_id: string }
export type Citire = { extras: ExtrasCitit; format: Format | null; problema: string | null }

export const CITITOARE: Record<string, string> = {
  BCR_PDF_V1: 'PDF BCR (George / BCR Business)',
  MT940: 'MT940 (standard SWIFT, orice bancă)',
}

export const ePdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

export function textDinFisier(buf: ArrayBuffer) {
  const u = new TextDecoder('utf-8').decode(buf)
  return u.includes('�') ? new TextDecoder('windows-1250').decode(buf) : u
}

// formatul potrivit pentru banca contului și cititorul folosit (cel mai nou, valabil la data extrasului)
function formatPentru(formate: Format[], banca: string | undefined, cititor: string, laData: string) {
  return formate
    .filter(f => f.banca_id === banca && f.structura.cititor === cititor && f.stare !== 'retrasa' && (!f.valabil_de_la || f.valabil_de_la <= laData))
    .sort((a, b) => (a.stare === b.stare ? b.versiune - a.versiune : a.stare === 'aprobata' ? -1 : 1))[0] ?? null
}

// Citește un fișier și întoarce extrasele găsite (un PDF = un extras; un MT940 poate avea mai multe conturi).
// conturi: conturile cunoscute (ale contractului, sau toate la probă), ca să se afle banca și transferurile interne.
// doarAprobate: la încărcarea reală se folosesc doar formatele aprobate; la probă (Biblioteca de bănci) și cele propuse.
export async function citesteFisier(f: File, buf: ArrayBuffer, conturi: ContCunoscut[], formate: Format[], doarAprobate = true, bancaProba?: string): Promise<Citire[]> {
  const fmt = formate.filter(x => !doarAprobate || x.stare === 'aprobata')
  const bancaCont = (iban: string) => bancaProba ?? conturi.find(c => c.iban === iban)?.banca_id
  if (ePdf(f)) {
    if (!fmt.some(x => x.structura.cititor === 'BCR_PDF_V1')) throw new Error('Nicio bancă din bibliotecă nu are un format PDF aprobat.')
    const x = citesteExtrasBCR(await textCuPozitii(buf), conturi)
    const format = formatPentru(fmt, bancaCont(x.iban), 'BCR_PDF_V1', x.data_sfarsit)
    return [{ extras: x, format, problema: format ? null : 'Extrasul pare BCR (PDF), dar banca acestui cont nu are un format PDF BCR aprobat în Biblioteca de bănci.' }]
  }
  const text = textDinFisier(buf)
  if (!pareMT940(text)) throw new Error('Fișierul nu e nici PDF, nici MT940. Formatele acceptate sunt cele din Biblioteca de bănci.')
  // prima citire află conturile; a doua folosește setările formatului băncii fiecărui cont
  const prima = citesteExtrasMT940(text, conturi)
  return prima.map(p => {
    const format = formatPentru(fmt, bancaCont(p.iban), 'MT940', p.data_sfarsit)
    const x = format ? citesteExtrasMT940(text, conturi, format.structura).find(z => z.iban === p.iban)! : p
    return { extras: x, format, problema: format ? null : `Banca contului ${p.iban} nu are un format MT940 ${doarAprobate ? 'aprobat' : ''} în Biblioteca de bănci.`.replace('  ', ' ') }
  })
}

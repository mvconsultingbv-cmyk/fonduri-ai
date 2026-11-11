// Scoate textul unui PDF împreună cu poziția fiecărei bucăți pe pagină.
// Rulează în browser: fișierul nu pleacă nicăieri până nu e salvat.
import type { Element } from './extrasBCR'

export async function textCuPozitii(fisier: ArrayBuffer): Promise<Element[]> {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const sarcina = pdfjs.getDocument({ data: new Uint8Array(fisier.slice(0)), verbosity: 0 })
  const doc = await sarcina.promise
  const out: Element[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent()
    for (const it of tc.items) if ('str' in it) out.push({ pagina: p, x: it.transform[4], y: it.transform[5], text: it.str })
  }
  await sarcina.destroy()
  return out
}

export async function amprenta(fisier: ArrayBuffer) {
  const h = await crypto.subtle.digest('SHA-256', fisier)
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('')
}

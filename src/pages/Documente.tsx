import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { bani, data, num } from '../lib/format'

// Facturile și celelalte documente justificative: încărcare + potrivirea cu plățile din extrase.
// Aplicația propune potriviri (după numărul facturii în textul băncii, sumă, numele furnizorului, dată);
// utilizatorul confirmă. Regulile (nu potrivești peste suma plății sau a facturii, perioade raportate) sunt în baza de date.

type Doc = {
  id: string; tip: string; numar: string | null; data_document: string; data_scadenta: string | null
  furnizor_denumire: string | null; furnizor_cui: string | null; moneda: string; suma_totala: number; suma_tva: number
  tva_deductibila: boolean; descriere: string | null; fisier_cale: string | null
}
type Stare = { document_id: string; platit_potrivit: number; rest: number; stare: string; restant: boolean }
type Rec = { id: string; document_id: string; operatiune_id: string; suma: number }
type Prop = { document_id: string; operatiune_id: string; potrivire_suma: string | null; numar_in_text: boolean; nume_in_text: boolean; scor: number; rest_op: number }
type Op = { id: string; data_operatiune: string; moneda: string; suma: number; cine: string | null; detalii: string | null; descriere_banca: string | null; tip: string | null; documentat: number; aferenta_proiect: boolean | null; sens: string; operatiune_parinte_id: string | null }

const TIP_DOC: Record<string, string> = {
  factura: 'Factură', chitanta: 'Chitanță', bon_fiscal: 'Bon fiscal', stat_plata: 'Stat de plată', contract_furnizare: 'Contract',
  act_aditional: 'Act adițional', notificare: 'Notificare', proces_verbal: 'Proces-verbal', decont_cheltuieli: 'Decont cheltuieli', altul: 'Alt document',
}
const STARE: Record<string, { t: string; c: string }> = { neplatit: { t: 'fără plată', c: 'galben' }, partial: { t: 'plătit parțial', c: 'albastru-e' }, platit: { t: 'plătit', c: 'verde' } }
const DE_DOCUMENTAT = new Set(['plata_furnizor', 'retragere_numerar', 'altele'])

export default function Documente() {
  const { id } = useParams()
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [stari, setStari] = useState<Stare[]>([])
  const [recs, setRecs] = useState<Rec[]>([])
  const [props, setProps] = useState<Prop[]>([])
  const [ops, setOps] = useState<Op[]>([])
  const [eroare, setEroare] = useState<string | null>(null)
  const [mesaj, setMesaj] = useState<{ cls: string; text: string } | null>(null)
  const [lucreaza, setLucreaza] = useState(false)
  const [vedere, setVedere] = useState<'documente' | 'fara'>('documente')
  const [filtru, setFiltru] = useState('')
  const [cauta, setCauta] = useState('')
  const [deschis, setDeschis] = useState<string | null>(null)
  const [coada, setCoada] = useState<File[]>([])

  const incarca = useCallback(async () => {
    if (!id) return
    const [d, s, p] = await Promise.all([
      supabase.from('documente').select('id,tip,numar,data_document,data_scadenta,furnizor_denumire,furnizor_cui,moneda,suma_totala,suma_tva,tva_deductibila,descriere,fisier_cale').eq('contract_id', id).order('data_document', { ascending: false }),
      supabase.from('v_stare_documente').select('document_id,platit_potrivit,rest,stare,restant').eq('contract_id', id),
      supabase.from('v_potriviri_propuse').select('document_id,operatiune_id,potrivire_suma,numar_in_text,nume_in_text,scor,rest_op').eq('contract_id', id).order('scor', { ascending: false }),
    ])
    if (d.error || s.error) { setEroare('Documentele nu au putut fi citite.'); return }
    const ids = (d.data ?? []).map(x => x.id)
    const r = ids.length ? await supabase.from('reconcilieri').select('id,document_id,operatiune_id,suma').in('document_id', ids) : { data: [] }
    const toate: Op[] = []
    for (let de = 0; ; de += 1000) {
      const o = await supabase.from('v_operatiuni_validare').select('id,data_operatiune,moneda,suma,cine,detalii,descriere_banca,tip,documentat,aferenta_proiect,sens,operatiune_parinte_id')
        .eq('contract_id', id).eq('sens', 'debit').is('operatiune_parinte_id', null).order('data_operatiune').range(de, de + 999)
      if (o.error) break
      toate.push(...(o.data as Op[]))
      if ((o.data ?? []).length < 1000) break
    }
    setDocs((d.data ?? []) as Doc[]); setStari((s.data ?? []) as Stare[]); setRecs((r.data ?? []) as Rec[])
    setProps((p.data ?? []) as Prop[]); setOps(toate)
  }, [id])
  useEffect(() => { incarca() }, [incarca])

  const opDupaId = useMemo(() => new Map(ops.map(o => [o.id, o])), [ops])
  const stareDupaId = useMemo(() => new Map(stari.map(s => [s.document_id, s])), [stari])

  async function actiune(fn: () => PromiseLike<{ error: { message: string } | null }>, succes: string) {
    setLucreaza(true); setMesaj(null)
    const { error } = await fn()
    if (error) setMesaj({ cls: 'rosu', text: error.message })
    else { setMesaj({ cls: 'verde', text: succes }); await incarca() }
    setLucreaza(false)
  }
  const potriveste = (doc: string, op: string, suma?: number) =>
    actiune(() => supabase.rpc('potriveste_document', { p_document: doc, p_operatiune: op, p_suma: suma ?? null }), 'Plata a fost potrivită cu documentul.')
  const anuleaza = (rid: string) => actiune(() => supabase.rpc('anuleaza_potrivire', { p_id: rid }), 'Potrivirea a fost anulată.')

  async function deschideFisier(cale: string | null) {
    if (!cale) return
    const { data: u, error } = await supabase.storage.from('documente').createSignedUrl(cale, 300)
    if (error || !u) { setMesaj({ cls: 'rosu', text: 'Fișierul nu a putut fi deschis.' }); return }
    window.open(u.signedUrl, '_blank', 'noopener')
  }

  // Potriviri automate sigure: o singură propunere cu sumă exactă + (număr factură sau nume furnizor), nefolosită de alt document.
  const sigure = useMemo(() => {
    const peDoc = new Map<string, Prop[]>(), peOp = new Map<string, Prop[]>()
    for (const p of props) {
      if (p.potrivire_suma !== 'exacta' || !(p.numar_in_text || p.nume_in_text)) continue
      peDoc.set(p.document_id, [...(peDoc.get(p.document_id) ?? []), p]); peOp.set(p.operatiune_id, [...(peOp.get(p.operatiune_id) ?? []), p])
    }
    return [...peDoc.values()].filter(l => l.length === 1 && (peOp.get(l[0].operatiune_id) ?? []).length === 1).map(l => l[0])
  }, [props])

  async function potrivesteSigure() {
    setLucreaza(true); setMesaj(null)
    let ok = 0; const erori: string[] = []
    for (const p of sigure) {
      const { error } = await supabase.rpc('potriveste_document', { p_document: p.document_id, p_operatiune: p.operatiune_id, p_suma: null })
      if (error) erori.push(error.message); else ok++
    }
    setMesaj(erori.length ? { cls: 'galben', text: `${ok} potrivite; ${erori.length} refuzate: ${erori[0]}` } : { cls: 'verde', text: `${ok} documente potrivite automat cu plata lor.` })
    await incarca(); setLucreaza(false)
  }

  const lista = useMemo(() => {
    const t = cauta.trim().toLowerCase()
    return (docs ?? []).filter(d => {
      const s = stareDupaId.get(d.id)
      if (filtru === 'restant' ? !s?.restant : filtru && s?.stare !== filtru) return false
      return !t || `${d.numar ?? ''} ${d.furnizor_denumire ?? ''} ${d.furnizor_cui ?? ''} ${d.descriere ?? ''} ${num(d.suma_totala)}`.toLowerCase().includes(t)
    })
  }, [docs, stareDupaId, filtru, cauta])

  const faraDocument = useMemo(() => {
    const t = cauta.trim().toLowerCase()
    return ops.filter(o => o.aferenta_proiect === true && DE_DOCUMENTAT.has(o.tip ?? '') && Number(o.documentat) < Number(o.suma) - 0.004)
      .filter(o => !t || `${o.cine ?? ''} ${o.detalii ?? ''} ${o.descriere_banca ?? ''} ${num(o.suma)}`.toLowerCase().includes(t))
  }, [ops, cauta])

  if (eroare) return <><Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link><div className="alerta rosu">{eroare}</div></>
  if (!docs) return <div className="gol">Se încarcă documentele…</div>

  const nr = (s: string) => docs.filter(d => stareDupaId.get(d.id)?.stare === s).length

  return (
    <>
      <Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link>
      <section className="titlu-pagina">
        <h1>Facturi și documente</h1>
        <p>{docs.length} documente încărcate · {nr('platit')} plătite · {nr('partial')} parțial · {nr('neplatit')} fără plată potrivită · {faraDocument.length} plăți aferente fără document</p>
      </section>

      <Incarcare contractId={id!} coada={coada} setCoada={setCoada} lucreaza={lucreaza} setLucreaza={setLucreaza}
        gata={async (txt, cls) => { setMesaj({ cls, text: txt }); await incarca() }} />

      <section className="file-vederi">
        <button className={`fila ${vedere === 'documente' ? 'activa' : ''}`} onClick={() => setVedere('documente')}>Documente <span className="contor">{docs.length}</span></button>
        <button className={`fila ${vedere === 'fara' ? 'activa' : ''}`} onClick={() => setVedere('fara')}>Plăți fără document <span className={`contor ${faraDocument.length === 0 ? 'gata' : ''}`}>{faraDocument.length || '✓'}</span></button>
      </section>
      <p className="explicatie">{vedere === 'documente'
        ? 'Pentru fiecare document, aplicația caută plata din extrase: numărul facturii în textul băncii, aceeași sumă, numele furnizorului, o dată apropiată. Dumneavoastră confirmați. O factură plătită în rate se potrivește cu mai multe plăți; o plată poate acoperi mai multe facturi.'
        : 'Plăți aferente proiectului (furnizori, numerar, altele) care nu au încă un document justificativ potrivit. La raportare, fiecare cheltuială trebuie să aibă documentul ei.'}</p>

      <section className="filtre">
        {vedere === 'documente' && (
          <select value={filtru} onChange={e => setFiltru(e.target.value)} aria-label="Stare">
            <option value="">Toate stările</option><option value="neplatit">Fără plată</option><option value="partial">Plătite parțial</option><option value="platit">Plătite</option><option value="restant">Scadența depășită</option>
          </select>
        )}
        <input value={cauta} onChange={e => setCauta(e.target.value)} placeholder="Caută furnizor, număr, sumă…" />
        {vedere === 'documente' && sigure.length > 0 && (
          <button className="buton mic-b" disabled={lucreaza} onClick={potrivesteSigure} title="Doar cazurile fără dubiu: sumă identică + număr factură sau nume furnizor, o singură plată posibilă">
            Potrivește automat {sigure.length} sigure
          </button>
        )}
      </section>

      {mesaj && <div className={`alerta ${mesaj.cls} spatiu`}>{mesaj.text}</div>}

      {vedere === 'documente' ? (
        <section className="bloc fara-padding">
          <div className="tabel-wrap">
            <table className="tabel-op">
              <thead><tr><th>Data</th><th>Furnizor / document</th><th className="n">Valoare</th><th className="n">Plătit</th><th>Stare</th><th>Propuneri</th></tr></thead>
              <tbody>
                {lista.map(d => {
                  const s = stareDupaId.get(d.id)
                  const pr = props.filter(p => p.document_id === d.id)
                  const rc = recs.filter(r => r.document_id === d.id)
                  return (
                    <Fragment key={d.id}>
                      <tr>
                        <td className="nowrap">{data(d.data_document)}{d.data_scadenta && <div className={`mic ${s?.restant ? 'rosu-text' : 'gri'}`}>scadent {data(d.data_scadenta)}</div>}</td>
                        <td className="lat">
                          <button className="text-buton" onClick={() => setDeschis(deschis === d.id ? null : d.id)}>
                            <span className="tare">{d.furnizor_denumire ?? '—'}</span>
                            <div className="mic gri">{TIP_DOC[d.tip] ?? d.tip} {d.numar ?? ''}{d.descriere ? ` · ${d.descriere}` : ''}</div>
                          </button>
                        </td>
                        <td className="n tare">{bani(d.suma_totala, d.moneda)}{Number(d.suma_tva) > 0 && <div className="mic gri">TVA {num(d.suma_tva)}{d.tva_deductibila ? ' deductibilă' : ''}</div>}</td>
                        <td className="n">{num(s?.platit_potrivit)}</td>
                        <td><span className={`eticheta ${STARE[s?.stare ?? '']?.c ?? ''}`}>{STARE[s?.stare ?? '']?.t ?? '—'}</span>{s?.restant && <div className="mic rosu-text">scadență depășită</div>}</td>
                        <td>{s?.stare !== 'platit' && (pr.length > 0
                          ? <button className="link-mic" onClick={() => setDeschis(d.id)}>{pr.length} {pr.length === 1 ? 'plată posibilă' : 'plăți posibile'}</button>
                          : <span className="mic gri">—</span>)}</td>
                      </tr>
                      {deschis === d.id && (
                        <tr className="rand-detaliu"><td colSpan={6}>
                          <DetaliuDoc d={d} rest={Number(s?.rest ?? d.suma_totala)} pr={pr} rc={rc} ops={ops} opDupaId={opDupaId} lucreaza={lucreaza}
                            potriveste={potriveste} anuleaza={anuleaza} deschide={() => deschideFisier(d.fisier_cale)} />
                        </td></tr>
                      )}
                    </Fragment>
                  )
                })}
                {lista.length === 0 && <tr><td colSpan={6} className="gol-rand">{docs.length === 0 ? 'Niciun document încărcat încă. Încărcați facturile de mai sus.' : 'Niciun document pentru filtrele alese.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="bloc fara-padding">
          <div className="tabel-wrap">
            <table className="tabel-op">
              <thead><tr><th>Data</th><th>Cine / detalii</th><th className="n">Sumă</th><th className="n">Fără document</th></tr></thead>
              <tbody>
                {faraDocument.slice(0, 300).map(o => (
                  <tr key={o.id}>
                    <td className="nowrap">{data(o.data_operatiune)}<div className="mic gri">{o.moneda === 'RON' ? 'lei' : 'EUR'}</div></td>
                    <td className="lat"><span className="tare">{o.cine ?? o.descriere_banca?.slice(0, 70)}</span>{o.detalii && <div className="mic gri">{o.detalii}</div>}</td>
                    <td className="n tare">{num(o.suma)}</td>
                    <td className="n">{num(Number(o.suma) - Number(o.documentat))}</td>
                  </tr>
                ))}
                {faraDocument.length === 0 && <tr><td colSpan={4} className="gol-rand">Toate plățile aferente au document. ✓</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className="nota">Fișierele se păstrează privat, accesibile doar persoanelor cu drepturi pe acest contract. Același fișier nu poate fi încărcat de două ori. După raportarea unei perioade, potrivirile din ea nu se mai pot schimba.</p>
    </>
  )
}

function DetaliuDoc({ d, rest, pr, rc, ops, opDupaId, lucreaza, potriveste, anuleaza, deschide }: {
  d: Doc; rest: number; pr: Prop[]; rc: Rec[]; ops: Op[]; opDupaId: Map<string, Op>; lucreaza: boolean
  potriveste: (doc: string, op: string, suma?: number) => void; anuleaza: (id: string) => void; deschide: () => void
}) {
  const [manual, setManual] = useState('')
  const t = manual.trim().toLowerCase()
  const cautate = t.length < 2 ? [] : ops.filter(o => o.aferenta_proiect === true && Number(o.documentat) < Number(o.suma) - 0.004 && !rc.some(r => r.operatiune_id === o.id)
    && `${o.cine ?? ''} ${o.detalii ?? ''} ${o.descriere_banca ?? ''} ${num(o.suma)} ${o.suma}`.toLowerCase().includes(t)).slice(0, 8)
  const randOp = (o: Op | undefined) => o ? <><span className="tare">{data(o.data_operatiune)}</span> · {o.cine ?? o.descriere_banca?.slice(0, 60)} · <span className="tare">{bani(o.suma, o.moneda)}</span></> : '—'
  return (
    <div className="detaliu-op">
      <div className="rand-butoane">
        {d.fisier_cale && <button className="buton-text" onClick={deschide}>Deschide fișierul</button>}
        {d.furnizor_cui && <span className="mic gri">CUI furnizor {d.furnizor_cui}</span>}
      </div>
      {rc.length > 0 && (
        <div className="alocari">
          <div className="mic tare">Plăți potrivite</div>
          {rc.map(r => (
            <div key={r.id} className="alocare">
              <span>{randOp(opDupaId.get(r.operatiune_id))}</span>
              <span className="n tare">{num(r.suma)}</span>
              <button className="link-mic rosu-text" disabled={lucreaza} onClick={() => anuleaza(r.id)}>anulează</button>
            </div>
          ))}
        </div>
      )}
      {rest > 0.004 && pr.length > 0 && (
        <div className="alocari">
          <div className="mic tare">Propuse de aplicație</div>
          {pr.map(p => (
            <div key={p.operatiune_id} className="alocare">
              <span>{randOp(opDupaId.get(p.operatiune_id))}
                <span className="mic gri"> — {[p.numar_in_text && 'nr. facturii apare în text', p.potrivire_suma === 'exacta' && 'aceeași sumă', p.potrivire_suma === 'aproximativa' && 'sumă apropiată (altă monedă)', p.potrivire_suma === 'partiala' && 'posibilă rată', p.nume_in_text && 'numele furnizorului'].filter(Boolean).join(', ')}</span>
              </span>
              <button className="buton mic-b" disabled={lucreaza} onClick={() => potriveste(d.id, p.operatiune_id)}>Potrivește</button>
            </div>
          ))}
        </div>
      )}
      {rest > 0.004 && (
        <div className="form-alocare">
          <input value={manual} onChange={e => setManual(e.target.value)} placeholder="Caută altă plată: nume, sumă…" style={{ width: 280, textAlign: 'left' }} />
          <span className="mic gri">rămas de acoperit {bani(rest, d.moneda)}</span>
        </div>
      )}
      {cautate.map(o => (
        <div key={o.id} className="alocare">
          <span>{randOp(o)}</span>
          <button className="buton mic-b" disabled={lucreaza} onClick={() => potriveste(d.id, o.id)}>Potrivește</button>
        </div>
      ))}
    </div>
  )
}

// ---------- Încărcarea fișierelor ----------
async function amprenta(f: File) {
  const h = await crypto.subtle.digest('SHA-256', await f.arrayBuffer())
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('')
}
const azi = () => new Date().toISOString().slice(0, 10)
const gol = () => ({ tip: 'factura', numar: '', data_document: '', data_scadenta: '', furnizor_denumire: '', furnizor_cui: '', moneda: 'RON', suma_totala: '', suma_tva: '', tva_deductibila: false, descriere: '' })

function Incarcare({ contractId, coada, setCoada, lucreaza, setLucreaza, gata }: {
  contractId: string; coada: File[]; setCoada: (f: File[]) => void; lucreaza: boolean; setLucreaza: (b: boolean) => void
  gata: (text: string, cls: string) => Promise<void>
}) {
  const f = coada[0]
  const [v, setV] = useState(gol())
  const [eroare, setEroare] = useState<string | null>(null)
  const url = useMemo(() => (f ? URL.createObjectURL(f) : null), [f])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  const set = (k: string, val: string | boolean) => setV(x => ({ ...x, [k]: val }))
  const nr = (s: string) => Number(s.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))

  async function salveaza() {
    if (!f) return
    setEroare(null)
    const total = nr(v.suma_totala), tva = v.suma_tva ? nr(v.suma_tva) : 0
    if (!v.data_document) return setEroare('Completați data documentului.')
    if (!(total > 0)) return setEroare('Completați valoarea totală (cu TVA).')
    if (!(tva >= 0) || tva > total) return setEroare('TVA nu poate fi mai mare decât totalul.')
    if (v.data_scadenta && v.data_scadenta < v.data_document) return setEroare('Scadența nu poate fi înaintea datei documentului.')
    setLucreaza(true)
    try {
      const h = await amprenta(f)
      const ext = (f.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '')
      const cale = `${contractId}/documente/${h}.${ext}`
      const up = await supabase.storage.from('documente').upload(cale, f, { contentType: f.type || 'application/pdf', upsert: false })
      if (up.error && !/exists|duplicate/i.test(up.error.message)) throw new Error('Fișierul nu a putut fi încărcat: ' + up.error.message)
      const ins = await supabase.from('documente').insert({
        contract_id: contractId, tip: v.tip, numar: v.numar.trim() || null, data_document: v.data_document, data_scadenta: v.data_scadenta || null,
        furnizor_denumire: v.furnizor_denumire.trim() || null, furnizor_cui: v.furnizor_cui.trim() || null, moneda: v.moneda,
        suma_totala: Math.round(total * 100) / 100, suma_tva: Math.round(tva * 100) / 100, tva_deductibila: v.tva_deductibila,
        descriere: v.descriere.trim() || null, fisier_cale: cale, fisier_amprenta: h,
      })
      if (ins.error) throw new Error(/duplicate|unique/i.test(ins.error.message) ? 'Acest fișier a mai fost încărcat (același conținut).' : ins.error.message)
      setCoada(coada.slice(1)); setV(x => ({ ...gol(), moneda: x.moneda, tip: x.tip }))
      await gata(`Documentul ${v.numar || f.name} a fost salvat. Verificați mai jos plata propusă.`, 'verde')
    } catch (e) { setEroare((e as Error).message) }
    setLucreaza(false)
  }

  return (
    <section className="bloc">
      <div className="bloc-titlu">
        <h2>Încarcă documente</h2>
        <p>Alegeți unul sau mai multe fișiere (PDF sau poză). Pentru fiecare completați datele de pe document, cu fișierul alături.</p>
      </div>
      {!f ? (
        <label className="zona-incarcare">
          <input type="file" multiple accept="application/pdf,image/*" onChange={e => { setCoada([...(e.target.files ?? [])]); e.target.value = '' }} />
          <span className="tare">Alegeți fișierele</span><span className="mic gri">PDF, JPG, PNG</span>
        </label>
      ) : (
        <div className="incarcare-grila">
          <div className="formular-doc">
            <div className="mic gri">{coada.length > 1 ? `Fișierul 1 din ${coada.length}: ` : ''}<span className="tare">{f.name}</span></div>
            <div className="campuri">
              <label>Tip<select value={v.tip} onChange={e => set('tip', e.target.value)}>{Object.entries(TIP_DOC).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
              <label>Număr (serie și nr.)<input value={v.numar} onChange={e => set('numar', e.target.value)} placeholder="ex. FDB 12345" /></label>
              <label>Data documentului<input type="date" max={azi()} value={v.data_document} onChange={e => set('data_document', e.target.value)} /></label>
              <label>Scadența<input type="date" value={v.data_scadenta} onChange={e => set('data_scadenta', e.target.value)} /></label>
              <label className="lat2">Furnizor<input value={v.furnizor_denumire} onChange={e => set('furnizor_denumire', e.target.value)} placeholder="denumirea de pe factură" /></label>
              <label>CUI furnizor<input value={v.furnizor_cui} onChange={e => set('furnizor_cui', e.target.value)} placeholder="opțional" /></label>
              <label>Monedă<select value={v.moneda} onChange={e => set('moneda', e.target.value)}><option value="RON">lei</option><option value="EUR">EUR</option></select></label>
              <label>Total de plată (cu TVA)<input inputMode="decimal" value={v.suma_totala} onChange={e => set('suma_totala', e.target.value)} placeholder="0,00" /></label>
              <label>din care TVA<input inputMode="decimal" value={v.suma_tva} onChange={e => set('suma_tva', e.target.value)} placeholder="0,00" /></label>
              <label className="bifa-camp"><input type="checkbox" checked={v.tva_deductibila} onChange={e => set('tva_deductibila', e.target.checked)} /> TVA deductibilă (firma își recuperează TVA-ul)</label>
              <label className="lat2">Ce s-a cumpărat<input value={v.descriere} onChange={e => set('descriere', e.target.value)} placeholder="ex. laptop pentru echipa de proiect" /></label>
            </div>
            {eroare && <div className="alerta rosu">{eroare}</div>}
            <div className="rand-butoane">
              <button className="buton" disabled={lucreaza} onClick={salveaza}>{lucreaza ? 'Se salvează…' : 'Salvează documentul'}</button>
              <button className="buton-text" disabled={lucreaza} onClick={() => setCoada(coada.slice(1))}>Sari peste</button>
              <button className="buton-text" disabled={lucreaza} onClick={() => setCoada([])}>Renunță la toate</button>
            </div>
            <p className="nota">TVA deductibilă nu e eligibilă în proiect; TVA nedeductibilă (firmă neplătitoare de TVA) este eligibilă.</p>
          </div>
          <div className="previzualizare">
            {url && (f.type.startsWith('image/') ? <img src={url} alt={f.name} /> : <iframe src={url} title={f.name} />)}
          </div>
        </div>
      )}
    </section>
  )
}

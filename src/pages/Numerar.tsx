import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { bani, data, iban, num } from '../lib/format'

// Numerar și avansuri. Fiecare retragere de numerar (bancomat, ghișeu) este un AVANS: bani scoși din cont
// pentru care cineva trebuie să aducă documente (bonuri, facturi, chitanțe) sau să-i redepună.
// Regulile sunt în baza de date: avansul pornește doar dintr-o retragere, justificările nu pot depăși suma,
// un document nu poate fi folosit de două ori (nici aici, nici la o plată din bancă).
// Calculul (justificat, rest, stare) e în v_numerar.

type Avans = {
  operatiune_id: string; contract_id: string; cont_id: string; iban: string; moneda: string; data: string; suma: number
  aferenta_proiect: boolean | null; descriere_banca: string | null; comision: number
  avans_id: string | null; titular_nume: string | null; scop: string | null; termen: string; termen_implicit: boolean
  suma_avans: number; justificat_documente: number; redepus: number; nr_justificari: number; rest: number
  stare: 'neaferent' | 'justificat' | 'depasit' | 'partial' | 'de_justificat'
}
type Just = {
  id: string; avans_id: string; operatiune_id: string; tip: 'document' | 'redepunere'; suma: number
  tip_document: string | null; numar: string | null; data_document: string | null; furnizor_denumire: string | null; descriere: string | null
  data_redepunere: string | null; descriere_redepunere: string | null
}
type DocLiber = { id: string; tip: string; numar: string | null; data_document: string; furnizor_denumire: string | null; descriere: string | null; moneda: string; disponibil: number }
type Intrare = { id: string; data_operatiune: string; suma: number; descriere_banca: string | null; moneda: string }

const STARE: Record<Avans['stare'], { t: string; c: string }> = {
  de_justificat: { t: 'de justificat', c: 'galben' },
  partial: { t: 'justificat parțial', c: 'albastru-e' },
  depasit: { t: 'termen depășit', c: 'rosu' },
  justificat: { t: 'justificat', c: 'verde' },
  neaferent: { t: 'nu e pe proiect', c: 'gri-e' },
}
const TIP_DOC: Record<string, string> = { factura: 'Factură', chitanta: 'Chitanță', bon_fiscal: 'Bon fiscal', decont_cheltuieli: 'Decont', altul: 'Document' }
const nr = (s: string) => Number(s.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))
const r2 = (x: number) => Math.round(x * 100) / 100

export default function Numerar() {
  const { id } = useParams()
  const [lista, setLista] = useState<Avans[] | null>(null)
  const [just, setJust] = useState<Just[]>([])
  const [docs, setDocs] = useState<DocLiber[]>([])
  const [intrari, setIntrari] = useState<Intrare[]>([])
  const [eroare, setEroare] = useState<string | null>(null)
  const [mesaj, setMesaj] = useState<{ cls: string; text: string } | null>(null)
  const [lucreaza, setLucreaza] = useState(false)
  const [vedere, setVedere] = useState<'proiect' | 'neaferente' | 'toate'>('proiect')
  const [deschis, setDeschis] = useState<string | null>(null)

  const incarca = useCallback(async () => {
    if (!id) return
    const [a, j, d, i] = await Promise.all([
      supabase.from('v_numerar').select('*').eq('contract_id', id).order('data'),
      supabase.from('v_justificari_avans').select('*').order('creat_la'),
      supabase.from('v_documente_disponibile').select('id,tip,numar,data_document,furnizor_denumire,descriere,moneda,disponibil').eq('contract_id', id).gt('disponibil', 0).order('data_document'),
      supabase.from('operatiuni').select('id,data_operatiune,suma,descriere_banca,conturi!inner(contract_id,moneda)').eq('conturi.contract_id', id).eq('sens', 'credit').order('data_operatiune').limit(2000),
    ])
    if (a.error) { setEroare('Datele nu au putut fi citite.'); return }
    setLista(a.data as Avans[])
    setJust((j.data ?? []) as Just[])
    setDocs((d.data ?? []) as DocLiber[])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setIntrari(((i.data ?? []) as any[]).map(x => ({ id: x.id, data_operatiune: x.data_operatiune, suma: x.suma, descriere_banca: x.descriere_banca, moneda: x.conturi?.moneda })))
  }, [id])
  useEffect(() => { incarca() }, [incarca])

  const pe = useMemo(() => (lista ?? []).filter(a => a.aferenta_proiect !== false), [lista])
  const tot = useMemo(() => {
    const t = { retras: 0, docs: 0, redepus: 0, rest: 0, depasite: 0, comision: 0 }
    for (const a of pe) {
      t.retras += Number(a.suma_avans); t.docs += Number(a.justificat_documente); t.redepus += Number(a.redepus)
      t.rest += Math.max(0, Number(a.rest)); t.comision += Number(a.comision)
      if (a.stare === 'depasit') t.depasite++
    }
    return t
  }, [pe])

  const vizibile = (lista ?? []).filter(a => vedere === 'toate' || (vedere === 'proiect' ? a.aferenta_proiect !== false : a.aferenta_proiect === false))

  async function gata(text: string, cls = 'verde') { setMesaj({ cls, text }); await incarca() }

  if (eroare) return <><Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link><div className="alerta rosu">{eroare}</div></>
  if (!lista) return <div className="gol">Se încarcă retragerile de numerar…</div>
  const moneda = pe[0]?.moneda ?? 'RON'
  const neaf = lista.length - pe.length

  return (
    <>
      <Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link>
      <section className="titlu-pagina">
        <h1>Numerar și avansuri</h1>
        <p>Fiecare retragere de numerar din contul proiectului e un avans: banii trebuie justificați cu bonuri și facturi sau redepuși în cont.</p>
      </section>

      <section className="cifre">
        <div className="cifra"><div className="cifra-eticheta">Retras pe proiect</div><div className="cifra-valoare mic-v">{bani(tot.retras, moneda)}</div><div className="cifra-sub">{pe.length} retrageri · comisioane {bani(tot.comision, moneda)}</div></div>
        <div className="cifra"><div className="cifra-eticheta">Justificat cu documente</div><div className="cifra-valoare mic-v">{bani(tot.docs, moneda)}</div><div className="cifra-sub">bonuri, facturi, chitanțe</div></div>
        <div className="cifra"><div className="cifra-eticheta">Redepus în cont</div><div className="cifra-valoare mic-v">{bani(tot.redepus, moneda)}</div><div className="cifra-sub">bani returnați</div></div>
        <div className="cifra accent"><div className="cifra-eticheta">De justificat</div><div className="cifra-valoare mic-v">{bani(tot.rest, moneda)}</div><div className="cifra-sub">{tot.depasite ? `${tot.depasite} cu termenul depășit` : 'în termen'}</div></div>
      </section>

      <div className="alerta albastru spatiu">
        <b>Regula:</b> numerarul scos din contul proiectului nu e o cheltuială în sine. Devine cheltuială doar prin documentele cu care se justifică (bon fiscal, factură, chitanță), iar acestea se alocă apoi pe capitole ca orice altă plată.
        Partea nejustificată trebuie redepusă în cont; altfel nu se poate deconta și rămâne în sarcina asociației. Termenul implicit e de 30 de zile de la retragere și se poate schimba.
      </div>
      {tot.depasite > 0 && <div className="alerta rosu spatiu">{tot.depasite === 1 ? 'Un avans are' : `${tot.depasite} avansuri au`} termenul de justificare depășit, cu {bani(tot.rest, moneda)} încă nejustificați. Aduceți documentele în „Facturi și documente” sau redepuneți banii.</div>}
      {mesaj && <div className={`alerta ${mesaj.cls} spatiu`}>{mesaj.text}</div>}

      <section className="file-vederi">
        <button className={`fila ${vedere === 'proiect' ? 'activa' : ''}`} onClick={() => setVedere('proiect')}>Pe proiect <span className="contor">{pe.length}</span></button>
        <button className={`fila ${vedere === 'neaferente' ? 'activa' : ''}`} onClick={() => setVedere('neaferente')}>Neaferente (cont mixt) <span className="contor">{neaf}</span></button>
        <button className={`fila ${vedere === 'toate' ? 'activa' : ''}`} onClick={() => setVedere('toate')}>Toate <span className="contor">{lista.length}</span></button>
      </section>

      <section className="bloc fara-padding">
        <div className="tabel-wrap">
          <table className="tabel-op">
            <thead><tr>
              <th>Data</th><th>Cine / pentru ce</th><th className="n">Retras</th><th className="n">Comision</th>
              <th>Termen</th><th className="n">Justificat</th><th className="n">Rest</th><th>Stare</th><th />
            </tr></thead>
            <tbody>
              {vizibile.map(a => (
                <Fragment key={a.operatiune_id}>
                  <tr className={a.aferenta_proiect === false ? 'rand-lipsa' : ''}>
                    <td className="nowrap">{data(a.data)}<div className="mic gri">{iban(a.iban).slice(-9)}</div></td>
                    <td className="lat">{a.titular_nume ? <span className="tare">{a.titular_nume}</span> : <span className="gri">titular necompletat</span>}
                      {a.scop && <div className="mic gri">{a.scop}</div>}</td>
                    <td className="n tare">{num(a.suma_avans)}</td>
                    <td className="n">{num(a.comision)}</td>
                    <td className="nowrap">{a.aferenta_proiect === false ? '—' : <>{data(a.termen)}{a.termen_implicit && <div className="mic gri">implicit</div>}</>}</td>
                    <td className="n">{num(Number(a.justificat_documente) + Number(a.redepus))}</td>
                    <td className="n tare">{a.aferenta_proiect === false ? '—' : num(Math.max(0, Number(a.rest)))}</td>
                    <td><span className={`eticheta ${STARE[a.stare].c}`}>{STARE[a.stare].t}</span></td>
                    <td className="nowrap">{a.aferenta_proiect !== false && <button className="link-mic" onClick={() => setDeschis(deschis === a.operatiune_id ? null : a.operatiune_id)}>{deschis === a.operatiune_id ? 'închide' : 'justifică'}</button>}</td>
                  </tr>
                  {deschis === a.operatiune_id && (
                    <tr className="rand-detaliu"><td colSpan={9}>
                      <Detaliu a={a} just={just.filter(j => j.operatiune_id === a.operatiune_id)} docs={docs.filter(d => d.moneda === a.moneda)}
                        intrari={intrari.filter(i => i.moneda === a.moneda && i.data_operatiune >= a.data)}
                        contractId={id!} lucreaza={lucreaza} setLucreaza={setLucreaza} gata={gata} />
                    </td></tr>
                  )}
                </Fragment>
              ))}
              {vizibile.length === 0 && <tr><td colSpan={9} className="gol-rand">Nicio retragere de numerar în această vedere.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <p className="nota">Retragerile marcate „nu e pe proiect” vin din contul mixt și au fost clasificate ca neaferente pe ecranul de validare. Dacă o retragere a fost de fapt pentru proiect, schimbați-o acolo și apare aici de justificat. Comisioanele de retragere sunt legate automat după referința din extras.</p>
    </>
  )
}

function Detaliu({ a, just, docs, intrari, contractId, lucreaza, setLucreaza, gata }: {
  a: Avans; just: Just[]; docs: DocLiber[]; intrari: Intrare[]; contractId: string
  lucreaza: boolean; setLucreaza: (b: boolean) => void; gata: (t: string, c?: string) => Promise<void>
}) {
  const [v, setV] = useState({ titular: a.titular_nume ?? '', scop: a.scop ?? '', termen: a.termen_implicit ? '' : a.termen })
  const [mod, setMod] = useState<'document' | 'redepunere'>('document')
  const [alegere, setAlegere] = useState('')
  const [suma, setSuma] = useState('')
  const [eroare, setEroare] = useState<string | null>(null)
  const rest = Math.max(0, Number(a.rest))

  const optiuni = mod === 'document'
    ? docs.map(d => ({ id: d.id, max: Number(d.disponibil), text: `${data(d.data_document)} · ${TIP_DOC[d.tip] ?? d.tip} ${d.numar ?? ''} · ${d.furnizor_denumire ?? ''}${d.descriere ? ` · ${d.descriere}` : ''}` }))
    : intrari.map(i => ({ id: i.id, max: Number(i.suma), text: `${data(i.data_operatiune)} · ${(i.descriere_banca ?? '').slice(0, 70)}` }))
  const ales = optiuni.find(o => o.id === alegere)

  useEffect(() => { if (ales) setSuma(Math.min(ales.max, rest).toFixed(2).replace('.', ',')) }, [alegere]) // eslint-disable-line react-hooks/exhaustive-deps

  async function avansId(): Promise<string> {
    if (a.avans_id) return a.avans_id
    const r = await supabase.from('avansuri_numerar').insert({ operatiune_id: a.operatiune_id }).select('id').single()
    if (r.error) throw new Error(r.error.message)
    return r.data.id
  }

  async function salveazaDate() {
    setEroare(null)
    if (v.termen && v.termen < a.data) return setEroare('Termenul nu poate fi înaintea retragerii.')
    setLucreaza(true)
    try {
      const date = { titular_nume: v.titular.trim() || null, scop: v.scop.trim() || null, termen_justificare: v.termen || null }
      const r = a.avans_id
        ? await supabase.from('avansuri_numerar').update(date).eq('id', a.avans_id)
        : await supabase.from('avansuri_numerar').insert({ operatiune_id: a.operatiune_id, ...date })
      if (r.error) throw new Error(r.error.message)
      await gata('Datele avansului au fost salvate.')
    } catch (e) { setEroare((e as Error).message) }
    setLucreaza(false)
  }

  async function adauga() {
    setEroare(null)
    const s = nr(suma)
    if (!ales) return setEroare(mod === 'document' ? 'Alegeți documentul.' : 'Alegeți depunerea din extras.')
    if (!(s > 0)) return setEroare('Completați suma.')
    if (s > rest + 0.004) return setEroare(`Mai sunt de justificat doar ${num(rest)}.`)
    if (s > ales.max + 0.004) return setEroare(`Din ${mod === 'document' ? 'document' : 'depunere'} sunt disponibili doar ${num(ales.max)}.`)
    setLucreaza(true)
    try {
      const av = await avansId()
      const r = await supabase.from('justificari_avans').insert({
        avans_id: av, tip: mod, suma: r2(s),
        document_id: mod === 'document' ? ales.id : null, operatiune_id: mod === 'redepunere' ? ales.id : null,
      })
      if (r.error) throw new Error(r.error.message)
      setAlegere(''); setSuma('')
      await gata(`Am adăugat ${mod === 'document' ? 'documentul' : 'redepunerea'} de ${bani(s, a.moneda)} la avansul din ${data(a.data)}.`)
    } catch (e) { setEroare((e as Error).message) }
    setLucreaza(false)
  }

  async function sterge(j: Just) {
    if (!window.confirm('Scoateți această justificare? Documentul sau depunerea redevine liberă.')) return
    setLucreaza(true)
    const r = await supabase.from('justificari_avans').delete().eq('id', j.id)
    setLucreaza(false)
    await gata(r.error ? r.error.message : 'Justificarea a fost scoasă.', r.error ? 'rosu' : 'verde')
  }

  return (
    <div className="detaliu-avans">
      <div className="mic gri spatiu-mic">{a.descriere_banca}</div>
      <div className="campuri">
        <label>Cine a ridicat banii<input value={v.titular} onChange={e => setV(x => ({ ...x, titular: e.target.value }))} placeholder="nume și prenume" /></label>
        <label className="lat2">Pentru ce<input value={v.scop} onChange={e => setV(x => ({ ...x, scop: e.target.value }))} placeholder="ex. materiale pentru atelierul din mai" /></label>
        <label>Termen de justificare<input type="date" min={a.data} value={v.termen} onChange={e => setV(x => ({ ...x, termen: e.target.value }))} /></label>
      </div>
      <div className="rand-butoane"><button className="buton mic-b" disabled={lucreaza} onClick={salveazaDate}>Salvează datele</button>
        {!v.termen && <span className="mic gri">Fără termen completat se folosește {data(a.termen)} (30 de zile).</span>}</div>

      <h3 className="subtitlu">Justificări</h3>
      {just.length === 0 ? <p className="mic gri">Încă nimic. Retragerea de {bani(a.suma_avans, a.moneda)} e în întregime nejustificată.</p> : (
        <ul className="lista-justificari">
          {just.map(j => (
            <li key={j.id}>
              <span>{j.tip === 'document'
                ? <>{data(j.data_document)} · {TIP_DOC[j.tip_document ?? ''] ?? 'Document'} {j.numar ?? ''} · {j.furnizor_denumire ?? ''}{j.descriere ? ` · ${j.descriere}` : ''}</>
                : <>Redepunere {data(j.data_redepunere)} · {(j.descriere_redepunere ?? '').slice(0, 60)}</>}</span>
              <span className="nowrap"><b>{bani(j.suma, a.moneda)}</b> <button className="link-mic rosu-text" disabled={lucreaza} onClick={() => sterge(j)}>scoate</button></span>
            </li>
          ))}
        </ul>
      )}

      {rest > 0.004 ? (
        <div className="form-justificare">
          <div className="file-vederi mici">
            <button className={`fila ${mod === 'document' ? 'activa' : ''}`} onClick={() => { setMod('document'); setAlegere('') }}>Cu document</button>
            <button className={`fila ${mod === 'redepunere' ? 'activa' : ''}`} onClick={() => { setMod('redepunere'); setAlegere('') }}>Cu redepunere în cont</button>
          </div>
          {optiuni.length === 0 ? (
            <p className="mic gri">{mod === 'document'
              ? <>Nu există documente libere în {a.moneda === 'RON' ? 'lei' : a.moneda}. Încărcați întâi bonurile și facturile în <Link to={`/contract/${contractId}/documente`}>Facturi și documente</Link>, apoi reveniți aici.</>
              : <>Nu există intrări în cont după {data(a.data)}. Redepunerea apare aici după ce încărcați extrasul pe care se vede.</>}</p>
          ) : (
            <div className="campuri">
              <label className="lat2">{mod === 'document' ? 'Documentul' : 'Depunerea din extras'}
                <select value={alegere} onChange={e => setAlegere(e.target.value)}>
                  <option value="">— alegeți —</option>
                  {optiuni.map(o => <option key={o.id} value={o.id}>{o.text} · {num(o.max)}</option>)}
                </select></label>
              <label>Suma<input inputMode="decimal" value={suma} onChange={e => setSuma(e.target.value)} placeholder="0,00" /></label>
              <div className="rand-butoane"><button className="buton mic-b" disabled={lucreaza || !alegere} onClick={adauga}>Adaugă</button></div>
            </div>
          )}
        </div>
      ) : <div className="alerta verde">Avansul e justificat integral.</div>}
      {eroare && <div className="alerta rosu spatiu">{eroare}</div>}
    </div>
  )
}

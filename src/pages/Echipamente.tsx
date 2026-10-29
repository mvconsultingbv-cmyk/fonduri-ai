import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { bani, data, num } from '../lib/format'

// Capitolul C.2 – Echipamente. Plata se leagă de echipament ca ACHIZIȚIE (nu se alocă pe buget);
// pe proiect intră doar AMORTIZAREA: cost ÷ durata (luni) × lunile din proiect × % folosire pe proiect.
// Calculul e făcut în baza de date (v_echipamente, v_amortizare_perioade).

type Ech = {
  id: string; denumire: string; moneda: string; cost_achizitie: number; data_punere_functiune: string; durata_amortizare_luni: number
  procent_utilizare: number; observatii: string | null; document_id: string | null; document_numar: string | null; prima_luna: string; ultima_luna: string
  amortizare_lunara: number; platit: number; plati: { id: string; operatiune_id: string; suma: number; data: string }[]
  luni_in_proiect: number; eligibil_total: number; luni_scurse: number; eligibil_pana_acum: number
  pe_perioade: { perioada: number; luni: number; eligibil: number }[]
}
type Op = { id: string; data_operatiune: string; moneda: string; suma: number; cine: string | null; detalii: string | null; descriere_banca: string | null; decontat: number; legat_echipament: number; tva_neeligibila: number; documente: { document_id: string; numar: string | null }[] }
type Doc = { id: string; numar: string | null; furnizor_denumire: string | null; descriere: string | null; moneda: string; suma_totala: number }

const luna = (d: string) => { const [y, m] = d.split('-'); return `${m}.${y}` }

export default function Echipamente() {
  const { id } = useParams()
  const [cauta] = useSearchParams()
  const [lista, setLista] = useState<Ech[] | null>(null)
  const [ops, setOps] = useState<Op[]>([])
  const [docs, setDocs] = useState<Doc[]>([])
  const [bugetC2, setBugetC2] = useState<number | null>(null)
  const [eroare, setEroare] = useState<string | null>(null)
  const [mesaj, setMesaj] = useState<{ cls: string; text: string } | null>(null)
  const [lucreaza, setLucreaza] = useState(false)
  const [formular, setFormular] = useState<boolean>(!!cauta.get('operatiune'))
  const [editez, setEditez] = useState<string | null>(null)

  const incarca = useCallback(async () => {
    if (!id) return
    const [e, o, d, b] = await Promise.all([
      supabase.from('v_echipamente').select('*').eq('contract_id', id).order('data_punere_functiune'),
      supabase.from('v_operatiuni_validare').select('id,data_operatiune,moneda,suma,cine,detalii,descriere_banca,decontat,legat_echipament,tva_neeligibila,documente')
        .eq('contract_id', id).eq('sens', 'debit').eq('aferenta_proiect', true).is('operatiune_parinte_id', null)
        .in('tip', ['plata_furnizor', 'retragere_numerar', 'altele']).order('suma', { ascending: false }).limit(1000),
      supabase.from('documente').select('id,numar,furnizor_denumire,descriere,moneda,suma_totala').eq('contract_id', id).order('data_document', { ascending: false }),
      supabase.from('v_buget_in_vigoare').select('suma_in_vigoare_eur').eq('contract_id', id).eq('mod_calcul', 'amortizare'),
    ])
    if (e.error || o.error) { setEroare('Datele nu au putut fi citite.'); return }
    setLista(e.data as Ech[]); setOps(o.data as Op[]); setDocs((d.data ?? []) as Doc[])
    setBugetC2((b.data ?? []).reduce((a, x) => a + Number(x.suma_in_vigoare_eur), 0))
  }, [id])
  useEffect(() => { incarca() }, [incarca])

  const totaluri = useMemo(() => {
    const m = new Map<string, { cost: number; acum: number; total: number }>()
    for (const e of lista ?? []) {
      const t = m.get(e.moneda) ?? { cost: 0, acum: 0, total: 0 }
      t.cost += Number(e.cost_achizitie); t.acum += Number(e.eligibil_pana_acum); t.total += Number(e.eligibil_total); m.set(e.moneda, t)
    }
    return [...m.entries()]
  }, [lista])

  async function sterge(e: Ech) {
    if (!window.confirm(`Ștergeți echipamentul „${e.denumire}”? Plata legată redevine liberă (se poate aloca din nou).`)) return
    setLucreaza(true); setMesaj(null)
    const { error } = await supabase.from('echipamente').delete().eq('id', e.id)
    setMesaj(error ? { cls: 'rosu', text: error.message } : { cls: 'verde', text: 'Echipamentul a fost șters.' })
    await incarca(); setLucreaza(false)
  }

  if (eroare) return <><Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link><div className="alerta rosu">{eroare}</div></>
  if (!lista) return <div className="gol">Se încarcă echipamentele…</div>

  const fmt = (f: (t: { cost: number; acum: number; total: number }) => number) =>
    totaluri.length ? totaluri.map(([m, t]) => bani(f(t), m)).join(' + ') : bani(0, 'RON')

  return (
    <>
      <Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link>
      <section className="titlu-pagina">
        <h1>Echipamente (C.2)</h1>
        <p>Pe proiect nu intră prețul echipamentului, ci doar amortizarea lui pe lunile de proiect, în proporția în care e folosit pentru proiect.</p>
      </section>

      <section className="cifre">
        <div className="cifra"><div className="cifra-eticheta">Cumpărat</div><div className="cifra-valoare mic-v">{fmt(t => t.cost)}</div><div className="cifra-sub">costul de achiziție</div></div>
        <div className="cifra accent"><div className="cifra-eticheta">Eligibil până acum</div><div className="cifra-valoare mic-v">{fmt(t => t.acum)}</div><div className="cifra-sub">amortizarea lunilor încheiate</div></div>
        <div className="cifra"><div className="cifra-eticheta">Eligibil până la final</div><div className="cifra-valoare mic-v">{fmt(t => t.total)}</div><div className="cifra-sub">dacă rămân în folosință</div></div>
        <div className="cifra"><div className="cifra-eticheta">Buget C.2</div><div className="cifra-valoare mic-v">{bugetC2 != null ? bani(bugetC2, 'EUR') : '—'}</div><div className="cifra-sub">în vigoare</div></div>
      </section>

      <div className="alerta albastru spatiu">
        <b>Cum se calculează:</b> amortizarea începe în luna de după punerea în funcțiune (regula contabilă) și durează cât a stabilit contabilul (de regulă 2–4 ani pentru calculatoare, conform Catalogului mijloacelor fixe).
        Lunar = cost ÷ durată. Eligibil = lunar × lunile care cad între începutul și sfârșitul proiectului × % folosire pe proiect. Restul costului rămâne în sarcina asociației.
      </div>

      {mesaj && <div className={`alerta ${mesaj.cls} spatiu`}>{mesaj.text}</div>}

      {formular ? (
        <Formular contractId={id!} ops={ops} docs={docs} initial={cauta.get('operatiune')} lucreaza={lucreaza} setLucreaza={setLucreaza}
          inchide={() => setFormular(false)} gata={async t => { setMesaj({ cls: 'verde', text: t }); setFormular(false); await incarca() }} />
      ) : (
        <div className="rand-butoane spatiu"><button className="buton" onClick={() => setFormular(true)}>+ Adaugă un echipament</button></div>
      )}

      <section className="bloc fara-padding">
        <div className="tabel-wrap">
          <table className="tabel-op">
            <thead><tr><th>Echipament</th><th className="n">Cost</th><th>Amortizare</th><th className="n">% proiect</th><th className="n">Perioada 1</th><th className="n">Perioada 2</th><th className="n">Eligibil acum</th><th className="n">Eligibil total</th><th /></tr></thead>
            <tbody>
              {lista.map(e => (
                <Fragment key={e.id}>
                <tr>
                  <td className="lat">
                    <div className="tare">{e.denumire}</div>
                    <div className="mic gri">pus în funcțiune {data(e.data_punere_functiune)}{e.document_numar ? ` · factura ${e.document_numar}` : ''}</div>
                    <div className="mic gri">plată: {e.plati.map(p => `${data(p.data)} ${num(p.suma)}`).join(', ') || 'nelegată'}</div>
                  </td>
                  <td className="n tare">{bani(e.cost_achizitie, e.moneda)}</td>
                  <td className="nowrap">{e.durata_amortizare_luni} luni · {num(e.amortizare_lunara)}/lună<div className="mic gri">{luna(e.prima_luna)} – {luna(e.ultima_luna)}</div></td>
                  <td className="n">{num(e.procent_utilizare)}%</td>
                  {[1, 2].map(p => { const x = e.pe_perioade.find(z => z.perioada === p); return <td key={p} className="n">{num(x?.eligibil)}<div className="mic gri">{x?.luni ?? 0} luni</div></td> })}
                  <td className="n tare">{num(e.eligibil_pana_acum)}<div className="mic gri">{e.luni_scurse} luni</div></td>
                  <td className="n">{num(e.eligibil_total)}<div className="mic gri">{e.luni_in_proiect} luni</div></td>
                  <td className="nowrap"><button className="link-mic" onClick={() => setEditez(editez === e.id ? null : e.id)}>modifică</button>
                    <button className="link-mic rosu-text" disabled={lucreaza} onClick={() => sterge(e)}>șterge</button></td>
                </tr>
                {editez === e.id && (
                  <tr className="rand-detaliu"><td colSpan={9}>
                    <Editare e={e} docs={docs} lucreaza={lucreaza} setLucreaza={setLucreaza} inchide={() => setEditez(null)}
                      gata={async t => { setMesaj({ cls: 'verde', text: t }); setEditez(null); await incarca() }} />
                  </td></tr>
                )}
                </Fragment>
              ))}
              {lista.length === 0 && <tr><td colSpan={9} className="gol-rand">Niciun echipament înregistrat. Adăugați-l pornind de la plata cu care a fost cumpărat.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <p className="nota">Sumele sunt în moneda plății; pe tabloul de bord, cele în lei se convertesc la cursul perioadei. O plată legată de un echipament nu mai poate fi alocată și pe alt capitol.</p>
    </>
  )
}

function Formular({ contractId, ops, docs, initial, lucreaza, setLucreaza, inchide, gata }: {
  contractId: string; ops: Op[]; docs: Doc[]; initial: string | null; lucreaza: boolean; setLucreaza: (b: boolean) => void
  inchide: () => void; gata: (t: string) => Promise<void>
}) {
  const libere = useMemo(() => ops.map(o => ({ ...o, liber: Number(o.suma) - Number(o.decontat) - Number(o.legat_echipament) - Number(o.tva_neeligibila) })).filter(o => o.liber > 0.004), [ops])
  const [opId, setOpId] = useState(initial && libere.some(o => o.id === initial) ? initial : '')
  const [filtru, setFiltru] = useState('')
  const op = libere.find(o => o.id === opId)
  const [v, setV] = useState({ denumire: '', cost: '', data: '', durata: '36', procent: '100', document: '', observatii: '' })
  const [eroare, setEroare] = useState<string | null>(null)
  const set = (k: string, val: string) => setV(x => ({ ...x, [k]: val }))

  useEffect(() => {
    if (!op) return
    setV(x => ({ ...x, cost: op.liber.toFixed(2).replace('.', ','), data: op.data_operatiune, document: op.documente?.[0]?.document_id ?? x.document,
      denumire: x.denumire || (op.detalii ?? '') }))
  }, [opId]) // eslint-disable-line react-hooks/exhaustive-deps

  const nr = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'))
  const t = filtru.trim().toLowerCase()
  const vizibile = libere.filter(o => !t || `${o.cine ?? ''} ${o.detalii ?? ''} ${o.descriere_banca ?? ''} ${num(o.suma)}`.toLowerCase().includes(t)).slice(0, 60)

  const cost = nr(v.cost), durata = parseInt(v.durata), procent = nr(v.procent)
  const lunar = cost > 0 && durata > 0 ? cost / durata : 0

  async function salveaza() {
    setEroare(null)
    if (!op) return setEroare('Alegeți plata cu care s-a cumpărat echipamentul.')
    if (!v.denumire.trim()) return setEroare('Scrieți ce echipament este.')
    if (!(cost > 0) || cost > op.liber + 0.004) return setEroare(`Costul trebuie să fie între 0 și ${num(op.liber)} (cât e liber din plată).`)
    if (!(durata >= 1 && durata <= 600)) return setEroare('Durata de amortizare, în luni (ex. 36).')
    if (!(procent > 0 && procent <= 100)) return setEroare('Procentul de folosire pe proiect: între 1 și 100.')
    if (!v.data) return setEroare('Data punerii în funcțiune.')
    setLucreaza(true)
    const ins = await supabase.from('echipamente').insert({
      contract_id: contractId, denumire: v.denumire.trim(), document_id: v.document || null, moneda: op.moneda,
      cost_achizitie: Math.round(cost * 100) / 100, data_punere_functiune: v.data, durata_amortizare_luni: durata,
      procent_utilizare: procent, observatii: v.observatii.trim() || null,
    }).select('id').single()
    if (ins.error) { setEroare(ins.error.message); setLucreaza(false); return }
    const leg = await supabase.from('echipamente_plati').insert({ echipament_id: ins.data.id, operatiune_id: op.id, suma: Math.round(cost * 100) / 100 })
    if (leg.error) {
      await supabase.from('echipamente').delete().eq('id', ins.data.id)
      setEroare(leg.error.message); setLucreaza(false); return
    }
    setLucreaza(false)
    await gata(`„${v.denumire.trim()}” a fost înregistrat pe C.2.`)
  }

  return (
    <section className="bloc">
      <div className="bloc-titlu"><h2>Echipament nou</h2><p>Porniți de la plata din extras cu care a fost cumpărat.</p></div>
      {!op ? (
        <>
          <input className="cauta-lat" value={filtru} onChange={e => setFiltru(e.target.value)} placeholder="Caută plata: emag, altex, sumă…" />
          <div className="lista-alegere">
            {vizibile.map(o => (
              <button key={o.id} className="alegere" onClick={() => setOpId(o.id)}>
                <span>{data(o.data_operatiune)} · <span className="tare">{o.cine ?? o.descriere_banca?.slice(0, 60)}</span>{o.detalii ? <span className="gri"> · {o.detalii}</span> : ''}</span>
                <span className="n tare">{bani(o.liber, o.moneda)}{o.liber < Number(o.suma) - 0.004 && <span className="mic gri"> din {num(o.suma)}</span>}</span>
              </button>
            ))}
            {vizibile.length === 0 && <div className="gol mic-gol">Nicio plată liberă care să se potrivească.</div>}
          </div>
          <div className="rand-butoane"><button className="buton-text" onClick={inchide}>Renunță</button></div>
        </>
      ) : (
        <>
          <div className="alerta albastru spatiu">Plata: {data(op.data_operatiune)} · {op.cine ?? op.descriere_banca?.slice(0, 60)} · <b>{bani(op.suma, op.moneda)}</b>
            {' '}<button className="link-mic" onClick={() => setOpId('')}>altă plată</button></div>
          <div className="campuri">
            <label className="lat2">Ce echipament<input value={v.denumire} onChange={e => set('denumire', e.target.value)} placeholder="ex. Laptop Lenovo ThinkPad" /></label>
            <label>Cost de achiziție ({op.moneda === 'RON' ? 'lei' : 'EUR'})<input inputMode="decimal" value={v.cost} onChange={e => set('cost', e.target.value)} /></label>
            <label>Pus în funcțiune la<input type="date" value={v.data} onChange={e => set('data', e.target.value)} /></label>
            <label>Durata de amortizare (luni)<input inputMode="numeric" value={v.durata} onChange={e => set('durata', e.target.value)} /></label>
            <label>% folosire pe proiect<input inputMode="decimal" value={v.procent} onChange={e => set('procent', e.target.value)} /></label>
            <label className="lat2">Factura<select value={v.document} onChange={e => set('document', e.target.value)}>
              <option value="">— fără / încă neîncărcată —</option>
              {docs.filter(d => d.moneda === op.moneda).map(d => <option key={d.id} value={d.id}>{d.numar ?? 'fără număr'} · {d.furnizor_denumire ?? ''} · {num(d.suma_totala)}</option>)}
            </select></label>
            <label className="lat2">Observații<input value={v.observatii} onChange={e => set('observatii', e.target.value)} placeholder="ex. folosit și pentru alt proiect 20%" /></label>
          </div>
          {Number(op.tva_neeligibila) > 0 && <p className="mic gri">Din plată, {num(op.tva_neeligibila)} sunt TVA deductibilă (firma o recuperează), deci costul de amortizat e fără TVA.</p>}
          {lunar > 0 && procent > 0 && (
            <p className="mic">Amortizare lunară {num(lunar)} · pe proiect {num(lunar * procent / 100)} pe lună, începând cu luna de după {data(v.data)}.</p>
          )}
          {eroare && <div className="alerta rosu spatiu">{eroare}</div>}
          <div className="rand-butoane">
            <button className="buton" disabled={lucreaza} onClick={salveaza}>{lucreaza ? 'Se salvează…' : 'Salvează echipamentul'}</button>
            <button className="buton-text" disabled={lucreaza} onClick={inchide}>Renunță</button>
          </div>
        </>
      )}
    </section>
  )
}

function Editare({ e, docs, lucreaza, setLucreaza, inchide, gata }: {
  e: Ech; docs: Doc[]; lucreaza: boolean; setLucreaza: (b: boolean) => void; inchide: () => void; gata: (t: string) => Promise<void>
}) {
  const [v, setV] = useState({ denumire: e.denumire, cost: String(e.cost_achizitie).replace('.', ','), data: e.data_punere_functiune,
    durata: String(e.durata_amortizare_luni), procent: String(Number(e.procent_utilizare)), document: e.document_id ?? '', observatii: e.observatii ?? '' })
  const [eroare, setEroare] = useState<string | null>(null)
  const set = (k: string, val: string) => setV(x => ({ ...x, [k]: val }))
  const nr = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'))
  const cost = nr(v.cost), durata = parseInt(v.durata), procent = nr(v.procent)
  async function salveaza() {
    setEroare(null)
    if (!v.denumire.trim()) return setEroare('Scrieți ce echipament este.')
    if (!(cost > 0)) return setEroare('Costul trebuie să fie mai mare decât 0.')
    if (!(durata >= 1 && durata <= 600)) return setEroare('Durata de amortizare, în luni.')
    if (!(procent > 0 && procent <= 100)) return setEroare('Procentul de folosire pe proiect: între 1 și 100.')
    if (!v.data) return setEroare('Data punerii în funcțiune.')
    setLucreaza(true)
    const { error } = await supabase.rpc('modifica_echipament', { p_id: e.id, p_denumire: v.denumire, p_cost: cost, p_data: v.data,
      p_durata: durata, p_procent: procent, p_document: v.document || null, p_observatii: v.observatii })
    setLucreaza(false)
    if (error) setEroare(error.message); else await gata(`„${v.denumire.trim()}” a fost modificat.`)
  }
  return (
    <div className="detaliu-op">
      <div className="campuri">
        <label className="lat2">Ce echipament<input value={v.denumire} onChange={x => set('denumire', x.target.value)} /></label>
        <label>Cost de achiziție ({e.moneda === 'RON' ? 'lei' : 'EUR'})<input inputMode="decimal" value={v.cost} onChange={x => set('cost', x.target.value)} /></label>
        <label>Pus în funcțiune la<input type="date" value={v.data} onChange={x => set('data', x.target.value)} /></label>
        <label>Durata de amortizare (luni)<input inputMode="numeric" value={v.durata} onChange={x => set('durata', x.target.value)} /></label>
        <label>% folosire pe proiect<input inputMode="decimal" value={v.procent} onChange={x => set('procent', x.target.value)} /></label>
        <label className="lat2">Factura<select value={v.document} onChange={x => set('document', x.target.value)}>
          <option value="">— fără / încă neîncărcată —</option>
          {docs.filter(d => d.moneda === e.moneda).map(d => <option key={d.id} value={d.id}>{d.numar ?? 'fără număr'} · {d.furnizor_denumire ?? ''} · {num(d.suma_totala)}</option>)}
        </select></label>
        <label className="lat2">Observații<input value={v.observatii} onChange={x => set('observatii', x.target.value)} /></label>
      </div>
      {cost > 0 && durata > 0 && procent > 0 && <p className="mic">Amortizare lunară {num(cost / durata)} · pe proiect {num(cost / durata * procent / 100)} pe lună.</p>}
      {eroare && <div className="alerta rosu">{eroare}</div>}
      <div className="rand-butoane">
        <button className="buton mic-b" disabled={lucreaza} onClick={salveaza}>{lucreaza ? 'Se salvează…' : 'Salvează modificările'}</button>
        <button className="buton-text" disabled={lucreaza} onClick={inchide}>Renunță</button>
      </div>
    </div>
  )
}

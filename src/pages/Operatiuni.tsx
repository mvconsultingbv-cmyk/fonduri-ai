import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { bani, data, iban, num } from '../lib/format'

// Ecranul de validare: aici utilizatorul confirmă ce a propus aplicația pentru fiecare operațiune din extrase.
// Toate modificările trec prin funcțiile din baza de date (clasifica_operatiuni, aloca_pe_buget, storneaza_alocare),
// care verifică regulile și scriu automat în jurnal. Ecranul doar afișează și trimite deciziile.

type Alocare = { id: string; capitol: string; denumire: string; suma: number; stare: string; creat_la: string }
type Op = {
  id: string; cont_id: string; iban: string; moneda: string; cont_denumire: string; extras_numar: string; rand_extras: number
  data_operatiune: string; sens: 'debit' | 'credit'; suma: number
  tip_propus: string | null; tip_confirmat: string | null; tip: string | null
  aferenta_proiect: boolean | null; in_perioada_mixta: boolean; operatiune_parinte_id: string | null
  nr_comisioane: number; suma_comisioane: number; cine: string | null; detalii: string | null; descriere_banca: string | null
  decontat: number; alocari: Alocare[]
  legat_echipament: number; echipamente: { id: string; echipament_id: string; denumire: string; suma: number }[]
  tva_neeligibila: number; peste_eligibil: boolean
  documentat: number; documente: { id: string; document_id: string; numar: string | null; tip: string; suma: number }[]
}
type Pozitie = { id: string; capitol: string; denumire: string; mod_calcul: string }

const TIP: Record<string, string> = {
  incasare_finantare: 'Încasare finanțare', plata_furnizor: 'Plată furnizor', plata_salarii: 'Salarii', plata_taxe: 'Taxe și contribuții',
  comision_bancar: 'Comision bancar', dobanda: 'Dobândă', schimb_valutar: 'Schimb valutar', transfer_intern: 'Transfer între conturi',
  transfer_cont_propriu: 'Cont propriu asociație', retragere_numerar: 'Retragere numerar', depunere_numerar: 'Depunere numerar',
  restituire: 'Restituire', altele: 'Altele',
}
// Tipuri care nu sunt cheltuieli (bani mutați, nu consumați): nu se alocă pe buget.
const FARA_ALOCARE = new Set(['schimb_valutar', 'transfer_intern', 'transfer_cont_propriu', 'restituire', 'incasare_finantare', 'depunere_numerar', 'dobanda', 'plata_salarii', 'plata_taxe', 'comision_bancar'])
// Salariile și contribuțiile intră pe capitolul A prin pontaje; comisioanele, de regulă, în costurile indirecte (E).
const PE_PONTAJ = new Set(['plata_salarii', 'plata_taxe'])
// Ce intră în „de alocat pe capitole”: salariile și contribuțiile merg pe capitolul A prin pontaje (etapa 2), comisioanele la indirecte.
const DE_ALOCAT = new Set(['plata_furnizor', 'retragere_numerar', 'altele'])

type Vedere = 'mixt' | 'tip' | 'alocare' | 'toate'
const VEDERI: { cheie: Vedere; titlu: string; explicatie: string }[] = [
  { cheie: 'mixt', titlu: 'Cont mixt: aferent / neaferent', explicatie: 'Operațiunile din conturile vechi, din perioada în care contul a fost folosit și pentru alte activități ale asociației. Pentru fiecare decideți dacă ține de proiect. Comisionul legat de o plată urmează automat decizia plății.' },
  { cheie: 'tip', titlu: 'Tip de confirmat', explicatie: 'Aplicația a citit textul băncii și a propus un tip. Confirmați-l sau schimbați-l. Tipul decide unde poate merge operațiunea mai departe (pe buget, la schimburi, la transferuri).' },
  { cheie: 'alocare', titlu: 'De alocat pe capitole', explicatie: 'Plăți aferente proiectului, încă nealocate (sau alocate parțial) pe capitolele de buget care se decontează din plăți. Salariile și contribuțiile nu apar aici: se decontează pe capitolul A prin pontaje (modul în lucru). Comisioanele bancare sunt acoperite, de regulă, de costurile indirecte (E). Dacă o plată marcată „taxe” e de fapt un serviciu, schimbați-i tipul și va apărea aici.' },
  { cheie: 'toate', titlu: 'Toate operațiunile', explicatie: 'Toate operațiunile din extrasele încărcate, cu filtrele de mai sus.' },
]

export default function Operatiuni() {
  const { id } = useParams()
  const [ops, setOps] = useState<Op[] | null>(null)
  const [pozitii, setPozitii] = useState<Pozitie[]>([])
  const [eroare, setEroare] = useState<string | null>(null)
  const [mesaj, setMesaj] = useState<{ cls: string; text: string } | null>(null)
  const [lucreaza, setLucreaza] = useState(false)

  const [vedere, setVedere] = useState<Vedere>('mixt')
  const [cont, setCont] = useState('')
  const [luna, setLuna] = useState('')
  const [sens, setSens] = useState('')
  const [tipFiltru, setTipFiltru] = useState('')
  const [cauta, setCauta] = useState('')
  const [limita, setLimita] = useState(100)
  const [selectate, setSelectate] = useState<Set<string>>(new Set())
  const [deschis, setDeschis] = useState<string | null>(null)

  const incarca = useCallback(async () => {
    if (!id) return
    const toate: Op[] = []
    for (let de = 0; ; de += 1000) {
      const r = await supabase.from('v_operatiuni_validare')
        .select('id,cont_id,iban,moneda,cont_denumire,extras_numar,rand_extras,data_operatiune,sens,suma,tip_propus,tip_confirmat,tip,aferenta_proiect,in_perioada_mixta,operatiune_parinte_id,nr_comisioane,suma_comisioane,cine,detalii,descriere_banca,decontat,alocari,legat_echipament,echipamente,documentat,documente,tva_neeligibila,peste_eligibil')
        .eq('contract_id', id).order('data_operatiune').order('rand_extras').range(de, de + 999)
      if (r.error) { setEroare('Operațiunile nu au putut fi citite.'); return }
      toate.push(...(r.data as unknown as Op[]))
      if ((r.data ?? []).length < 1000) break
    }
    setOps(toate)
  }, [id])

  useEffect(() => {
    incarca()
    if (id) supabase.from('pozitii_buget').select('id,capitol,denumire,mod_calcul').eq('contract_id', id).order('ordine')
      .then(({ data }) => setPozitii((data ?? []) as Pozitie[]))
  }, [id, incarca])

  // Comisioanele legate de o plată nu apar ca rânduri separate: apar sub plata lor și urmează decizia ei.
  const principale = useMemo(() => (ops ?? []).filter(o => !o.operatiune_parinte_id), [ops])
  const comisioane = useMemo(() => {
    const m = new Map<string, Op[]>()
    for (const o of ops ?? []) if (o.operatiune_parinte_id) m.set(o.operatiune_parinte_id, [...(m.get(o.operatiune_parinte_id) ?? []), o])
    return m
  }, [ops])

  const deFacut = useMemo(() => ({
    mixt: principale.filter(o => o.in_perioada_mixta && o.aferenta_proiect === null),
    tip: principale.filter(o => !o.tip_confirmat),
    alocare: principale.filter(o => o.sens === 'debit' && o.aferenta_proiect === true && DE_ALOCAT.has(o.tip ?? '') && Number(o.decontat) + Number(o.legat_echipament) + Number(o.tva_neeligibila) < Number(o.suma) - 0.004),
    toate: principale,
  }), [principale])

  const conturi = useMemo(() => {
    const m = new Map<string, { id: string; nume: string; moneda: string }>()
    for (const o of principale) if (!m.has(o.cont_id)) m.set(o.cont_id, { id: o.cont_id, nume: o.cont_denumire, moneda: o.moneda })
    return [...m.values()]
  }, [principale])
  const luni = useMemo(() => [...new Set(principale.map(o => o.data_operatiune.slice(0, 7)))].sort(), [principale])

  const lista = useMemo(() => {
    const t = cauta.trim().toLowerCase()
    return deFacut[vedere].filter(o =>
      (!cont || o.cont_id === cont) && (!luna || o.data_operatiune.startsWith(luna)) && (!sens || o.sens === sens) &&
      (!tipFiltru || o.tip === tipFiltru) &&
      (!t || `${o.cine ?? ''} ${o.detalii ?? ''} ${o.descriere_banca ?? ''} ${num(o.suma)}`.toLowerCase().includes(t)))
  }, [deFacut, vedere, cont, luna, sens, tipFiltru, cauta])

  useEffect(() => { setSelectate(new Set()); setLimita(100) }, [vedere, cont, luna, sens, tipFiltru, cauta])

  const vizibile = lista.slice(0, limita)
  const toateBifate = vizibile.length > 0 && vizibile.every(o => selectate.has(o.id))
  const bifeaza = (oid: string) => setSelectate(s => { const n = new Set(s); if (n.has(oid)) n.delete(oid); else n.add(oid); return n })
  const bifeazaTot = () => setSelectate(toateBifate ? new Set() : new Set(vizibile.map(o => o.id)))

  async function actiune(fn: () => PromiseLike<{ error: { message: string } | null; data?: unknown }>, succes: string) {
    setLucreaza(true); setMesaj(null)
    const { error } = await fn()
    if (error) setMesaj({ cls: 'rosu', text: error.message })
    else { setMesaj({ cls: 'verde', text: succes }); await incarca() }
    setLucreaza(false)
  }

  const clasifica = (ids: string[], p: { aferenta?: boolean; confirma?: boolean; tip?: string }, succes: string) =>
    actiune(() => supabase.rpc('clasifica_operatiuni', {
      p_ids: ids, p_aferenta: p.aferenta ?? null, p_confirma_propus: p.confirma ?? false, p_tip: p.tip ?? null,
    }), succes).then(() => setSelectate(new Set()))

  if (eroare) return <><Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link><div className="alerta rosu">{eroare}</div></>
  if (!ops) return <div className="gol">Se încarcă operațiunile…</div>

  const v = VEDERI.find(x => x.cheie === vedere)!
  const sel = [...selectate]
  const pozAlocabile = pozitii.filter(p => p.mod_calcul === 'plati')

  return (
    <>
      <Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link>
      <section className="titlu-pagina">
        <h1>Validarea operațiunilor</h1>
        <p>{principale.length} operațiuni din extrase ({(ops.length - principale.length)} comisioane legate de plățile lor). Aplicația propune, dumneavoastră decideți.</p>
      </section>

      <section className="file-vederi">
        {VEDERI.map(x => (
          <button key={x.cheie} className={`fila ${vedere === x.cheie ? 'activa' : ''}`} onClick={() => setVedere(x.cheie)}>
            <span>{x.titlu}</span>
            <span className={`contor ${x.cheie !== 'toate' && deFacut[x.cheie].length === 0 ? 'gata' : ''}`}>
              {x.cheie !== 'toate' && deFacut[x.cheie].length === 0 ? '✓' : deFacut[x.cheie].length}
            </span>
          </button>
        ))}
      </section>
      <p className="explicatie">{v.explicatie}</p>

      <section className="filtre">
        <select value={cont} onChange={e => setCont(e.target.value)} aria-label="Cont">
          <option value="">Toate conturile</option>
          {conturi.map(c => <option key={c.id} value={c.id}>{c.nume}</option>)}
        </select>
        <select value={luna} onChange={e => setLuna(e.target.value)} aria-label="Luna">
          <option value="">Toate lunile</option>
          {luni.map(l => <option key={l} value={l}>{l.slice(5)}.{l.slice(0, 4)}</option>)}
        </select>
        <select value={sens} onChange={e => setSens(e.target.value)} aria-label="Sens">
          <option value="">Intrări și ieșiri</option><option value="credit">Doar intrări</option><option value="debit">Doar ieșiri</option>
        </select>
        <select value={tipFiltru} onChange={e => setTipFiltru(e.target.value)} aria-label="Tip">
          <option value="">Toate tipurile</option>
          {Object.entries(TIP).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select>
        <input value={cauta} onChange={e => setCauta(e.target.value)} placeholder="Caută nume, detalii, sumă…" />
      </section>

      {mesaj && <div className={`alerta ${mesaj.cls} spatiu`}>{mesaj.text}</div>}

      {sel.length > 0 && (
        <section className="bara-actiuni">
          <span className="tare">{sel.length} selectate</span>
          {vedere !== 'tip' && vedere !== 'alocare' && <>
            <button className="buton mic-b verde-b" disabled={lucreaza} onClick={() => clasifica(sel, { aferenta: true }, `${sel.length} operațiuni marcate aferente proiectului.`)}>Aferente proiectului</button>
            <button className="buton mic-b rosu-b" disabled={lucreaza} onClick={() => clasifica(sel, { aferenta: false }, `${sel.length} operațiuni marcate neaferente.`)}>Neaferente</button>
          </>}
          <button className="buton mic-b" disabled={lucreaza} onClick={() => clasifica(sel, { confirma: true }, 'Tipul propus a fost confirmat.')}>Confirmă tipul propus</button>
          <select className="mic-b" disabled={lucreaza} value="" onChange={e => e.target.value && clasifica(sel, { tip: e.target.value }, `Tipul a fost schimbat în „${TIP[e.target.value]}”.`)}>
            <option value="">Schimbă tipul în…</option>
            {Object.entries(TIP).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
          <button className="buton-text" onClick={() => setSelectate(new Set())}>Renunță</button>
        </section>
      )}

      <section className="bloc fara-padding">
        <div className="tabel-wrap">
          <table className="tabel-op">
            <thead>
              <tr>
                <th className="bifa"><input type="checkbox" checked={toateBifate} onChange={bifeazaTot} aria-label="Selectează tot" /></th>
                <th>Data</th><th>Cine / detalii</th><th>Tip</th><th className="n">Sumă</th><th>Proiect</th><th>Pe buget</th>
              </tr>
            </thead>
            <tbody>
              {vizibile.map(o => {
                const fees = comisioane.get(o.id) ?? []
                const alocabil = o.sens === 'debit' && o.aferenta_proiect === true && !FARA_ALOCARE.has(o.tip ?? '')
                const rest = Number(o.suma) - Number(o.decontat) - Number(o.legat_echipament) - Number(o.tva_neeligibila)
                return (
                  <Fragment key={o.id}>
                    <tr className={selectate.has(o.id) ? 'rand-selectat' : ''}>
                      <td className="bifa"><input type="checkbox" checked={selectate.has(o.id)} onChange={() => bifeaza(o.id)} aria-label="Selectează" /></td>
                      <td className="nowrap">{data(o.data_operatiune)}<div className="mic gri">{o.moneda === 'RON' ? 'lei' : 'EUR'} · {iban(o.iban).slice(-4)}</div></td>
                      <td className="lat">
                        <button className="text-buton" onClick={() => setDeschis(deschis === o.id ? null : o.id)}>
                          <span className="tare">{o.cine ?? scurt(o.descriere_banca)}</span>
                          {o.detalii && <div className="mic gri">{o.detalii}</div>}
                        </button>
                        {o.sens === 'debit' && o.aferenta_proiect === true && DE_ALOCAT.has(o.tip ?? '') && (
                          Number(o.documentat) >= Number(o.suma) - 0.004 ? <div className="mic verde-text">✓ are document</div>
                          : Number(o.documentat) > 0 ? <div className="mic gri">document parțial</div> : <div className="mic rosu-text">fără document</div>)}
                        {fees.length > 0 && <div className="mic gri">+ comision {bani(fees.reduce((a, f) => a + Number(f.suma), 0), o.moneda)}</div>}
                      </td>
                      <td>
                        <span className={`eticheta ${o.tip_confirmat ? 'verde' : ''}`} title={o.tip_confirmat ? 'confirmat' : 'propus de aplicație'}>
                          {TIP[o.tip ?? ''] ?? '—'}
                        </span>
                        {!o.tip_confirmat && <div className="mic gri">propus</div>}
                      </td>
                      <td className={`n tare ${o.sens === 'credit' ? 'verde-text' : ''}`}>{o.sens === 'credit' ? '+' : '−'}{num(o.suma)}</td>
                      <td className="nowrap">
                        {!o.in_perioada_mixta ? <span className="mic gri">da (cont dedicat)</span>
                          : o.aferenta_proiect === null ? (
                            <div className="butoane-da-nu">
                              <button className="da" disabled={lucreaza} onClick={() => clasifica([o.id], { aferenta: true }, 'Marcată aferentă proiectului.')}>Da</button>
                              <button className="nu" disabled={lucreaza} onClick={() => clasifica([o.id], { aferenta: false }, 'Marcată neaferentă.')}>Nu</button>
                            </div>
                          ) : (
                            <span className={`eticheta ${o.aferenta_proiect ? 'verde' : 'rosu'}`}>{o.aferenta_proiect ? 'aferentă' : 'neaferentă'}</span>
                          )}
                        {o.in_perioada_mixta && o.aferenta_proiect !== null && (
                          <button className="link-mic" disabled={lucreaza} onClick={() => clasifica([o.id], { aferenta: !o.aferenta_proiect }, 'Decizia a fost schimbată.')}>schimbă</button>
                        )}
                      </td>
                      <td>
                        {o.alocari.map(a => <div key={a.id} className="mic"><span className="eticheta albastru-e">{a.capitol}</span> {num(a.suma)}</div>)}
                        {Number(o.tva_neeligibila) > 0 && <div className="mic gri" title="TVA deductibilă din factură: firma o recuperează, nu intră pe proiect">TVA {num(o.tva_neeligibila)} neelig.</div>}
                        {o.peste_eligibil && <div className="mic rosu-text" title="S-a alocat mai mult decât partea eligibilă (după TVA deductibilă). Stornați diferența.">⚠ peste eligibil</div>}
                        {o.echipamente.map(e => <div key={e.id} className="mic" title={`Echipament: ${e.denumire} – pe proiect intră doar amortizarea`}><span className="eticheta galben-e">C.2</span> {num(e.suma)}</div>)}
                        {alocabil && rest > 0.004 && <button className="link-mic" onClick={() => setDeschis(deschis === o.id ? null : o.id)}>{o.alocari.length ? `+ rest ${num(rest)}` : 'Alocă'}</button>}
                        {!alocabil && o.alocari.length === 0 && o.echipamente.length === 0 && (
                          o.sens === 'debit' && o.aferenta_proiect === true && PE_PONTAJ.has(o.tip ?? '') ? <span className="mic gri">A · prin pontaj</span>
                          : o.sens === 'debit' && o.aferenta_proiect === true && o.tip === 'comision_bancar' ? <span className="mic gri">E · indirecte</span>
                          : <span className="mic gri">—</span>)}
                      </td>
                    </tr>
                    {deschis === o.id && (
                      <tr className="rand-detaliu">
                        <td />
                        <td colSpan={6}>
                          <Detaliu key={`${o.id}-${rest}`} contractId={id!} o={o} fees={fees} alocabil={alocabil} rest={rest} pozitii={pozAlocabile} lucreaza={lucreaza}
                            aloca={(poz, suma) => actiune(() => supabase.rpc('aloca_pe_buget', { p_operatiune: o.id, p_pozitie: poz, p_suma: suma }), 'Alocarea a fost salvată.')}
                            storneaza={(aid) => { if (window.confirm('Stornați această alocare? Rămâne în istoric, dar nu mai contează în buget.')) actiune(() => supabase.rpc('storneaza_alocare', { p_decontare: aid, p_motiv: 'corectat din ecranul de validare' }), 'Alocarea a fost stornată.') }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {vizibile.length === 0 && (
                <tr><td colSpan={7} className="gol-rand">{deFacut[vedere].length === 0 && vedere !== 'toate' ? 'Nimic de făcut aici. ✓' : 'Nicio operațiune pentru filtrele alese.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {lista.length > limita && (
          <div className="mai-mult"><button className="buton-text" onClick={() => setLimita(l => l + 200)}>Arată încă {Math.min(200, lista.length - limita)} din {lista.length - limita} rămase</button></div>
        )}
      </section>
      <p className="nota">Nicio decizie nu modifică datele venite de la bancă (dată, sumă, text). Fiecare decizie e înregistrată în jurnal, cu cine și când a făcut-o. O alocare aprobată nu se șterge: se corectează prin storno.</p>
    </>
  )
}

function Detaliu({ contractId, o, fees, alocabil, rest, pozitii, lucreaza, aloca, storneaza }: {
  contractId: string; o: Op; fees: Op[]; alocabil: boolean; rest: number; pozitii: Pozitie[]; lucreaza: boolean
  aloca: (poz: string, suma: number) => void; storneaza: (id: string) => void
}) {
  const [poz, setPoz] = useState(pozitii[0]?.id ?? '')
  const [suma, setSuma] = useState(rest > 0 ? rest.toFixed(2) : '')
  const valoare = Number(suma.replace(/\s/g, '').replace(',', '.'))
  return (
    <div className="detaliu-op">
      <div className="text-banca">{o.descriere_banca}</div>
      <div className="mic gri">Extras {o.extras_numar}, rândul {o.rand_extras} · {o.cont_denumire} · {iban(o.iban)}</div>
      {fees.length > 0 && (
        <div className="mic">Comisioane legate: {fees.map(f => `${num(f.suma)} (${f.tip_confirmat ? 'confirmat' : 'propus'})`).join(', ')} — urmează automat decizia plății.</div>
      )}
      {o.alocari.length > 0 && (
        <div className="alocari">
          {o.alocari.map(a => (
            <div key={a.id} className="alocare">
              <span><span className="eticheta albastru-e">{a.capitol}</span> {a.denumire}</span>
              <span className="n tare">{bani(a.suma, o.moneda)}</span>
              <button className="link-mic rosu-text" disabled={lucreaza} onClick={() => storneaza(a.id)}>stornează</button>
            </div>
          ))}
        </div>
      )}
      {o.echipamente.length > 0 && (
        <div className="mic">Achiziție de echipament (C.2): {o.echipamente.map(e => `${e.denumire} – ${num(e.suma)}`).join(', ')} · pe proiect intră amortizarea. <Link to={`/contract/${contractId}/echipamente`}>vezi echipamentele</Link></div>
      )}
      {Number(o.tva_neeligibila) > 0 && (
        <div className="mic">Din plată, {bani(o.tva_neeligibila, o.moneda)} sunt TVA deductibilă (după factura potrivită) și nu se pot aloca pe proiect.</div>
      )}
      {o.peste_eligibil && (
        <div className="alerta rosu">Alocările depășesc partea eligibilă a plății (suma minus TVA deductibilă). Stornați alocarea și refaceți-o cu suma corectă.</div>
      )}
      {o.documente.length > 0 && (
        <div className="mic">Documente: {o.documente.map(d => `${d.numar ?? d.tip} (${num(d.suma)})`).join(', ')} · <Link to={`/contract/${contractId}/documente`}>vezi documentele</Link></div>
      )}
      {alocabil && rest > 0.004 && (
        <div className="mic"><Link className="link-mic" to={`/contract/${contractId}/echipamente?operatiune=${o.id}`}>E un echipament? Înregistrează-l pe C.2 (amortizare) →</Link></div>
      )}
      {alocabil && rest > 0.004 && (
        pozitii.length === 0 ? <div className="mic gri">Contractul nu are capitole care se decontează din plăți.</div> : (
          <div className="form-alocare">
            <select value={poz} onChange={e => setPoz(e.target.value)} aria-label="Capitol">
              {pozitii.map(p => <option key={p.id} value={p.id}>{p.capitol} · {p.denumire}</option>)}
            </select>
            <input value={suma} onChange={e => setSuma(e.target.value)} inputMode="decimal" aria-label="Sumă" />
            <span className="mic gri">{o.moneda === 'RON' ? 'lei' : 'EUR'} din {num(rest)} nealocați</span>
            <button className="buton mic-b" disabled={lucreaza || !poz || !(valoare > 0) || valoare > rest + 0.004} onClick={() => aloca(poz, valoare)}>Alocă</button>
          </div>
        )
      )}
      {o.sens === 'debit' && o.aferenta_proiect === null && <div className="mic gri">Pentru alocare pe buget, marcați întâi operațiunea ca aferentă proiectului.</div>}
    </div>
  )
}

function scurt(t: string | null) {
  if (!t) return '—'
  const c = t.replace(/\[.*?\]/g, '').replace(/Tranzactie efectuata prin George Banking BCR\s*/i, '').trim()
  return c.length > 70 ? c.slice(0, 70) + '…' : c
}

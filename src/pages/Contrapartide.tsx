import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { bani, data, iban, num } from '../lib/format'

// Furnizori și beneficiari (registrul de contrapartide).
// Aplicația îl propune din extrase (propune_contrapartide): numele, IBAN-ul și CUI-ul celeilalte părți din fiecare transfer,
// iar la plățile cu cardul numele comerciantului. Tipul (firmă, persoană fizică, instituție, cont propriu) e ghicit
// și se corectează aici. Dublurile (același furnizor scris diferit) se unesc (uneste_contrapartide).
// Semnalele arată ce cere atenție la un audit Horizon: firme fără CUI, persoane fizice, părți legate, plăți fără document.

type Tip = 'PF' | 'PJ' | 'institutie_publica' | 'cont_propriu'
type Cp = {
  contract_id: string; id: string; tip: Tip; denumire: string; cui: string | null; cod_fiscal_strain: string | null; tara: string
  ibanuri: string[] | null; chei: string[]; parte_legata: boolean; propusa_automat: boolean; observatii: string | null
  nr_operatiuni: number; nr_pe_proiect: number; platit_ron: number; platit_eur: number; proiect_ron: number; proiect_eur: number
  incasat_ron: number; incasat_eur: number; plati_proiect_fara_document: number; prima: string | null; ultima: string | null; nr_documente: number
  plati_legate_personal: number
}
type Op = { id: string; data_operatiune: string; sens: string; suma: number; aferenta_proiect: boolean | null; descriere_banca: string | null; moneda: string; tip: string }
type Vedere = 'proiect' | 'verificat' | 'pf' | 'legate' | 'toate'

const TIP: Record<Tip, { t: string; c: string }> = {
  PJ: { t: 'firmă', c: 'albastru-e' }, PF: { t: 'persoană fizică', c: 'galben' },
  institutie_publica: { t: 'instituție publică', c: 'verde' }, cont_propriu: { t: 'cont propriu', c: 'gri-e' },
}

function semnale(c: Cp): { t: string; c: string }[] {
  const s: { t: string; c: string }[] = []
  if (c.nr_pe_proiect === 0) return s
  if (c.parte_legata) s.push({ t: 'parte legată', c: 'rosu' })
  if (c.tip === 'PJ' && c.tara === 'RO' && !c.cui) s.push({ t: 'fără CUI', c: 'galben' })
  if (c.tip === 'PJ' && c.tara !== 'RO' && !c.cod_fiscal_strain) s.push({ t: 'străin fără cod fiscal', c: 'galben' })
  // persoanele fizice plătite din proiect în afara statelor de plată: cer contract și impozit reținut
  if (c.tip === 'PF' && c.nr_pe_proiect > c.plati_legate_personal) s.push({ t: `PF: ${c.nr_pe_proiect - c.plati_legate_personal} în afara salariilor`, c: 'galben' })
  if (c.plati_proiect_fara_document > 0 && c.tip === 'PJ') s.push({ t: `${c.plati_proiect_fara_document} fără document`, c: 'galben' })
  if (c.propusa_automat) s.push({ t: 'neconfirmat', c: 'gri-e' })
  return s
}
const deVerificat = (c: Cp) => semnale(c).some(s => s.t !== 'neconfirmat')
const sumaText = (ron: number, eur: number) => [Number(ron) ? bani(ron, 'RON') : null, Number(eur) ? bani(eur, 'EUR') : null].filter(Boolean).join(' + ') || '—'

export default function Contrapartide() {
  const { id } = useParams()
  const [lista, setLista] = useState<Cp[] | null>(null)
  const [eroare, setEroare] = useState<string | null>(null)
  const [mesaj, setMesaj] = useState<{ cls: string; text: string } | null>(null)
  const [lucreaza, setLucreaza] = useState(false)
  const [vedere, setVedere] = useState<Vedere>('proiect')
  const [cauta, setCauta] = useState('')
  const [deschis, setDeschis] = useState<string | null>(null)

  const incarca = useCallback(async () => {
    if (!id) return
    const r = await supabase.from('v_contrapartide_contract').select('*').eq('contract_id', id).order('denumire')
    if (r.error) { setEroare('Datele nu au putut fi citite.'); return }
    setLista(r.data as Cp[])
  }, [id])
  useEffect(() => { incarca() }, [incarca])

  async function gata(text: string, cls = 'verde') { setMesaj({ cls, text }); await incarca() }

  async function propune() {
    setLucreaza(true); setMesaj(null)
    const r = await supabase.rpc('propune_contrapartide', { p_contract: id })
    setLucreaza(false)
    if (r.error) return gata(r.error.message, 'rosu')
    const x = r.data as { contrapartide_noi: number; operatiuni_legate: number; documente_legate: number }
    await gata(x.operatiuni_legate || x.documente_legate
      ? `Am legat ${x.operatiuni_legate} operațiuni și ${x.documente_legate} documente; ${x.contrapartide_noi} contrapartide noi au fost adăugate în registru.`
      : 'Toate operațiunile și documentele sunt deja legate de registru. Nimic nou.')
  }

  const pe = useMemo(() => (lista ?? []).filter(c => c.nr_pe_proiect > 0), [lista])
  const nr = {
    proiect: pe.length, verificat: pe.filter(deVerificat).length,
    pf: pe.filter(c => c.tip === 'PF').length, legate: (lista ?? []).filter(c => c.parte_legata).length, toate: lista?.length ?? 0,
  }
  const t = cauta.trim().toLowerCase()
  const vizibile = (lista ?? [])
    .filter(c => vedere === 'toate' ? true : vedere === 'proiect' ? c.nr_pe_proiect > 0 : vedere === 'verificat' ? deVerificat(c)
      : vedere === 'pf' ? c.tip === 'PF' && c.nr_pe_proiect > 0 : c.parte_legata)
    .filter(c => !t || `${c.denumire} ${c.cui ?? ''} ${(c.ibanuri ?? []).join(' ')}`.toLowerCase().includes(t))
    .sort((a, b) => (Number(b.proiect_ron) + Number(b.proiect_eur) * 5) - (Number(a.proiect_ron) + Number(a.proiect_eur) * 5) || a.denumire.localeCompare(b.denumire))

  if (eroare) return <><Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link><div className="alerta rosu">{eroare}</div></>
  if (!lista) return <div className="gol">Se încarcă registrul…</div>

  const totPF = pe.filter(c => c.tip === 'PF').reduce((a, c) => a + Number(c.proiect_ron), 0)

  return (
    <>
      <Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link>
      <section className="titlu-pagina">
        <h1>Furnizori și beneficiari</h1>
        <p>Cui plătește proiectul și de la cine încasează. Registrul e propus din extrase; aici se corectează tipul, se completează CUI-ul și se unesc dublurile.</p>
      </section>

      <section className="cifre">
        <div className="cifra"><div className="cifra-eticheta">În registru</div><div className="cifra-valoare mic-v">{nr.toate}</div><div className="cifra-sub">{nr.proiect} cu operațiuni pe proiect</div></div>
        <div className="cifra accent"><div className="cifra-eticheta">De verificat</div><div className="cifra-valoare mic-v">{nr.verificat}</div><div className="cifra-sub">pe proiect, cu semnale</div></div>
        <div className="cifra"><div className="cifra-eticheta">Persoane fizice pe proiect</div><div className="cifra-valoare mic-v">{nr.pf}</div><div className="cifra-sub">{bani(totPF, 'RON')} plătiți</div></div>
        <div className="cifra"><div className="cifra-eticheta">Părți legate</div><div className="cifra-valoare mic-v">{nr.legate}</div><div className="cifra-sub">marcate de dumneavoastră</div></div>
      </section>

      <div className="alerta albastru spatiu">
        <b>De ce contează:</b> la un audit Horizon se verifică cine a primit banii. <b>Firmele</b> au nevoie de CUI și factură. <b>Persoanele fizice</b> au nevoie de contract (muncă, civil, drepturi de autor) și de impozitul reținut.{' '}
        <b>Părțile legate</b> (firme ale administratorului, ale membrilor sau ale rudelor) sunt eligibile doar la preț de piață, dovedit cu oferte comparative, și trebuie declarate.
        Marcați-le aici, ca să apară în raportare.
      </div>
      {mesaj && <div className={`alerta ${mesaj.cls} spatiu`}>{mesaj.text}</div>}

      <div className="rand-butoane spatiu">
        <button className="buton" disabled={lucreaza} onClick={propune}>{lucreaza ? 'Se lucrează…' : 'Recunoaște din extrasele noi'}</button>
        <span className="mic gri">După ce încărcați extrase sau documente noi, apăsați aici ca plățile noi să fie legate de registru.</span>
      </div>

      <section className="file-vederi">
        {([['proiect', 'Pe proiect'], ['verificat', 'De verificat'], ['pf', 'Persoane fizice'], ['legate', 'Părți legate'], ['toate', 'Toate']] as [Vedere, string][]).map(([k, txt]) => (
          <button key={k} className={`fila ${vedere === k ? 'activa' : ''}`} onClick={() => setVedere(k)}>{txt} <span className="contor">{nr[k]}</span></button>
        ))}
      </section>
      <input className="cauta-lat" value={cauta} onChange={e => setCauta(e.target.value)} placeholder="Caută după nume, CUI sau IBAN…" />

      <section className="bloc fara-padding">
        <div className="tabel-wrap">
          <table className="tabel-op">
            <thead><tr>
              <th>Contrapartida</th><th className="n">Operațiuni</th><th className="n">Plătit pe proiect</th><th className="n">Încasat</th><th className="n">Documente</th><th>Semnale</th><th />
            </tr></thead>
            <tbody>
              {vizibile.map(c => (
                <Fragment key={c.id}>
                  <tr>
                    <td className="lat">
                      <div className="tare">{c.denumire}</div>
                      <div className="mic gri"><span className={`eticheta ${TIP[c.tip].c}`}>{TIP[c.tip].t}</span>
                        {c.cui ? ` CUI ${c.cui}` : c.cod_fiscal_strain ? ` cod fiscal ${c.cod_fiscal_strain}` : ''}{c.tara !== 'RO' ? ` · ${c.tara}` : ''}
                        </div>{c.ibanuri?.length ? <div className="mic gri">{iban(c.ibanuri[0])}{c.ibanuri.length > 1 ? ` +${c.ibanuri.length - 1}` : ''}</div> : null}
                    </td>
                    <td className="n">{c.nr_operatiuni}<div className="mic gri">{c.nr_pe_proiect} pe proiect</div>{c.plati_legate_personal ? <div className="mic gri">{c.plati_legate_personal} salarii/taxe</div> : null}</td>
                    <td className="n tare">{sumaText(c.proiect_ron, c.proiect_eur)}</td>
                    <td className="n">{sumaText(c.incasat_ron, c.incasat_eur)}</td>
                    <td className="n">{c.nr_documente}</td>
                    <td className="semnale">{semnale(c).map((s, i) => <span key={i} className={`eticheta ${s.c}`}>{s.t}</span>)}</td>
                    <td className="nowrap"><button className="link-mic" onClick={() => setDeschis(deschis === c.id ? null : c.id)}>{deschis === c.id ? 'închide' : 'deschide'}</button></td>
                  </tr>
                  {deschis === c.id && (
                    <tr className="rand-detaliu"><td colSpan={7}>
                      <Detaliu c={c} toate={lista} lucreaza={lucreaza} setLucreaza={setLucreaza} gata={gata} inchide={() => setDeschis(null)} />
                    </td></tr>
                  )}
                </Fragment>
              ))}
              {vizibile.length === 0 && <tr><td colSpan={7} className="gol-rand">{lista.length === 0 ? 'Registrul e gol. Apăsați „Recunoaște din extrasele noi”.' : 'Nimic în această vedere.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <p className="nota">Sumele sunt în moneda contului. „Pe proiect” înseamnă operațiuni din conturile proiectului și cele din contul mixt marcate ca aferente. Tipul și numele propuse automat sunt marcate „neconfirmat” până le salvați.</p>
    </>
  )
}

function Detaliu({ c, toate, lucreaza, setLucreaza, gata, inchide }: {
  c: Cp; toate: Cp[]; lucreaza: boolean; setLucreaza: (b: boolean) => void; gata: (t: string, c?: string) => Promise<void>; inchide: () => void
}) {
  const [v, setV] = useState({ tip: c.tip, denumire: c.denumire, cui: c.cui ?? '', cod_fiscal_strain: c.cod_fiscal_strain ?? '', tara: c.tara, parte_legata: c.parte_legata, observatii: c.observatii ?? '' })
  const [ops, setOps] = useState<Op[] | null>(null)
  const [unire, setUnire] = useState('')
  const [cautaU, setCautaU] = useState('')
  const [eroare, setEroare] = useState<string | null>(null)
  const set = (k: string, val: string | boolean) => setV(x => ({ ...x, [k]: val }))

  useEffect(() => {
    supabase.from('operatiuni').select('id,data_operatiune,sens,suma,aferenta_proiect,descriere_banca,tip_propus,tip_confirmat,conturi!inner(contract_id,moneda)')
      .eq('contrapartida_id', c.id).eq('conturi.contract_id', c.contract_id).order('data_operatiune').limit(500)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data: d }) => setOps(((d ?? []) as any[]).map(x => ({ ...x, moneda: x.conturi?.moneda, tip: x.tip_confirmat ?? x.tip_propus }))))
  }, [c.id, c.contract_id])

  async function salveaza() {
    setEroare(null)
    if (!v.denumire.trim()) return setEroare('Denumirea nu poate fi goală.')
    const cui = v.cui.replace(/^RO/i, '').replace(/\s/g, '')
    if (cui && !/^\d{2,10}$/.test(cui)) return setEroare('CUI-ul românesc are între 2 și 10 cifre (fără „RO”).')
    const tara = v.tara.trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(tara)) return setEroare('Țara: codul din două litere (RO, DE, IT…).')
    setLucreaza(true)
    const r = await supabase.from('contrapartide').update({
      tip: v.tip, denumire: v.denumire.trim(), cui: cui || null, cod_fiscal_strain: v.cod_fiscal_strain.trim() || null, tara,
      parte_legata: v.parte_legata, observatii: v.observatii.trim() || null, propusa_automat: false,
    }).eq('id', c.id)
    setLucreaza(false)
    if (r.error) return setEroare(r.error.message)
    await gata(`„${v.denumire.trim()}” a fost salvat${v.parte_legata ? ' și marcat ca parte legată' : ''}.`)
  }

  const tu = cautaU.trim().toLowerCase()
  const candidati = toate.filter(x => x.id !== c.id && (!tu || x.denumire.toLowerCase().includes(tu))).slice(0, 200)
  const ales = toate.find(x => x.id === unire)

  async function uneste() {
    if (!ales) return
    if (!window.confirm(`„${ales.denumire}” va fi unit în „${c.denumire}”: toate plățile și documentele lui trec aici, iar el dispare din registru. Continuați?`)) return
    setLucreaza(true)
    const r = await supabase.rpc('uneste_contrapartide', { p_pastrez: c.id, p_elimin: ales.id })
    setLucreaza(false)
    if (r.error) return setEroare(r.error.message)
    setUnire(''); setCautaU('')
    await gata(`„${ales.denumire}” a fost unit în „${c.denumire}”.`)
  }

  return (
    <div className="detaliu-avans">
      <div className="campuri">
        <label className="lat2">Denumire<input value={v.denumire} onChange={e => set('denumire', e.target.value)} /></label>
        <label>Tip<select value={v.tip} onChange={e => set('tip', e.target.value)}>
          {(Object.keys(TIP) as Tip[]).map(k => <option key={k} value={k}>{TIP[k].t}</option>)}</select></label>
        <label>Țara<input value={v.tara} maxLength={2} onChange={e => set('tara', e.target.value)} /></label>
        {v.tip !== 'PF' && <label>CUI (România)<input value={v.cui} onChange={e => set('cui', e.target.value)} placeholder="ex. 19190844" /></label>}
        {v.tip !== 'PF' && <label>Cod fiscal străin<input value={v.cod_fiscal_strain} onChange={e => set('cod_fiscal_strain', e.target.value)} placeholder="ex. IE1234567X" /></label>}
        <label className="lat2">Observații<input value={v.observatii} onChange={e => set('observatii', e.target.value)} placeholder="ex. contract drepturi de autor 17/2024" /></label>
        <label className="bifa-camp lat2"><input type="checkbox" checked={v.parte_legata} onChange={e => set('parte_legata', e.target.checked)} /> Parte legată (firmă sau persoană legată de asociație, de conducerea ei sau de membri)</label>
      </div>
      {c.chei.length > 1 && <p className="mic gri">Apare în extrase și ca: {c.chei.join(' · ')}</p>}
      <div className="rand-butoane"><button className="buton mic-b" disabled={lucreaza} onClick={salveaza}>Salvează{c.propusa_automat ? ' și confirmă' : ''}</button>
        <button className="buton-text" onClick={inchide}>Închide</button></div>

      <h3 className="subtitlu">Unește cu un duplicat</h3>
      <p className="mic gri">Dacă același furnizor apare de două ori (de ex. o dată din plăți cu cardul și o dată din transferuri), alegeți dublura: plățile ei trec aici.</p>
      <div className="campuri">
        <label>Caută<input value={cautaU} onChange={e => setCautaU(e.target.value)} placeholder="o parte din nume" /></label>
        <label className="lat2">Dublura<select value={unire} onChange={e => setUnire(e.target.value)}>
          <option value="">— alegeți —</option>
          {candidati.map(x => <option key={x.id} value={x.id}>{x.denumire} · {TIP[x.tip].t} · {x.nr_operatiuni} op.</option>)}
        </select></label>
        <div className="rand-butoane"><button className="buton mic-b" disabled={lucreaza || !unire} onClick={uneste}>Unește aici</button></div>
      </div>

      <h3 className="subtitlu">Operațiuni</h3>
      {!ops ? <p className="mic gri">Se încarcă…</p> : ops.length === 0 ? <p className="mic gri">Nicio operațiune în acest contract.</p> : (
        <ul className="lista-justificari">
          {ops.map(o => (
            <li key={o.id} className={o.aferenta_proiect === false ? 'gri' : ''}>
              <span>{data(o.data_operatiune)} · {o.sens === 'credit' ? 'încasare' : 'plată'}{o.aferenta_proiect === false ? ' · neaferentă' : ''} · <span className="gri">{(o.descriere_banca ?? '').replace(/^Tranzactie efectuata prin George Banking BCR Referinta \S+, data valutei \S+, /, '').slice(0, 110)}</span></span>
              <span className="nowrap tare">{o.sens === 'credit' ? '+' : '−'}{num(o.suma)} {o.moneda === 'RON' ? 'lei' : o.moneda}</span>
            </li>
          ))}
        </ul>
      )}
      {eroare && <div className="alerta rosu spatiu">{eroare}</div>}
    </div>
  )
}

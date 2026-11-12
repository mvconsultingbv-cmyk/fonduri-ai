import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { bani, data } from '../lib/format'

// Transferuri și cont propriu: banii care se mută fără să fie cheltuială.
//  1. Transferuri între conturile contractului: fiecare ieșire dintr-un cont trebuie să aibă intrarea ei în alt cont
//     al aceluiași contract (aceeași monedă, aceeași sumă). Altfel, banii ar lipsi din sold sau s-ar număra de două ori.
//     Contrapartea se recunoaște după IBAN-ul din textul băncii; perechile sigure se leagă cu un clic.
//  2. Mișcări cu contul propriu al firmei: fiecare are un motiv (alimentare, recuperarea cheltuielilor indirecte,
//     recuperarea comisioanelor, returnarea unei alimentări). Din motive rezultă cât datorează proiectul firmei și invers.
// Regulile (sume egale, conturi diferite, o singură pereche pe operațiune) stau în baza de date (migrația 021).

type Tr = {
  id: string; cont_id: string; iban: string; moneda: string; cont_denumire: string; extras_numar: string | null; data_operatiune: string
  sens: 'debit' | 'credit'; suma: number; descriere_banca: string | null; iban_contrapartida: string | null; cont_contrapartida: string | null
  transfer_id: string | null; pereche_id: string | null; pereche_data: string | null; pereche_cont: string | null
  propunere_id: string | null; propunere_data: string | null; propunere_cont: string | null; stare: string
}
type Cp = {
  id: string; moneda: string; cont_denumire: string; extras_numar: string | null; data_operatiune: string; sens: 'debit' | 'credit'
  suma: number; descriere_banca: string | null; motiv: string | null; motiv_propus: string | null
}
type Rap = { perioada: number; mod_calcul: string; denumire: string; eligibil_eur: number; neconfirmat_eur: number }

const STARE: Record<string, { text: string; cls: string; explicatie: string }> = {
  legat: { text: 'legat', cls: 'verde', explicatie: 'Ieșirea și intrarea sunt legate.' },
  propunere: { text: 'pereche găsită', cls: 'albastru-e', explicatie: 'Aplicația a găsit o singură potrivire posibilă. Confirmați legarea.' },
  asteapta_extras: { text: 'așteaptă extras', cls: 'galben-e', explicatie: 'Contrapartea e un cont al contractului, dar extrasul lui pentru acea dată nu e încărcat.' },
  cont_extern: { text: 'cont din afara contractului', cls: 'rosu', explicatie: 'IBAN-ul de la celălalt capăt nu e al contractului. Probabil e o mișcare cu contul propriu sau o plată: schimbați tipul în ecranul de validare.' },
  fara_pereche: { text: 'fără pereche', cls: 'rosu', explicatie: 'Nu s-a găsit operațiunea corespunzătoare. Alegeți-o manual sau verificați tipul.' },
}
const MOTIVE: Record<string, string> = {
  alimentare: 'Alimentare de la firmă (firma pune bani în proiect)',
  recuperare_overhead: 'Recuperarea cheltuielilor indirecte (overhead)',
  recuperare_comisioane: 'Recuperarea comisioanelor plătite de firmă',
  returnare_alimentare: 'Returnarea unei alimentări către firmă',
  altele: 'Alt motiv (de explicat)',
}
const MOTIV_SCURT: Record<string, string> = {
  alimentare: 'Alimentare', recuperare_overhead: 'Indirecte (overhead)', recuperare_comisioane: 'Comisioane',
  returnare_alimentare: 'Returnare alimentare', altele: 'Alt motiv',
}

export default function Transferuri() {
  const { id } = useParams()
  const [tr, setTr] = useState<Tr[] | null>(null)
  const [cp, setCp] = useState<Cp[] | null>(null)
  const [rap, setRap] = useState<Rap[]>([])
  const [moneda, setMoneda] = useState('EUR')
  const [eroare, setEroare] = useState<string | null>(null)
  const [mesaj, setMesaj] = useState<{ cls: string; text: string } | null>(null)
  const [lucreaza, setLucreaza] = useState(false)
  const [alege, setAlege] = useState<string | null>(null)

  const incarca = useCallback(async () => {
    if (!id) return
    const [a, b, r, c] = await Promise.all([
      supabase.from('v_transferuri_interne').select('*').eq('contract_id', id).order('data_operatiune').order('sens', { ascending: false }),
      supabase.from('v_cont_propriu').select('id,moneda,cont_denumire,extras_numar,data_operatiune,sens,suma,descriere_banca,motiv,motiv_propus').eq('contract_id', id).order('data_operatiune'),
      supabase.from('v_raport_perioade').select('perioada,mod_calcul,denumire,eligibil_eur,neconfirmat_eur').eq('contract_id', id).eq('mod_calcul', 'procent'),
      supabase.from('contracte').select('programe(moneda)').eq('id', id).single(),
    ])
    if (a.error || b.error || r.error || c.error) { setEroare('Datele nu au putut fi citite.'); return }
    setTr(a.data as Tr[]); setCp(b.data as Cp[]); setRap(r.data as Rap[])
    setMoneda((c.data as unknown as { programe: { moneda: string } | null })?.programe?.moneda?.trim() || 'EUR')
  }, [id])
  useEffect(() => { incarca() }, [incarca])

  const contoare = useMemo(() => {
    const n: Record<string, number> = {}
    for (const t of tr ?? []) n[t.stare] = (n[t.stare] ?? 0) + 1
    return n
  }, [tr])

  // Ce poate rezulta din motive, pe fiecare monedă.
  const sold = useMemo(() => {
    const m: Record<string, { alimentat: number; returnat: number; overhead: number; comisioane: number; nelamurit: number; nrNelamurit: number; nrPropuse: number }> = {}
    for (const o of cp ?? []) {
      const k = o.moneda.trim()
      const s = (m[k] ??= { alimentat: 0, returnat: 0, overhead: 0, comisioane: 0, nelamurit: 0, nrNelamurit: 0, nrPropuse: 0 })
      const v = Number(o.suma) * (o.sens === 'debit' ? 1 : -1) // pozitiv = a ieșit din proiect spre firmă
      if (!o.motiv) { s.nrPropuse += o.motiv_propus ? 1 : 0 }
      switch (o.motiv) {
        case 'alimentare': s.alimentat -= v; break
        case 'returnare_alimentare': s.returnat += v; break
        case 'recuperare_overhead': s.overhead += v; break
        case 'recuperare_comisioane': s.comisioane += v; break
        default: s.nelamurit += v; s.nrNelamurit++
      }
    }
    return m
  }, [cp])

  const indirecte = useMemo(() => {
    const e = rap.reduce((a, r) => a + Number(r.eligibil_eur), 0)
    const n = rap.reduce((a, r) => a + Number(r.neconfirmat_eur), 0)
    return { eligibil: e, confirmat: e - n, neconfirmat: n }
  }, [rap])

  async function ruleaza(fn: () => Promise<{ error: { message?: string } | null }>, ok: string) {
    setLucreaza(true); setMesaj(null)
    const { error } = await fn()
    setLucreaza(false)
    if (error) return setMesaj({ cls: 'rosu', text: error.message || 'Operațiunea nu a reușit.' })
    setAlege(null); setMesaj({ cls: 'verde', text: ok }); await incarca()
  }

  async function leagaToate() {
    setLucreaza(true); setMesaj(null)
    const { data: n, error } = await supabase.rpc('leaga_transferuri_propuse', { p_contract: id })
    setLucreaza(false)
    if (error) return setMesaj({ cls: 'rosu', text: error.message || 'Legarea nu a reușit.' })
    setMesaj({ cls: 'verde', text: `Au fost legate ${n} perechi.` }); await incarca()
  }

  const leaga = (t: Tr, altul: string) => {
    const [ies, intr] = t.sens === 'debit' ? [t.id, altul] : [altul, t.id]
    return ruleaza(async () => await supabase.rpc('leaga_transfer', { p_iesire: ies, p_intrare: intr }), 'Perechea a fost legată.')
  }
  const dezleaga = (t: Tr) => {
    if (!window.confirm('Dezlegi această pereche? Operațiunile rămân în extrase, doar nu mai sunt legate între ele.')) return
    return ruleaza(async () => await supabase.from('transferuri_interne').delete().eq('id', t.transfer_id!), 'Perechea a fost dezlegată.')
  }
  const motiv = (o: Cp, m: string | null) =>
    ruleaza(async () => await supabase.rpc('seteaza_motiv_cont_propriu', { p_operatiune: o.id, p_motiv: m }), m ? `Motiv salvat: ${MOTIV_SCURT[m]}.` : 'Motivul a fost șters.')
  async function confirmaPropuse() {
    const de = (cp ?? []).filter(o => !o.motiv && o.motiv_propus)
    if (!window.confirm(`Confirmi motivul propus pentru ${de.length} mișcări? Fiecare îl poți schimba apoi individual.`)) return
    setLucreaza(true); setMesaj(null)
    for (const o of de) {
      const { error } = await supabase.rpc('seteaza_motiv_cont_propriu', { p_operatiune: o.id, p_motiv: o.motiv_propus })
      if (error) { setLucreaza(false); setMesaj({ cls: 'rosu', text: error.message }); await incarca(); return }
    }
    setLucreaza(false); setMesaj({ cls: 'verde', text: `Au fost confirmate ${de.length} motive.` }); await incarca()
  }

  if (eroare) return <><Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link><div className="alerta rosu">{eroare}</div></>
  if (!tr || !cp) return <div className="gol">Se încarcă transferurile…</div>

  const nePereche = (contoare.fara_pereche ?? 0) + (contoare.cont_extern ?? 0)
  const sProg = sold[moneda]
  const deConfirmat = cp.filter(o => !o.motiv && o.motiv_propus).length

  // Variante pentru alegerea manuală a perechii: alt cont, sens opus, aceeași monedă și sumă, nelegată, max. 10 zile.
  const variante = (t: Tr) => tr.filter(x => x.id !== t.id && x.cont_id !== t.cont_id && x.sens !== t.sens && x.moneda === t.moneda
    && Number(x.suma) === Number(t.suma) && !x.pereche_id
    && Math.abs((new Date(x.data_operatiune).getTime() - new Date(t.data_operatiune).getTime()) / 864e5) <= 10)

  return (
    <>
      <Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link>
      <section className="titlu-pagina">
        <h1>Transferuri și cont propriu</h1>
        <p>Banii mutați între conturile proiectului sau între proiect și contul propriu al firmei. Aceștia nu sunt cheltuieli, dar fiecare mișcare trebuie să aibă perechea ori motivul ei.</p>
      </section>

      <section className="cifre">
        <div className="cifra accent"><div className="cifra-eticheta">Transferuri între conturi</div><div className="cifra-valoare mic-v">{tr.length}</div>
          <div className="cifra-sub">{contoare.legat ?? 0} legate</div></div>
        <div className="cifra"><div className="cifra-eticheta">Așteaptă un extras</div><div className="cifra-valoare mic-v">{contoare.asteapta_extras ?? 0}</div>
          <div className="cifra-sub">perechea e într-un extras neîncărcat</div></div>
        <div className="cifra"><div className="cifra-eticheta">Fără pereche</div><div className={`cifra-valoare mic-v ${nePereche ? 'rosu-text' : ''}`}>{nePereche}</div>
          <div className="cifra-sub">{contoare.propunere ? `${contoare.propunere} cu pereche găsită` : 'de lămurit'}</div></div>
        <div className="cifra"><div className="cifra-eticheta">Indirecte retrase la firmă</div><div className="cifra-valoare mic-v">{bani(sProg?.overhead ?? 0, moneda)}</div>
          <div className="cifra-sub">din {bani(indirecte.eligibil, moneda)} indirecte calculate</div></div>
      </section>

      {mesaj && <div className={`alerta ${mesaj.cls} spatiu`}>{mesaj.text}</div>}

      <section className="bloc fara-padding">
        <div className="bloc-titlu" style={{ padding: '16px 18px 0' }}><h2>1. Transferuri între conturile contractului</h2>
          <p>Fiecare ieșire dintr-un cont trebuie să aibă intrarea ei în alt cont al contractului, cu aceeași sumă. Celălalt cont se recunoaște după IBAN-ul din textul băncii.</p></div>
        {(contoare.propunere ?? 0) > 0 && <div className="rand-butoane" style={{ padding: '4px 18px 12px' }}>
          <button className="buton" disabled={lucreaza} onClick={leagaToate}>Leagă perechile găsite ({Math.ceil((contoare.propunere ?? 0) / 2)})</button></div>}
        <div className="tabel-wrap">
          <table className="tabel-op">
            <thead><tr><th>Data</th><th>Contul</th><th>Sens</th><th className="n">Suma</th><th>Celălalt cont</th><th>Stare</th><th></th></tr></thead>
            <tbody>
              {tr.map(t => {
                const s = STARE[t.stare] ?? STARE.fara_pereche
                const v = alege === t.id ? variante(t) : []
                return (
                  <tr key={t.id}>
                    <td>{data(t.data_operatiune)}{t.extras_numar && <div className="mic gri">extras {t.extras_numar}</div>}</td>
                    <td>{t.cont_denumire}</td>
                    <td>{t.sens === 'debit' ? 'ieșire' : 'intrare'}</td>
                    <td className="n tare">{bani(t.suma, t.moneda.trim())}</td>
                    <td>{t.pereche_cont ?? t.cont_contrapartida ?? t.propunere_cont ?? (t.iban_contrapartida ? <span className="mic">{t.iban_contrapartida}</span> : <span className="gri">necunoscut</span>)}
                      {t.pereche_data && <div className="mic gri">{t.sens === 'debit' ? 'intrată' : 'ieșită'} {data(t.pereche_data)}</div>}
                      {!t.pereche_data && t.propunere_data && <div className="mic gri">propusă: {data(t.propunere_data)}</div>}</td>
                    <td><span className={`eticheta ${s.cls}`} title={s.explicatie}>{s.text}</span>
                      {(t.stare === 'asteapta_extras' || t.stare === 'cont_extern' || t.stare === 'fara_pereche') && <div className="mic gri">{s.explicatie}</div>}</td>
                    <td className="n">
                      {t.stare === 'legat' && <button className="buton-text" disabled={lucreaza} onClick={() => dezleaga(t)}>Dezleagă</button>}
                      {t.stare === 'propunere' && t.propunere_id && <button className="buton-text" disabled={lucreaza} onClick={() => leaga(t, t.propunere_id!)}>Leagă</button>}
                      {(t.stare === 'fara_pereche' || t.stare === 'cont_extern') && (alege === t.id
                        ? (v.length ? <select disabled={lucreaza} defaultValue="" onChange={e => e.target.value && leaga(t, e.target.value)}>
                            <option value="">— alege perechea —</option>
                            {v.map(x => <option key={x.id} value={x.id}>{data(x.data_operatiune)} · {x.cont_denumire}</option>)}
                          </select> : <span className="mic gri">nicio operațiune potrivită</span>)
                        : <button className="buton-text" disabled={lucreaza} onClick={() => setAlege(t.id)}>Alege perechea</button>)}
                    </td>
                  </tr>
                )
              })}
              {tr.length === 0 && <tr><td colSpan={7} className="gol">Nicio operațiune de tip „transfer între conturi”.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bloc fara-padding">
        <div className="bloc-titlu" style={{ padding: '16px 18px 0' }}><h2>2. Mișcări cu contul propriu al firmei</h2>
          <p>Bani trimiși din proiect către contul firmei sau primiți de la ea. Motivul arată dacă e o recuperare legitimă (de exemplu cheltuielile indirecte) sau o sumă care trebuie returnată.</p></div>
        {deConfirmat > 0 && <div className="rand-butoane" style={{ padding: '4px 18px 12px' }}>
          <button className="buton" disabled={lucreaza} onClick={confirmaPropuse}>Confirmă motivele propuse ({deConfirmat})</button></div>}
        <div className="tabel-wrap">
          <table className="tabel-op">
            <thead><tr><th>Data</th><th>Contul</th><th>Sens</th><th className="n">Suma</th><th>Textul băncii</th><th>Motiv</th></tr></thead>
            <tbody>
              {cp.map(o => (
                <tr key={o.id}>
                  <td>{data(o.data_operatiune)}{o.extras_numar && <div className="mic gri">extras {o.extras_numar}</div>}</td>
                  <td>{o.cont_denumire}</td>
                  <td>{o.sens === 'debit' ? 'spre firmă' : 'de la firmă'}</td>
                  <td className="n tare">{bani(o.suma, o.moneda.trim())}</td>
                  <td className="mic">{detalii(o.descriere_banca)}</td>
                  <td>
                    <select disabled={lucreaza} value={o.motiv ?? ''} onChange={e => motiv(o, e.target.value || null)}>
                      <option value="">{o.motiv_propus ? `— propus: ${MOTIV_SCURT[o.motiv_propus]} —` : '— alege motivul —'}</option>
                      {Object.entries(MOTIVE).map(([k, x]) => <option key={k} value={k}>{x}</option>)}
                    </select>
                    {!o.motiv && <div className="mic"><span className="eticheta galben-e">neconfirmat</span></div>}
                  </td>
                </tr>
              ))}
              {cp.length === 0 && <tr><td colSpan={6} className="gol">Nicio mișcare cu contul propriu al firmei.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bloc">
        <div className="bloc-titlu"><h2>3. Ce rezultă: cine cui datorează</h2>
          <p>Calculat din motivele confirmate. Mișcările fără motiv apar separat, ca „de lămurit”.</p></div>
        {Object.keys(sold).length === 0 && <p className="gri">Nu există mișcări cu contul propriu.</p>}
        {Object.entries(sold).map(([m, s]) => {
          const datoreazaFirmei = s.alimentat - s.returnat
          return (
            <div key={m} className="spatiu">
              <h3 style={{ margin: '0 0 6px' }}>În {m === 'RON' ? 'lei' : m}</h3>
              <div className="tabel-wrap"><table className="tabel-op">
                <tbody>
                  <tr><td>Alimentări primite de la firmă, minus returnări</td><td className="n tare">{bani(datoreazaFirmei, m)}</td>
                    <td className="mic gri">{datoreazaFirmei > 0.005 ? 'proiectul datorează firmei această sumă' : 'nimic de returnat'}</td></tr>
                  <tr><td>Cheltuieli indirecte (overhead) retrase la firmă</td><td className="n tare">{bani(s.overhead, m)}</td>
                    <td className="mic gri">{m === moneda ? comparaIndirecte(s.overhead, indirecte, m) : 'se compară cu indirectele după conversia la cursul perioadei'}</td></tr>
                  <tr><td>Comisioane recuperate de firmă</td><td className="n tare">{bani(s.comisioane, m)}</td>
                    <td className="mic gri">trebuie să corespundă comisioanelor plătite de firmă pentru proiect</td></tr>
                  <tr className={s.nrNelamurit ? 'rand-total' : ''}><td>De lămurit (fără motiv sau „alt motiv”)</td>
                    <td className={`n tare ${s.nrNelamurit ? 'rosu-text' : ''}`}>{bani(s.nelamurit, m)}</td>
                    <td className="mic gri">{s.nrNelamurit ? `${s.nrNelamurit} mișcări${s.nrPropuse ? `, din care ${s.nrPropuse} cu motiv propus de confirmat` : ''}` : 'totul are motiv'}</td></tr>
                </tbody>
              </table></div>
            </div>
          )
        })}
        {sProg && sProg.overhead > indirecte.confirmat + 0.005 && <div className="alerta galben spatiu">
          Firma a retras deja <b>{bani(sProg.overhead, moneda)}</b> ca cheltuieli indirecte, dar din costurile directe confirmate până acum rezultă doar <b>{bani(indirecte.confirmat, moneda)}</b>.
          Diferența se acoperă pe măsură ce se confirmă costurile directe (în special salariile, {bani(indirecte.neconfirmat, moneda)} indirecte încă neconfirmate).
          Dacă ele nu se confirmă, diferența trebuie returnată în contul proiectului.
        </div>}
      </section>

      <p className="nota">
        Un transfer între conturile contractului nu e cheltuială și nu se alocă pe buget. Legarea perechii arată că banii nu s-au pierdut pe drum și că nu se numără de două ori.
        Regulile de legare (aceeași monedă, aceeași sumă, conturi diferite ale aceluiași contract, cel mult 10 zile între ieșire și intrare, o singură pereche pe operațiune) sunt verificate de baza de date.
        Mișcările cu „cont din afara contractului” sunt de obicei tipizate greșit: schimbați tipul lor în ecranul <Link to={`/contract/${id}/operatiuni`}>Validarea operațiunilor</Link>.
      </p>
    </>
  )
}

function comparaIndirecte(retras: number, ind: { eligibil: number; confirmat: number; neconfirmat: number }, m: string) {
  if (retras <= ind.confirmat + 0.005) return `în limita indirectelor confirmate (${bani(ind.confirmat, m)})`
  if (retras <= ind.eligibil + 0.005) return `peste indirectele confirmate (${bani(ind.confirmat, m)}), dar în limita celor calculate (${bani(ind.eligibil, m)})`
  return `peste indirectele calculate (${bani(ind.eligibil, m)}): ${bani(retras - ind.eligibil, m)} ar trebui returnați`
}

// Din textul băncii păstrează partea cu explicația plății, dacă există.
function detalii(t: string | null) {
  if (!t) return '—'
  const m = t.match(/Detalii:?\s*([^[]+)/i)
  return (m ? m[1] : t).trim().slice(0, 90)
}

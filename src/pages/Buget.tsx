import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { bani, data, num, MOD_CALCUL } from '../lib/format'

// Modificări de buget: bugetul aprobat la semnare se schimbă pe parcurs.
//  - „Mutare între capitole”: fără act adițional, dacă programul o permite (regula „mutari_fara_act_permise”
//    din biblioteca de programe, eventual cu o limită procentuală „mutari_fara_act_procent_max”). Totalul rămâne.
//  - „Act adițional”: semnat cu finanțatorul, poate schimba și totalul; documentul e obligatoriu.
// O modificare intră „propusă” și produce efecte doar după aprobarea administratorului sau a directorului de program.
// Aprobată, nu se mai schimbă: o greșeală se corectează cu o modificare nouă, inversă (ca o stornare).
// Capitolele procentuale (ex. indirecte 25%) nu se modifică direct: urmează automat capitolele de bază.
// Toate verificările stau în baza de date (probleme_modificare_buget); ecranul doar le afișează.

type Poz = { pozitie_id: string; cod: string; denumire: string; mod_calcul: string; suma_initiala_eur: number; modificari_aprobate_eur: number; suma_in_vigoare_eur: number; procent: number | null; ordine: number | null }
type Linie = { id: string; pozitie_id: string; cod: string; denumire: string; diferenta: number }
type Mod = {
  id: string; numar: string; tip: 'mutare' | 'act_aditional'; tip_document: string; data_document: string; data_efect: string; descriere: string | null
  stare: 'propusa' | 'aprobata' | 'retrasa'; document_id: string | null; document_numar: string | null; document_tip: string | null
  propus_de_nume: string | null; creat_la: string; aprobat_de_nume: string | null; aprobat_la: string | null
  respins_de_nume: string | null; respins_la: string | null; motiv_respingere: string | null
  linii: Linie[]; probleme: string[]; pot_aproba: boolean
}
type Doc = { id: string; tip: string; numar: string | null; data_document: string | null; descriere: string | null }

const TIP_MOD: Record<string, string> = { mutare: 'Mutare între capitole', act_aditional: 'Act adițional' }
const STARE: Record<string, { text: string; cls: string }> = {
  propusa: { text: 'propusă, așteaptă aprobarea', cls: 'galben-e' },
  aprobata: { text: 'aprobată', cls: 'verde' },
  retrasa: { text: 'respinsă / retrasă', cls: 'gri-e' },
}
const nr = (s: string) => Number(String(s).replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))
const semn = (v: number) => (v > 0 ? '+' : '') + num(v)
const AZI = new Date().toISOString().slice(0, 10)
// Mesajele vin din baza de date cu sume în format 1234.56; le arătăm în format românesc (1.234,56).
const ro = (t: string) => t.replace(/-?\d+\.\d{2}(?= EUR)/g, x => num(Number(x)))

export default function Buget() {
  const { id } = useParams()
  const [poz, setPoz] = useState<Poz[] | null>(null)
  const [mods, setMods] = useState<Mod[]>([])
  const [docs, setDocs] = useState<Doc[]>([])
  const [moneda, setMoneda] = useState('EUR')
  const [valoare, setValoare] = useState(0)
  const [potAproba, setPotAproba] = useState(false)
  const [eroare, setEroare] = useState<string | null>(null)
  const [mesaj, setMesaj] = useState<{ cls: string; text: string } | null>(null)
  const [form, setForm] = useState<string | 'nou' | null>(null)
  const [respinge, setRespinge] = useState<string | null>(null)
  const [motiv, setMotiv] = useState('')
  const [lucreaza, setLucreaza] = useState(false)
  const [laData, setLaData] = useState('')
  const [bugetLaData, setBugetLaData] = useState<Poz[] | null>(null)

  const incarca = useCallback(async () => {
    if (!id) return
    const [p, m, d, c, a] = await Promise.all([
      supabase.from('v_buget_in_vigoare').select('pozitie_id,cod,denumire,mod_calcul,suma_initiala_eur,modificari_aprobate_eur,suma_in_vigoare_eur,procent,ordine').eq('contract_id', id).order('ordine'),
      supabase.from('v_modificari_buget').select('*').eq('contract_id', id).order('data_efect', { ascending: false }).order('creat_la', { ascending: false }),
      supabase.from('documente').select('id,tip,numar,data_document,descriere').eq('contract_id', id).in('tip', ['act_aditional', 'notificare', 'altul']).order('data_document', { ascending: false }),
      supabase.from('contracte').select('valoare_finantare_eur,programe(moneda)').eq('id', id).single(),
      supabase.rpc('pot_aproba_buget', { p_contract: id }),
    ])
    if (p.error || m.error || d.error || c.error) { setEroare('Datele nu au putut fi citite.'); return }
    setPoz(p.data as Poz[]); setMods(m.data as Mod[]); setDocs(d.data as Doc[])
    const ct = c.data as unknown as { valoare_finantare_eur: number; programe: { moneda: string } | null }
    setValoare(Number(ct.valoare_finantare_eur)); setMoneda(ct.programe?.moneda?.trim() || 'EUR')
    setPotAproba(Boolean(a.data))
  }, [id])
  useEffect(() => { incarca() }, [incarca])

  useEffect(() => {
    if (!id || !laData) { setBugetLaData(null); return }
    supabase.rpc('buget_la_data', { p_contract: id, p_la: laData }).then(({ data: b, error }) => setBugetLaData(error ? null : (b as Poz[]).sort((x, y) => (x.ordine ?? 0) - (y.ordine ?? 0))))
  }, [id, laData, mods])

  // Ce ar însemna aprobarea tuturor modificărilor propuse (doar orientativ).
  const dupaPropuneri = useMemo(() => {
    const m = new Map<string, number>()
    for (const x of mods.filter(x => x.stare === 'propusa')) for (const l of x.linii) m.set(l.pozitie_id, (m.get(l.pozitie_id) ?? 0) + Number(l.diferenta))
    return m
  }, [mods])

  async function gata(text: string) { setForm(null); setRespinge(null); setMotiv(''); setMesaj({ cls: 'verde', text }); await incarca() }

  async function aproba(m: Mod) {
    if (!window.confirm(`Aprobi modificarea ${m.numar}? După aprobare nu se mai poate schimba; o greșeală se corectează doar cu o modificare inversă.`)) return
    setLucreaza(true); setMesaj(null)
    const { error } = await supabase.from('modificari_buget').update({ stare: 'aprobata' }).eq('id', m.id)
    setLucreaza(false)
    if (error) return setMesaj({ cls: 'rosu', text: ro(error.message) })
    await gata(`Modificarea ${m.numar} a fost aprobată. Bugetul în vigoare, împărțirea tranșelor și raportarea s-au recalculat.`)
  }

  async function trimiteRespingere(m: Mod) {
    if (!motiv.trim()) return setMesaj({ cls: 'rosu', text: 'Scrie motivul respingerii.' })
    setLucreaza(true); setMesaj(null)
    const { error } = await supabase.from('modificari_buget').update({ stare: 'retrasa', motiv_respingere: motiv.trim() }).eq('id', m.id)
    setLucreaza(false)
    if (error) return setMesaj({ cls: 'rosu', text: error.message })
    await gata(`Modificarea ${m.numar} a fost respinsă și rămâne în istoric.`)
  }

  async function sterge(m: Mod) {
    if (!window.confirm(`Ștergi propunerea ${m.numar}? Fiind doar propusă, nu a produs niciun efect.`)) return
    setLucreaza(true)
    const { error } = await supabase.from('modificari_buget').delete().eq('id', m.id)
    setLucreaza(false)
    if (error) return setMesaj({ cls: 'rosu', text: error.message })
    await gata(`Propunerea ${m.numar} a fost ștearsă.`)
  }

  if (eroare) return <><Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link><div className="alerta rosu">{eroare}</div></>
  if (!poz) return <div className="gol">Se încarcă bugetul…</div>

  const totalInitial = poz.reduce((a, p) => a + Number(p.suma_initiala_eur), 0)
  const totalVigoare = poz.reduce((a, p) => a + Number(p.suma_in_vigoare_eur), 0)
  const propuse = mods.filter(m => m.stare === 'propusa')
  const aprobate = mods.filter(m => m.stare === 'aprobata')
  const pct = poz.filter(p => p.mod_calcul === 'procent').reduce((a, p) => a + Number(p.procent ?? 0), 0)
  const bazaPropusa = [...dupaPropuneri.entries()].reduce((a, [pid, d]) => a + (poz.find(p => p.pozitie_id === pid)?.mod_calcul === 'procent' ? 0 : d), 0)

  return (
    <>
      <Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link>
      <section className="titlu-pagina">
        <h1>Modificări de buget</h1>
        <p>Bugetul aprobat la semnare și toate schimbările lui: mutări între capitole și acte adiționale. O modificare produce efecte doar după aprobarea administratorului sau a directorului de program.</p>
      </section>

      <section className="cifre">
        <div className="cifra accent"><div className="cifra-eticheta">Buget în vigoare azi</div><div className="cifra-valoare mic-v">{bani(totalVigoare, moneda)}</div>
          <div className="cifra-sub">{Math.abs(totalVigoare - totalInitial) > 0.005 ? `inițial ${bani(totalInitial, moneda)}` : 'egal cu bugetul inițial'}</div></div>
        <div className="cifra"><div className="cifra-eticheta">Modificări aprobate</div><div className="cifra-valoare mic-v">{aprobate.length}</div><div className="cifra-sub">{aprobate.length ? `ultima cu efect de la ${data(aprobate[0].data_efect)}` : 'bugetul e cel de la semnare'}</div></div>
        <div className="cifra"><div className="cifra-eticheta">Așteaptă aprobarea</div><div className={`cifra-valoare mic-v ${propuse.length ? 'rosu-text' : ''}`}>{propuse.length}</div><div className="cifra-sub">{potAproba ? 'le poți aproba tu' : 'le aprobă administratorul sau directorul de program'}</div></div>
        <div className="cifra"><div className="cifra-eticheta">Valoarea contractului</div><div className="cifra-valoare mic-v">{bani(valoare, moneda)}</div>
          <div className="cifra-sub">{totalVigoare > valoare + 0.005 ? 'bugetul o depășește!' : 'bugetul se încadrează'}</div></div>
      </section>

      {mesaj && <div className={`alerta ${mesaj.cls} spatiu`}>{mesaj.text}</div>}

      <section className="bloc fara-padding">
        <div className="bloc-titlu" style={{ padding: '16px 18px 0' }}><h2>Bugetul pe capitole</h2>
          <p>Inițial + modificările aprobate = bugetul în vigoare. Toate celelalte ecrane (tablou de bord, tranșe, raportare) lucrează cu bugetul în vigoare.</p>
          <div className="rand-butoane" style={{ marginTop: 8 }}>
            <label className="mic">Vezi bugetul la data de <input type="date" value={laData} onChange={e => setLaData(e.target.value)} /></label>
            {laData && <button className="buton-text" onClick={() => setLaData('')}>azi</button>}
          </div>
        </div>
        <div className="tabel-wrap">
          <table className="tabel-op">
            <thead><tr><th>Capitol</th><th>Calcul</th><th className="n">Inițial</th><th className="n">Modificări aprobate</th><th className="n">În vigoare azi</th>
              {laData && <th className="n">La {data(laData)}</th>}{propuse.length > 0 && <th className="n">Dacă se aprobă propunerile</th>}</tr></thead>
            <tbody>
              {poz.map(p => {
                const d = p.mod_calcul === 'procent' ? Math.round(bazaPropusa * Number(p.procent ?? 0)) / 100 : (dupaPropuneri.get(p.pozitie_id) ?? 0)
                const ld = bugetLaData?.find(b => b.pozitie_id === p.pozitie_id)
                return (
                  <tr key={p.pozitie_id}>
                    <td><b>{p.cod}</b> {p.denumire}</td>
                    <td className="mic gri">{MOD_CALCUL[p.mod_calcul] ?? p.mod_calcul}{p.mod_calcul === 'procent' && p.procent ? ` (${num(p.procent)}%)` : ''}</td>
                    <td className="n">{num(p.suma_initiala_eur)}</td>
                    <td className={`n ${Number(p.modificari_aprobate_eur) ? 'tare' : 'gri'}`}>{Number(p.modificari_aprobate_eur) ? semn(Number(p.modificari_aprobate_eur)) : '—'}</td>
                    <td className="n tare">{num(p.suma_in_vigoare_eur)}</td>
                    {laData && <td className="n">{ld ? num(ld.suma_in_vigoare_eur) : '…'}</td>}
                    {propuse.length > 0 && <td className="n">{d ? <>{num(Number(p.suma_in_vigoare_eur) + d)} <span className="mic gri">({semn(d)})</span></> : <span className="gri">neschimbat</span>}</td>}
                  </tr>
                )
              })}
              <tr className="rand-total"><td><b>Total</b></td><td></td><td className="n tare">{num(totalInitial)}</td>
                <td className="n tare">{semn(totalVigoare - totalInitial)}</td><td className="n tare">{num(totalVigoare)}</td>
                {laData && <td className="n tare">{bugetLaData ? num(bugetLaData.reduce((a, b) => a + Number(b.suma_in_vigoare_eur), 0)) : '…'}</td>}
                {propuse.length > 0 && <td className="n tare">{num(totalVigoare + bazaPropusa * (1 + pct / 100))}</td>}</tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="bloc-titlu"><h2>Modificările</h2></section>
      {mods.length === 0 && form !== 'nou' && <div className="alerta albastru spatiu">Nicio modificare de buget introdusă. Bugetul în vigoare e cel de la semnarea contractului.</div>}

      {mods.map(m => form === m.id ? (
        <section className="bloc" key={m.id}><FormModificare contractId={id!} m={m} poz={poz} docs={docs} pct={pct} moneda={moneda} lucreaza={lucreaza} setLucreaza={setLucreaza} inchide={() => setForm(null)} gata={gata} /></section>
      ) : (
        <section className="bloc" key={m.id}>
          <div className="rand-butoane" style={{ justifyContent: 'space-between' }}>
            <div><b>{m.numar}</b> · {TIP_MOD[m.tip] ?? m.tip} · {m.tip_document} din {data(m.data_document)}{m.data_efect !== m.data_document && <> · efect de la {data(m.data_efect)}</>}</div>
            <span className={`eticheta ${STARE[m.stare].cls}`}>{STARE[m.stare].text}</span>
          </div>
          {m.descriere && <p className="mic" style={{ margin: '8px 0' }}>{m.descriere}</p>}
          <div className="tabel-wrap">
            <table className="tabel-op">
              <thead><tr><th>Capitol</th><th className="n">Diferență ({moneda})</th></tr></thead>
              <tbody>
                {m.linii.map(l => <tr key={l.id}><td><b>{l.cod}</b> {l.denumire}</td><td className={`n tare ${Number(l.diferenta) < 0 ? 'rosu-text' : 'verde-text'}`}>{semn(Number(l.diferenta))}</td></tr>)}
                {m.linii.length === 0 && <tr><td colSpan={2} className="gol">Nicio linie.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="mic gri" style={{ margin: '8px 0' }}>
            Document: {m.document_id ? `${m.document_tip === 'act_aditional' ? 'act adițional' : m.document_tip} ${m.document_numar ?? ''}` : 'neatașat'}
            {' · '}propusă de {m.propus_de_nume ?? '—'} la {data(m.creat_la)}
            {m.stare === 'aprobata' && <> · aprobată de {m.aprobat_de_nume ?? '—'} la {data(m.aprobat_la)}</>}
            {m.stare === 'retrasa' && <> · respinsă de {m.respins_de_nume ?? '—'} la {data(m.respins_la)}: „{m.motiv_respingere}”</>}
          </p>
          {m.stare === 'propusa' && m.probleme.length > 0 && <div className="alerta galben spatiu"><b>Nu poate fi aprobată încă:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{m.probleme.map((p, i) => <li key={i}>{ro(p)}</li>)}</ul></div>}
          {m.stare === 'propusa' && (respinge === m.id ? (
            <div className="formular-doc">
              <label className="mic">Motivul respingerii sau al retragerii<input value={motiv} onChange={e => setMotiv(e.target.value)} placeholder="ex. sumele nu corespund notificării trimise finanțatorului" /></label>
              <div className="rand-butoane"><button className="buton rosu-b mic-b" disabled={lucreaza} onClick={() => trimiteRespingere(m)}>Respinge</button><button className="buton-text" onClick={() => { setRespinge(null); setMotiv('') }}>Renunță</button></div>
            </div>
          ) : (
            <div className="rand-butoane">
              {m.pot_aproba && <button className="buton verde-b mic-b" disabled={lucreaza || m.probleme.length > 0} onClick={() => aproba(m)}>Aprobă</button>}
              <button className="buton-text" disabled={lucreaza} onClick={() => { setMesaj(null); setRespinge(m.id); setMotiv('') }}>{m.pot_aproba ? 'Respinge' : 'Retrage'}</button>
              <button className="buton-text" disabled={lucreaza} onClick={() => { setMesaj(null); setForm(m.id) }}>Modifică</button>
              <button className="buton-text" disabled={lucreaza} onClick={() => sterge(m)}>Șterge</button>
            </div>
          ))}
        </section>
      ))}

      {form === 'nou'
        ? <section className="bloc"><FormModificare contractId={id!} poz={poz} docs={docs} pct={pct} moneda={moneda} lucreaza={lucreaza} setLucreaza={setLucreaza} inchide={() => setForm(null)} gata={gata} /></section>
        : <div className="rand-butoane spatiu"><button className="buton" onClick={() => { setMesaj(null); setForm('nou') }}>+ Propune o modificare de buget</button></div>}

      <p className="nota">
        Cum lucrează aplicația: o modificare se introduce „propusă” și nu schimbă nimic până nu e aprobată de administrator sau de directorul de program. Înainte de aprobare,
        aplicația verifică regulile programului din bibliotecă (dacă mutările fără act adițional sunt permise și, dacă e cazul, până la ce procent), că o mutare adună zero,
        că niciun capitol nu ajunge negativ, că bugetul nu depășește valoarea contractului și că actul adițional e atașat. Capitolele calculate procentual
        (de exemplu cheltuielile indirecte) nu se modifică direct: cresc sau scad singure cu procentul lor din ce se mută în capitolele de bază.
        O modificare aprobată rămâne definitivă; o greșeală se corectează cu o modificare nouă, inversă.
      </p>
    </>
  )
}

function FormModificare({ contractId, m, poz, docs, pct, moneda, lucreaza, setLucreaza, inchide, gata }: {
  contractId: string; m?: Mod; poz: Poz[]; docs: Doc[]; pct: number; moneda: string
  lucreaza: boolean; setLucreaza: (b: boolean) => void; inchide: () => void; gata: (text: string) => Promise<void>
}) {
  const baza = poz.filter(p => p.mod_calcul !== 'procent')
  const [v, setV] = useState({
    tip: m?.tip ?? 'mutare', numar: m?.numar ?? '', tip_document: m?.tip_document ?? 'Notă internă', data_document: m?.data_document ?? AZI,
    data_efect: m && m.data_efect !== m.data_document ? m.data_efect : '', descriere: m?.descriere ?? '', document_id: m?.document_id ?? '',
  })
  const [dif, setDif] = useState<Record<string, string>>(() => Object.fromEntries((m?.linii ?? []).map(l => [l.pozitie_id, String(l.diferenta).replace('.', ',')])))
  const [eroare, setEroare] = useState<string | null>(null)
  const set = (k: string, val: string) => setV(x => ({ ...x, [k]: val }))

  const valori = baza.map(p => ({ p, d: dif[p.pozitie_id]?.trim() ? nr(dif[p.pozitie_id]) : 0 }))
  const suma = valori.reduce((a, x) => a + (Number.isFinite(x.d) ? x.d : 0), 0)
  const efectProcent = Math.round(suma * pct) / 100

  function schimbaTip(t: string) {
    setV(x => ({ ...x, tip: t as Mod['tip'], tip_document: t === 'act_aditional' ? 'Act adițional' : (x.tip_document === 'Act adițional' ? 'Notă internă' : x.tip_document) }))
  }

  async function salveaza() {
    setEroare(null)
    if (!v.numar.trim()) return setEroare('Dă un număr sau un nume modificării (de exemplu „Mutare 1” sau numărul actului adițional).')
    if (!v.data_document) return setEroare('Data documentului e obligatorie.')
    if (valori.some(x => !Number.isFinite(x.d))) return setEroare('O sumă nu e un număr valid. Folosește virgula pentru zecimale, de exemplu -1500,50.')
    const linii = valori.filter(x => Math.abs(x.d) > 0.004).map(x => ({ pozitie_id: x.p.pozitie_id, diferenta_eur: Math.round(x.d * 100) / 100 }))
    if (!linii.length) return setEroare('Completează cel puțin un capitol: minus unde scade bugetul, plus unde crește.')
    const cap = { numar: v.numar.trim(), tip: v.tip, tip_document: v.tip_document.trim() || TIP_MOD[v.tip], data_document: v.data_document,
      data_efect: v.data_efect || null, descriere: v.descriere.trim() || null, document_id: v.document_id || null }
    setLucreaza(true)
    let modId = m?.id
    if (m) {
      const { error } = await supabase.from('modificari_buget').update(cap).eq('id', m.id)
      if (error) { setLucreaza(false); return setEroare(error.message) }
      const del = await supabase.from('modificari_buget_linii').delete().eq('modificare_id', m.id)
      if (del.error) { setLucreaza(false); return setEroare(del.error.message) }
    } else {
      const { data: r, error } = await supabase.from('modificari_buget').insert({ ...cap, contract_id: contractId }).select('id').single()
      if (error) { setLucreaza(false); return setEroare(error.message) }
      modId = (r as { id: string }).id
    }
    const ins = await supabase.from('modificari_buget_linii').insert(linii.map(l => ({ ...l, modificare_id: modId })))
    if (ins.error) {
      if (!m) await supabase.from('modificari_buget').delete().eq('id', modId!)
      setLucreaza(false); return setEroare(ins.error.message)
    }
    setLucreaza(false)
    await gata(m ? `Propunerea ${cap.numar} a fost actualizată.` : `Modificarea ${cap.numar} a fost propusă. Intră în calcule după aprobare.`)
  }

  return (
    <div className="formular-doc">
      <h2 style={{ margin: 0 }}>{m ? `Modifică propunerea ${m.numar}` : 'Propune o modificare de buget'}</h2>
      <div className="campuri">
        <label>Tipul<select value={v.tip} onChange={e => schimbaTip(e.target.value)}>
          <option value="mutare">Mutare între capitole (fără act adițional)</option>
          <option value="act_aditional">Act adițional semnat cu finanțatorul</option>
        </select></label>
        <label>Număr / nume<input value={v.numar} onChange={e => set('numar', e.target.value)} placeholder={v.tip === 'act_aditional' ? 'ex. AA 1' : 'ex. Mutare 1'} /></label>
        <label>Documentul (fel)<input value={v.tip_document} onChange={e => set('tip_document', e.target.value)} placeholder="ex. Notă internă, Notificare, Act adițional" /></label>
        <label>Data documentului<input type="date" value={v.data_document} onChange={e => set('data_document', e.target.value)} /></label>
        <label>Are efect de la (dacă e altă dată)<input type="date" value={v.data_efect} onChange={e => set('data_efect', e.target.value)} /></label>
        <label>Documentul atașat {v.tip === 'act_aditional' ? '(obligatoriu)' : '(opțional)'}<select value={v.document_id} onChange={e => set('document_id', e.target.value)}>
          <option value="">— niciunul —</option>
          {docs.map(d => <option key={d.id} value={d.id}>{d.tip === 'act_aditional' ? 'Act adițional' : d.tip === 'notificare' ? 'Notificare' : 'Alt document'} {d.numar ?? ''} {d.data_document ? `din ${data(d.data_document)}` : ''} {d.descriere ? `· ${d.descriere.slice(0, 40)}` : ''}</option>)}
        </select></label>
        <label className="lat2">Justificarea<input value={v.descriere} onChange={e => set('descriere', e.target.value)} placeholder="de ce se mută banii, de exemplu: deplasări mai puține decât estimat, mai multe ore de personal" /></label>
      </div>
      {docs.length === 0 && <div className="mic gri">Documentele (actul adițional, notificarea) se încarcă din ecranul Facturi și documente, cu tipul „act adițional” sau „notificare”, apoi apar aici.</div>}

      <div className="tabel-wrap">
        <table className="tabel-op">
          <thead><tr><th>Capitol</th><th className="n">În vigoare azi</th><th className="n">Diferență ({moneda}): minus scade, plus crește</th><th className="n">Rezultă</th></tr></thead>
          <tbody>
            {valori.map(({ p, d }) => (
              <tr key={p.pozitie_id}>
                <td><b>{p.cod}</b> {p.denumire}</td>
                <td className="n">{num(p.suma_in_vigoare_eur)}</td>
                <td className="n"><input inputMode="decimal" style={{ width: 130, textAlign: 'right' }} value={dif[p.pozitie_id] ?? ''} onChange={e => setDif(x => ({ ...x, [p.pozitie_id]: e.target.value }))} placeholder="0" /></td>
                <td className={`n ${Number(p.suma_in_vigoare_eur) + (d || 0) < 0 ? 'rosu-text' : ''}`}>{num(Number(p.suma_in_vigoare_eur) + (Number.isFinite(d) ? d : 0))}</td>
              </tr>
            ))}
            {poz.filter(p => p.mod_calcul === 'procent').map(p => (
              <tr key={p.pozitie_id} className="rand-detaliu">
                <td><b>{p.cod}</b> {p.denumire} <span className="mic gri">(automat, {num(p.procent)}% din capitolele de bază)</span></td>
                <td className="n">{num(p.suma_in_vigoare_eur)}</td>
                <td className="n gri">{efectProcent ? semn(Math.round(suma * Number(p.procent ?? 0)) / 100) : '—'}</td>
                <td className="n">{num(Number(p.suma_in_vigoare_eur) + Math.round(suma * Number(p.procent ?? 0)) / 100)}</td>
              </tr>
            ))}
            <tr className="rand-total"><td><b>Suma diferențelor</b></td><td></td><td className={`n tare ${v.tip === 'mutare' && Math.abs(suma) > 0.004 ? 'rosu-text' : ''}`}>{semn(Math.round(suma * 100) / 100)}</td><td></td></tr>
          </tbody>
        </table>
      </div>
      {v.tip === 'mutare' && Math.abs(suma) > 0.004 && <div className="alerta galben">La o mutare între capitole, ce scade dintr-un capitol trebuie să crească în altul: suma diferențelor trebuie să fie 0. Poți salva propunerea, dar nu va putea fi aprobată așa.</div>}
      {eroare && <div className="alerta rosu">{eroare}</div>}
      <div className="rand-butoane">
        <button className="buton" disabled={lucreaza} onClick={salveaza}>{lucreaza ? 'Se salvează…' : m ? 'Salvează propunerea' : 'Propune modificarea'}</button>
        <button className="buton-text" disabled={lucreaza} onClick={inchide}>Renunță</button>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { bani, data, num, procent, TIP_TRANSA } from '../lib/format'

// Tranșe de finanțare: ce trebuie să primească beneficiarul de la finanțator și ce a primit.
//  - Fiecare tranșă din contract (prefinanțare, plăți intermediare, plata finală) are o sumă așteptată și un termen.
//  - Când banii intră în cont, tranșa se leagă de încasarea ei din extras (o intrare în moneda programului).
//  - Banii primiți se împart pe capitole proporțional cu bugetul în vigoare (v_repartizare_incasari);
//    împărțirea se reface singură la fiecare tranșă legată sau la fiecare modificare de buget.
// Regulile de validare stau în baza de date (încasarea trebuie să fie o intrare a aceluiași contract, folosită o singură dată).

type Transa = { id: string; numar: number; tip: string; suma_asteptata_eur: number; termen: string | null; conditie: string | null; operatiune_id: string | null }
type Op = { id: string; data_operatiune: string; suma: number; moneda: string; tip: string | null; contrapartida: string | null; descriere_banca: string | null; extras_numar: string | null }
type Rep = { capitol: string; buget_capitol: number; pondere_procent: number; total_incasat: number; incasat_repartizat: number }
type Contract = { valoare_finantare_eur: number; programe: { denumire: string; moneda: string } | null }

const nr = (s: string) => Number(String(s).replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))
const txt = (v: number | null | undefined) => (v == null ? '' : String(Number(v)).replace('.', ','))
const EXCLUSE = new Set(['schimb_valutar', 'transfer_intern', 'restituire'])
const AZI = new Date().toISOString().slice(0, 10)

export default function Transe() {
  const { id } = useParams()
  const [transe, setTranse] = useState<Transa[] | null>(null)
  const [ops, setOps] = useState<Op[]>([])
  const [rep, setRep] = useState<Rep[]>([])
  const [contract, setContract] = useState<Contract | null>(null)
  const [eroare, setEroare] = useState<string | null>(null)
  const [mesaj, setMesaj] = useState<{ cls: string; text: string } | null>(null)
  const [form, setForm] = useState<string | 'nou' | null>(null)
  const [lucreaza, setLucreaza] = useState(false)
  const [reguli, setReguli] = useState<{ plafon: number | null; mim: number | null }>({ plafon: null, mim: null })

  const incarca = useCallback(async () => {
    if (!id) return
    const [t, o, r, c, pl, mi] = await Promise.all([
      supabase.from('transe').select('id,numar,tip,suma_asteptata_eur,termen,conditie,operatiune_id').eq('contract_id', id).order('numar'),
      supabase.from('v_operatiuni_validare').select('id,data_operatiune,suma,moneda,tip,contrapartida,descriere_banca,extras_numar')
        .eq('contract_id', id).eq('sens', 'credit').is('operatiune_parinte_id', null).order('data_operatiune'),
      supabase.from('v_repartizare_incasari').select('capitol,buget_capitol,pondere_procent,total_incasat,incasat_repartizat').eq('contract_id', id).order('buget_capitol', { ascending: false }),
      supabase.from('contracte').select('valoare_finantare_eur,programe(denumire,moneda)').eq('id', id).single(),
      supabase.rpc('valoare_regula', { p_contract: id, p_cod: 'plafon_plati_procent' }),
      supabase.rpc('valoare_regula', { p_contract: id, p_cod: 'mecanism_asigurare_procent' }),
    ])
    if (t.error || o.error || r.error || c.error) { setEroare('Datele nu au putut fi citite.'); return }
    setTranse(t.data as Transa[]); setOps(o.data as Op[]); setRep(r.data as Rep[]); setContract(c.data as unknown as Contract)
    setReguli({ plafon: pl.data == null ? null : Number(pl.data), mim: mi.data == null ? null : Number(mi.data) })
  }, [id])
  useEffect(() => { incarca() }, [incarca])

  const moneda = contract?.programe?.moneda?.trim() || 'EUR'
  const opDupaId = useMemo(() => new Map(ops.map(o => [o.id, o])), [ops])
  const libere = useMemo(() => {
    const folosite = new Set((transe ?? []).map(t => t.operatiune_id).filter(Boolean))
    return ops.filter(o => o.moneda.trim() === moneda && !folosite.has(o.id) && !EXCLUSE.has(o.tip ?? ''))
      .sort((a, b) => Number(b.tip === 'incasare_finantare') - Number(a.tip === 'incasare_finantare') || Number(b.suma) - Number(a.suma))
  }, [ops, transe, moneda])

  const sumar = useMemo(() => {
    const s = { asteptat: 0, incasat: 0, urmatoare: null as Transa | null }
    for (const t of transe ?? []) {
      s.asteptat += Number(t.suma_asteptata_eur)
      const o = t.operatiune_id ? opDupaId.get(t.operatiune_id) : null
      if (o) s.incasat += Number(o.suma)
      else if (!s.urmatoare) s.urmatoare = t
    }
    return s
  }, [transe, opDupaId])

  async function gata(text: string) { setForm(null); setMesaj({ cls: 'verde', text }); await incarca() }

  async function sterge(t: Transa) {
    if (!window.confirm(`Ștergi tranșa ${t.numar}? Încasarea legată (dacă există) rămâne în extras, doar se dezleagă.`)) return
    setLucreaza(true)
    const { error } = await supabase.from('transe').delete().eq('id', t.id)
    setLucreaza(false)
    if (error) return setMesaj({ cls: 'rosu', text: 'Tranșa nu a putut fi ștearsă.' })
    await gata(`Tranșa ${t.numar} a fost ștearsă.`)
  }

  if (eroare) return <><Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link><div className="alerta rosu">{eroare}</div></>
  if (!transe || !contract) return <div className="gol">Se încarcă tranșele…</div>

  const valoare = Number(contract.valoare_finantare_eur)
  const totalIncasat = Number(rep[0]?.total_incasat ?? sumar.incasat)
  const necuprins = valoare - sumar.asteptat
  // Regulile programului (biblioteca de programe): plafonul plăților înainte de plata finală și mecanismul de asigurare.
  const plafon = reguli.plafon != null ? Math.round(valoare * reguli.plafon) / 100 : null
  const inainteDeFinala = transe.filter(t => t.tip !== 'finala').reduce((a, t) => a + Number(t.suma_asteptata_eur), 0)
  const mim = reguli.mim != null ? Math.round(valoare * reguli.mim) / 100 : null

  return (
    <>
      <Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link>
      <section className="titlu-pagina">
        <h1>Tranșe de finanțare</h1>
        <p>Ce trebuie să primească beneficiarul de la finanțator, ce a primit deja și cum se împart banii primiți pe capitolele de buget.</p>
      </section>

      <section className="cifre">
        <div className="cifra accent"><div className="cifra-eticheta">Valoarea finanțării</div><div className="cifra-valoare mic-v">{bani(valoare, moneda)}</div><div className="cifra-sub">{contract.programe?.denumire}</div></div>
        <div className="cifra"><div className="cifra-eticheta">Încasat</div><div className="cifra-valoare mic-v">{bani(totalIncasat, moneda)}</div><div className="cifra-sub">{procent(valoare ? (totalIncasat / valoare) * 100 : 0)} din finanțare</div></div>
        <div className="cifra"><div className="cifra-eticheta">Mai e de primit</div><div className="cifra-valoare mic-v">{bani(valoare - totalIncasat, moneda)}</div><div className="cifra-sub">până la valoarea finanțării</div></div>
        <div className="cifra"><div className="cifra-eticheta">Următoarea tranșă</div><div className="cifra-valoare mic-v">{sumar.urmatoare ? bani(sumar.urmatoare.suma_asteptata_eur, moneda) : '—'}</div>
          <div className="cifra-sub">{sumar.urmatoare ? `${TIP_TRANSA[sumar.urmatoare.tip] ?? sumar.urmatoare.tip}${sumar.urmatoare.termen ? `, termen ${data(sumar.urmatoare.termen)}` : ''}` : 'nicio tranșă așteptată introdusă'}</div></div>
      </section>

      {mesaj && <div className={`alerta ${mesaj.cls} spatiu`}>{mesaj.text}</div>}
      {plafon != null && inainteDeFinala > plafon + 0.005 && <div className="alerta rosu spatiu">
        Tranșele de dinaintea plății finale însumează <b>{bani(inainteDeFinala, moneda)}</b>, peste plafonul programului de {num(reguli.plafon)}% din finanțare (<b>{bani(plafon, moneda)}</b>). Diferența se poate primi doar la plata finală.
      </div>}
      {(plafon != null || mim != null) && <p className="mic gri spatiu">
        Regulile programului:{plafon != null && <> înainte de plata finală se pot primi cel mult {num(reguli.plafon)}% din finanțare ({bani(plafon, moneda)}; introduse până acum {bani(inainteDeFinala, moneda)}).</>}
        {mim != null && <> Din prefinanțare se rețin {num(reguli.mim)}% din finanțare ({bani(mim, moneda)}) pentru mecanismul de asigurare reciprocă; suma se primește de regulă înapoi la plata finală, deci la prefinanțare intră în cont mai puțin decât scrie în contract.</>}
      </p>}
      {Math.abs(necuprins) > 0.005 && <div className="alerta galben spatiu">
        Tranșele introduse însumează <b>{bani(sumar.asteptat, moneda)}</b>, iar finanțarea e de <b>{bani(valoare, moneda)}</b>.
        {necuprins > 0 ? ` Mai trebuie introduse tranșe de ${bani(necuprins, moneda)} (de regulă plățile intermediare și plata finală, după rapoartele pe perioade).` : ` Tranșele depășesc finanțarea cu ${bani(-necuprins, moneda)}: verifică sumele.`}
      </div>}

      <section className="bloc fara-padding">
        <div className="tabel-wrap">
          <table className="tabel-op">
            <thead><tr><th>Nr.</th><th>Tranșa</th><th className="n">Așteptat</th><th>Termen</th><th>Încasarea din extras</th><th className="n">Diferență</th><th></th></tr></thead>
            <tbody>
              {transe.map(t => {
                const o = t.operatiune_id ? opDupaId.get(t.operatiune_id) : null
                const dif = o ? Number(o.suma) - Number(t.suma_asteptata_eur) : null
                const intarziata = !o && t.termen && t.termen < AZI
                return form === t.id ? (
                  <tr key={t.id}><td colSpan={7}><FormTransa contractId={id!} t={t} libere={libere} opCurent={o ?? null} moneda={moneda} lucreaza={lucreaza} setLucreaza={setLucreaza} inchide={() => setForm(null)} gata={gata} /></td></tr>
                ) : (
                  <tr key={t.id}>
                    <td>{t.numar}</td>
                    <td><b>{TIP_TRANSA[t.tip] ?? t.tip}</b>{t.conditie && <div className="mic gri">{t.conditie}</div>}</td>
                    <td className="n">{num(t.suma_asteptata_eur)}</td>
                    <td>{data(t.termen)}</td>
                    <td>{o ? <><span className="eticheta verde">încasată</span> {data(o.data_operatiune)} · {bani(o.suma, o.moneda)}{o.extras_numar && <div className="mic gri">extras {o.extras_numar}</div>}</>
                      : intarziata ? <span className="eticheta rosu">termen depășit</span> : <span className="eticheta gri-e">așteptată</span>}</td>
                    <td className={`n ${dif && Math.abs(dif) > 0.005 ? 'rosu-text' : 'gri'}`}>{dif == null ? '—' : Math.abs(dif) > 0.005 ? num(dif) : '0,00'}</td>
                    <td className="n"><button className="buton-text" disabled={lucreaza} onClick={() => { setMesaj(null); setForm(t.id) }}>Modifică</button>{' '}
                      <button className="buton-text" disabled={lucreaza} onClick={() => sterge(t)}>Șterge</button></td>
                  </tr>
                )
              })}
              {transe.length === 0 && <tr><td colSpan={7} className="gol">Nicio tranșă introdusă.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {form === 'nou'
        ? <section className="bloc"><FormTransa contractId={id!} numarNou={Math.max(0, ...transe.map(t => t.numar)) + 1} libere={libere} opCurent={null} moneda={moneda} lucreaza={lucreaza} setLucreaza={setLucreaza} inchide={() => setForm(null)} gata={gata} /></section>
        : <div className="rand-butoane spatiu"><button className="buton" onClick={() => { setMesaj(null); setForm('nou') }}>+ Adaugă o tranșă</button></div>}

      <section className="bloc fara-padding">
        <div className="bloc-titlu" style={{ padding: '16px 18px 0' }}><h2>Banii primiți, împărțiți pe capitole</h2>
          <p>Fiecare capitol primește din totalul încasat partea lui din buget. La o tranșă nouă sau la o modificare de buget, împărțirea se reface singură.</p></div>
        <div className="tabel-wrap">
          <table className="tabel-op">
            <thead><tr><th>Capitol</th><th className="n">Buget</th><th className="n">Pondere</th><th className="n">Încasat pe capitol</th><th className="n">Mai e de primit pe capitol</th></tr></thead>
            <tbody>
              {rep.map(r => (
                <tr key={r.capitol}><td><b>{r.capitol}</b></td><td className="n">{num(r.buget_capitol)}</td><td className="n">{procent(r.pondere_procent)}</td>
                  <td className="n tare">{num(r.incasat_repartizat)}</td><td className="n">{num(Number(r.buget_capitol) - Number(r.incasat_repartizat))}</td></tr>
              ))}
              <tr className="rand-total"><td><b>Total</b></td><td className="n tare">{num(rep.reduce((a, r) => a + Number(r.buget_capitol), 0))}</td><td className="n tare">100,0%</td>
                <td className="n tare">{num(rep.reduce((a, r) => a + Number(r.incasat_repartizat), 0))}</td>
                <td className="n tare">{num(rep.reduce((a, r) => a + Number(r.buget_capitol) - Number(r.incasat_repartizat), 0))}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <p className="nota">
        Sumele sunt în moneda programului ({moneda}). Ca încasare a unei tranșe se pot alege doar intrări în {moneda} din conturile contractului, care nu sunt deja legate de altă tranșă;
        schimburile valutare, transferurile între conturile proprii și restituirile nu apar în listă. Diferența dintre suma primită și cea așteptată apare de obicei din comisioane bancare
        sau dintr-o reținere a finanțatorului (de exemplu, contribuția la fondul de garantare) și merită lămurită.
      </p>
    </>
  )
}

function FormTransa({ contractId, t, numarNou, libere, opCurent, moneda, lucreaza, setLucreaza, inchide, gata }: {
  contractId: string; t?: Transa; numarNou?: number; libere: Op[]; opCurent: Op | null; moneda: string
  lucreaza: boolean; setLucreaza: (b: boolean) => void; inchide: () => void; gata: (text: string) => Promise<void>
}) {
  const [v, setV] = useState({ numar: String(t?.numar ?? numarNou ?? 1), tip: t?.tip ?? 'intermediara', suma: txt(t?.suma_asteptata_eur), termen: t?.termen ?? '',
    conditie: t?.conditie ?? '', op: t?.operatiune_id ?? '' })
  const [eroare, setEroare] = useState<string | null>(null)
  const set = (k: string, val: string) => setV(x => ({ ...x, [k]: val }))
  const optiuni = opCurent ? [opCurent, ...libere] : libere

  async function salveaza() {
    setEroare(null)
    const numar = Number(v.numar), suma = nr(v.suma)
    if (!(Number.isInteger(numar) && numar > 0)) return setEroare('Numărul tranșei: un număr întreg mai mare decât 0.')
    if (!(suma > 0)) return setEroare(`Suma așteptată (${moneda}) trebuie să fie mai mare decât 0.`)
    const rand = { numar, tip: v.tip, suma_asteptata_eur: suma, termen: v.termen || null, conditie: v.conditie.trim() || null, operatiune_id: v.op || null }
    setLucreaza(true)
    const { error } = t ? await supabase.from('transe').update(rand).eq('id', t.id) : await supabase.from('transe').insert({ ...rand, contract_id: contractId })
    setLucreaza(false)
    if (error) return setEroare(error.code === '23505' ? 'Există deja o tranșă cu acest număr sau încasarea e legată deja de altă tranșă.' : error.message || 'Tranșa nu a putut fi salvată.')
    await gata(t ? `Tranșa ${numar} a fost actualizată.` : `Tranșa ${numar} a fost adăugată.`)
  }

  return (
    <div className="formular-doc">
      <div className="campuri">
        <label>Numărul tranșei<input inputMode="numeric" value={v.numar} onChange={e => set('numar', e.target.value)} /></label>
        <label>Tipul<select value={v.tip} onChange={e => set('tip', e.target.value)}>{Object.entries(TIP_TRANSA).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></label>
        <label>Suma așteptată ({moneda})<input inputMode="decimal" value={v.suma} onChange={e => set('suma', e.target.value)} placeholder="ex. 50000" /></label>
        <label>Termen (estimat)<input type="date" value={v.termen} onChange={e => set('termen', e.target.value)} /></label>
        <label className="lat2">Condiția din contract<input value={v.conditie} onChange={e => set('conditie', e.target.value)} placeholder="ex. după aprobarea raportului pe perioada 1" /></label>
        <label className="lat2">Încasarea din extras<select value={v.op} onChange={e => set('op', e.target.value)}>
          <option value="">— încă neîncasată —</option>
          {optiuni.map(o => <option key={o.id} value={o.id}>{data(o.data_operatiune)} · {bani(o.suma, o.moneda)} · {(o.contrapartida ?? o.descriere_banca ?? '').slice(0, 50)}{o.tip === 'incasare_finantare' ? ' · finanțare' : ''}</option>)}
        </select></label>
      </div>
      {eroare && <div className="alerta rosu">{eroare}</div>}
      <div className="rand-butoane">
        <button className="buton" disabled={lucreaza} onClick={salveaza}>{lucreaza ? 'Se salvează…' : 'Salvează tranșa'}</button>
        <button className="buton-text" disabled={lucreaza} onClick={inchide}>Renunță</button>
      </div>
    </div>
  )
}

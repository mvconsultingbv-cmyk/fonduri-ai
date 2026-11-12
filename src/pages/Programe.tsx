import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { data, MOD_CALCUL } from '../lib/format'

// Biblioteca de programe (doar administratorul): tot ce ține de un program de finanțare stă aici, nu în cod.
//  - Fișa programului: moneda, cursul de referință și cum se transformă leii.
//  - Capitolele standard ale bugetului: un contract nou le preia automat.
//  - Regulile, cu articolul din ghid. O regulă aprobată nu se mai rescrie: se face o versiune nouă,
//    valabilă de la o dată; versiunea veche rămâne pentru perioadele de dinainte.
// Un contract pe acest program pornește doar după ce programul și toate regulile lui sunt aprobate.

type Stare = 'propusa' | 'aprobata' | 'retrasa'
type Program = {
  id: string; cod: string; denumire: string; sursa_finantare: string | null; moneda: string
  sursa_curs_referinta: string; regula_curs_tip: string | null; regula_curs: string | null
  metoda_alocare_lei: string; stare: Stare; aprobat_la: string | null
}
type Capitol = { id: string; program_id: string; capitol: string; cod: string; denumire: string; descriere_eligibilitate: string | null; mod_calcul: string; procent: number | null; optional: boolean; ordine: number }
type Regula = {
  id: string; program_id: string; cod: string; titlu: string; text_regula: string; articol_sursa: string; document_sursa: string | null
  versiune: number; inlocuieste_id: string | null; valabil_de_la: string | null; stare: Stare; aprobat_la: string | null; valoare: number | null; unitate: string | null
}

const STARE: Record<Stare, { text: string; cls: string }> = {
  propusa: { text: 'propusă', cls: 'galben' }, aprobata: { text: 'aprobată', cls: 'verde' }, retrasa: { text: 'retrasă', cls: 'gri-e' },
}
const CURS_TIP: Record<string, string> = {
  medie_perioada_raportare: 'media cursurilor zilnice pe perioada de raportare',
  zi_platii: 'cursul din ziua plății',
  lunar_inforeuro: 'cursul lunar InforEuro',
}
const ALOCARE: Record<string, string> = { fifo: 'primii lei intrați, primii cheltuiți (FIFO)', medie_ponderata: 'curs mediu ponderat', identificare_specifica: 'pe fiecare schimb în parte' }
const nr = (s: string) => (s.trim() === '' ? null : Number(s.replace(/\s/g, '').replace(',', '.')))
const txt = (v: number | null | undefined) => (v == null ? '' : String(Number(v)).replace('.', ','))

export default function Programe() {
  const [programe, setPrograme] = useState<Program[] | null>(null)
  const [capitole, setCapitole] = useState<Capitol[]>([])
  const [reguli, setReguli] = useState<Regula[]>([])
  const [contracte, setContracte] = useState<{ program_id: string }[]>([])
  const [ales, setAles] = useState<string | null>(null)
  const [form, setForm] = useState<string | null>(null)   // 'program' | 'program-nou' | 'cap:<id>' | 'cap-nou' | 'reg:<id>' | 'reg-nou' | 'ver:<id>'
  const [mesaj, setMesaj] = useState<{ cls: string; text: string } | null>(null)
  const [eroare, setEroare] = useState<string | null>(null)

  const incarca = useCallback(async () => {
    const [p, c, r, k] = await Promise.all([
      supabase.from('programe').select('id,cod,denumire,sursa_finantare,moneda,sursa_curs_referinta,regula_curs_tip,regula_curs,metoda_alocare_lei,stare,aprobat_la').order('denumire'),
      supabase.from('capitole_program').select('*').order('ordine'),
      supabase.from('reguli_program').select('id,program_id,cod,titlu,text_regula,articol_sursa,document_sursa,versiune,inlocuieste_id,valabil_de_la,stare,aprobat_la,valoare,unitate').order('cod').order('versiune'),
      supabase.from('contracte').select('program_id'),
    ])
    if (p.error || c.error || r.error) { setEroare('Biblioteca nu a putut fi citită.'); return }
    setPrograme(p.data as Program[]); setCapitole(c.data as Capitol[]); setReguli(r.data as Regula[]); setContracte((k.data ?? []) as { program_id: string }[])
    setAles(a => a ?? (p.data as Program[])[0]?.id ?? null)
  }, [])
  useEffect(() => { incarca() }, [incarca])

  const p = programe?.find(x => x.id === ales) ?? null
  const caps = capitole.filter(c => c.program_id === ales)
  const regs = reguli.filter(r => r.program_id === ales)
  const grupuri = useMemo(() => {
    const m = new Map<string, Regula[]>()
    for (const r of regs) m.set(r.cod, [...(m.get(r.cod) ?? []), r])
    return [...m.entries()]
  }, [regs])
  const propuse = regs.filter(r => r.stare === 'propusa').length
  const nrContracte = contracte.filter(c => c.program_id === ales).length

  async function executa(op: PromiseLike<{ error: { message: string } | null }>, text: string) {
    setMesaj(null)
    const { error } = await op
    if (error) { setMesaj({ cls: 'rosu', text: error.message }); return false }
    setMesaj({ cls: 'verde', text }); setForm(null); await incarca(); return true
  }

  if (eroare) return <><Link to="/admin" className="inapoi">← Administrare</Link><div className="alerta rosu">{eroare}</div></>
  if (!programe) return <div className="gol">Se încarcă…</div>

  return (
    <>
      <Link to="/admin" className="inapoi">← Administrare</Link>
      <section className="titlu-pagina">
        <h1>Biblioteca de programe</h1>
        <p>Regulile fiecărui program de finanțare, comune tuturor firmelor client. Le aprobă M.V. Consulting; un contract pornește doar pe un program aprobat, cu toate regulile aprobate.</p>
      </section>

      <div className="file-vederi">
        {programe.map(x => (
          <button key={x.id} className={`fila ${x.id === ales ? 'activa' : ''}`} onClick={() => { setAles(x.id); setForm(null); setMesaj(null) }}>
            {x.denumire} <span className={`eticheta ${STARE[x.stare].cls}`}>{STARE[x.stare].text}</span>
          </button>
        ))}
        <button className="fila" onClick={() => { setForm('program-nou'); setMesaj(null) }}>+ Program nou</button>
      </div>
      {mesaj && <div className={`alerta ${mesaj.cls}`}>{mesaj.text}</div>}

      {form === 'program-nou' && (
        <section className="bloc">
          <div className="bloc-titlu"><h2>Program nou</h2><p>Intră ca „propus”. După ce completați capitolele și regulile, îl aprobați.</p></div>
          <FormProgram inchide={() => setForm(null)} salveaza={async v => {
            const { data: d, error } = await supabase.from('programe').insert(v).select('id').single()
            if (error) { setMesaj({ cls: 'rosu', text: error.code === '23505' ? 'Există deja un program cu acest cod.' : error.message }); return }
            setMesaj({ cls: 'verde', text: `Programul ${v.denumire} a fost adăugat. Completați acum capitolele și regulile.` })
            setForm(null); setAles(d.id); await incarca()
          }} />
        </section>
      )}

      {p && form !== 'program-nou' && (
        <>
          <section className="bloc">
            <div className="bloc-titlu">
              <h2>{p.denumire} <span className={`eticheta ${STARE[p.stare].cls}`}>{STARE[p.stare].text}{p.aprobat_la ? ` ${data(p.aprobat_la)}` : ''}</span></h2>
              <p>Cod {p.cod} · {nrContracte} {nrContracte === 1 ? 'contract' : 'contracte'} pe acest program</p>
            </div>
            {form === 'program'
              ? <FormProgram p={p} inchide={() => setForm(null)} salveaza={v => executa(supabase.from('programe').update(v).eq('id', p.id), 'Fișa programului a fost actualizată.').then(() => {})} />
              : <>
                  <ul className="lista-puncte">
                    <li><b>Finanțator:</b> {p.sursa_finantare || '—'}</li>
                    <li><b>Moneda programului:</b> {p.moneda}</li>
                    <li><b>Curs de referință:</b> {p.sursa_curs_referinta}, {CURS_TIP[p.regula_curs_tip ?? ''] ?? '—'}</li>
                    {p.regula_curs && <li><b>Regula de curs:</b> {p.regula_curs}</li>}
                    <li><b>Cum se urmăresc leii cumpărați:</b> {ALOCARE[p.metoda_alocare_lei] ?? p.metoda_alocare_lei}</li>
                  </ul>
                  {p.stare === 'propusa' && propuse > 0 && <div className="alerta galben">Programul are {propuse} {propuse === 1 ? 'regulă propusă' : 'reguli propuse'}. Un contract nou pe el pornește doar după ce le aprobați și pe acestea.</div>}
                  <div className="rand-butoane">
                    <button className="buton-text" onClick={() => setForm('program')}>Modifică fișa</button>
                    {p.stare === 'propusa' && <button className="buton" onClick={() => executa(supabase.from('programe').update({ stare: 'aprobata' }).eq('id', p.id), `Programul ${p.denumire} e aprobat.`)}>Aprobă programul</button>}
                    {p.stare === 'aprobata' && <button className="buton-text" onClick={() => executa(supabase.from('programe').update({ stare: 'propusa' }).eq('id', p.id), 'Aprobarea a fost anulată; programul e din nou propus.')}>Anulează aprobarea</button>}
                  </div>
                </>}
          </section>

          <section className="bloc fara-padding">
            <div className="bloc-titlu" style={{ padding: '18px 18px 0' }}>
              <h2>Capitolele standard ale bugetului</h2>
              <p>Un contract nou pe acest program pornește cu aceste capitole; sumele le completează cel care introduce contractul. Capitolele „opționale” pot rămâne goale.</p>
            </div>
            <div className="tabel-wrap">
              <table className="tabel-op">
                <thead><tr><th>Cod</th><th>Denumire</th><th>Cum se justifică</th><th>Ce e eligibil</th><th></th></tr></thead>
                <tbody>
                  {caps.map(c => form === `cap:${c.id}`
                    ? <tr key={c.id}><td colSpan={5}><FormCapitol c={c} inchide={() => setForm(null)} salveaza={v => executa(supabase.from('capitole_program').update(v).eq('id', c.id), `Capitolul ${v.cod} a fost actualizat.`).then(() => {})} /></td></tr>
                    : <tr key={c.id}>
                        <td className="mono"><b>{c.cod}</b></td>
                        <td>{c.denumire}{c.optional && <span className="eticheta gri-e">opțional</span>}</td>
                        <td className="nowrap">{MOD_CALCUL[c.mod_calcul]}{c.procent != null && ` (${txt(c.procent)}%)`}</td>
                        <td className="mic">{c.descriere_eligibilitate}</td>
                        <td className="n nowrap">
                          <button className="buton-text" onClick={() => setForm(`cap:${c.id}`)}>Modifică</button>
                          <button className="buton-text" onClick={() => { if (confirm(`Scoateți capitolul ${c.cod} din șablon? Contractele existente nu se schimbă.`)) executa(supabase.from('capitole_program').delete().eq('id', c.id), `Capitolul ${c.cod} a fost scos din șablon.`) }}>Scoate</button>
                        </td>
                      </tr>)}
                  {caps.length === 0 && <tr><td colSpan={5} className="gol">Niciun capitol. Adăugați capitolele bugetului din ghidul programului.</td></tr>}
                  {form === 'cap-nou' && <tr><td colSpan={5}><FormCapitol ordine={(caps.at(-1)?.ordine ?? 0) + 1} inchide={() => setForm(null)} salveaza={v => executa(supabase.from('capitole_program').insert({ ...v, program_id: p.id }), `Capitolul ${v.cod} a fost adăugat.`).then(() => {})} /></td></tr>}
                </tbody>
              </table>
            </div>
            {form !== 'cap-nou' && <div style={{ padding: '0 18px 18px' }}><button className="buton-text" onClick={() => setForm('cap-nou')}>+ Adaugă un capitol</button></div>}
          </section>

          <section className="bloc">
            <div className="bloc-titlu">
              <h2>Regulile programului</h2>
              <p>Fiecare regulă are articolul din ghid. Cele cu o valoare (de exemplu zilele productive pe an) intră direct în calcule. O regulă aprobată nu se rescrie: faceți o versiune nouă, valabilă de la o dată.</p>
            </div>
            {grupuri.length === 0 && <div className="gol">Nicio regulă introdusă.</div>}
            {grupuri.map(([cod, versiuni]) => {
              const ultima = versiuni.at(-1)!
              return (
                <div key={cod} className="validare-bloc" style={{ marginBottom: 14 }}>
                  <div className="mono mic gri">{cod}</div>
                  {versiuni.map(r => form === `reg:${r.id}`
                    ? <FormRegula key={r.id} r={r} inchide={() => setForm(null)} salveaza={v => executa(supabase.from('reguli_program').update(v).eq('id', r.id), 'Regula a fost actualizată.').then(() => {})} />
                    : (
                    <div key={r.id} style={{ padding: '8px 0', borderTop: r === versiuni[0] ? 'none' : '1px dashed var(--linie)', opacity: r.stare === 'retrasa' ? 0.6 : 1 }}>
                      <div><b>{r.titlu}</b> <span className="eticheta gri-e">v{r.versiune}</span><span className={`eticheta ${STARE[r.stare].cls}`}>{STARE[r.stare].text}{r.aprobat_la ? ` ${data(r.aprobat_la)}` : ''}</span>
                        {r.valabil_de_la && <span className="eticheta albastru-e">de la {data(r.valabil_de_la)}</span>}</div>
                      {r.valoare != null && <div className="tare" style={{ margin: '4px 0' }}>Valoare: {txt(r.valoare)} {r.unitate ?? ''}</div>}
                      <div className="mic" style={{ whiteSpace: 'pre-wrap' }}>{r.text_regula}</div>
                      <div className="mic gri">{r.articol_sursa}{r.document_sursa ? ` · ${r.document_sursa}` : ''}</div>
                      <div className="rand-butoane" style={{ marginTop: 6 }}>
                        {r.stare === 'propusa' && <>
                          <button className="buton" onClick={() => executa(supabase.from('reguli_program').update({ stare: 'aprobata' }).eq('id', r.id), `Regula „${r.titlu}” e aprobată.`)}>Aprobă</button>
                          <button className="buton-text" onClick={() => setForm(`reg:${r.id}`)}>Modifică</button>
                          <button className="buton-text" onClick={() => { if (confirm('Ștergeți această regulă propusă?')) executa(supabase.from('reguli_program').delete().eq('id', r.id), 'Regula propusă a fost ștearsă.') }}>Șterge</button>
                        </>}
                        {r.stare === 'aprobata' && <button className="buton-text" onClick={() => { if (confirm('Retrageți regula? Nu se mai aplică nicăieri, iar retragerea nu se mai poate anula.')) executa(supabase.from('reguli_program').update({ stare: 'retrasa' }).eq('id', r.id), 'Regula a fost retrasă.') }}>Retrage</button>}
                      </div>
                    </div>))}
                  {form === `ver:${ultima.id}`
                    ? <FormRegula baza={ultima} inchide={() => setForm(null)} salveaza={v => executa(supabase.from('reguli_program').insert({ ...v, program_id: p.id, cod, inlocuieste_id: ultima.id }), 'Versiunea nouă a fost adăugată ca propusă. Aprobați-o ca să se aplice.').then(() => {})} />
                    : ultima.stare !== 'propusa' && <button className="buton-text" onClick={() => setForm(`ver:${ultima.id}`)}>+ Versiune nouă</button>}
                </div>
              )
            })}
            {form === 'reg-nou'
              ? <FormRegula nou inchide={() => setForm(null)} salveaza={v => executa(supabase.from('reguli_program').insert({ ...v, program_id: p.id }), 'Regula a fost adăugată ca propusă.').then(() => {})} />
              : <button className="buton-text" onClick={() => setForm('reg-nou')}>+ Regulă nouă</button>}
          </section>
        </>
      )}
      <p className="nota">Regulile pe care le folosesc calculele, după cod: <span className="mono">zile_productive_an</span> (personal), <span className="mono">mutari_fara_act_permise</span> și <span className="mono">mutari_fara_act_procent_max</span> (modificări de buget). Celelalte reguli sunt informative, pentru cine verifică cheltuielile. Tot ce se schimbă aici apare în Jurnalul general.</p>
    </>
  )
}

type VProgram = Omit<Program, 'id' | 'stare' | 'aprobat_la'>
function FormProgram({ p, inchide, salveaza }: { p?: Program; inchide: () => void; salveaza: (v: VProgram) => Promise<void> }) {
  const [v, setV] = useState<VProgram>({
    cod: p?.cod ?? '', denumire: p?.denumire ?? '', sursa_finantare: p?.sursa_finantare ?? '', moneda: p?.moneda?.trim() ?? 'EUR',
    sursa_curs_referinta: p?.sursa_curs_referinta ?? 'BCE', regula_curs_tip: p?.regula_curs_tip ?? 'medie_perioada_raportare',
    regula_curs: p?.regula_curs ?? '', metoda_alocare_lei: p?.metoda_alocare_lei ?? 'fifo',
  })
  const [eroare, setEroare] = useState<string | null>(null)
  const [lucreaza, setLucreaza] = useState(false)
  const set = (k: keyof VProgram, x: string) => setV(o => ({ ...o, [k]: x }))
  async function trimite() {
    setEroare(null)
    if (!v.cod.trim() || !v.denumire.trim()) return setEroare('Completați codul și denumirea.')
    if (!/^[A-Z]{3}$/.test(v.moneda.trim().toUpperCase())) return setEroare('Moneda are 3 litere (EUR, RON…).')
    setLucreaza(true)
    await salveaza({ ...v, cod: v.cod.trim().toUpperCase(), moneda: v.moneda.trim().toUpperCase(), denumire: v.denumire.trim(), sursa_finantare: v.sursa_finantare?.trim() || null, regula_curs: v.regula_curs?.trim() || null })
    setLucreaza(false)
  }
  return (
    <div className="formular-doc">
      <div className="campuri">
        <label>Cod scurt<input value={v.cod} onChange={e => set('cod', e.target.value)} placeholder="ex. PNRR, POR-CENTRU" /></label>
        <label>Denumire<input value={v.denumire} onChange={e => set('denumire', e.target.value)} /></label>
        <label className="lat2">Finanțator<input value={v.sursa_finantare ?? ''} onChange={e => set('sursa_finantare', e.target.value)} placeholder="ex. Comisia Europeană (gestiune directă)" /></label>
        <label>Moneda programului<input value={v.moneda} onChange={e => set('moneda', e.target.value)} /></label>
        <label>Sursa cursului de referință
          <select value={v.sursa_curs_referinta} onChange={e => set('sursa_curs_referinta', e.target.value)}>
            <option>BCE</option><option>BNR</option><option>InforEuro</option>
          </select></label>
        <label>Ce curs se aplică
          <select value={v.regula_curs_tip ?? ''} onChange={e => set('regula_curs_tip', e.target.value)}>
            {Object.entries(CURS_TIP).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select></label>
        <label>Cum se urmăresc leii cumpărați
          <select value={v.metoda_alocare_lei} onChange={e => set('metoda_alocare_lei', e.target.value)}>
            {Object.entries(ALOCARE).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select></label>
        <label className="lat2">Regula de curs, pe scurt, cu articolul<textarea rows={2} value={v.regula_curs ?? ''} onChange={e => set('regula_curs', e.target.value)} /></label>
      </div>
      {eroare && <div className="alerta rosu">{eroare}</div>}
      <div className="rand-butoane">
        <button className="buton" disabled={lucreaza} onClick={trimite}>{lucreaza ? 'Se salvează…' : p ? 'Salvează' : 'Adaugă programul'}</button>
        <button className="buton-text" disabled={lucreaza} onClick={inchide}>Renunță</button>
      </div>
    </div>
  )
}

type VCapitol = Omit<Capitol, 'id' | 'program_id'>
function FormCapitol({ c, ordine, inchide, salveaza }: { c?: Capitol; ordine?: number; inchide: () => void; salveaza: (v: VCapitol) => Promise<void> }) {
  const [v, setV] = useState({
    capitol: c?.capitol ?? '', cod: c?.cod ?? '', denumire: c?.denumire ?? '', descriere_eligibilitate: c?.descriere_eligibilitate ?? '',
    mod_calcul: c?.mod_calcul ?? 'plati', procent: txt(c?.procent), optional: c?.optional ?? false, ordine: String(c?.ordine ?? ordine ?? 1),
  })
  const [eroare, setEroare] = useState<string | null>(null)
  const set = (k: string, x: string | boolean) => setV(o => ({ ...o, [k]: x }))
  async function trimite() {
    setEroare(null)
    if (!v.cod.trim() || !v.denumire.trim()) return setEroare('Completați codul și denumirea capitolului.')
    const pr = nr(v.procent)
    if (v.mod_calcul === 'procent' && (pr == null || !(pr > 0 && pr <= 100))) return setEroare('Un capitol procentual are nevoie de procent (între 0 și 100).')
    await salveaza({ capitol: v.capitol.trim() || v.cod.trim(), cod: v.cod.trim(), denumire: v.denumire.trim(), descriere_eligibilitate: v.descriere_eligibilitate.trim() || null,
      mod_calcul: v.mod_calcul, procent: v.mod_calcul === 'procent' ? pr : null, optional: v.optional, ordine: Number(v.ordine) || 0 })
  }
  return (
    <div className="formular-doc">
      <div className="campuri">
        <label>Cod<input value={v.cod} onChange={e => set('cod', e.target.value)} placeholder="ex. C.1" /></label>
        <label>Denumire<input value={v.denumire} onChange={e => set('denumire', e.target.value)} /></label>
        <label>Cum se justifică
          <select value={v.mod_calcul} onChange={e => set('mod_calcul', e.target.value)}>
            {Object.entries(MOD_CALCUL).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select></label>
        {v.mod_calcul === 'procent'
          ? <label>Procent din celelalte capitole<input value={v.procent} onChange={e => set('procent', e.target.value)} placeholder="ex. 25" /></label>
          : <label>Ordine în listă<input value={v.ordine} onChange={e => set('ordine', e.target.value)} /></label>}
        <label className="lat2">Ce e eligibil (cu articolul din ghid)<textarea rows={2} value={v.descriere_eligibilitate} onChange={e => set('descriere_eligibilitate', e.target.value)} /></label>
        <label className="bifa-camp"><input type="checkbox" checked={v.optional} onChange={e => set('optional', e.target.checked)} /> Opțional (nu toate contractele îl au)</label>
      </div>
      {eroare && <div className="alerta rosu">{eroare}</div>}
      <div className="rand-butoane"><button className="buton" onClick={trimite}>{c ? 'Salvează' : 'Adaugă capitolul'}</button><button className="buton-text" onClick={inchide}>Renunță</button></div>
    </div>
  )
}

type VRegula = { titlu: string; text_regula: string; articol_sursa: string; document_sursa: string | null; valabil_de_la: string | null; valoare: number | null; unitate: string | null; cod?: string }
function FormRegula({ r, baza, nou, inchide, salveaza }: { r?: Regula; baza?: Regula; nou?: boolean; inchide: () => void; salveaza: (v: VRegula) => Promise<void> }) {
  const sursa = r ?? baza
  const [v, setV] = useState({
    cod: sursa?.cod ?? '', titlu: sursa?.titlu ?? '', text_regula: sursa?.text_regula ?? '', articol_sursa: sursa?.articol_sursa ?? '',
    document_sursa: sursa?.document_sursa ?? '', valabil_de_la: r?.valabil_de_la ?? '', valoare: txt(sursa?.valoare), unitate: sursa?.unitate ?? '',
  })
  const [eroare, setEroare] = useState<string | null>(null)
  const set = (k: string, x: string) => setV(o => ({ ...o, [k]: x }))
  async function trimite() {
    setEroare(null)
    if (nou && !/^[a-z0-9_]+$/.test(v.cod.trim())) return setEroare('Codul regulii: litere mici, cifre și „_” (ex. tva_eligibila).')
    if (!v.titlu.trim() || !v.text_regula.trim() || !v.articol_sursa.trim()) return setEroare('Completați titlul, textul regulii și articolul din ghid.')
    if (baza && !v.valabil_de_la) return setEroare('O versiune nouă are nevoie de data de la care se aplică.')
    const val = nr(v.valoare)
    if (v.valoare.trim() && (val == null || Number.isNaN(val))) return setEroare('Valoarea trebuie să fie un număr.')
    await salveaza({ ...(nou ? { cod: v.cod.trim() } : {}), titlu: v.titlu.trim(), text_regula: v.text_regula.trim(), articol_sursa: v.articol_sursa.trim(),
      document_sursa: v.document_sursa.trim() || null, valabil_de_la: v.valabil_de_la || null, valoare: val, unitate: v.unitate.trim() || null })
  }
  return (
    <div className="formular-doc" style={{ margin: '10px 0' }}>
      {baza && <div className="alerta albastru">Versiune nouă pentru „{baza.titlu}”. Versiunea {baza.versiune} rămâne valabilă pentru perioada de dinainte de data de mai jos.</div>}
      <div className="campuri">
        {nou && <label>Cod (pentru calcule)<input value={v.cod} onChange={e => set('cod', e.target.value)} placeholder="ex. tva_eligibila" /></label>}
        <label className={nou ? '' : 'lat2'}>Titlu<input value={v.titlu} onChange={e => set('titlu', e.target.value)} /></label>
        <label className="lat2">Textul regulii<textarea rows={3} value={v.text_regula} onChange={e => set('text_regula', e.target.value)} /></label>
        <label>Articolul din ghid<input value={v.articol_sursa} onChange={e => set('articol_sursa', e.target.value)} placeholder="ex. MGA art. 6.2.A" /></label>
        <label>Documentul<input value={v.document_sursa} onChange={e => set('document_sursa', e.target.value)} placeholder="ex. Ghidul solicitantului 2024" /></label>
        <label>Valoare (dacă intră în calcule)<input value={v.valoare} onChange={e => set('valoare', e.target.value)} /></label>
        <label>Unitate<input value={v.unitate} onChange={e => set('unitate', e.target.value)} placeholder="ex. zile/an, %" /></label>
        <label>Se aplică de la{baza ? '' : ' (gol = de la început)'}<input type="date" value={v.valabil_de_la} onChange={e => set('valabil_de_la', e.target.value)} /></label>
      </div>
      {eroare && <div className="alerta rosu">{eroare}</div>}
      <div className="rand-butoane"><button className="buton" onClick={trimite}>{r ? 'Salvează' : baza ? 'Adaugă versiunea' : 'Adaugă regula'}</button><button className="buton-text" onClick={inchide}>Renunță</button></div>
    </div>
  )
}

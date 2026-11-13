import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { data, iban as fmtIban, num } from '../lib/format'
import { verifica } from '../lib/extrasBCR'
import { CITITOARE, citesteFisier, type Citire, type Format } from '../lib/cititoare'

// Biblioteca de bănci (doar administratorul): tot ce ține de o bancă stă aici, nu în cod.
//  - Fișa băncii: denumire, cod BIC, țara și codul din IBAN (RO: caracterele 5–8, de ex. RNCB = BCR).
//    După cod, aplicația recunoaște singură banca unui cont nou.
//  - Formatele de extras: ce cititor folosește aplicația (PDF BCR sau MT940 standard) și setările lui.
//  - Proba: un extras real se citește fără să se salveze nimic; dacă cifrele se potrivesc, formatul se aprobă.
// Clienții pot încărca extrase doar într-un format aprobat al băncii contului. Un format aprobat nu se
// rescrie: se face o versiune nouă. Banca se aprobă înaintea formatelor ei.

type Stare = 'propusa' | 'aprobata' | 'retrasa'
type Banca = { id: string; denumire: string; cod_bic: string | null; tara: string; cod_iban: string | null; observatii: string | null; stare: Stare; aprobat_la: string | null }
type ContSumar = { iban: string; banca_id: string; banca?: string }

const STARE: Record<Stare, { text: string; cls: string }> = {
  propusa: { text: 'propusă', cls: 'galben' }, aprobata: { text: 'aprobată', cls: 'verde' }, retrasa: { text: 'retrasă', cls: 'gri-e' },
}
const SOLD_DATA: Record<string, string> = {
  ziua_anterioara: 'soldul inițial poartă data zilei dinainte (cel mai des)',
  aceeasi_zi: 'soldul inițial poartă data primei zile a extrasului',
}
const TIP: Record<string, string> = {
  incasare_finantare: 'Încasare finanțare', plata_furnizor: 'Plată furnizor', plata_salarii: 'Salarii', plata_taxe: 'Taxe și contribuții',
  comision_bancar: 'Comision bancar', dobanda: 'Dobândă', schimb_valutar: 'Schimb valutar', transfer_intern: 'Transfer între conturi',
  transfer_cont_propriu: 'Cont propriu', retragere_numerar: 'Retragere numerar', depunere_numerar: 'Depunere numerar', restituire: 'Restituire', altele: 'Altele',
}

export default function Banci() {
  const [banci, setBanci] = useState<Banca[] | null>(null)
  const [formate, setFormate] = useState<Format[]>([])
  const [conturi, setConturi] = useState<ContSumar[]>([])
  const [ales, setAles] = useState<string | null>(null)
  const [form, setForm] = useState<string | null>(null) // 'banca' | 'banca-noua' | 'format-nou' | 'fmt:<id>' | 'ver:<id>'
  const [mesaj, setMesaj] = useState<{ cls: string; text: string } | null>(null)
  const [eroare, setEroare] = useState<string | null>(null)

  const incarca = useCallback(async () => {
    const [b, f, c] = await Promise.all([
      supabase.from('banci').select('id,denumire,cod_bic,tara,cod_iban,observatii,stare,aprobat_la').order('denumire'),
      supabase.from('formate_extras').select('id,banca_id,versiune,denumire,tip_fisier,structura,stare,valabil_de_la,observatii,aprobat_la').order('versiune'),
      supabase.from('conturi').select('iban,banca_id'),
    ])
    if (b.error || f.error) { setEroare('Biblioteca nu a putut fi citită.'); return }
    setBanci(b.data as Banca[]); setFormate(f.data as Format[]); setConturi((c.data ?? []) as ContSumar[])
    setAles(a => a ?? (b.data as Banca[])[0]?.id ?? null)
  }, [])
  useEffect(() => { incarca() }, [incarca])

  async function executa(op: PromiseLike<{ error: { message: string } | null }>, text: string) {
    setMesaj(null)
    const { error } = await op
    if (error) { setMesaj({ cls: 'rosu', text: error.message }); return false }
    setMesaj({ cls: 'verde', text }); setForm(null); await incarca(); return true
  }

  if (eroare) return <><Link to="/admin" className="inapoi">← Administrare</Link><div className="alerta rosu">{eroare}</div></>
  if (!banci) return <div className="gol">Se încarcă…</div>
  const b = banci.find(x => x.id === ales) ?? null
  const fmts = formate.filter(f => f.banca_id === ales) as (Format & { observatii?: string | null; aprobat_la?: string | null })[]
  const nrConturi = conturi.filter(c => c.banca_id === ales).length
  const aprobate = fmts.filter(f => f.stare === 'aprobata').length

  return (
    <>
      <Link to="/admin" className="inapoi">← Administrare</Link>
      <section className="titlu-pagina">
        <h1>Biblioteca de bănci</h1>
        <p>Cum arată extrasele fiecărei bănci, comune tuturor firmelor client. Le aprobă M.V. Consulting după o probă pe un extras real; clienții încarcă extrase doar în formatele aprobate.</p>
      </section>

      <div className="file-vederi">
        {banci.map(x => (
          <button key={x.id} className={`fila ${x.id === ales ? 'activa' : ''}`} onClick={() => { setAles(x.id); setForm(null); setMesaj(null) }}>
            {x.denumire} <span className={`eticheta ${STARE[x.stare].cls}`}>{STARE[x.stare].text}</span>
          </button>
        ))}
        <button className="fila" onClick={() => { setForm('banca-noua'); setMesaj(null) }}>+ Bancă nouă</button>
      </div>
      {mesaj && <div className={`alerta ${mesaj.cls}`}>{mesaj.text}</div>}

      {form === 'banca-noua' && (
        <section className="bloc">
          <div className="bloc-titlu"><h2>Bancă nouă</h2><p>Intră ca „propusă”. Adăugați apoi formatul extrasului, faceți proba pe un extras real și aprobați întâi banca, apoi formatul.</p></div>
          <FormBanca inchide={() => setForm(null)} salveaza={v => executa(supabase.from('banci').insert(v), `Banca ${v.denumire} a fost adăugată.`).then(() => {})} />
        </section>
      )}

      {b && form !== 'banca-noua' && <>
        <section className="bloc">
          {form === 'banca'
            ? <FormBanca b={b} inchide={() => setForm(null)} salveaza={v => executa(supabase.from('banci').update(v).eq('id', b.id), 'Fișa băncii a fost actualizată.').then(() => {})} />
            : <>
              <div className="bloc-titlu">
                <h2>{b.denumire} <span className={`eticheta ${STARE[b.stare].cls}`}>{STARE[b.stare].text}{b.aprobat_la ? ` ${data(b.aprobat_la)}` : ''}</span></h2>
              </div>
              <div className="grila-detalii" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
                <div><div className="mic gri">Cod BIC</div><div className="mono">{b.cod_bic ?? '—'}</div></div>
                <div><div className="mic gri">Țara</div><div>{b.tara}</div></div>
                <div><div className="mic gri">Codul din IBAN</div><div className="mono">{b.cod_iban ?? '—'}</div>{b.tara === 'RO' && !b.cod_iban && <div className="mic rosu-text">Fără cod, aplicația nu recunoaște banca după IBAN.</div>}</div>
                <div><div className="mic gri">Conturi la această bancă</div><div>{nrConturi}</div></div>
              </div>
              {b.observatii && <p className="mic" style={{ marginTop: 10 }}>{b.observatii}</p>}
              {b.stare === 'propusa' && <div className="alerta galben" style={{ marginTop: 12 }}>Banca e propusă. Clienții nu o văd și nu pot încărca extrase de la ea până nu aprobați banca și cel puțin un format de extras.</div>}
              {b.stare === 'aprobata' && aprobate === 0 && <div className="alerta galben" style={{ marginTop: 12 }}>Banca e aprobată, dar nu are niciun format de extras aprobat: extrasele ei nu se pot încă încărca.</div>}
              <div className="rand-butoane" style={{ marginTop: 12 }}>
                {b.stare !== 'retrasa' && <button className="buton-text" onClick={() => setForm('banca')}>Modifică fișa</button>}
                {b.stare === 'propusa' && <button className="buton" onClick={() => executa(supabase.from('banci').update({ stare: 'aprobata' }).eq('id', b.id), `Banca ${b.denumire} e aprobată. Aprobați acum și formatul ei de extras.`)}>Aprobă banca</button>}
                {b.stare === 'aprobata' && aprobate === 0 && <button className="buton-text" onClick={() => executa(supabase.from('banci').update({ stare: 'propusa' }).eq('id', b.id), 'Aprobarea a fost anulată; banca e din nou propusă.')}>Anulează aprobarea</button>}
                {b.stare !== 'retrasa' && <button className="buton-text" onClick={() => { if (confirm(`Retrageți banca ${b.denumire}? Formatele ei se retrag și ele, iar extrasele ei nu se mai pot încărca. Retragerea nu se mai poate anula.`)) executa(supabase.from('banci').update({ stare: 'retrasa' }).eq('id', b.id), 'Banca a fost retrasă.') }}>Retrage</button>}
              </div>
            </>}
        </section>

        <section className="bloc fara-padding">
          <div className="bloc-titlu" style={{ padding: '18px 18px 0' }}>
            <h2>Formatele de extras</h2>
            <p>Fiecare format spune ce cititor folosește aplicația pentru extrasele acestei bănci. Un format aprobat nu se rescrie: faceți o versiune nouă (de exemplu când banca își schimbă extrasul), valabilă de la o dată.</p>
          </div>
          <div className="tabel-wrap">
            <table className="tabel-op">
              <thead><tr><th>Versiune</th><th>Denumire</th><th>Cititor</th><th>Setări</th><th>Valabil de la</th><th>Stare</th><th></th></tr></thead>
              <tbody>
                {fmts.map(f => form === `fmt:${f.id}` || form === `ver:${f.id}`
                  ? <tr key={f.id}><td colSpan={7}><FormFormat f={f} versiuneNoua={form === `ver:${f.id}`} inchide={() => setForm(null)}
                      salveaza={v => form === `ver:${f.id}`
                        ? executa(supabase.from('formate_extras').insert({ ...v, banca_id: b.id }), 'Versiunea nouă a formatului a fost adăugată (propusă). Faceți proba și aprobați-o.').then(() => {})
                        : executa(supabase.from('formate_extras').update(v).eq('id', f.id), 'Formatul a fost actualizat.').then(() => {})} /></td></tr>
                  : <tr key={f.id} style={{ opacity: f.stare === 'retrasa' ? 0.6 : 1 }}>
                      <td className="mono">v{f.versiune}</td>
                      <td>{f.denumire}{f.observatii && <div className="mic gri">{f.observatii}</div>}</td>
                      <td className="mic">{CITITOARE[f.structura.cititor] ?? f.structura.cititor}</td>
                      <td className="mic">{f.structura.cititor === 'MT940' ? SOLD_DATA[f.structura.sold_initial_data ?? 'ziua_anterioara'] : f.structura.cititor === 'ING_PDF_V1' ? 'coloanele extrasului ING; soldul verificat după fiecare operațiune' : 'coloanele și antetul extrasului BCR'}</td>
                      <td className="nowrap">{f.valabil_de_la ? data(f.valabil_de_la) : '—'}</td>
                      <td><span className={`eticheta ${STARE[f.stare].cls}`}>{STARE[f.stare].text}{f.aprobat_la ? ` ${data(f.aprobat_la)}` : ''}</span></td>
                      <td className="n nowrap">
                        {f.stare === 'propusa' && <>
                          <button className="buton" disabled={b.stare !== 'aprobata'} title={b.stare !== 'aprobata' ? 'Aprobați întâi banca' : ''}
                            onClick={() => executa(supabase.from('formate_extras').update({ stare: 'aprobata' }).eq('id', f.id), `Formatul „${f.denumire}” e aprobat. Clienții pot încărca extrase în acest format.`)}>Aprobă</button>
                          <button className="buton-text" onClick={() => setForm(`fmt:${f.id}`)}>Modifică</button>
                          <button className="buton-text" onClick={() => { if (confirm('Ștergeți formatul propus?')) executa(supabase.from('formate_extras').delete().eq('id', f.id), 'Formatul propus a fost șters.') }}>Șterge</button>
                        </>}
                        {f.stare === 'aprobata' && <>
                          <button className="buton-text" onClick={() => setForm(`ver:${f.id}`)}>+ Versiune nouă</button>
                          <button className="buton-text" onClick={() => { if (confirm('Retrageți formatul? Extrasele deja încărcate rămân; extrase noi în acest format nu se mai pot încărca.')) executa(supabase.from('formate_extras').update({ stare: 'retrasa' }).eq('id', f.id), 'Formatul a fost retras.') }}>Retrage</button>
                        </>}
                      </td>
                    </tr>)}
                {fmts.length === 0 && form !== 'format-nou' && <tr><td colSpan={7} className="gol">Niciun format. Adăugați-l, apoi faceți proba pe un extras real al băncii.</td></tr>}
                {form === 'format-nou' && <tr><td colSpan={7}><FormFormat inchide={() => setForm(null)} salveaza={v => executa(supabase.from('formate_extras').insert({ ...v, banca_id: b.id }), 'Formatul a fost adăugat (propus). Faceți proba și aprobați-l.').then(() => {})} /></td></tr>}
              </tbody>
            </table>
          </div>
          {form !== 'format-nou' && b.stare !== 'retrasa' && <div style={{ padding: '0 18px 18px' }}><button className="buton-text" onClick={() => setForm('format-nou')}>+ Adaugă un format</button></div>}
        </section>

        {fmts.some(f => f.stare !== 'retrasa') && <Proba banca={b} formate={fmts.filter(f => f.stare !== 'retrasa')} conturi={conturi} />}
      </>}
    </>
  )
}

// Proba: citește un extras real cu formatele băncii (și cele propuse), fără să salveze nimic.
function Proba({ banca, formate, conturi }: { banca: Banca; formate: Format[]; conturi: ContSumar[] }) {
  const [rez, setRez] = useState<{ nume: string; citiri?: Citire[]; eroare?: string } | null>(null)
  async function citeste(fl: FileList | null) {
    const f = fl?.[0]; if (!f) return
    setRez({ nume: f.name })
    try {
      const buf = await f.arrayBuffer()
      const citiri = await citesteFisier(f, buf, conturi.map(c => ({ iban: c.iban, banca_id: c.banca_id })), formate, false, banca.id)
      setRez({ nume: f.name, citiri })
    } catch (e) { setRez({ nume: f.name, eroare: e instanceof Error ? e.message : String(e) }) }
  }
  return (
    <section className="bloc">
      <div className="bloc-titlu">
        <h2>Probă pe un extras real</h2>
        <p>Alegeți un extras descărcat de la {banca.denumire}. Aplicația îl citește cu formatele de mai sus și arată ce a înțeles; <b>nu se salvează nimic</b>. Comparați soldurile și totalurile cu extrasul băncii: dacă se potrivesc la ban, formatul poate fi aprobat.</p>
      </div>
      <label className="zona-incarcare">
        <input type="file" accept="application/pdf,.pdf,.sta,.txt,.940,.mt940,.mt9" onChange={e => { citeste(e.target.files); e.target.value = '' }} />
        <span>Alege extrasul de probă (PDF sau MT940)</span>
        <span className="mic gri">Fișierul e citit doar pe calculatorul dvs.</span>
      </label>
      {rez && !rez.citiri && !rez.eroare && <div className="gol">Citesc {rez.nume}…</div>}
      {rez?.eroare && <div className="alerta rosu" style={{ marginTop: 12 }}>{rez.nume}: {rez.eroare}</div>}
      {rez?.citiri?.map(({ extras: x, format, problema }, k) => {
        const tipuri: Record<string, number> = {}
        x.operatiuni.forEach(o => { tipuri[o.tip_propus] = (tipuri[o.tip_propus] ?? 0) + 1 })
        const codIban = x.iban.startsWith('RO') ? x.iban.slice(4, 8) : null
        return (
          <div key={k} style={{ marginTop: 16 }}>
            <h3 style={{ margin: '0 0 6px' }}>Extrasul nr. {x.numar} · <span className="mono">{fmtIban(x.iban)}</span> · {x.moneda}</h3>
            <div className="mic gri">Citit cu: {format ? `${format.denumire} (v${format.versiune}, ${format.stare === 'aprobata' ? 'aprobat' : 'propus'})` : '—'} · perioada {data(x.data_inceput)} – {data(x.data_sfarsit)}{x.titular ? ` · titular ${x.titular}` : ''}</div>
            {problema && <div className="alerta galben" style={{ marginTop: 8 }}>{problema}</div>}
            {codIban && banca.cod_iban && codIban !== banca.cod_iban && <div className="alerta rosu" style={{ marginTop: 8 }}>IBAN-ul extrasului are codul de bancă {codIban}, nu {banca.cod_iban}: extrasul nu pare de la {banca.denumire}.</div>}
            <div className="cifre" style={{ marginTop: 10 }}>
              <div className="cifra"><div className="cifra-eticheta">Sold inițial</div><div className="cifra-valoare">{num(x.sold_initial)}</div></div>
              <div className="cifra"><div className="cifra-eticheta">Total plăți (debit)</div><div className="cifra-valoare">{num(x.total_debit)}</div></div>
              <div className="cifra"><div className="cifra-eticheta">Total încasări (credit)</div><div className="cifra-valoare">{num(x.total_credit)}</div></div>
              <div className="cifra"><div className="cifra-eticheta">Sold final</div><div className="cifra-valoare">{num(x.sold_final)}</div><div className="cifra-sub">{x.operatiuni.length} operațiuni</div></div>
            </div>
            <ul className="mic" style={{ marginTop: 10 }}>
              {verifica(x).map((v, i) => <li key={i} className={v.ok ? 'verde-text' : 'rosu-text'}>{v.ok ? '✓' : '✗'} {v.text}</li>)}
              {x.avertismente.map((a, i) => <li key={`a${i}`}>⚠ {a}</li>)}
            </ul>
            <div className="mic" style={{ marginTop: 6 }}>Tipuri propuse: {Object.entries(tipuri).map(([t, n]) => `${TIP[t] ?? t} ${n}`).join(' · ')}</div>
            <div className="tabel-wrap" style={{ marginTop: 10 }}>
              <table className="tabel-op">
                <thead><tr><th>Data</th><th>Explicație</th><th>Tip propus</th><th className="n">Debit</th><th className="n">Credit</th></tr></thead>
                <tbody>
                  {x.operatiuni.slice(0, 15).map(o => <tr key={o.rand}><td className="nowrap">{data(o.data_operatiune)}</td><td className="mic">{o.descriere}</td><td className="mic nowrap">{TIP[o.tip_propus] ?? o.tip_propus}{o.parinte_rand ? ` (la rândul ${o.parinte_rand})` : ''}</td>
                    <td className="n">{o.sens === 'debit' ? num(o.suma) : ''}</td><td className="n">{o.sens === 'credit' ? num(o.suma) : ''}</td></tr>)}
                  {x.operatiuni.length > 15 && <tr><td colSpan={5} className="gol">… încă {x.operatiuni.length - 15} operațiuni</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </section>
  )
}

type VBanca = { denumire: string; cod_bic: string | null; tara: string; cod_iban: string | null; observatii: string | null }
function FormBanca({ b, inchide, salveaza }: { b?: Banca; inchide: () => void; salveaza: (v: VBanca) => Promise<void> }) {
  const [v, setV] = useState({ denumire: b?.denumire ?? '', cod_bic: b?.cod_bic ?? '', tara: b?.tara ?? 'RO', cod_iban: b?.cod_iban ?? '', observatii: b?.observatii ?? '' })
  const [eroare, setEroare] = useState<string | null>(null)
  const set = (k: keyof typeof v, x: string) => setV(s => ({ ...s, [k]: x }))
  function trimite() {
    const cod = v.cod_iban.trim().toUpperCase()
    if (!v.denumire.trim()) return setEroare('Completați denumirea băncii.')
    if (cod && !/^[A-Z0-9]{4}$/.test(cod)) return setEroare('Codul din IBAN are 4 caractere (de ex. RNCB, INGB, BTRL, BRDE).')
    if (v.tara.trim().toUpperCase() === 'RO' && !cod) return setEroare('La o bancă din România completați codul din IBAN (caracterele 5–8 ale IBAN-ului).')
    setEroare(null)
    salveaza({ denumire: v.denumire.trim(), cod_bic: v.cod_bic.trim().toUpperCase() || null, tara: v.tara.trim().toUpperCase(), cod_iban: cod || null, observatii: v.observatii.trim() || null })
  }
  return (
    <div className="campuri">
      <label>Denumirea băncii<input value={v.denumire} onChange={e => set('denumire', e.target.value)} placeholder="ING Bank N.V. Amsterdam – Sucursala București" /></label>
      <label>Cod BIC (SWIFT)<input value={v.cod_bic} onChange={e => set('cod_bic', e.target.value)} placeholder="INGBROBU" /></label>
      <label>Țara<input value={v.tara} maxLength={2} onChange={e => set('tara', e.target.value)} /></label>
      <label>Codul din IBAN<input value={v.cod_iban} maxLength={4} onChange={e => set('cod_iban', e.target.value)} placeholder="INGB" /><span className="mic gri">În RO12 <b>INGB</b> 0000…, caracterele 5–8.</span></label>
      <label style={{ gridColumn: '1 / -1' }}>Observații<textarea value={v.observatii} onChange={e => set('observatii', e.target.value)} rows={2} placeholder="De ex.: extrasele se exportă din Home'Bank → Conturi → Extrase → MT940" /></label>
      {eroare && <div className="alerta rosu">{eroare}</div>}
      <div className="rand-butoane"><button className="buton" onClick={trimite}>Salvează</button><button className="buton-text" onClick={inchide}>Renunță</button></div>
    </div>
  )
}

type VFormat = { denumire: string; tip_fisier: string; structura: Record<string, unknown>; valabil_de_la: string | null; observatii: string | null }
function FormFormat({ f, versiuneNoua, inchide, salveaza }: { f?: Format & { observatii?: string | null }; versiuneNoua?: boolean; inchide: () => void; salveaza: (v: VFormat) => Promise<void> }) {
  const [v, setV] = useState({
    denumire: f?.denumire ?? '', cititor: f?.structura.cititor ?? 'MT940', sold: f?.structura.sold_initial_data ?? 'ziua_anterioara',
    valabil: versiuneNoua ? new Date().toISOString().slice(0, 10) : f?.valabil_de_la ?? '', observatii: f?.observatii ?? '',
  })
  const set = (k: keyof typeof v, x: string) => setV(s => ({ ...s, [k]: x }))
  const [eroare, setEroare] = useState<string | null>(null)
  function trimite() {
    if (!v.denumire.trim()) return setEroare('Completați denumirea formatului.')
    setEroare(null)
    const structura = v.cititor === 'MT940'
      ? { ...(f?.structura.cititor === 'MT940' ? f.structura : {}), cititor: 'MT940', sold_initial_data: v.sold }
      : { ...(f?.structura ?? {}), cititor: v.cititor }
    salveaza({ denumire: v.denumire.trim(), tip_fisier: v.cititor === 'MT940' ? 'mt940' : 'pdf', structura, valabil_de_la: v.valabil || null, observatii: v.observatii.trim() || null })
  }
  return (
    <div className="campuri">
      {versiuneNoua && <div className="alerta galben" style={{ gridColumn: '1 / -1' }}>Versiune nouă a formatului „{f?.denumire}”. Intră ca propusă; versiunea veche rămâne aprobată până o retrageți.</div>}
      <label>Denumire<input value={v.denumire} onChange={e => set('denumire', e.target.value)} placeholder="ING – extras MT940 (Home'Bank)" /></label>
      <label>Cititor<select value={v.cititor} onChange={e => set('cititor', e.target.value)}>{Object.entries(CITITOARE).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
        {v.cititor === 'BCR_PDF_V1' && <span className="mic gri">Doar pentru extrasele PDF ale BCR.</span>}
        {v.cititor === 'ING_PDF_V1' && <span className="mic gri">Doar pentru extrasele PDF ING Business. Verifică soldul după fiecare operațiune.</span>}
        {v.cititor !== 'MT940' && <span className="mic gri">Pentru PDF-urile altor bănci e nevoie de un cititor nou, scris și testat într-o sesiune separată.</span>}</label>
      {v.cititor === 'MT940' && <label>Data soldului inițial<select value={v.sold} onChange={e => set('sold', e.target.value)}>{Object.entries(SOLD_DATA).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
        <span className="mic gri">Hotărăște ziua de început a extrasului. Dacă proba arată prima zi greșit, schimbați setarea.</span></label>}
      <label>Valabil de la<input type="date" value={v.valabil} onChange={e => set('valabil', e.target.value)} /></label>
      <label style={{ gridColumn: '1 / -1' }}>Observații<textarea value={v.observatii} rows={2} onChange={e => set('observatii', e.target.value)} placeholder="De ex.: verificat pe extrasul din octombrie 2026, solduri și totaluri identice" /></label>
      {eroare && <div className="alerta rosu">{eroare}</div>}
      <div className="rand-butoane"><button className="buton" onClick={trimite}>Salvează</button><button className="buton-text" onClick={inchide}>Renunță</button></div>
    </div>
  )
}

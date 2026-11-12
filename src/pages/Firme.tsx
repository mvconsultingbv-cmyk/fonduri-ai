import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { cheamaInvitare } from '../lib/invitare'

// Firme client (doar administratorul): firmele beneficiare, cu contractele lor.
//  - La adăugare, CUI-ul se verifică la ANAF (prin funcția de pe server; din browser ANAF nu răspunde):
//    se completează singure denumirea și adresa și se arată dacă firma e plătitoare de TVA sau inactivă.
//  - CUI-ul se păstrează fără „RO”; o firmă nu poate fi adăugată de două ori.
//  - Statutul de TVA folosit la calcule se setează pe contract (ecranul Facturi și documente), cu data de la care se aplică.

type Firma = { id: string; denumire: string; cui: string | null; adresa: string | null; creat_la: string }
type Contract = { id: string; numar_contract: string; organizatie_id: string; programe: { denumire: string } | null }
type Anaf = { gasit: boolean; cui: string; denumire?: string; adresa?: string; platitor_tva?: boolean; inactiv?: boolean; indisponibil?: boolean }

export default function Firme() {
  const [firme, setFirme] = useState<Firma[] | null>(null)
  const [contracte, setContracte] = useState<Contract[]>([])
  const [oameni, setOameni] = useState<Record<string, number>>({})
  const [eroare, setEroare] = useState<string | null>(null)
  const [mesaj, setMesaj] = useState<{ cls: string; text: string } | null>(null)
  const [form, setForm] = useState<string | 'nou' | null>(null)

  const incarca = useCallback(async () => {
    const [f, c, u] = await Promise.all([
      supabase.from('organizatii').select('id,denumire,cui,adresa,creat_la').order('denumire'),
      supabase.from('contracte').select('id,numar_contract,organizatie_id,programe(denumire)'),
      supabase.rpc('lista_utilizatori', { p_contract: null }),
    ])
    if (f.error || c.error) { setEroare('Firmele nu au putut fi citite.'); return }
    setFirme(f.data as Firma[]); setContracte(c.data as unknown as Contract[])
    // câți oameni au rol pe contractele fiecărei firme
    const n: Record<string, Set<string>> = {}
    for (const om of (u.data ?? []) as { id: string; activ: boolean; roluri: { contract_id: string }[] }[]) {
      if (!om.activ) continue
      for (const r of om.roluri) {
        const org = (c.data as unknown as Contract[]).find(k => k.id === r.contract_id)?.organizatie_id
        if (org) (n[org] ??= new Set()).add(om.id)
      }
    }
    setOameni(Object.fromEntries(Object.entries(n).map(([k, s]) => [k, s.size])))
  }, [])
  useEffect(() => { incarca() }, [incarca])

  async function gata(text: string) { setForm(null); setMesaj({ cls: 'verde', text }); await incarca() }

  if (eroare) return <><Link to="/admin" className="inapoi">← Administrare</Link><div className="alerta rosu">{eroare}</div></>
  if (!firme) return <div className="gol">Se încarcă firmele…</div>

  return (
    <>
      <Link to="/admin" className="inapoi">← Administrare</Link>
      <section className="titlu-pagina">
        <h1>Firme client</h1>
        <p>Firmele beneficiare care folosesc aplicația. Fiecare contract de finanțare aparține unei firme; oamenii primesc acces pe contracte, din ecranul Utilizatori și roluri.</p>
      </section>
      {mesaj && <div className={`alerta ${mesaj.cls} spatiu`}>{mesaj.text}</div>}

      {form === 'nou'
        ? <section className="bloc"><FormFirma inchide={() => setForm(null)} gata={gata} /></section>
        : <div className="rand-butoane spatiu"><button className="buton" onClick={() => { setMesaj(null); setForm('nou') }}>+ Adaugă o firmă</button></div>}

      <section className="bloc fara-padding">
        <div className="tabel-wrap">
          <table className="tabel-op">
            <thead><tr><th>Firma</th><th>CUI</th><th>Contracte</th><th className="n">Oameni cu acces</th><th></th></tr></thead>
            <tbody>
              {firme.map(f => form === f.id
                ? <tr key={f.id}><td colSpan={5}><FormFirma f={f} inchide={() => setForm(null)} gata={gata} /></td></tr>
                : <tr key={f.id}>
                    <td><b>{f.denumire}</b>{f.adresa && <div className="mic gri">{f.adresa}</div>}</td>
                    <td className="mono">{f.cui ?? '—'}</td>
                    <td>{contracte.filter(c => c.organizatie_id === f.id).map(c => <div key={c.id}><Link to={`/contract/${c.id}`}>{c.programe?.denumire} · {c.numar_contract}</Link></div>)}
                      {!contracte.some(c => c.organizatie_id === f.id) && <span className="gri">niciun contract</span>}</td>
                    <td className="n">{oameni[f.id] ?? 0}</td>
                    <td className="n"><button className="buton-text" onClick={() => { setMesaj(null); setForm(f.id) }}>Modifică</button></td>
                  </tr>)}
              {firme.length === 0 && <tr><td colSpan={5} className="gol">Nicio firmă introdusă.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <p className="nota">O firmă nu se șterge din acest ecran: are contracte și date în jurnal. Adăugarea unui contract nou pentru o firmă e pasul următor în aplicație.</p>
    </>
  )
}

function FormFirma({ f, inchide, gata }: { f?: Firma; inchide: () => void; gata: (t: string) => Promise<void> }) {
  const [v, setV] = useState({ cui: f?.cui ?? '', denumire: f?.denumire ?? '', adresa: f?.adresa ?? '' })
  const [anaf, setAnaf] = useState<Anaf | null>(null)
  const [eroare, setEroare] = useState<string | null>(null)
  const [lucreaza, setLucreaza] = useState(false)
  const set = (k: string, val: string) => setV(x => ({ ...x, [k]: val }))
  const cuiCurat = v.cui.toUpperCase().replace(/^RO/, '').replace(/\D/g, '')

  async function verifica() {
    setEroare(null); setAnaf(null)
    if (!/^\d{2,10}$/.test(cuiCurat)) return setEroare('CUI-ul are între 2 și 10 cifre (cu sau fără „RO” în față).')
    setLucreaza(true)
    const r = await cheamaInvitare<Anaf>({ actiune: 'verifica_cui', cui: cuiCurat })
    setLucreaza(false)
    if (r.eroare || !r.date) return setEroare(r.eroare ?? 'Verificarea nu a reușit.')
    setAnaf(r.date)
    if (r.date.gasit) setV(x => ({ ...x, cui: cuiCurat, denumire: x.denumire || r.date!.denumire || '', adresa: x.adresa || r.date!.adresa || '' }))
  }

  async function salveaza() {
    setEroare(null)
    if (!v.denumire.trim()) return setEroare('Completați denumirea.')
    if (v.cui && !/^\d{2,10}$/.test(cuiCurat)) return setEroare('CUI invalid.')
    const rand = { denumire: v.denumire.trim(), cui: cuiCurat || null, adresa: v.adresa.trim() || null }
    setLucreaza(true)
    const { error } = f ? await supabase.from('organizatii').update(rand).eq('id', f.id) : await supabase.from('organizatii').insert(rand)
    setLucreaza(false)
    if (error) return setEroare(error.code === '23505' ? 'Există deja o firmă cu acest CUI.' : error.message)
    await gata(f ? `Datele firmei ${rand.denumire} au fost actualizate.` : `Firma ${rand.denumire} a fost adăugată.`)
  }

  return (
    <div className="formular-doc">
      <div className="campuri">
        <label>CUI<input value={v.cui} onChange={e => set('cui', e.target.value)} placeholder="ex. RO39374418" /></label>
        <label>&nbsp;<button className="buton-text" type="button" disabled={lucreaza} onClick={verifica}>{lucreaza ? 'Se verifică…' : 'Verifică la ANAF'}</button></label>
        <label className="lat2">Denumirea<input value={v.denumire} onChange={e => set('denumire', e.target.value)} /></label>
        <label className="lat2">Adresa sediului<input value={v.adresa} onChange={e => set('adresa', e.target.value)} /></label>
      </div>
      {anaf && (anaf.gasit
        ? <div className={`alerta ${anaf.inactiv ? 'rosu' : 'verde'}`}>ANAF: <b>{anaf.denumire}</b>, {anaf.platitor_tva ? 'plătitoare de TVA' : 'neplătitoare de TVA'}{anaf.inactiv ? ', DECLARATĂ INACTIVĂ' : ''}.
            {' '}Statutul de TVA pentru calcule se setează pe contract, în ecranul Facturi și documente.</div>
        : <div className="alerta galben">{anaf.indisponibil ? 'Serviciul ANAF nu răspunde acum; completați datele de mână.' : 'ANAF nu găsește acest CUI. Verificați cifrele.'}</div>)}
      {eroare && <div className="alerta rosu">{eroare}</div>}
      <div className="rand-butoane">
        <button className="buton" disabled={lucreaza} onClick={salveaza}>{lucreaza ? 'Se salvează…' : f ? 'Salvează' : 'Adaugă firma'}</button>
        <button className="buton-text" disabled={lucreaza} onClick={inchide}>Renunță</button>
      </div>
    </div>
  )
}

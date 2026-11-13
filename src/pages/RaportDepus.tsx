import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth'
import { data, num } from '../lib/format'

// Raportul depus la finanțator pentru o perioadă, comparația pe capitole și închiderea perioadei.
// Toate regulile stau în baza de date (migrația 027a):
//  - sumele declarate se introduc pe fiecare capitol; orice diferență față de aplicație trebuie explicată;
//  - perioada o închide administratorul sau directorul de program, doar când lista „Ce mai trebuie” e goală;
//  - la închidere, cifrele aplicației se „fotografiază”, iar nimic din perioadă nu se mai modifică;
//  - redeschiderea o face doar administratorul, cu motiv scris, păstrat în istoric.

type Perioada = { id: string; numar: number; stare: string; data_sfarsit: string; raportata_la: string | null }
type Raport = { id: string; data_depunere: string; referinta: string | null; fisier_cale: string | null; fisier_nume: string | null; observatii: string | null }
type Linie = {
  pozitie_id: string; cod: string; denumire: string; ordine: number; linie_id: string | null
  aplicatie_eur: number | null; neconfirmat_eur: number; declarat_eur: number | null; diferenta_eur: number | null; explicatie: string | null
}
type Redeschidere = { id: string; motiv: string; inchisa_la: string | null; redeschisa_la: string }

const nr = (s: string) => Number(s.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))
const scrie = (v: number | null | undefined) => (v == null ? '' : Number(v).toFixed(2).replace('.', ','))
async function amprenta(f: File) {
  const h = await crypto.subtle.digest('SHA-256', await f.arrayBuffer())
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export default function RaportDepus({ contractId, p, laSchimbare }: { contractId: string; p: Perioada; laSchimbare: () => void }) {
  const { utilizator } = useAuth()
  const [raport, setRaport] = useState<Raport | null | undefined>(undefined)
  const [linii, setLinii] = useState<Linie[]>([])
  const [probleme, setProbleme] = useState<string[]>([])
  const [istoric, setIstoric] = useState<Redeschidere[]>([])
  const [rol, setRol] = useState<string | null>(null)
  const [edit, setEdit] = useState<Record<string, { d: string; e: string }>>({})
  const [antet, setAntet] = useState<{ data_depunere: string; referinta: string; observatii: string } | null>(null)
  const [fisier, setFisier] = useState<File | null>(null)
  const [motiv, setMotiv] = useState<string | null>(null)
  const [lucreaza, setLucreaza] = useState(false)
  const [mesaj, setMesaj] = useState<{ cls: string; text: string } | null>(null)

  const inchisa = p.stare === 'raportata'
  const admin = !!utilizator?.este_admin_platforma
  const poateScrie = admin || rol === 'manager' || rol === 'responsabil_financiar'
  const poateInchide = admin || rol === 'director_program'

  const incarca = useCallback(async () => {
    const [r, l, v, h] = await Promise.all([
      supabase.from('rapoarte_depuse').select('id,data_depunere,referinta,fisier_cale,fisier_nume,observatii').eq('perioada_id', p.id).maybeSingle(),
      supabase.from('v_comparatie_raport').select('pozitie_id,cod,denumire,ordine,linie_id,aplicatie_eur,neconfirmat_eur,declarat_eur,diferenta_eur,explicatie').eq('perioada_id', p.id).order('ordine'),
      supabase.rpc('verifica_inchidere_perioada', { p_perioada: p.id }),
      supabase.from('redeschideri_perioade').select('id,motiv,inchisa_la,redeschisa_la').eq('perioada_id', p.id).order('redeschisa_la', { ascending: false }),
    ])
    setRaport((r.data as Raport) ?? null)
    const ls = (l.data ?? []) as Linie[]
    setLinii(ls)
    setEdit(Object.fromEntries(ls.map(x => [x.pozitie_id, { d: scrie(x.declarat_eur), e: x.explicatie ?? '' }])))
    setProbleme(((v.data ?? []) as unknown as string[]))
    setIstoric((h.data ?? []) as Redeschidere[])
  }, [p.id])

  useEffect(() => { setMesaj(null); setAntet(null); setMotiv(null); incarca() }, [incarca])
  useEffect(() => {
    if (!utilizator) return
    supabase.from('roluri_contract').select('rol').eq('contract_id', contractId).eq('utilizator_id', utilizator.id).maybeSingle()
      .then(({ data: d }) => setRol((d as { rol: string } | null)?.rol ?? null))
  }, [contractId, utilizator])

  async function ruleaza(fn: () => Promise<string>) {
    setLucreaza(true); setMesaj(null)
    try { const ok = await fn(); setMesaj({ cls: 'verde', text: ok }); await incarca(); laSchimbare() }
    catch (e) { setMesaj({ cls: 'rosu', text: (e as Error).message }) }
    setLucreaza(false)
  }

  async function urcaFisier(): Promise<{ fisier_cale: string; fisier_amprenta: string; fisier_nume: string } | null> {
    if (!fisier) return null
    const h = await amprenta(fisier)
    const ext = (fisier.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '')
    const cale = `${contractId}/rapoarte/${h}.${ext}`
    const up = await supabase.storage.from('documente').upload(cale, fisier, { contentType: fisier.type || 'application/pdf', upsert: false })
    if (up.error && !/exists|duplicate/i.test(up.error.message)) throw new Error('Fișierul nu a putut fi încărcat: ' + up.error.message)
    return { fisier_cale: cale, fisier_amprenta: h, fisier_nume: fisier.name }
  }

  const salveazaAntet = () => ruleaza(async () => {
    if (!antet?.data_depunere) throw new Error('Completați data depunerii.')
    const f = await urcaFisier()
    const camp = { data_depunere: antet.data_depunere, referinta: antet.referinta.trim() || null, observatii: antet.observatii.trim() || null, ...(f ?? {}) }
    if (raport) {
      const { error } = await supabase.from('rapoarte_depuse').update(camp).eq('id', raport.id)
      if (error) throw new Error(error.message)
    } else {
      const { data: r, error } = await supabase.from('rapoarte_depuse').insert({ perioada_id: p.id, ...camp }).select('id').single()
      if (error) throw new Error(error.message)
      const ins = await supabase.from('raport_depus_linii').insert(linii.map(l => ({ raport_id: (r as { id: string }).id, pozitie_buget_id: l.pozitie_id })))
      if (ins.error) throw new Error(ins.error.message)
    }
    setAntet(null); setFisier(null)
    return raport ? 'Datele raportului au fost actualizate.' : 'Raportul a fost introdus. Completați acum sumele declarate pe fiecare capitol.'
  })

  const salveazaSume = () => ruleaza(async () => {
    if (!raport) throw new Error('Introduceți întâi raportul depus.')
    for (const l of linii) {
      const v = edit[l.pozitie_id]; if (!v) continue
      const d = v.d.trim() === '' ? null : nr(v.d)
      if (d != null && !Number.isFinite(d)) throw new Error(`Capitolul ${l.cod}: suma „${v.d}” nu e un număr.`)
      const rand = { suma_declarata_eur: d == null ? null : Math.round(d * 100) / 100, explicatie: v.e.trim() || null }
      const neschimbat = rand.suma_declarata_eur === (l.declarat_eur == null ? null : Number(l.declarat_eur)) && rand.explicatie === (l.explicatie ?? null)
      if (neschimbat && l.linie_id) continue
      const r = l.linie_id
        ? await supabase.from('raport_depus_linii').update(rand).eq('id', l.linie_id)
        : await supabase.from('raport_depus_linii').insert({ raport_id: raport.id, pozitie_buget_id: l.pozitie_id, ...rand })
      if (r.error) throw new Error(`Capitolul ${l.cod}: ${r.error.message}`)
    }
    return 'Sumele declarate au fost salvate.'
  })

  const stergeRaport = () => {
    if (!raport || !window.confirm('Ștergeți raportul introdus pentru această perioadă, cu toate sumele declarate? (Documentul rămâne în arhivă.)')) return
    ruleaza(async () => {
      const { error } = await supabase.from('rapoarte_depuse').delete().eq('id', raport.id)
      if (error) throw new Error(error.message)
      return 'Raportul a fost șters.'
    })
  }

  const inchide = () => {
    if (!window.confirm(`Închideți perioada ${p.numar}? Cifrele aplicației se fixează așa cum sunt acum, iar nimic din perioadă (plăți, alocări, salarii, documente, sume declarate) nu se mai poate modifica. Doar administratorul o poate redeschide, cu motiv.`)) return
    ruleaza(async () => {
      const { error } = await supabase.rpc('inchide_perioada_raportare', { p_perioada: p.id })
      if (error) throw new Error(error.message)
      return `Perioada ${p.numar} a fost închisă.`
    })
  }

  const redeschide = () => ruleaza(async () => {
    const { error } = await supabase.rpc('redeschide_perioada', { p_perioada: p.id, p_motiv: motiv ?? '' })
    if (error) throw new Error(error.message)
    setMotiv(null)
    return `Perioada ${p.numar} a fost redeschisă. Motivul a rămas în istoric și în jurnal.`
  })

  async function deschideFisier() {
    if (!raport?.fisier_cale) return
    const { data: u, error } = await supabase.storage.from('documente').createSignedUrl(raport.fisier_cale, 300)
    if (error || !u) { setMesaj({ cls: 'rosu', text: 'Fișierul nu a putut fi deschis.' }); return }
    window.open(u.signedUrl, '_blank', 'noopener')
  }

  if (raport === undefined) return null
  const editabil = !inchisa && poateScrie && !!raport
  const tot = linii.reduce((a, l) => ({ app: a.app + Number(l.aplicatie_eur ?? 0), decl: a.decl + Number(l.declarat_eur ?? 0) }), { app: 0, decl: 0 })
  const difLive = (l: Linie) => {
    const v = edit[l.pozitie_id]?.d ?? ''
    if (v.trim() === '') return null
    const d = nr(v)
    return Number.isFinite(d) ? Math.round((d - Number(l.aplicatie_eur ?? 0)) * 100) / 100 : null
  }
  const deschisaAntet = antet !== null || (!raport && !inchisa && poateScrie)
  const valAntet = antet ?? { data_depunere: raport?.data_depunere ?? '', referinta: raport?.referinta ?? '', observatii: raport?.observatii ?? '' }

  return (
    <section className="bloc spatiu">
      <h2 style={{ marginTop: 0 }}>Raportul depus și închiderea perioadei {p.numar}</h2>
      {mesaj && <div className={`alerta ${mesaj.cls} spatiu`}>{mesaj.text}</div>}

      {inchisa && <div className="alerta verde spatiu">
        <b>Perioada este închisă{p.raportata_la ? ` din ${data(p.raportata_la.slice(0, 10))}` : ''}.</b> Cifrele aplicației de mai jos sunt cele fixate la închidere. Nimic din perioadă nu se mai poate modifica.
      </div>}

      {/* 1. Antetul raportului */}
      {raport && !deschisaAntet && <div className="spatiu">
        Depus la <b>{data(raport.data_depunere)}</b>{raport.referinta && <> · referința <b>{raport.referinta}</b></>}
        {' · '}{raport.fisier_cale ? <button className="buton-text" onClick={deschideFisier}>Deschide documentul ({raport.fisier_nume ?? 'PDF'})</button> : <span className="rosu-text">documentul nu e atașat</span>}
        {raport.observatii && <div className="mic gri">{raport.observatii}</div>}
        {!inchisa && poateScrie && <div className="rand-butoane" style={{ marginTop: 8 }}>
          <button className="buton-text" onClick={() => setAntet({ data_depunere: raport.data_depunere, referinta: raport.referinta ?? '', observatii: raport.observatii ?? '' })}>Modifică datele raportului</button>
          <button className="buton-text" onClick={stergeRaport} disabled={lucreaza}>Șterge raportul</button>
        </div>}
      </div>}
      {!raport && (inchisa || !poateScrie) && <p className="gri">Raportul depus nu a fost introdus.</p>}
      {deschisaAntet && <div className="formular-doc spatiu">
        {!raport && <p className="mic gri" style={{ margin: 0 }}>Când raportul perioadei a fost depus la finanțator, introduceți aici data, referința și documentul depus (PDF), apoi sumele declarate pe fiecare capitol.</p>}
        <div className="campuri">
          <label>Data depunerii<input type="date" value={valAntet.data_depunere} onChange={e => setAntet({ ...valAntet, data_depunere: e.target.value })} /></label>
          <label>Referința (nr. de înregistrare / din portal)<input value={valAntet.referinta} onChange={e => setAntet({ ...valAntet, referinta: e.target.value })} /></label>
          <label className="lat2">Documentul depus {raport?.fisier_cale ? '(alegeți doar dacă îl înlocuiți)' : '(obligatoriu pentru închidere)'}<input type="file" accept="application/pdf,image/*" onChange={e => setFisier(e.target.files?.[0] ?? null)} /></label>
          <label className="lat2">Observații<input value={valAntet.observatii} onChange={e => setAntet({ ...valAntet, observatii: e.target.value })} /></label>
        </div>
        <div className="rand-butoane">
          <button className="buton" disabled={lucreaza} onClick={salveazaAntet}>{raport ? 'Salvează' : 'Introdu raportul'}</button>
          {raport && <button className="buton-text" onClick={() => { setAntet(null); setFisier(null) }}>Renunță</button>}
        </div>
      </div>}

      {/* 2. Comparația pe capitole */}
      {raport && <>
        <div className="tabel-wrap spatiu">
          <table className="tabel-op">
            <thead><tr><th>Capitol</th><th className="n">Aplicația</th><th className="n">Declarat la finanțator</th><th className="n">Diferență</th><th>Explicația diferenței</th></tr></thead>
            <tbody>
              {linii.map(l => {
                const dif = editabil ? difLive(l) : (l.diferenta_eur == null ? null : Number(l.diferenta_eur))
                return (
                  <tr key={l.pozitie_id}>
                    <td><b>{l.cod}</b> {l.denumire !== l.cod ? l.denumire : ''}{Number(l.neconfirmat_eur) ? <div className="mic rosu-text">{num(l.neconfirmat_eur)} neconfirmat</div> : null}</td>
                    <td className="n">{l.aplicatie_eur == null ? '—' : num(l.aplicatie_eur)}</td>
                    <td className="n">{editabil
                      ? <input style={{ width: 120, textAlign: 'right' }} value={edit[l.pozitie_id]?.d ?? ''} placeholder="necompletat" onChange={e => setEdit({ ...edit, [l.pozitie_id]: { ...edit[l.pozitie_id], d: e.target.value } })} />
                      : (l.declarat_eur == null ? <span className="gri">necompletat</span> : num(l.declarat_eur))}</td>
                    <td className={`n ${dif ? 'rosu-text tare' : 'gri'}`}>{dif == null ? '—' : dif === 0 ? '0' : num(dif)}</td>
                    <td>{editabil && dif
                      ? <input style={{ width: '100%' }} value={edit[l.pozitie_id]?.e ?? ''} placeholder="de ce diferă (obligatoriu)" onChange={e => setEdit({ ...edit, [l.pozitie_id]: { ...edit[l.pozitie_id], e: e.target.value } })} />
                      : <span className="mic">{l.explicatie ?? ''}</span>}</td>
                  </tr>
                )
              })}
              <tr className="rand-total"><td><b>Total</b></td><td className="n tare">{num(tot.app)}</td><td className="n tare">{num(tot.decl)}</td><td className={`n tare ${Math.round((tot.decl - tot.app) * 100) ? 'rosu-text' : ''}`}>{num(tot.decl - tot.app)}</td><td></td></tr>
            </tbody>
          </table>
        </div>
        {editabil && <div className="rand-butoane spatiu"><button className="buton" disabled={lucreaza} onClick={salveazaSume}>Salvează sumele declarate</button>
          <span className="mic gri">Scrieți 0 pentru capitolele pe care nu s-a declarat nimic. Totalul se recalculează după salvare.</span></div>}
      </>}

      {/* 3. Închiderea */}
      {!inchisa && <div className="spatiu">
        {probleme.length > 0
          ? <div className="alerta galben"><b>Ce mai trebuie până la închiderea perioadei:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{probleme.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          : <div className="alerta verde"><b>Perioada poate fi închisă.</b> Toate verificările au trecut.</div>}
        {poateInchide
          ? <div className="rand-butoane spatiu"><button className="buton verde-b" disabled={lucreaza || probleme.length > 0} onClick={inchide}>Închide perioada {p.numar}</button></div>
          : <p className="mic gri">Perioada o închide administratorul sau directorul de program.</p>}
      </div>}
      {inchisa && admin && (motiv === null
        ? <div className="rand-butoane"><button className="buton-text" onClick={() => setMotiv('')}>Redeschide perioada (doar administrator)</button></div>
        : <div className="formular-doc">
            <label>Motivul redeschiderii (rămâne în istoric și în jurnal)<input value={motiv} onChange={e => setMotiv(e.target.value)} placeholder="ex. finanțatorul a cerut corectarea capitolului C.3" /></label>
            <div className="rand-butoane"><button className="buton rosu-b" disabled={lucreaza} onClick={redeschide}>Redeschide</button><button className="buton-text" onClick={() => setMotiv(null)}>Renunță</button></div>
          </div>)}
      {istoric.length > 0 && <div className="mic gri spatiu"><b>Redeschideri anterioare:</b>
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{istoric.map(h => <li key={h.id}>{data(h.redeschisa_la.slice(0, 10))}: {h.motiv}{h.inchisa_la ? ` (fusese închisă la ${data(h.inchisa_la.slice(0, 10))})` : ''}</li>)}</ul></div>}
    </section>
  )
}

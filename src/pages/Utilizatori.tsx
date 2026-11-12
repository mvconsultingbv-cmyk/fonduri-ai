import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth'
import { cheamaInvitare, mesajInvitatie, ROLURI } from '../lib/invitare'

// Utilizatori și roluri.
//  - În Administrare (fără contract): toți oamenii din aplicație, cu rolurile lor pe toate contractele.
//    Doar administratorul vede ecranul.
//  - În meniul unui contract („Echipa contractului”): oamenii cu rol pe acel contract.
//    Administratorul și managerul contractului pot invita, schimba rolul sau scoate un om;
//    ceilalți doar văd lista. Directorul de program îl numește, schimbă sau scoate doar administratorul.
//  - Accesul vine din rolul pe contract. „Firma de bază” e informativă; un om poate avea roluri pe contractele mai multor firme.
//  - Un om nu se șterge niciodată (jurnalul trebuie să știe cine a făcut ce): se dezactivează.
//  - Invitarea se face prin funcția de pe server „invita-utilizator”, care întoarce un link de activare;
//    linkul îl trimite omului cel care invită (email sau mesaj).

type RolOm = { contract_id: string; rol: string; numar: string; firma: string; acordat_la: string }
type Om = {
  id: string; nume: string; email: string; telefon: string | null; organizatie_id: string | null; organizatie: string | null
  activ: boolean; este_admin: boolean; invitat_la: string | null; confirmat_la: string | null; ultima_conectare: string | null; roluri: RolOm[]
}
type Contract = { id: string; numar_contract: string; organizatii: { denumire: string } | null }
type Firma = { id: string; denumire: string }

const cand = (s: string | null) => (s ? new Date(s).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

export default function Utilizatori({ peContract = false }: { peContract?: boolean }) {
  const { id: contractId } = useParams()
  const { utilizator } = useAuth()
  const eAdmin = !!utilizator?.este_admin_platforma
  const [oameni, setOameni] = useState<Om[] | null>(null)
  const [contracte, setContracte] = useState<Contract[]>([])
  const [firme, setFirme] = useState<Firma[]>([])
  const [eroare, setEroare] = useState<string | null>(null)
  const [mesaj, setMesaj] = useState<{ cls: string; text: string } | null>(null)
  const [link, setLink] = useState<{ nume: string; email: string; link: string; nou: boolean } | null>(null)
  const [invit, setInvit] = useState(false)
  const [rolNou, setRolNou] = useState<string | null>(null)   // id-ul omului căruia îi adăugăm un rol (Administrare)
  const [lucreaza, setLucreaza] = useState(false)

  const incarca = useCallback(async () => {
    const [l, c, f] = await Promise.all([
      supabase.rpc('lista_utilizatori', { p_contract: peContract ? contractId : null }),
      supabase.from('contracte').select('id,numar_contract,organizatii(denumire)').order('data_inceput', { ascending: false }),
      eAdmin ? supabase.from('organizatii').select('id,denumire').order('denumire') : Promise.resolve({ data: [], error: null }),
    ])
    if (l.error) { setEroare(l.error.message.includes('administrator') ? 'Ecranul e doar pentru administrator.' : 'Lista nu a putut fi citită.'); return }
    setOameni(l.data as Om[]); setContracte((c.data ?? []) as unknown as Contract[]); setFirme((f.data ?? []) as Firma[])
  }, [peContract, contractId, eAdmin])
  useEffect(() => { incarca() }, [incarca])

  // pe contract: pot administra echipa administratorul și managerul contractului
  const rolulMeu = useMemo(() => oameni?.find(o => o.id === utilizator?.id)?.roluri.find(r => r.contract_id === contractId)?.rol ?? null, [oameni, utilizator, contractId])
  const potAdministra = eAdmin || (peContract && rolulMeu === 'manager')
  const rolPermis = (rol: string) => eAdmin || rol !== 'director_program'

  async function gata(text: string, cls = 'verde') { setMesaj({ cls, text }); await incarca() }

  async function schimbaRol(om: Om, r: RolOm, rol: string) {
    setLucreaza(true); setMesaj(null)
    const { error } = await supabase.from('roluri_contract').update({ rol }).eq('contract_id', r.contract_id).eq('utilizator_id', om.id)
    setLucreaza(false)
    if (error) return setMesaj({ cls: 'rosu', text: error.message })
    await gata(`${om.nume} are acum rolul „${ROLURI[rol].text}” pe contractul ${r.numar}.`)
  }
  async function scoateRol(om: Om, r: RolOm) {
    if (!window.confirm(`Scoți rolul lui ${om.nume} de pe contractul ${r.numar} (${r.firma})? Nu va mai vedea contractul. Ce a lucrat rămâne în jurnal.`)) return
    setLucreaza(true); setMesaj(null)
    const { error } = await supabase.from('roluri_contract').delete().eq('contract_id', r.contract_id).eq('utilizator_id', om.id)
    setLucreaza(false)
    if (error) return setMesaj({ cls: 'rosu', text: error.message })
    await gata(`${om.nume} nu mai are acces la contractul ${r.numar}.`)
  }
  async function linkNou(om: Om) {
    setLucreaza(true); setMesaj(null); setLink(null)
    const r = await cheamaInvitare<{ link: string }>({ actiune: 'link_nou', utilizator_id: om.id })
    setLucreaza(false)
    if (r.eroare || !r.date?.link) return setMesaj({ cls: 'rosu', text: r.eroare ?? 'Linkul nu a putut fi generat.' })
    setLink({ nume: om.nume, email: om.email, link: r.date.link, nou: !om.ultima_conectare })
  }
  async function activ(om: Om, val: boolean) {
    if (!val && !window.confirm(`Dezactivezi contul lui ${om.nume}? Nu se va mai putea conecta și nu va mai vedea niciun contract. Ce a lucrat rămâne în jurnal; contul se poate reactiva oricând.`)) return
    setLucreaza(true); setMesaj(null)
    const { error } = await supabase.from('utilizatori').update({ activ: val }).eq('id', om.id)
    setLucreaza(false)
    if (error) return setMesaj({ cls: 'rosu', text: error.message })
    await gata(val ? `Contul lui ${om.nume} a fost reactivat.` : `Contul lui ${om.nume} a fost dezactivat.`)
  }
  async function firmaDeBaza(om: Om, org: string) {
    setLucreaza(true); setMesaj(null)
    const { error } = await supabase.from('utilizatori').update({ organizatie_id: org || null }).eq('id', om.id)
    setLucreaza(false)
    if (error) return setMesaj({ cls: 'rosu', text: error.message })
    await gata(`Firma de bază a lui ${om.nume} a fost schimbată.`)
  }

  const inapoi = peContract ? <Link to={`/contract/${contractId}`} className="inapoi">← Tabloul de bord</Link> : <Link to="/admin" className="inapoi">← Administrare</Link>
  if (eroare) return <>{inapoi}<div className="alerta rosu">{eroare}</div></>
  if (!oameni) return <div className="gol">Se încarcă oamenii…</div>

  const neconectati = oameni.filter(o => o.activ && !o.ultima_conectare).length

  return (
    <>
      {inapoi}
      <section className="titlu-pagina">
        <h1>{peContract ? 'Echipa contractului' : 'Utilizatori și roluri'}</h1>
        <p>{peContract
          ? 'Cine are acces la acest contract și cu ce rol. Accesul vine doar din rolul pe contract.'
          : 'Toți oamenii din aplicație și rolurile lor pe fiecare contract. Un om poate lucra pentru mai multe firme: are câte un rol pe fiecare contract.'}</p>
      </section>

      <section className="cifre">
        <div className="cifra accent"><div className="cifra-eticheta">Oameni</div><div className="cifra-valoare mic-v">{oameni.filter(o => o.activ).length}</div><div className="cifra-sub">cu cont activ</div></div>
        <div className="cifra"><div className="cifra-eticheta">Invitați, încă neconectați</div><div className="cifra-valoare mic-v">{neconectati}</div><div className="cifra-sub">nu și-au ales încă parola</div></div>
        <div className="cifra"><div className="cifra-eticheta">Dezactivați</div><div className="cifra-valoare mic-v">{oameni.filter(o => !o.activ).length}</div><div className="cifra-sub">păstrați pentru jurnal</div></div>
      </section>

      {mesaj && <div className={`alerta ${mesaj.cls} spatiu`}>{mesaj.text}</div>}
      {link && <CutieLink {...link} inchide={() => setLink(null)} />}

      {potAdministra && (invit
        ? <section className="bloc"><FormInvitare eAdmin={eAdmin} contractFix={peContract ? contractId! : null} contracte={contracte} firme={firme}
            lucreaza={lucreaza} setLucreaza={setLucreaza} inchide={() => setInvit(false)}
            gata={async (rez) => {
              setInvit(false)
              if (rez.link) setLink({ nume: rez.nume, email: rez.email, link: rez.link, nou: true })
              await gata(rez.existent ? `${rez.nume} avea deja cont în aplicație; a primit rolul pe contract (nu e nevoie de link).` : `Contul lui ${rez.nume} a fost creat. Trimiteți-i linkul de mai sus.`)
            }} /></section>
        : <div className="rand-butoane spatiu"><button className="buton" onClick={() => { setMesaj(null); setLink(null); setInvit(true) }}>+ Invită un om</button></div>)}

      <section className="bloc fara-padding">
        <div className="tabel-wrap">
          <table className="tabel-op">
            <thead><tr><th>Om</th>{!peContract && <th>Firma de bază</th>}<th>{peContract ? 'Rol' : 'Roluri pe contracte'}</th><th>Cont</th><th></th></tr></thead>
            <tbody>
              {oameni.map(om => {
                const eu = om.id === utilizator?.id
                return (
                  <tr key={om.id} className={om.activ ? '' : 'rand-lipsa'}>
                    <td><b>{om.nume}</b>{om.este_admin && <span className="eticheta albastru-e" style={{ marginLeft: 6 }}>administrator</span>}
                      <div className="mic gri">{om.email}{om.telefon ? ` · ${om.telefon}` : ''}</div></td>
                    {!peContract && <td>{eAdmin && !lucreaza
                      ? <select value={om.organizatie_id ?? ''} onChange={e => firmaDeBaza(om, e.target.value)}><option value="">— niciuna —</option>{firme.map(f => <option key={f.id} value={f.id}>{f.denumire}</option>)}</select>
                      : (om.organizatie ?? '—')}</td>}
                    <td>
                      {om.roluri.length === 0 && <span className="gri">{om.este_admin ? 'vede toate contractele (administrator)' : 'niciun rol'}</span>}
                      {om.roluri.map(r => {
                        const poate = potAdministra && om.activ && !eu && rolPermis(r.rol)
                        return (
                          <div key={r.contract_id} className="spatiu-mic">
                            {!peContract && <span className="mic">{r.firma} · {r.numar}: </span>}
                            {poate
                              ? <select value={r.rol} disabled={lucreaza} onChange={e => schimbaRol(om, r, e.target.value)}>
                                  {Object.entries(ROLURI).filter(([k]) => rolPermis(k)).map(([k, x]) => <option key={k} value={k}>{x.text}</option>)}
                                </select>
                              : <span className="eticheta">{ROLURI[r.rol]?.text ?? r.rol}</span>}
                            {poate && <> <button className="buton-text" disabled={lucreaza} onClick={() => scoateRol(om, r)} title="Scoate de pe contract">Scoate</button></>}
                          </div>
                        )
                      })}
                      {!peContract && eAdmin && om.activ && (rolNou === om.id
                        ? <AdaugaRol om={om} contracte={contracte} lucreaza={lucreaza} setLucreaza={setLucreaza} inchide={() => setRolNou(null)}
                            gata={async t => { setRolNou(null); await gata(t) }} eroare={t => setMesaj({ cls: 'rosu', text: t })} />
                        : <div className="spatiu-mic"><button className="buton-text" disabled={lucreaza} onClick={() => setRolNou(om.id)}>+ rol pe un contract</button></div>)}
                    </td>
                    <td className="nowrap">
                      {!om.activ ? <span className="eticheta rosu">dezactivat</span>
                        : om.ultima_conectare ? <><span className="eticheta verde">activ</span><div className="mic gri">ultima conectare {cand(om.ultima_conectare)}</div></>
                        : <><span className="eticheta galben">invitat, neconectat</span><div className="mic gri">invitat {cand(om.invitat_la)}</div></>}
                    </td>
                    <td className="n nowrap">
                      {potAdministra && om.activ && !eu && (eAdmin || !om.ultima_conectare) &&
                        <button className="buton-text" disabled={lucreaza} onClick={() => linkNou(om)} title="Un link nou de setare a parolei">Link nou</button>}
                      {eAdmin && !eu && <> <button className="buton-text" disabled={lucreaza} onClick={() => activ(om, !om.activ)}>{om.activ ? 'Dezactivează' : 'Reactivează'}</button></>}
                    </td>
                  </tr>
                )
              })}
              {oameni.length === 0 && <tr><td colSpan={5} className="gol">Nimeni nu are încă rol pe acest contract.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bloc">
        <div className="bloc-titlu"><h2>Ce poate face fiecare rol</h2></div>
        <ul className="lista-puncte">
          {Object.entries(ROLURI).map(([k, r]) => <li key={k}><b>{r.text}</b>: {r.rost}.</li>)}
          <li><b>Administrator</b> (M.V. Consulting): vede și lucrează pe toate contractele, aprobă bibliotecile și poate numi directori de program.</li>
        </ul>
      </section>

      <p className="nota">
        Invitarea creează contul și dă un link de activare, pe care îl trimiteți omului (butonul de email deschide un mesaj gata scris, sau copiați linkul într-un mesaj).
        Linkul se folosește o singură dată și expiră în aproximativ o oră; dacă a expirat, apăsați „Link nou”. Un om nu se șterge niciodată, pentru că jurnalul trebuie să știe
        cine a făcut fiecare schimbare: se dezactivează și se poate reactiva oricând. {!eAdmin && 'Directorul de program îl numește doar administratorul.'}
      </p>
    </>
  )
}

function CutieLink({ nume, email, link, nou, inchide }: { nume: string; email: string; link: string; nou: boolean; inchide: () => void }) {
  const [copiat, setCopiat] = useState(false)
  const { subiect, corp } = mesajInvitatie(nume, link, nou)
  const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subiect)}&body=${encodeURIComponent(corp)}`
  async function copiaza() {
    try { await navigator.clipboard.writeText(corp); setCopiat(true) } catch { setCopiat(false) }
  }
  return (
    <section className="bloc">
      <div className="bloc-titlu"><h2>Linkul pentru {nume}</h2>
        <p>Trimiteți-l acum: se folosește o singură dată și expiră în aproximativ o oră. Nu îl păstrați și nu îl trimiteți altcuiva — cine are linkul intră în contul lui {nume}.</p></div>
      <textarea readOnly value={corp} rows={7} style={{ width: '100%', fontFamily: 'inherit', fontSize: '0.85rem' }} onFocus={e => e.target.select()} />
      <div className="rand-butoane">
        <a className="buton" href={mailto}>Deschide emailul către {email}</a>
        <button className="buton-text" onClick={copiaza}>{copiat ? 'Copiat ✓' : 'Copiază mesajul'}</button>
        <button className="buton-text" onClick={inchide}>Închide</button>
      </div>
    </section>
  )
}

type RezInvitare = { existent: boolean; link?: string; nume: string; email: string }

function FormInvitare({ eAdmin, contractFix, contracte, firme, lucreaza, setLucreaza, inchide, gata }: {
  eAdmin: boolean; contractFix: string | null; contracte: Contract[]; firme: Firma[]
  lucreaza: boolean; setLucreaza: (b: boolean) => void; inchide: () => void; gata: (r: RezInvitare) => Promise<void>
}) {
  const [v, setV] = useState({ nume: '', email: '', telefon: '', contract: contractFix ?? '', rol: 'responsabil_financiar', firma: '' })
  const [eroare, setEroare] = useState<string | null>(null)
  const set = (k: string, val: string) => setV(x => ({ ...x, [k]: val }))

  async function trimite() {
    setEroare(null)
    if (!v.nume.trim()) return setEroare('Completați numele.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) return setEroare('Adresa de email nu e validă.')
    if (!eAdmin && !v.contract) return setEroare('Alegeți contractul.')
    setLucreaza(true)
    const r = await cheamaInvitare<{ existent: boolean; link?: string }>({
      actiune: 'invita', nume: v.nume.trim(), email: v.email.trim(), telefon: v.telefon.trim() || null,
      contract_id: v.contract || null, rol: v.contract ? v.rol : null, organizatie_id: v.firma || null,
    })
    setLucreaza(false)
    if (r.eroare || !r.date) return setEroare(r.eroare ?? 'Invitația nu a putut fi făcută.')
    await gata({ existent: r.date.existent, link: r.date.link, nume: v.nume.trim(), email: v.email.trim().toLowerCase() })
  }

  return (
    <div className="formular-doc">
      <div className="bloc-titlu"><h2>Invită un om</h2><p>Dacă adresa are deja cont în aplicație, omul primește doar rolul pe contract.</p></div>
      <div className="campuri">
        <label>Nume și prenume<input value={v.nume} onChange={e => set('nume', e.target.value)} /></label>
        <label>Email<input type="email" value={v.email} onChange={e => set('email', e.target.value)} /></label>
        <label>Telefon (opțional)<input value={v.telefon} onChange={e => set('telefon', e.target.value)} /></label>
        {eAdmin && <label>Firma de bază (opțional)<select value={v.firma} onChange={e => set('firma', e.target.value)}>
          <option value="">— niciuna (ex. contabil extern) —</option>{firme.map(f => <option key={f.id} value={f.id}>{f.denumire}</option>)}</select></label>}
        {!contractFix && <label>Contractul{!eAdmin ? '' : ' (opțional)'}<select value={v.contract} onChange={e => set('contract', e.target.value)}>
          {eAdmin && <option value="">— fără rol deocamdată —</option>}
          {contracte.map(c => <option key={c.id} value={c.id}>{c.organizatii?.denumire} · {c.numar_contract}</option>)}</select></label>}
        {v.contract && <label>Rolul<select value={v.rol} onChange={e => set('rol', e.target.value)}>
          {Object.entries(ROLURI).filter(([k]) => eAdmin || k !== 'director_program').map(([k, x]) => <option key={k} value={k}>{x.text}</option>)}</select></label>}
      </div>
      {v.contract && <p className="mic gri">{ROLURI[v.rol]?.text}: {ROLURI[v.rol]?.rost}.</p>}
      {eroare && <div className="alerta rosu">{eroare}</div>}
      <div className="rand-butoane">
        <button className="buton" disabled={lucreaza} onClick={trimite}>{lucreaza ? 'Se creează contul…' : 'Invită'}</button>
        <button className="buton-text" disabled={lucreaza} onClick={inchide}>Renunță</button>
      </div>
    </div>
  )
}

function AdaugaRol({ om, contracte, lucreaza, setLucreaza, inchide, gata, eroare }: {
  om: Om; contracte: Contract[]; lucreaza: boolean; setLucreaza: (b: boolean) => void; inchide: () => void
  gata: (t: string) => Promise<void>; eroare: (t: string) => void
}) {
  const libere = contracte.filter(c => !om.roluri.some(r => r.contract_id === c.id))
  const [c, setC] = useState(libere[0]?.id ?? '')
  const [rol, setRol] = useState('cititor')
  if (!libere.length) return <div className="mic gri spatiu-mic">Are deja rol pe toate contractele. <button className="buton-text" onClick={inchide}>Închide</button></div>
  async function salveaza() {
    setLucreaza(true)
    const { error } = await supabase.from('roluri_contract').insert({ contract_id: c, utilizator_id: om.id, rol })
    setLucreaza(false)
    if (error) return eroare(error.message)
    const k = contracte.find(x => x.id === c)
    await gata(`${om.nume} are acum rolul „${ROLURI[rol].text}” pe contractul ${k?.numar_contract}.`)
  }
  return (
    <div className="spatiu-mic">
      <select value={c} onChange={e => setC(e.target.value)}>{libere.map(x => <option key={x.id} value={x.id}>{x.organizatii?.denumire} · {x.numar_contract}</option>)}</select>{' '}
      <select value={rol} onChange={e => setRol(e.target.value)}>{Object.entries(ROLURI).map(([k, x]) => <option key={k} value={k}>{x.text}</option>)}</select>{' '}
      <button className="buton-text" disabled={lucreaza} onClick={salveaza}>Adaugă</button>{' '}
      <button className="buton-text" disabled={lucreaza} onClick={inchide}>Renunță</button>
    </div>
  )
}

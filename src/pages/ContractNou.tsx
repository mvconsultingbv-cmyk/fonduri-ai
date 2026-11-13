import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth'
import { bani, data, iban as fIban, MOD_CALCUL, num, STARE_CONTRACT, TIP_TRANSA } from '../lib/format'

// Contract nou pentru o firmă client, în pași:
//   1. datele contractului (firma, programul din bibliotecă, număr, valoare, perioadă)
//   2. bugetul pe capitole — pornește din capitolele standard ale programului
//   3. perioadele de raportare   4. conturile bancare   5. tranșele (opțional)
// Contractul stă „în pregătire” cât se completează. Managerul îl trimite spre aprobare; doar administratorul îl pornește.
// Toate verificările (bugetul adună valoarea, perioadele se leagă, programul și regulile lui sunt aprobate…)
// le face baza de date (verifica_contract); ecranul doar le arată.

type Org = { id: string; denumire: string; cui: string | null }
type Prog = { id: string; denumire: string; moneda: string; stare: string }
type Banca = { id: string; denumire: string; cod_iban: string | null }
type Contract = { id: string; organizatie_id: string; program_id: string; numar_contract: string; cod_proiect: string | null; titlu: string; valoare_finantare_eur: number; data_semnare: string | null; data_inceput: string; data_sfarsit: string; stare: string; trimis_la: string | null }
type Poz = { id?: string; capitol: string; cod: string; denumire: string; descriere_eligibilitate: string | null; mod_calcul: string; procent: number | null; ordine: number; suma: string; optional?: boolean; intra_baza_procent: boolean }
type Per = { id: string; numar: number; data_inceput: string; data_sfarsit: string }
type Cont = { id: string; iban: string; moneda: string; denumire: string | null; data_deschidere: string; sold_deschidere: number; banci: { denumire: string } | null }
type Transa = { id: string; numar: number; tip: string; suma_asteptata_eur: number; termen: string | null; conditie: string | null }
type Verif = { nivel: 'blocant' | 'atentie'; zona: string; mesaj: string }

const nr = (s: string) => { const t = String(s ?? '').trim(); if (!t) return 0; return Number(t.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) }
const txt = (v: number | null | undefined) => (v == null ? '' : String(Number(v)).replace('.', ','))
const ziUrm = (d: string) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10) }
const plusLuni = (d: string, n: number) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + n); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10) }
const STARI_EDITABILE = new Set(['in_pregatire'])

export default function ContractNou() {
  const { id } = useParams()
  const nav = useNavigate()
  const { utilizator } = useAuth()
  const admin = !!utilizator?.este_admin_platforma
  const [orgs, setOrgs] = useState<Org[]>([])
  const [progs, setProgs] = useState<Prog[]>([])
  const [banci, setBanci] = useState<Banca[]>([])
  const [c, setC] = useState<Contract | null>(null)
  const [poz, setPoz] = useState<Poz[]>([])
  const [areBuget, setAreBuget] = useState(false)
  const [per, setPer] = useState<Per[]>([])
  const [conturi, setConturi] = useState<Cont[]>([])
  const [transe, setTranse] = useState<Transa[]>([])
  const [verif, setVerif] = useState<Verif[]>([])
  const [incarcat, setIncarcat] = useState(false)
  const [mesaj, setMesaj] = useState<{ cls: string; text: string } | null>(null)
  const [lucreaza, setLucreaza] = useState(false)

  const incarcaSablon = useCallback(async (programId: string) => {
    const { data: cap } = await supabase.from('capitole_program').select('capitol,cod,denumire,descriere_eligibilitate,mod_calcul,procent,ordine,optional,intra_baza_procent').eq('program_id', programId).order('ordine')
    return (cap ?? []).map(x => ({ ...x, suma: '' })) as Poz[]
  }, [])

  const incarca = useCallback(async () => {
    const [o, p, b] = await Promise.all([
      supabase.from('organizatii').select('id,denumire,cui').order('denumire'),
      supabase.from('programe').select('id,denumire,moneda,stare').neq('stare', 'retrasa').order('denumire'),
      supabase.from('banci').select('id,denumire,cod_iban').neq('stare', 'retrasa').order('denumire'),
    ])
    setOrgs((o.data ?? []) as Org[]); setProgs((p.data ?? []) as Prog[]); setBanci((b.data ?? []) as Banca[])
    if (id) {
      const [k, z, r, n, t, v] = await Promise.all([
        supabase.from('contracte').select('id,organizatie_id,program_id,numar_contract,cod_proiect,titlu,valoare_finantare_eur,data_semnare,data_inceput,data_sfarsit,stare,trimis_la').eq('id', id).maybeSingle(),
        supabase.from('pozitii_buget').select('id,capitol,cod,denumire,descriere_eligibilitate,mod_calcul,procent,ordine,suma_initiala_eur,intra_baza_procent').eq('contract_id', id).order('ordine'),
        supabase.from('perioade_raportare').select('id,numar,data_inceput,data_sfarsit').eq('contract_id', id).order('numar'),
        supabase.from('conturi').select('id,iban,moneda,denumire,data_deschidere,sold_deschidere,banci(denumire)').eq('contract_id', id).order('creat_la'),
        supabase.from('transe').select('id,numar,tip,suma_asteptata_eur,termen,conditie').eq('contract_id', id).order('numar'),
        supabase.rpc('verifica_contract', { p_contract: id }),
      ])
      const kc = k.data as Contract | null
      setC(kc)
      const zz = (z.data ?? []) as (Poz & { suma_initiala_eur: number })[]
      setAreBuget(zz.length > 0)
      setPoz(zz.length ? zz.map(x => ({ ...x, suma: txt(x.suma_initiala_eur) })) : kc ? await incarcaSablon(kc.program_id) : [])
      setPer((r.data ?? []) as Per[]); setConturi((n.data ?? []) as unknown as Cont[]); setTranse((t.data ?? []) as Transa[]); setVerif((v.data ?? []) as Verif[])
    }
    setIncarcat(true)
  }, [id, incarcaSablon])
  useEffect(() => { incarca() }, [incarca])

  const prog = progs.find(p => p.id === c?.program_id)
  const moneda = prog?.moneda?.trim() || 'EUR'
  const editabil = !c || STARI_EDITABILE.has(c.stare) || (admin && c.stare === 'trimis')
  const blocante = verif.filter(v => v.nivel === 'blocant')
  const blocanteFaraProgram = blocante.filter(v => v.zona !== 'Program')

  async function executa(op: PromiseLike<{ error: { message: string } | null }>, text: string) {
    setMesaj(null); setLucreaza(true)
    const { error } = await op
    setLucreaza(false)
    if (error) { setMesaj({ cls: 'rosu', text: error.message }); return false }
    setMesaj({ cls: 'verde', text }); await incarca(); return true
  }

  async function renunta() {
    if (!c || !confirm('Ștergeți acest contract în pregătire, cu bugetul, perioadele, conturile și tranșele lui? Ștergerea rămâne în jurnal.')) return
    setLucreaza(true)
    const e1 = await supabase.from('conturi').delete().eq('contract_id', c.id)
    const e2 = e1.error ? e1 : await supabase.from('contracte').delete().eq('id', c.id)
    setLucreaza(false)
    if (e2.error) { setMesaj({ cls: 'rosu', text: e2.error.message.includes('extrase') || e2.error.code === '23503' ? 'Contractul are deja extrase încărcate; nu se mai șterge.' : e2.error.message }); return }
    nav('/')
  }

  if (!incarcat) return <div className="gol">Se încarcă…</div>
  if (id && !c) return <><Link to="/" className="inapoi">← Contracte</Link><div className="alerta rosu">Contractul nu există sau nu aveți acces la el.</div></>
  if (c && !['in_pregatire', 'trimis'].includes(c.stare)) return <><Link to="/" className="inapoi">← Contracte</Link><div className="alerta albastru">Contractul e deja pornit. <Link to={`/contract/${c.id}`}>Deschideți tabloul de bord →</Link></div></>

  return (
    <>
      <Link to="/" className="inapoi">← Contracte</Link>
      <section className="titlu-pagina">
        <h1>{c ? `Contract ${c.numar_contract}` : 'Contract nou'} {c && <span className={`stare stare-${c.stare}`}>{STARE_CONTRACT[c.stare]}</span>}</h1>
        <p>{c ? `${orgs.find(o => o.id === c.organizatie_id)?.denumire ?? ''} · ${prog?.denumire ?? ''}` : 'Participarea unei firme client la un program de finanțare. Se completează în pași; contractul pornește după aprobarea administratorului.'}</p>
      </section>
      {mesaj && <div className={`alerta ${mesaj.cls}`}>{mesaj.text}</div>}
      {c?.stare === 'trimis' && <div className="alerta albastru">Trimis spre aprobare pe {data(c.trimis_la)}. {admin ? 'Verificați datele și porniți contractul de la pasul 6.' : 'Până la aprobare nu se mai modifică; dacă trebuie corectat ceva, retrageți-l de la pasul 6.'}</div>}

      <Pas n={1} titlu="Datele contractului" gata={!!c}>
        <FormDate c={c} orgs={orgs} progs={progs} editabil={editabil} admin={admin} lucreaza={lucreaza}
          salveaza={async v => {
            if (c) { await executa(supabase.from('contracte').update(v).eq('id', c.id), 'Datele contractului au fost salvate.'); return }
            setMesaj(null); setLucreaza(true)
            const { data: d, error } = await supabase.from('contracte').insert(v).select('id').single()
            setLucreaza(false)
            if (error) { setMesaj({ cls: 'rosu', text: error.code === '23505' ? 'Firma are deja un contract cu acest număr.' : error.code === '42501' ? 'Nu puteți introduce un contract pentru această firmă.' : error.message }); return }
            nav(`/contract-nou/${d.id}`, { replace: true })
          }} />
      </Pas>

      {c && <>
        <Pas n={2} titlu="Bugetul pe capitole" gata={areBuget && !verif.some(v => v.zona === 'Buget' && v.nivel === 'blocant')}>
          <Buget poz={poz} setPoz={setPoz} areBuget={areBuget} valoare={Number(c.valoare_finantare_eur)} moneda={moneda} editabil={editabil} lucreaza={lucreaza}
            salveaza={async () => {
              const randuri = poz.filter(x => !(x.optional && !x.id && nr(x.suma) === 0))
              setMesaj(null); setLucreaza(true)
              for (const x of randuri) {
                const r = { capitol: x.capitol, cod: x.cod, denumire: x.denumire, descriere_eligibilitate: x.descriere_eligibilitate, mod_calcul: x.mod_calcul, procent: x.procent, ordine: x.ordine, intra_baza_procent: x.intra_baza_procent, suma_initiala_eur: nr(x.suma) }
                const { error } = x.id ? await supabase.from('pozitii_buget').update(r).eq('id', x.id) : await supabase.from('pozitii_buget').insert({ ...r, contract_id: c.id })
                if (error) { setLucreaza(false); setMesaj({ cls: 'rosu', text: `Capitolul ${x.cod}: ${error.message}` }); return }
              }
              setLucreaza(false); setMesaj({ cls: 'verde', text: 'Bugetul a fost salvat.' }); await incarca()
            }}
            refaDinSablon={async () => {
              if (!confirm('Ștergeți capitolele de acum și porniți din nou de la capitolele standard ale programului?')) return
              if (await executa(supabase.from('pozitii_buget').delete().eq('contract_id', c.id), 'Bugetul a fost golit; completați sumele pe capitolele standard.')) setPoz(await incarcaSablon(c.program_id))
            }} />
        </Pas>

        <Pas n={3} titlu="Perioadele de raportare" gata={per.length > 0 && !verif.some(v => v.zona === 'Perioade' && v.nivel === 'blocant')}>
          <Perioade per={per} c={c} editabil={editabil} lucreaza={lucreaza}
            adauga={(rows) => executa(supabase.from('perioade_raportare').insert(rows.map(r => ({ ...r, contract_id: c.id }))), rows.length > 1 ? `Au fost adăugate ${rows.length} perioade.` : 'Perioada a fost adăugată.')}
            sterge={pid => executa(supabase.from('perioade_raportare').delete().eq('id', pid), 'Perioada a fost ștearsă.')} />
        </Pas>

        <Pas n={4} titlu="Conturile bancare ale proiectului" gata={conturi.length > 0}>
          <Conturi conturi={conturi} banci={banci} c={c} moneda={moneda} editabil={editabil} lucreaza={lucreaza}
            adauga={r => executa(supabase.from('conturi').insert({ ...r, contract_id: c.id }), 'Contul a fost adăugat.')}
            sterge={cid => executa(supabase.from('conturi').delete().eq('id', cid), 'Contul a fost scos.')} />
        </Pas>

        <Pas n={5} titlu="Tranșele de finanțare (opțional)" gata={transe.length > 0}>
          <Transe transe={transe} moneda={moneda} editabil={editabil} lucreaza={lucreaza}
            adauga={r => executa(supabase.from('transe').insert({ ...r, contract_id: c.id, numar: (transe.at(-1)?.numar ?? 0) + 1 }), 'Tranșa a fost adăugată.')}
            sterge={tid => executa(supabase.from('transe').delete().eq('id', tid), 'Tranșa a fost ștearsă.')} />
        </Pas>

        <Pas n={6} titlu={admin ? 'Verificare și pornire' : 'Verificare și trimitere spre aprobare'} gata={blocante.length === 0}>
          {verif.length === 0 && <div className="alerta verde">Totul e în regulă.</div>}
          {verif.length > 0 && (
            <ul className="verificari">
              {verif.map((v, i) => <li key={i}><span className={`eticheta ${v.nivel === 'blocant' ? 'rosu' : 'galben'}`}>{v.nivel === 'blocant' ? 'de rezolvat' : 'atenție'}</span> <b>{v.zona}:</b> {v.mesaj}</li>)}
            </ul>
          )}
          {blocante.some(v => v.zona === 'Program') && <p className="mic gri">Programul și regulile lui le aprobă M.V. Consulting în biblioteca de programe. Contractul se poate pregăti și trimite între timp; pornește după aprobare.{admin && <> <Link to="/admin/programe">Deschide biblioteca →</Link></>}</p>}
          <div className="rand-butoane">
            {c.stare === 'in_pregatire' && !admin && <button className="buton" disabled={lucreaza || blocanteFaraProgram.length > 0} onClick={() => executa(supabase.from('contracte').update({ stare: 'trimis' }).eq('id', c.id), 'Contractul a fost trimis spre aprobare la M.V. Consulting.')}>Trimite spre aprobare</button>}
            {c.stare === 'trimis' && <button className="buton-text" disabled={lucreaza} onClick={() => executa(supabase.from('contracte').update({ stare: 'in_pregatire' }).eq('id', c.id), admin ? 'Contractul a fost întors în pregătire.' : 'Contractul a fost retras; îl puteți modifica.')}>{admin ? 'Întoarce în pregătire' : 'Retrage pentru modificări'}</button>}
            {admin && <button className="buton" disabled={lucreaza || blocante.length > 0} onClick={async () => { if (await executa(supabase.from('contracte').update({ stare: 'activ' }).eq('id', c.id), 'Contractul a pornit.')) nav(`/contract/${c.id}`) }}>Pornește contractul</button>}
            {c.stare === 'in_pregatire' && <button className="buton-text" disabled={lucreaza} onClick={renunta}>Renunță la contract</button>}
          </div>
          <p className="nota">După pornire: bugetul inițial nu se mai schimbă direct (mutările și actele adiționale trec prin Modificări de buget), iar programul, valoarea și perioada le schimbă doar administratorul. Oamenii se adaugă din Echipa contractului.</p>
        </Pas>
      </>}
    </>
  )
}

function Pas({ n, titlu, gata, children }: { n: number; titlu: string; gata: boolean; children: React.ReactNode }) {
  return (
    <section className="bloc">
      <div className="bloc-titlu"><h2><span className={`eticheta ${gata ? 'verde' : 'gri-e'}`}>{gata ? '✓' : n}</span> {titlu}</h2></div>
      {children}
    </section>
  )
}

type VDate = { organizatie_id: string; program_id: string; numar_contract: string; cod_proiect: string | null; titlu: string; valoare_finantare_eur: number; data_semnare: string | null; data_inceput: string; data_sfarsit: string }
function FormDate({ c, orgs, progs, editabil, admin, lucreaza, salveaza }: { c: Contract | null; orgs: Org[]; progs: Prog[]; editabil: boolean; admin: boolean; lucreaza: boolean; salveaza: (v: VDate) => Promise<void> }) {
  const [v, setV] = useState({
    organizatie_id: c?.organizatie_id ?? (orgs.length === 1 ? orgs[0].id : ''), program_id: c?.program_id ?? '', numar_contract: c?.numar_contract ?? '', cod_proiect: c?.cod_proiect ?? '',
    titlu: c?.titlu ?? '', valoare: txt(c?.valoare_finantare_eur), data_semnare: c?.data_semnare ?? '', data_inceput: c?.data_inceput ?? '', data_sfarsit: c?.data_sfarsit ?? '',
  })
  const [eroare, setEroare] = useState<string | null>(null)
  const set = (k: string, x: string) => setV(o => ({ ...o, [k]: x }))
  const pr = progs.find(p => p.id === v.program_id)
  async function trimite() {
    setEroare(null)
    if (!v.organizatie_id || !v.program_id) return setEroare('Alegeți firma și programul.')
    if (!v.numar_contract.trim() || !v.titlu.trim()) return setEroare('Completați numărul și titlul contractului.')
    const val = nr(v.valoare)
    if (!(val > 0)) return setEroare('Completați valoarea finanțării.')
    if (!v.data_inceput || !v.data_sfarsit || v.data_sfarsit <= v.data_inceput) return setEroare('Completați perioada contractului (sfârșitul după început).')
    await salveaza({ organizatie_id: v.organizatie_id, program_id: v.program_id, numar_contract: v.numar_contract.trim(), cod_proiect: v.cod_proiect.trim() || null, titlu: v.titlu.trim(),
      valoare_finantare_eur: Math.round(val * 100) / 100, data_semnare: v.data_semnare || null, data_inceput: v.data_inceput, data_sfarsit: v.data_sfarsit })
  }
  return (
    <div className="formular-doc">
      <div className="campuri">
        <label>Firma client
          <select value={v.organizatie_id} disabled={!editabil || (!!c && !admin)} onChange={e => set('organizatie_id', e.target.value)}>
            <option value="">— alegeți —</option>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.denumire}{o.cui ? ` (CUI ${o.cui})` : ''}</option>)}
          </select></label>
        <label>Programul de finanțare
          <select value={v.program_id} disabled={!editabil || !!c} onChange={e => set('program_id', e.target.value)}>
            <option value="">— alegeți —</option>
            {progs.map(p => <option key={p.id} value={p.id}>{p.denumire}{p.stare !== 'aprobata' ? ' (neaprobat încă)' : ''}</option>)}
          </select></label>
        <label>Numărul contractului<input value={v.numar_contract} disabled={!editabil} onChange={e => set('numar_contract', e.target.value)} /></label>
        <label>Cod scurt al proiectului<input value={v.cod_proiect} disabled={!editabil} onChange={e => set('cod_proiect', e.target.value)} placeholder="ex. HEAT" /></label>
        <label className="lat2">Titlul<input value={v.titlu} disabled={!editabil} onChange={e => set('titlu', e.target.value)} /></label>
        <label>Valoarea finanțării ({pr?.moneda?.trim() || 'moneda programului'})<input value={v.valoare} disabled={!editabil} onChange={e => set('valoare', e.target.value)} /></label>
        <label>Data semnării<input type="date" value={v.data_semnare} disabled={!editabil} onChange={e => set('data_semnare', e.target.value)} /></label>
        <label>Începe la<input type="date" value={v.data_inceput} disabled={!editabil} onChange={e => set('data_inceput', e.target.value)} /></label>
        <label>Se termină la<input type="date" value={v.data_sfarsit} disabled={!editabil} onChange={e => set('data_sfarsit', e.target.value)} /></label>
      </div>
      {!c && orgs.length === 0 && <div className="alerta galben">Nu lucrați încă pentru nicio firmă client. {admin ? <Link to="/admin/firme">Adăugați întâi firma →</Link> : 'Cereți acces de la M.V. Consulting.'}</div>}
      {pr && pr.stare !== 'aprobata' && <div className="alerta galben">Programul {pr.denumire} nu e încă aprobat în bibliotecă. Contractul se poate pregăti, dar pornește abia după aprobare.</div>}
      {c && !admin && <p className="mic gri">Programul și firma nu se mai schimbă după primul pas. Dacă ați greșit, renunțați la contract și introduceți-l din nou.</p>}
      {eroare && <div className="alerta rosu">{eroare}</div>}
      {editabil && <div className="rand-butoane"><button className="buton" disabled={lucreaza} onClick={trimite}>{lucreaza ? 'Se salvează…' : c ? 'Salvează' : 'Salvează și continuă'}</button></div>}
    </div>
  )
}

function Buget({ poz, setPoz, areBuget, valoare, moneda, editabil, lucreaza, salveaza, refaDinSablon }: {
  poz: Poz[]; setPoz: (p: Poz[]) => void; areBuget: boolean; valoare: number; moneda: string; editabil: boolean; lucreaza: boolean; salveaza: () => Promise<void>; refaDinSablon: () => Promise<void>
}) {
  const baza = useMemo(() => poz.filter(x => x.mod_calcul !== 'procent' && x.intra_baza_procent).reduce((s, x) => s + nr(x.suma), 0), [poz])
  const total = useMemo(() => poz.reduce((s, x) => s + nr(x.suma), 0), [poz])
  const dif = Math.round((valoare - total) * 100) / 100
  const set = (i: number, s: string) => setPoz(poz.map((x, j) => (j === i ? { ...x, suma: s } : x)))
  const bifa = (i: number, b: boolean) => setPoz(poz.map((x, j) => (j === i ? { ...x, intra_baza_procent: b } : x)))
  const arePct = poz.some(x => x.mod_calcul === 'procent')
  const calculeaza = () => setPoz(poz.map(x => (x.mod_calcul === 'procent' && x.procent ? { ...x, suma: txt(Math.round(baza * x.procent) / 100) } : x)))
  if (poz.length === 0) return <div className="alerta galben">Programul nu are încă capitole standard în bibliotecă. Administratorul le adaugă în Biblioteca de programe.</div>
  return (
    <>
      {!areBuget && <p className="mic gri">Capitolele vin din biblioteca programului. Completați sumele din bugetul aprobat (anexa la contract); capitolele opționale lăsate goale nu se adaugă.</p>}
      <div className="tabel-wrap">
        <table className="tabel-op">
          <thead><tr><th>Cod</th><th>Capitol</th><th>Cum se justifică</th><th className="n">Suma ({moneda})</th></tr></thead>
          <tbody>
            {poz.map((x, i) => (
              <tr key={x.id ?? x.cod}>
                <td className="mono"><b>{x.cod}</b></td>
                <td>{x.denumire}{x.optional && !x.id && <span className="eticheta gri-e">opțional</span>}{x.descriere_eligibilitate && <div className="mic gri">{x.descriere_eligibilitate}</div>}</td>
                <td className="nowrap">{MOD_CALCUL[x.mod_calcul]}{x.procent != null && ` (${txt(x.procent)}%)`}
                  {arePct && x.mod_calcul !== 'procent' && <label className="mic gri" style={{ display: 'block' }}><input type="checkbox" checked={x.intra_baza_procent} disabled={!editabil} onChange={e => bifa(i, e.target.checked)} /> în baza indirectelor</label>}</td>
                <td className="n"><input style={{ width: 130, textAlign: 'right' }} value={x.suma} disabled={!editabil} onChange={e => set(i, e.target.value)} placeholder="0" /></td>
              </tr>
            ))}
            <tr className="rand-total"><td colSpan={3}>Total capitole · valoarea contractului {bani(valoare, moneda)}</td><td className={`n ${dif === 0 ? 'verde-text' : 'rosu-text'}`}>{num(total)}</td></tr>
          </tbody>
        </table>
      </div>
      {dif !== 0 && <div className="alerta galben">Mai sunt de împărțit {bani(dif, moneda)} {dif < 0 ? '(capitolele depășesc valoarea)' : ''}. Capitolele trebuie să adune exact valoarea contractului.</div>}
      {editabil && <div className="rand-butoane" style={{ marginTop: 10 }}>
        <button className="buton" disabled={lucreaza} onClick={salveaza}>Salvează bugetul</button>
        {poz.some(x => x.mod_calcul === 'procent') && <button className="buton-text" onClick={calculeaza}>Calculează capitolele procentuale</button>}
        {areBuget && <button className="buton-text" disabled={lucreaza} onClick={refaDinSablon}>Pornește din nou de la capitolele programului</button>}
      </div>}
      {poz.some(x => x.mod_calcul === 'procent') && <p className="nota">„Calculează” aplică procentul la capitolele bifate „în baza indirectelor” (acum {bani(baza, moneda)}). Bifele vin din biblioteca programului (la Horizon, subcontractarea B și sprijinul către terți D.1 nu intră în bază); le puteți schimba dacă contractul spune altfel.</p>}
    </>
  )
}

function Perioade({ per, c, editabil, lucreaza, adauga, sterge }: { per: Per[]; c: Contract; editabil: boolean; lucreaza: boolean; adauga: (r: { numar: number; data_inceput: string; data_sfarsit: string }[]) => Promise<boolean>; sterge: (id: string) => Promise<boolean> }) {
  const urm = per.length ? ziUrm(per.at(-1)!.data_sfarsit) : c.data_inceput
  const [v, setV] = useState({ inceput: urm, sfarsit: '' })
  const [luni, setLuni] = useState('18')
  useEffect(() => setV({ inceput: urm, sfarsit: '' }), [urm])
  const genereaza = () => {
    const n = Number(luni); if (!(n > 0)) return
    const rows: { numar: number; data_inceput: string; data_sfarsit: string }[] = []
    let s = c.data_inceput, k = 1
    while (s <= c.data_sfarsit && k <= 40) { let e = plusLuni(s, n); if (e > c.data_sfarsit) e = c.data_sfarsit; rows.push({ numar: k++, data_inceput: s, data_sfarsit: e }); s = ziUrm(e) }
    adauga(rows)
  }
  return (
    <>
      {per.length > 0 && <table className="tabel-op"><thead><tr><th>Perioada</th><th>De la</th><th>Până la</th><th></th></tr></thead><tbody>
        {per.map(p => <tr key={p.id}><td>P{p.numar}</td><td>{data(p.data_inceput)}</td><td>{data(p.data_sfarsit)}</td><td className="n">{editabil && p === per.at(-1) && <button className="buton-text" disabled={lucreaza} onClick={() => sterge(p.id)}>Șterge</button>}</td></tr>)}
      </tbody></table>}
      {editabil && per.length === 0 && <div className="rand-butoane" style={{ margin: '8px 0' }}>
        <span>Împarte durata contractului în perioade de</span><input style={{ width: 60 }} value={luni} onChange={e => setLuni(e.target.value)} /><span>luni</span>
        <button className="buton" disabled={lucreaza} onClick={genereaza}>Generează</button>
      </div>}
      {editabil && urm <= c.data_sfarsit && <div className="rand-butoane" style={{ marginTop: 8 }}>
        <span>{per.length ? 'Adaugă perioada următoare' : 'Sau una câte una'}: de la</span><input type="date" value={v.inceput} onChange={e => setV({ ...v, inceput: e.target.value })} />
        <span>până la</span><input type="date" value={v.sfarsit} onChange={e => setV({ ...v, sfarsit: e.target.value })} />
        <button className="buton-text" disabled={lucreaza || !v.sfarsit} onClick={() => adauga([{ numar: (per.at(-1)?.numar ?? 0) + 1, data_inceput: v.inceput, data_sfarsit: v.sfarsit }])}>Adaugă</button>
      </div>}
      <p className="nota">Perioadele din contract (la Horizon, de regulă 18 luni). Fiecare raport la finanțator acoperă o perioadă.</p>
    </>
  )
}

function Conturi({ conturi, banci, c, moneda, editabil, lucreaza, adauga, sterge }: { conturi: Cont[]; banci: Banca[]; c: Contract; moneda: string; editabil: boolean; lucreaza: boolean; adauga: (r: object) => Promise<boolean>; sterge: (id: string) => Promise<boolean> }) {
  const [v, setV] = useState({ iban: '', moneda, banca_id: '', denumire: '', data_deschidere: c.data_inceput, sold: '' })
  const [eroare, setEroare] = useState<string | null>(null)
  const set = (k: string, x: string) => setV(o => ({ ...o, [k]: x }))
  // banca se recunoaște din IBAN (RO: caracterele 5–8), după codurile din Biblioteca de bănci
  const ibCurat = v.iban.replace(/\s/g, '').toUpperCase()
  const recunoscuta = ibCurat.startsWith('RO') && ibCurat.length >= 8 ? banci.find(b => b.cod_iban === ibCurat.slice(4, 8)) : undefined
  async function trimite() {
    setEroare(null)
    const ib = v.iban.replace(/\s/g, '').toUpperCase()
    if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(ib)) return setEroare('IBAN-ul nu pare corect (ex. RO49 AAAA 1B31 0075 9384 0000).')
    if (!v.banca_id && !recunoscuta) return setEroare(ib.startsWith('RO') ? `Banca cu codul ${ib.slice(4, 8)} nu e încă în biblioteca de bănci. Cereți-i lui M.V. Consulting să o adauge.` : 'Alegeți banca.')
    if (await adauga({ iban: ib, moneda: v.moneda.trim().toUpperCase(), banca_id: v.banca_id || recunoscuta?.id, denumire: v.denumire.trim() || null, data_deschidere: v.data_deschidere, sold_deschidere: nr(v.sold) }))
      setV(o => ({ ...o, iban: '', denumire: '', sold: '' }))
  }
  return (
    <>
      {conturi.length > 0 && <table className="tabel-op"><thead><tr><th>IBAN</th><th>Monedă</th><th>Banca</th><th>Din</th><th className="n">Sold la deschidere</th><th></th></tr></thead><tbody>
        {conturi.map(k => <tr key={k.id}><td className="mono">{fIban(k.iban)}{k.denumire && <div className="mic gri">{k.denumire}</div>}</td><td>{k.moneda}</td><td>{k.banci?.denumire}</td><td>{data(k.data_deschidere)}</td><td className="n">{num(k.sold_deschidere)}</td>
          <td className="n">{editabil && <button className="buton-text" disabled={lucreaza} onClick={() => sterge(k.id)}>Scoate</button>}</td></tr>)}
      </tbody></table>}
      {editabil && <div className="formular-doc" style={{ marginTop: 10 }}>
        <div className="campuri">
          <label className="lat2">IBAN<input value={v.iban} onChange={e => set('iban', e.target.value)} /></label>
          <label>Moneda<select value={v.moneda} onChange={e => set('moneda', e.target.value)}>{[...new Set([moneda, 'EUR', 'RON'])].map(m => <option key={m}>{m}</option>)}</select></label>
          <label>Banca<select value={v.banca_id} onChange={e => set('banca_id', e.target.value)}><option value="">{recunoscuta ? `${recunoscuta.denumire} (din IBAN)` : '— din IBAN / alegeți —'}</option>{banci.map(b => <option key={b.id} value={b.id}>{b.denumire}</option>)}</select></label>
          <label>Folosit pentru proiect din<input type="date" value={v.data_deschidere} onChange={e => set('data_deschidere', e.target.value)} /></label>
          <label>Sold în acea zi<input value={v.sold} onChange={e => set('sold', e.target.value)} placeholder="0" /></label>
          <label className="lat2">Denumire (opțional)<input value={v.denumire} onChange={e => set('denumire', e.target.value)} placeholder="ex. cont EUR proiect" /></label>
        </div>
        {eroare && <div className="alerta rosu">{eroare}</div>}
        <div className="rand-butoane"><button className="buton-text" disabled={lucreaza} onClick={trimite}>+ Adaugă contul</button></div>
      </div>}
      <p className="nota">De regulă un cont în moneda programului, în care vin banii de la finanțator, și unul în lei pentru plățile din țară. Deocamdată aplicația citește extrase doar de la BCR; celelalte bănci vin cu biblioteca de bănci.</p>
    </>
  )
}

function Transe({ transe, moneda, editabil, lucreaza, adauga, sterge }: { transe: Transa[]; moneda: string; editabil: boolean; lucreaza: boolean; adauga: (r: object) => Promise<boolean>; sterge: (id: string) => Promise<boolean> }) {
  const [v, setV] = useState({ tip: transe.length ? 'intermediara' : 'prefinantare', suma: '', termen: '', conditie: '' })
  const set = (k: string, x: string) => setV(o => ({ ...o, [k]: x }))
  return (
    <>
      {transe.length > 0 && <table className="tabel-op"><thead><tr><th>Nr.</th><th>Tip</th><th className="n">Suma</th><th>Termen</th><th>Condiție</th><th></th></tr></thead><tbody>
        {transe.map(t => <tr key={t.id}><td>{t.numar}</td><td>{TIP_TRANSA[t.tip]}</td><td className="n">{bani(t.suma_asteptata_eur, moneda)}</td><td>{data(t.termen)}</td><td className="mic">{t.conditie}</td>
          <td className="n">{editabil && <button className="buton-text" disabled={lucreaza} onClick={() => sterge(t.id)}>Șterge</button>}</td></tr>)}
      </tbody></table>}
      {editabil && <div className="rand-butoane" style={{ marginTop: 8 }}>
        <select value={v.tip} onChange={e => set('tip', e.target.value)}>{Object.entries(TIP_TRANSA).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
        <input style={{ width: 120 }} value={v.suma} onChange={e => set('suma', e.target.value)} placeholder={`suma ${moneda}`} />
        <input type="date" value={v.termen} onChange={e => set('termen', e.target.value)} />
        <input style={{ minWidth: 200 }} value={v.conditie} onChange={e => set('conditie', e.target.value)} placeholder="condiția (ex. după raportul P1)" />
        <button className="buton-text" disabled={lucreaza || !(nr(v.suma) > 0)} onClick={async () => { if (await adauga({ tip: v.tip, suma_asteptata_eur: nr(v.suma), termen: v.termen || null, conditie: v.conditie.trim() || null })) setV({ tip: 'intermediara', suma: '', termen: '', conditie: '' }) }}>+ Adaugă</button>
      </div>}
      <p className="nota">Ce urmează să primească firma de la finanțator. Se pot adăuga și după pornire, în ecranul Tranșe de finanțare.</p>
    </>
  )
}

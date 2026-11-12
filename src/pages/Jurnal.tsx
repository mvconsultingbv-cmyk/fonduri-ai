import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { data, num } from '../lib/format'

// Jurnal: cine a schimbat ce și când — pentru audit.
//  - Baza de date scrie singură în jurnal fiecare adăugare, modificare și ștergere din tabelele importante,
//    cu autorul și momentul. Jurnalul nu se poate modifica sau șterge, de nimeni.
//  - Ecranul doar citește, prin funcția jurnal_contract, care verifică accesul la contract.
//  - La o modificare se arată doar câmpurile schimbate, cu valoarea veche și cea nouă.
//  - Fără contract (în Administrare): modificările din biblioteci (programe, bănci, utilizatori), doar pentru administrator.

type Rand = {
  id: number; moment: string; utilizator_id: string | null; utilizator_nume: string | null; tabel: string
  inregistrare_id: string; actiune: 'INSERT' | 'UPDATE' | 'DELETE'
  schimbari: Record<string, [unknown, unknown]> | null; date: Record<string, unknown> | null; total: number
}
type Filtre = { utilizatori: { id: string; nume: string | null; n: number }[]; sistem: number; tabele: { tabel: string; n: number }[]; prima: string | null; ultima: string | null }
type Harti = Record<string, Map<string, string>>

const PE_PAGINA = 100

// Unde se vede în aplicație fiecare tip de date (eticheta și ecranul)
const UNDE: Record<string, [string, string | null]> = {
  operatiuni: ['Operațiuni bancare', 'operatiuni'],
  decontari: ['Alocări pe capitole', 'operatiuni'],
  cheltuieli_indirecte: ['Cheltuieli indirecte', 'operatiuni'],
  extrase: ['Extrase de cont', 'extrase'],
  conturi: ['Conturi bancare', 'extrase'],
  schimburi_valutare: ['Schimburi valutare', 'schimburi'],
  alocari_lei: ['Lei folosiți din schimburi', 'schimburi'],
  transferuri_interne: ['Transferuri între conturi', 'transferuri'],
  avansuri_numerar: ['Avansuri de numerar', 'numerar'],
  justificari_avans: ['Justificări de avans', 'numerar'],
  documente: ['Facturi și documente', 'documente'],
  reconcilieri: ['Potriviri factură–plată', 'documente'],
  organizatii_tva: ['Statut TVA', 'documente'],
  persoane_proiect: ['Personal', 'personal'],
  luni_personal: ['Luni de salariu', 'personal'],
  personal_plati: ['Plăți de salarii și taxe', 'personal'],
  echipamente: ['Echipamente', 'echipamente'],
  echipamente_plati: ['Plăți de echipamente', 'echipamente'],
  contrapartide: ['Furnizori și beneficiari', 'contrapartide'],
  transe: ['Tranșe de finanțare', 'transe'],
  modificari_buget: ['Modificări de buget', 'buget'],
  modificari_buget_linii: ['Linii de modificare de buget', 'buget'],
  pozitii_buget: ['Bugetul inițial', 'buget'],
  perioade_raportare: ['Perioade de raportare', 'raportare'],
  contracte: ['Datele contractului', ''],
  roluri_contract: ['Roluri pe contract', null],
  exceptii_contract: ['Excepții de la regulile programului', null],
  programe: ['Programe de finanțare', null],
  reguli_program: ['Regulile programelor', null],
  banci: ['Bănci', null],
  formate_extras: ['Formate de extras', null],
  utilizatori: ['Utilizatori', null],
  organizatii: ['Firme', null],
}
const unde = (t: string) => UNDE[t]?.[0] ?? t.replace(/_/g, ' ')

const ACTIUNE: Record<string, [string, string]> = {
  INSERT: ['Adăugare', 'verde'], UPDATE: ['Modificare', 'galben'], DELETE: ['Ștergere', 'rosu'],
}

// Denumiri pe înțeles pentru câmpuri (restul: numele câmpului, cu spații)
const CAMP: Record<string, string> = {
  tip_confirmat: 'tipul confirmat', tip_propus: 'tipul propus', aferenta_proiect: 'aferentă proiectului', contrapartida_id: 'furnizor / beneficiar',
  motiv_cont_propriu: 'motivul (cont propriu)', restituie_operatiune_id: 'restituie plata', plata_identica_verificata: 'plată dublă verificată',
  operatiune_parinte_id: 'comision la plata', pozitie_buget_id: 'capitolul', pozitie_id: 'capitolul', perioada_id: 'perioada', stare: 'starea',
  suma: 'suma', suma_totala: 'suma totală', suma_tva: 'TVA', tva_deductibila: 'TVA deductibilă', motiv: 'motivul', propusa_de: 'propusă de',
  aprobat_de: 'aprobat de', aprobat_la: 'aprobat la', respins_de: 'respins de', respins_la: 'respins la', motiv_respingere: 'motivul respingerii',
  propus_de: 'propus de', creat_de: 'introdus de', storneaza_id: 'stornează', stornat_la: 'stornat la', data_operatiune: 'data', data_document: 'data documentului',
  data_scadenta: 'scadența', furnizor_id: 'furnizor', furnizor_denumire: 'furnizor', furnizor_cui: 'CUI furnizor', numar: 'numărul', descriere: 'descrierea',
  denumire: 'denumirea', nume: 'numele', cui: 'CUI', parte_legata: 'parte legată', observatii: 'observații', confirmat: 'confirmat', zile_proiect: 'zile pe proiect',
  fractie_luna: 'fracția din lună', salariu_brut: 'salariu brut', salariu_net: 'salariu net', contributii_angajator: 'contribuții angajator',
  contributii_angajat: 'contribuții angajat', impozit: 'impozit', exclusiv_pe_proiect: 'exclusiv pe proiect', conditie: 'condiția', termen: 'termenul',
  suma_asteptata_eur: 'suma așteptată', operatiune_id: 'plata / încasarea din extras', titular_nume: 'titular', termen_justificare: 'termen de justificare',
  scop: 'scopul', diferenta_eur: 'diferența', data_efect: 'data de efect', tip_document: 'tipul documentului', document_id: 'documentul',
  cost_achizitie: 'cost de achiziție', durata_amortizare_luni: 'amortizare (luni)', procent_utilizare: '% utilizare pe proiect', data_punere_functiune: 'punere în funcțiune',
  raportata_la: 'raportată la', raportata_de: 'raportată de', sold_initial: 'sold inițial', sold_final: 'sold final', mixt_de_la: 'cont mixt de la', mixt_pana_la: 'cont mixt până la',
  platitor: 'plătitor de TVA', de_la: 'de la', rol: 'rolul', utilizator_id: 'utilizatorul', ibanuri: 'IBAN-uri', tip: 'tipul', luna: 'luna', moneda: 'moneda', curs: 'cursul',
}
const camp = (k: string) => CAMP[k] ?? k.replace(/_id$/, '').replace(/_/g, ' ')
// Câmpuri tehnice care nu spun nimic unui om
const ASCUNSE = new Set(['id', 'creat_la', 'actualizat_la', 'fisier_amprenta', 'chei', 'cuvinte_banca'])

// Valori de stare și tip, pe înțeles
const VALORI: Record<string, string> = {
  propusa: 'propusă', aprobata: 'aprobată', respinsa: 'respinsă', stornata: 'stornată', deschisa: 'deschisă', inchisa: 'închisă', raportata: 'raportată',
  act_aditional: 'act adițional', mutare: 'mutare între capitole', debit: 'ieșire', credit: 'intrare', PJ: 'persoană juridică', PF: 'persoană fizică',
  director_program: 'director de program', responsabil_financiar: 'responsabil financiar',
}

const reUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const reData = /^\d{4}-\d{2}-\d{2}$/
const reMoment = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

function oraRo(m: string) {
  const d = new Date(m)
  return { zi: d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' }), ora: d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }) }
}

// O valoare din jurnal, pe înțeles: legăturile se traduc în nume (capitol, cont, persoană etc.)
function valoare(k: string, v: unknown, h: Harti): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'da' : 'nu'
  if (typeof v === 'number') return k.includes('procent') || k === 'fractie_luna' || k === 'zile_proiect' || k.includes('luni') || k === 'numar' || k === 'rand_extras' ? String(v).replace('.', ',') : num(v)
  if (Array.isArray(v)) return v.map(x => valoare(k, x, h)).join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  const s = String(v)
  if (reUuid.test(s)) {
    for (const [n, m] of Object.entries(h)) { if (n === 'moneda') continue; const x = m.get(s); if (x) return x }
    return '(legat)'
  }
  if (reData.test(s)) return data(s)
  if (reMoment.test(s)) { const o = oraRo(s); return `${o.zi} ${o.ora}` }
  return VALORI[s] ?? s.replace(/_/g, s.includes(' ') ? '_' : ' ')
}

// Despre ce înregistrare e vorba, într-o linie
function rezumat(t: string, r: Record<string, unknown> | null, h: Harti): string {
  if (!r) return ''
  const v = (k: string) => valoare(k, r[k], h)
  const moneda = r.cont_id ? (h.moneda.get(String(r.cont_id)) ?? '') : String(r.moneda ?? '')
  const scurt = (s: unknown, n = 60) => { const x = String(s ?? '').replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n) + '…' : x }
  switch (t) {
    case 'operatiuni': return `${v('data_operatiune')} · ${r.sens === 'debit' ? '−' : '+'}${num(r.suma as number)} ${moneda === 'RON' ? 'lei' : moneda} · ${scurt(r.descriere_banca)}`
    case 'decontari': return `${v('pozitie_buget_id')} · ${num(r.suma as number)} · ${v('stare')}${r.operatiune_id ? ` · ${h.operatiuni.get(String(r.operatiune_id)) ?? ''}` : ''}`
    case 'documente': return `${v('tip')} ${r.numar ?? ''} din ${v('data_document')} · ${scurt(r.furnizor_denumire, 40)} · ${num(r.suma_totala as number)} ${String(r.moneda ?? '')}`
    case 'extrase': return `extras ${r.numar ?? ''} · ${v('data_inceput')} – ${v('data_sfarsit')} · ${v('cont_id')}`
    case 'conturi': return `${v('denumire')} · ${String(r.iban ?? '')} · ${String(r.moneda ?? '')}`
    case 'luni_personal': return `${v('persoana_id')} · luna ${v('luna')}`
    case 'personal_plati': return `${v('persoana_id')} · ${v('tip')} · luna ${v('luna')}`
    case 'schimburi_valutare': return `${v('data')} · ${num(r.suma_vanduta as number)} ${String(r.moneda_vanduta ?? '')} → ${num(r.suma_cumparata as number)} ${String(r.moneda_cumparata ?? '')}`
    case 'transferuri_interne': return `${v('data_iesire')} · ${num(r.suma as number)} ${String(r.moneda ?? '')}`
    case 'transe': return `tranșa ${r.numar ?? ''} · ${v('tip')} · ${num(r.suma_asteptata_eur as number)}`
    case 'modificari_buget': return `${v('numar')} · ${v('tip')} · ${v('stare')}`
    case 'modificari_buget_linii': return `${v('pozitie_id')} · ${num(r.diferenta_eur as number)}`
    case 'avansuri_numerar': return `${scurt(r.titular_nume, 40)} · ${num(r.suma as number)} · termen ${v('termen_justificare')}`
    case 'roluri_contract': return `${v('utilizator_id')} · ${v('rol')}`
    case 'cheltuieli_indirecte': return `${num(r.suma as number)} · ${v('motiv')}${r.operatiune_id ? ` · ${h.operatiuni.get(String(r.operatiune_id)) ?? ''}` : ''}`
    case 'perioade_raportare': return `perioada ${r.numar ?? ''} · ${v('data_inceput')} – ${v('data_sfarsit')} · ${v('stare')}`
    case 'echipamente_plati': case 'reconcilieri': case 'justificari_avans': case 'alocari_lei':
      return `${num((r.suma ?? r.suma_lei) as number)}${r.operatiune_id ? ` · ${h.operatiuni.get(String(r.operatiune_id)) ?? ''}` : ''}`
    default: return scurt(r.denumire ?? r.nume ?? r.titlu ?? r.numar_contract ?? r.cod ?? r.numar ?? '')
  }
}

function csvCelula(s: string) { return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

export default function Jurnal({ general }: { general?: boolean }) {
  const { id } = useParams()
  const contract = general ? null : id ?? null
  const [randuri, setRanduri] = useState<Rand[] | null>(null)
  const [filtre, setFiltre] = useState<Filtre | null>(null)
  const [harti, setHarti] = useState<Harti>({ moneda: new Map(), operatiuni: new Map() })
  const [eroare, setEroare] = useState<string | null>(null)
  const [deschis, setDeschis] = useState<Set<number>>(new Set())
  const [pagina, setPagina] = useState(0)
  const [exporta, setExporta] = useState(false)
  const [f, setF] = useState({ de_la: '', pana_la: '', cine: '', tabel: '', actiune: '' })

  // Numele pentru legături (capitol, cont, persoană, furnizor, perioadă, document, utilizator), ca jurnalul să nu arate coduri
  useEffect(() => {
    (async () => {
      const fl = await supabase.rpc('jurnal_contract_filtre', { p_contract: contract })
      if (fl.error) { setEroare(fl.error.code === '42501' ? 'Nu aveți acces la acest jurnal.' : 'Jurnalul nu a putut fi citit.'); return }
      const fd = fl.data as Filtre
      setFiltre(fd)
      const h: Harti = { moneda: new Map(), operatiuni: new Map(), utilizatori: new Map(fd.utilizatori.map(u => [u.id, u.nume ?? 'utilizator'])) }
      if (contract) {
        const [p, c, pe, pr, d, cp] = await Promise.all([
          supabase.from('pozitii_buget').select('id,cod,denumire').eq('contract_id', contract),
          supabase.from('conturi').select('id,iban,moneda').eq('contract_id', contract),
          supabase.from('persoane_proiect').select('id,nume').eq('contract_id', contract),
          supabase.from('perioade_raportare').select('id,numar').eq('contract_id', contract),
          supabase.from('documente').select('id,tip,numar').eq('contract_id', contract),
          supabase.from('contrapartide').select('id,denumire'),
        ])
        h.capitole = new Map((p.data ?? []).map(x => [x.id, `${x.cod} ${x.denumire}`]))
        h.conturi = new Map((c.data ?? []).map(x => [x.id, `cont ${x.moneda} …${String(x.iban).slice(-4)}`]))
        h.moneda = new Map((c.data ?? []).map(x => [x.id, String(x.moneda).trim()]))
        h.persoane = new Map((pe.data ?? []).map(x => [x.id, x.nume]))
        h.perioade = new Map((pr.data ?? []).map(x => [x.id, `perioada ${x.numar}`]))
        h.documente = new Map((d.data ?? []).map(x => [x.id, `${String(x.tip).replace(/_/g, ' ')} ${x.numar ?? ''}`.trim()]))
        h.contrapartide = new Map((cp.data ?? []).map(x => [x.id, x.denumire]))
      }
      setHarti(h)
    })()
  }, [contract])

  const parametri = useCallback((limita: number, offset: number) => ({
    p_contract: contract, p_de_la: f.de_la || null, p_pana_la: f.pana_la || null,
    p_utilizator: f.cine && f.cine !== 'oameni' ? f.cine : null, p_doar_oameni: f.cine === 'oameni',
    p_tabel: f.tabel || null, p_actiune: f.actiune || null, p_limita: limita, p_offset: offset,
  }), [contract, f])

  const incarca = useCallback(async () => {
    setRanduri(null)
    const { data: d, error } = await supabase.rpc('jurnal_contract', parametri(PE_PAGINA, pagina * PE_PAGINA))
    if (error) { setEroare(error.code === '42501' ? 'Nu aveți acces la acest jurnal.' : 'Jurnalul nu a putut fi citit.'); return }
    setRanduri(d as Rand[])
    // operațiunile la care se referă alocările de pe pagină: data și suma, ca să se știe despre ce plată e vorba
    const ids = [...new Set((d as Rand[]).map(r => r.date?.operatiune_id as string | undefined).filter((x): x is string => !!x))]
    if (ids.length && contract) {
      const o = await supabase.from('operatiuni').select('id,data_operatiune,sens,suma,cont_id').in('id', ids)
      setHarti(h => {
        const m = new Map(h.operatiuni)
        for (const x of o.data ?? []) m.set(x.id, `plata din ${data(x.data_operatiune)}, ${x.sens === 'debit' ? '−' : '+'}${num(x.suma)} ${(h.moneda.get(x.cont_id) ?? '').replace('RON', 'lei')}`)
        return { ...h, operatiuni: m }
      })
    }
  }, [parametri, pagina, contract])
  useEffect(() => { incarca() }, [incarca])

  const schimba = (k: keyof typeof f, v: string) => { setPagina(0); setDeschis(new Set()); setF(x => ({ ...x, [k]: v })) }
  const total = randuri?.[0]?.total ?? 0
  const pagini = Math.max(1, Math.ceil(total / PE_PAGINA))
  const totalJurnal = useMemo(() => filtre ? filtre.sistem + filtre.utilizatori.reduce((a, u) => a + u.n, 0) : 0, [filtre])
  const oameni = useMemo(() => filtre ? filtre.utilizatori.reduce((a, u) => a + u.n, 0) : 0, [filtre])

  function descriere(r: Rand): string[] {
    if (r.actiune === 'UPDATE' && r.schimbari)
      return Object.entries(r.schimbari).filter(([k]) => !ASCUNSE.has(k)).map(([k, [a, b]]) => `${camp(k)}: ${valoare(k, a, harti)} → ${valoare(k, b, harti)}`)
    return []
  }

  async function exportCsv() {
    setExporta(true)
    const toate: Rand[] = []
    for (let off = 0; ; off += 1000) {
      const { data: d, error } = await supabase.rpc('jurnal_contract', parametri(1000, off))
      if (error) { setExporta(false); setEroare('Exportul nu a reușit.'); return }
      toate.push(...(d as Rand[]))
      if ((d as Rand[]).length < 1000) break
    }
    const cap = ['Data', 'Ora', 'Cine', 'Unde', 'Acțiune', 'Înregistrarea', 'Ce s-a schimbat']
    const linii = toate.map(r => {
      const o = oraRo(r.moment)
      return [o.zi, o.ora, r.utilizator_nume ?? 'Sistem (automat)', unde(r.tabel), ACTIUNE[r.actiune][0], rezumat(r.tabel, r.date, harti), descriere(r).join(' | ')].map(csvCelula).join(';')
    })
    const blob = new Blob(['﻿' + [cap.join(';'), ...linii].join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `jurnal-${general ? 'general' : 'contract'}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    setExporta(false)
  }

  const inapoi = general ? <Link to="/admin" className="inapoi">← Administrare</Link> : <Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link>
  if (eroare) return <>{inapoi}<div className="alerta rosu">{eroare}</div></>

  return (
    <>
      {inapoi}
      <section className="titlu-pagina">
        <h1>{general ? 'Jurnal general' : 'Jurnal'}</h1>
        <p>{general
          ? 'Cine a schimbat ce și când în bibliotecile comune (programe, bănci) și în administrare (utilizatori, firme).'
          : 'Cine a schimbat ce și când la acest contract. Fiecare adăugare, modificare sau ștergere e înregistrată automat de baza de date, cu autorul și ora, și nu se mai poate modifica sau șterge.'}</p>
      </section>

      {filtre && <section className="cifre">
        <div className="cifra accent"><div className="cifra-eticheta">Înregistrări în jurnal</div><div className="cifra-valoare mic-v">{totalJurnal.toLocaleString('ro-RO')}</div>
          <div className="cifra-sub">{filtre.prima ? `${oraRo(filtre.prima).zi} – ${oraRo(filtre.ultima!).zi}` : 'nicio înregistrare'}</div></div>
        <div className="cifra"><div className="cifra-eticheta">Făcute de oameni</div><div className="cifra-valoare mic-v">{oameni.toLocaleString('ro-RO')}</div>
          <div className="cifra-sub">{filtre.utilizatori.length} {filtre.utilizatori.length === 1 ? 'persoană' : 'persoane'}</div></div>
        <div className="cifra"><div className="cifra-eticheta">Automate</div><div className="cifra-valoare mic-v">{filtre.sistem.toLocaleString('ro-RO')}</div>
          <div className="cifra-sub">importuri de extrase, calcule, propuneri</div></div>
        <div className="cifra"><div className="cifra-eticheta">Tipuri de date atinse</div><div className="cifra-valoare mic-v">{filtre.tabele.length}</div>
          <div className="cifra-sub">din ecranele aplicației</div></div>
      </section>}

      <div className="filtre">
        <label className="filtru-data">De la<input type="date" value={f.de_la} onChange={e => schimba('de_la', e.target.value)} /></label>
        <label className="filtru-data">Până la<input type="date" value={f.pana_la} onChange={e => schimba('pana_la', e.target.value)} /></label>
        <select value={f.cine} onChange={e => schimba('cine', e.target.value)} aria-label="Cine">
          <option value="">Toți (oameni și automat)</option>
          <option value="oameni">Doar oameni</option>
          {filtre?.utilizatori.map(u => <option key={u.id} value={u.id}>{u.nume ?? 'utilizator'} ({u.n})</option>)}
        </select>
        <select value={f.tabel} onChange={e => schimba('tabel', e.target.value)} aria-label="Unde">
          <option value="">Toate tipurile de date</option>
          {filtre?.tabele.slice().sort((a, b) => unde(a.tabel).localeCompare(unde(b.tabel), 'ro')).map(t => <option key={t.tabel} value={t.tabel}>{unde(t.tabel)} ({t.n})</option>)}
        </select>
        <select value={f.actiune} onChange={e => schimba('actiune', e.target.value)} aria-label="Acțiune">
          <option value="">Orice acțiune</option>
          {Object.entries(ACTIUNE).map(([k, [t]]) => <option key={k} value={k}>{t}</option>)}
        </select>
        <button className="buton-text" onClick={exportCsv} disabled={exporta || !total}>{exporta ? 'Se pregătește…' : 'Descarcă (Excel / CSV)'}</button>
      </div>

      <section className="bloc fara-padding">
        <div className="tabel-wrap">
          <table className="tabel-op tabel-jurnal">
            <thead><tr><th>Când</th><th>Cine</th><th>Unde</th><th>Ce s-a întâmplat</th><th></th></tr></thead>
            <tbody>
              {!randuri && <tr><td colSpan={5} className="gol-rand">Se încarcă jurnalul…</td></tr>}
              {randuri?.length === 0 && <tr><td colSpan={5} className="gol-rand">Nicio înregistrare pentru filtrele alese.</td></tr>}
              {randuri?.map(r => {
                const o = oraRo(r.moment), [act, cls] = ACTIUNE[r.actiune], d = descriere(r), e = deschis.has(r.id)
                const ecran = UNDE[r.tabel]?.[1]
                return [
                  <tr key={r.id}>
                    <td className="nowrap">{o.zi}<div className="mic gri">{o.ora}</div></td>
                    <td>{r.utilizator_nume ?? <span className="gri">Sistem (automat)</span>}</td>
                    <td>{ecran != null && contract ? <Link to={`/contract/${contract}${ecran ? '/' + ecran : ''}`} className="legatura">{unde(r.tabel)}</Link> : unde(r.tabel)}</td>
                    <td className="lat">
                      <span className={`eticheta ${cls}`}>{act}</span> <span className="tare">{rezumat(r.tabel, r.date, harti)}</span>
                      {d.length > 0 && <ul className="schimbari">{d.slice(0, e ? undefined : 4).map((x, i) => <li key={i}>{x}</li>)}{!e && d.length > 4 && <li className="gri">… încă {d.length - 4}</li>}</ul>}
                    </td>
                    <td className="n"><button className="buton-text mic-b" onClick={() => setDeschis(s => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n })}>{e ? 'Ascunde' : 'Detalii'}</button></td>
                  </tr>,
                  e && <tr key={r.id + 'd'} className="rand-detaliu"><td colSpan={5}>
                    <div className="mic gri spatiu">{r.actiune === 'DELETE' ? 'Înregistrarea, așa cum era înainte de ștergere:' : r.actiune === 'INSERT' ? 'Înregistrarea, așa cum a fost adăugată:' : 'Înregistrarea, după modificare:'}</div>
                    <dl className="detalii-jurnal">
                      {Object.entries(r.date ?? {}).filter(([k, v]) => !ASCUNSE.has(k) && v !== null && v !== '').map(([k, v]) => (
                        <div key={k} className={r.schimbari && k in r.schimbari ? 'schimbat' : ''}><dt>{camp(k)}</dt><dd>{valoare(k, v, harti)}</dd></div>
                      ))}
                    </dl>
                  </td></tr>,
                ]
              })}
            </tbody>
          </table>
        </div>
      </section>

      {total > PE_PAGINA && <div className="rand-butoane spatiu">
        <button className="buton-text" disabled={pagina === 0} onClick={() => setPagina(p => p - 1)}>← Mai noi</button>
        <span className="gri">Pagina {pagina + 1} din {pagini} · {total.toLocaleString('ro-RO')} înregistrări</span>
        <button className="buton-text" disabled={pagina + 1 >= pagini} onClick={() => setPagina(p => p + 1)}>Mai vechi →</button>
      </div>}

      <p className="nota">
        Jurnalul îl scrie baza de date, nu ecranele: orice schimbare ajunge aici, indiferent de unde a fost făcută, și nici administratorul nu o poate șterge.
        „Sistem (automat)” înseamnă o operație fără utilizator conectat: importul extraselor, calculele și propunerile automate.
        La o modificare se arată doar câmpurile care s-au schimbat (valoarea veche → valoarea nouă); modificările care nu schimbă nimic nu apar.
        Descărcarea ia toate înregistrările care corespund filtrelor, nu doar pagina curentă.
      </p>
    </>
  )
}

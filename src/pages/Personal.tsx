import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { bani, data, num } from '../lib/format'

// Capitolul A – Personal și pontaje (varianta lunară).
//  Cost lunar      = salariul brut + contribuțiile angajatorului (CAM).
//  Zile disponibile = Z ÷ 12 × partea din lună lucrată × normă (ore/zi ÷ 8),
//  unde Z = zilele productive pe an din biblioteca de programe (regula „zile_productive_an”; la Horizon Europe, 215).
//  Rata zilnică    = cost lunar ÷ zile disponibile.
//  Eligibil        = zilele lucrate pe proiect × rata zilnică (cel mult zilele disponibile).
//  Cine lucrează EXCLUSIV pe proiect declară toate zilele: eligibil = tot costul lunii.
// Calculul e făcut în baza de date (v_personal_luni, v_personal_taxe).

type Persoana = {
  id: string; nume: string; functie: string | null; tip_contract: string; norma_ore_zi: number; exclusiv_pe_proiect: boolean
  data_inceput: string; data_sfarsit: string | null; cuvinte_banca: string[]; observatii: string | null
}
type Luna = {
  id: string; persoana_id: string; luna: string; salariu_brut: number; contributii_angajat: number; impozit: number; salariu_net: number
  contributii_angajator: number; fractie_luna: number; zile_proiect: number | null; sursa: string; confirmat: boolean; observatii: string | null
  cost_lunar: number; zile_disponibile: number; rata_zilnica: number | null; zile_declarate: number | null; eligibil_lei: number | null
  perioada: number | null; curs_referinta: number | null; eligibil_eur: number | null; net_platit: number; diferenta_calcul_net: number
}
type Taxa = { luna: string; datorate: number; platite: number; nr_plati: number; diferenta: number }
type Op = { id: string; data_operatiune: string; suma: number; tip: string; cine: string | null; descriere_banca: string | null }
type Leg = { operatiune_id: string; tip: string; luna: string; persoana_id: string | null }

const TIP_CONTRACT: Record<string, string> = { cim: 'Contract de muncă', drepturi_autor: 'Drepturi de autor', pfa: 'PFA / colaborator', alt: 'Altul' }
const lunaText = (d: string) => { const [y, m] = d.split('-'); return `${m}.${y}` }
const nr = (s: string) => Number(String(s).replace(/\s/g, '').replace(',', '.'))
const txt = (v: number | null | undefined) => (v == null ? '' : String(Number(v)).replace('.', ','))

export default function Personal() {
  const { id } = useParams()
  const [pers, setPers] = useState<Persoana[] | null>(null)
  const [luni, setLuni] = useState<Luna[]>([])
  const [taxe, setTaxe] = useState<Taxa[]>([])
  const [ops, setOps] = useState<Op[]>([])
  const [leg, setLeg] = useState<Leg[]>([])
  const [bugetA, setBugetA] = useState<number | null>(null)
  const [zileAn, setZileAn] = useState<number | null>(null)
  const [eroare, setEroare] = useState<string | null>(null)
  const [mesaj, setMesaj] = useState<{ cls: string; text: string } | null>(null)
  const [lucreaza, setLucreaza] = useState(false)
  const [formPers, setFormPers] = useState<string | 'nou' | null>(null)
  const [editLuna, setEditLuna] = useState<string | null>(null)
  const [lunaNoua, setLunaNoua] = useState<string | null>(null)

  const incarca = useCallback(async () => {
    if (!id) return
    const [p, l, t, o, g, b, z] = await Promise.all([
      supabase.from('persoane_proiect').select('id,nume,functie,tip_contract,norma_ore_zi,exclusiv_pe_proiect,data_inceput,data_sfarsit,cuvinte_banca,observatii').eq('contract_id', id).order('data_inceput'),
      supabase.from('v_personal_luni').select('*').eq('contract_id', id).order('luna'),
      supabase.from('v_personal_taxe').select('luna,datorate,platite,nr_plati,diferenta').eq('contract_id', id).order('luna'),
      supabase.from('v_operatiuni_validare').select('id,data_operatiune,suma,tip,cine,descriere_banca')
        .eq('contract_id', id).eq('sens', 'debit').eq('aferenta_proiect', true).is('operatiune_parinte_id', null)
        .in('tip', ['plata_salarii', 'plata_taxe']).order('data_operatiune'),
      supabase.from('personal_plati').select('operatiune_id,tip,luna,persoana_id').eq('contract_id', id),
      supabase.from('v_buget_in_vigoare').select('suma_in_vigoare_eur').eq('contract_id', id).eq('mod_calcul', 'pontaj'),
      supabase.rpc('valoare_regula', { p_contract: id, p_cod: 'zile_productive_an' }),
    ])
    if (p.error || l.error || t.error || o.error || g.error) { setEroare('Datele nu au putut fi citite.'); return }
    setPers(p.data as Persoana[]); setLuni(l.data as Luna[]); setTaxe(t.data as Taxa[]); setOps(o.data as Op[]); setLeg(g.data as Leg[])
    setBugetA((b.data ?? []).reduce((a, x) => a + Number(x.suma_in_vigoare_eur), 0))
    setZileAn(z.data == null ? null : Number(z.data))
  }, [id])
  useEffect(() => { incarca() }, [incarca])

  const nelegate = useMemo(() => { const s = new Set(leg.map(x => x.operatiune_id)); return ops.filter(o => !s.has(o.id)) }, [ops, leg])
  const tot = useMemo(() => {
    const t = { cost: 0, eligLei: 0, eligEur: 0, zile: 0, fara: 0, deduse: 0 }
    for (const l of luni) {
      t.cost += Number(l.cost_lunar); t.eligLei += Number(l.eligibil_lei ?? 0); t.eligEur += Number(l.eligibil_eur ?? 0); t.zile += Number(l.zile_declarate ?? 0)
      if (l.eligibil_lei == null) t.fara++
      if (!l.confirmat) t.deduse++
    }
    return t
  }, [luni])

  const gata = async (t: string) => { setMesaj({ cls: 'verde', text: t }); setFormPers(null); setEditLuna(null); setLunaNoua(null); await incarca() }

  async function stergeLuna(l: Luna, p: Persoana) {
    if (!window.confirm(`Ștergeți luna ${lunaText(l.luna)} pentru ${p.nume}?`)) return
    setLucreaza(true); setMesaj(null)
    const { error } = await supabase.from('luni_personal').delete().eq('id', l.id)
    setLucreaza(false)
    if (error) setMesaj({ cls: 'rosu', text: error.message }); else await gata('Luna a fost ștearsă.')
  }
  async function dezleaga(opId: string) {
    setLucreaza(true); setMesaj(null)
    const { error } = await supabase.from('personal_plati').delete().eq('operatiune_id', opId)
    setLucreaza(false)
    if (error) setMesaj({ cls: 'rosu', text: error.message }); else await gata('Legătura a fost anulată. Plata apare la „Plăți nelegate”.')
  }

  if (eroare) return <><Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link><div className="alerta rosu">{eroare}</div></>
  if (!pers) return <div className="gol">Se încarcă personalul…</div>

  const opDupaId = new Map(ops.map(o => [o.id, o]))

  return (
    <>
      <Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link>
      <section className="titlu-pagina">
        <h1>Personal și pontaje (A)</h1>
        <p>Pe proiect intră costul fiecărei persoane (salariul brut + contribuția angajatorului), proporțional cu zilele lucrate pe proiect. {zileAn ? `Regula programului: ${num(zileAn)} zile productive pe an, adică ${num(zileAn / 12)} pe lună.` : ''}</p>
      </section>

      <section className="cifre">
        <div className="cifra"><div className="cifra-eticheta">Cost personal</div><div className="cifra-valoare mic-v">{bani(tot.cost, 'RON')}</div><div className="cifra-sub">{luni.length} luni-persoană</div></div>
        <div className="cifra accent"><div className="cifra-eticheta">Eligibil pe proiect</div><div className="cifra-valoare mic-v">{bani(tot.eligEur, 'EUR')}</div><div className="cifra-sub">{bani(tot.eligLei, 'RON')} · {num(tot.zile)} zile</div></div>
        <div className="cifra"><div className="cifra-eticheta">Buget A</div><div className="cifra-valoare mic-v">{bugetA != null ? bani(bugetA, 'EUR') : '—'}</div><div className="cifra-sub">{bugetA ? `folosit ${num(100 * tot.eligEur / bugetA)}%` : ''}</div></div>
        <div className="cifra"><div className="cifra-eticheta">De completat</div><div className="cifra-valoare mic-v">{tot.fara} {tot.fara === 1 ? 'lună' : 'luni'} fără pontaj</div><div className="cifra-sub">{tot.deduse} luni neconfirmate cu statul de plată</div></div>
      </section>

      {tot.fara > 0 && <div className="alerta galben spatiu">
        <b>Lipsesc zilele lucrate pe proiect.</b> Pentru fiecare persoană alegeți: fie „lucrează exclusiv pe proiect” (se declară toate zilele, cu o declarație semnată), fie completați pontajul lunar (zile pe proiect). Până atunci, luna nu intră la eligibil.
      </div>}
      {tot.deduse > 0 && <div className="alerta albastru spatiu">
        <b>Salariile brute sunt deduse din plăți</b>, nu luate din statele de plată: din netul plătit am calculat brutul (CAS 25%, CASS 10%, impozit 10%, CAM 2,25%), iar taxele rezultate se potrivesc cu ce s-a plătit la buget (tabelul de jos). Confirmați fiecare lună după statul de plată al contabilului.
      </div>}
      {mesaj && <div className={`alerta ${mesaj.cls} spatiu`}>{mesaj.text}</div>}

      {formPers === 'nou'
        ? <FormPersoana contractId={id!} lucreaza={lucreaza} setLucreaza={setLucreaza} inchide={() => setFormPers(null)} gata={gata} />
        : <div className="rand-butoane spatiu"><button className="buton" onClick={() => setFormPers('nou')}>+ Adaugă o persoană</button></div>}

      {pers.map(p => {
        const lp = luni.filter(l => l.persoana_id === p.id)
        const s = lp.reduce((a, l) => ({ cost: a.cost + Number(l.cost_lunar), lei: a.lei + Number(l.eligibil_lei ?? 0), eur: a.eur + Number(l.eligibil_eur ?? 0) }), { cost: 0, lei: 0, eur: 0 })
        return (
          <section key={p.id} className="bloc fara-padding spatiu">
            <div className="bloc-titlu" style={{ padding: '14px 16px 0' }}>
              <div>
                <div className="tare">{p.nume}</div>
                <div className="mic gri">{TIP_CONTRACT[p.tip_contract] ?? p.tip_contract}{p.functie ? ` · ${p.functie}` : ''} · normă {num(p.norma_ore_zi)} ore/zi · {data(p.data_inceput)} – {p.data_sfarsit ? data(p.data_sfarsit) : 'prezent'}</div>
                <div className="mic">{p.exclusiv_pe_proiect ? <span className="verde-text">✓ lucrează exclusiv pe proiect (se declară toate zilele)</span> : <span className="gri">pe pontaj: zilele pe proiect se completează lunar</span>}</div>
              </div>
              <div className="nowrap">
                <button className="link-mic" onClick={() => setFormPers(formPers === p.id ? null : p.id)}>modifică</button>
                <button className="link-mic" onClick={() => setLunaNoua(lunaNoua === p.id ? null : p.id)}>+ lună</button>
              </div>
            </div>
            {formPers === p.id && <div style={{ padding: '0 16px' }}><FormPersoana contractId={id!} p={p} lucreaza={lucreaza} setLucreaza={setLucreaza} inchide={() => setFormPers(null)} gata={gata} /></div>}
            {lunaNoua === p.id && <div style={{ padding: '0 16px' }}><FormLuna p={p} zileAn={zileAn} ultima={lp[lp.length - 1]} lucreaza={lucreaza} setLucreaza={setLucreaza} inchide={() => setLunaNoua(null)} gata={gata} /></div>}
            <div className="tabel-wrap">
              <table className="tabel-op">
                <thead><tr>
                  <th>Luna</th><th className="n">Brut</th><th className="n">CAM</th><th className="n">Cost lunar</th><th className="n">Net plătit</th>
                  <th className="n">Zile disp.</th><th className="n">Zile proiect</th><th className="n">Rată/zi</th><th className="n">Eligibil lei</th><th className="n">Eligibil EUR</th><th />
                </tr></thead>
                <tbody>
                  {lp.map(l => (
                    <Fragment key={l.id}>
                      <tr className={l.eligibil_lei == null ? 'rand-lipsa' : ''}>
                        <td className="nowrap">{lunaText(l.luna)}<div className="mic gri">{l.confirmat ? <span className="verde-text">✓ stat de plată</span> : l.sursa === 'dedus_din_plati' ? 'dedus din plăți' : 'neconfirmat'}{Number(l.fractie_luna) < 1 ? ` · ${num(100 * l.fractie_luna)}% din lună` : ''}</div></td>
                        <td className="n">{num(l.salariu_brut)}</td>
                        <td className="n">{num(l.contributii_angajator)}</td>
                        <td className="n tare">{num(l.cost_lunar)}</td>
                        <td className="n">{num(l.net_platit)}{Math.abs(Number(l.net_platit) - Number(l.salariu_net)) > 0.5 ? <div className="mic rosu-text">datorat {num(l.salariu_net)}</div> : <div className="mic verde-text">✓</div>}</td>
                        <td className="n">{num(l.zile_disponibile)}</td>
                        <td className="n">{p.exclusiv_pe_proiect ? <span className="gri">toate</span> : l.zile_proiect == null ? <span className="rosu-text">lipsă</span> : num(l.zile_proiect)}</td>
                        <td className="n">{num(l.rata_zilnica)}</td>
                        <td className="n">{l.eligibil_lei != null ? num(l.eligibil_lei) : '—'}</td>
                        <td className="n tare">{l.eligibil_eur != null ? num(l.eligibil_eur) : '—'}{l.perioada ? <div className="mic gri">perioada {l.perioada}</div> : null}</td>
                        <td className="nowrap"><button className="link-mic" onClick={() => setEditLuna(editLuna === l.id ? null : l.id)}>modifică</button></td>
                      </tr>
                      {editLuna === l.id && <tr className="rand-detaliu"><td colSpan={11}>
                        <FormLuna p={p} zileAn={zileAn} l={l} lucreaza={lucreaza} setLucreaza={setLucreaza} inchide={() => setEditLuna(null)} gata={gata} sterge={() => stergeLuna(l, p)} />
                      </td></tr>}
                    </Fragment>
                  ))}
                  {lp.length === 0 && <tr><td colSpan={11} className="gol-rand">Nicio lună înregistrată. Apăsați „+ lună”.</td></tr>}
                  {lp.length > 0 && <tr><td className="tare">Total</td><td colSpan={2} /><td className="n tare">{num(s.cost)}</td><td colSpan={4} /><td className="n tare">{num(s.lei)}</td><td className="n tare">{num(s.eur)}</td><td /></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}

      <section className="bloc fara-padding spatiu">
        <div className="bloc-titlu" style={{ padding: '14px 16px 0' }}><div><div className="tare">Taxele pe salarii: datorate față de plătite</div>
          <div className="mic gri">Datorate = CAS + CASS + impozit + CAM din lunile de mai sus. Plătite = plățile „Taxe și contribuții” din extrase, legate de luna lor (se plătesc de regulă până pe 25 ale lunii următoare).</div></div></div>
        <div className="tabel-wrap">
          <table className="tabel-op">
            <thead><tr><th>Luna salariului</th><th className="n">Datorate</th><th className="n">Plătite</th><th className="n">Plăți</th><th className="n">Diferență</th></tr></thead>
            <tbody>
              {taxe.map(t => (
                <tr key={t.luna} className={Math.abs(Number(t.diferenta)) > 1 ? 'rand-rosu' : ''}>
                  <td>{lunaText(t.luna)}</td><td className="n">{num(t.datorate)}</td><td className="n">{num(t.platite)}</td><td className="n">{t.nr_plati}</td>
                  <td className={`n tare ${Math.abs(Number(t.diferenta)) > 1 ? 'rosu-text' : 'verde-text'}`}>{Math.abs(Number(t.diferenta)) <= 1 ? '✓' : num(t.diferenta)}</td>
                </tr>
              ))}
              {taxe.length === 0 && <tr><td colSpan={5} className="gol-rand">Nicio lună încă.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bloc fara-padding spatiu">
        <div className="bloc-titlu" style={{ padding: '14px 16px 0' }}><div><div className="tare">Plăți de salarii și taxe nelegate <span className="contor">{nelegate.length}</span></div>
          <div className="mic gri">Plăți aferente proiectului, de tip „Salarii” sau „Taxe și contribuții”, încă nelegate de o persoană și o lună.</div></div></div>
        <div className="tabel-wrap">
          <table className="tabel-op">
            <thead><tr><th>Data</th><th>Tip</th><th>Către</th><th className="n">Suma</th><th>Legare</th></tr></thead>
            <tbody>
              {nelegate.map(o => <RandLegare key={o.id} o={o} pers={pers} contractId={id!} lucreaza={lucreaza} setLucreaza={setLucreaza} gata={gata} />)}
              {nelegate.length === 0 && <tr><td colSpan={5} className="gol-rand">Toate plățile de salarii și taxe sunt legate. ✓</td></tr>}
            </tbody>
          </table>
        </div>
        {leg.length > 0 && <details style={{ padding: '8px 16px 14px' }}><summary className="mic">Plăți deja legate ({leg.length}) – pentru corecturi</summary>
          <table className="tabel-op"><tbody>
            {leg.slice().sort((a, b) => a.luna.localeCompare(b.luna)).map(g => { const o = opDupaId.get(g.operatiune_id); return (
              <tr key={g.operatiune_id}><td className="nowrap">{o ? data(o.data_operatiune) : '—'}</td><td>{g.tip === 'net' ? 'salariu net' : 'taxe'} pentru {lunaText(g.luna)}</td>
                <td>{g.persoana_id ? pers.find(x => x.id === g.persoana_id)?.nume : ''}</td><td className="n">{o ? num(o.suma) : ''}</td>
                <td><button className="link-mic rosu-text" disabled={lucreaza} onClick={() => dezleaga(g.operatiune_id)}>anulează legătura</button></td></tr>) })}
          </tbody></table></details>}
      </section>

      <p className="nota">Eligibilul în EUR folosește cursul de referință al perioadei în care cade luna salariului. {zileAn ? `Plafonul programului de ${num(zileAn)} zile pe an e respectat automat: într-o lună nu se pot declara mai mult de ${num(zileAn / 12)} zile (proporțional cu norma și partea din lună lucrată).` : ''} Un pontaj (sau declarația de lucru exclusiv) trebuie păstrat pentru fiecare persoană, semnat de persoană și de coordonator.</p>
    </>
  )
}

function FormPersoana({ contractId, p, lucreaza, setLucreaza, inchide, gata }: {
  contractId: string; p?: Persoana; lucreaza: boolean; setLucreaza: (b: boolean) => void; inchide: () => void; gata: (t: string) => Promise<void>
}) {
  const [v, setV] = useState({ nume: p?.nume ?? '', functie: p?.functie ?? '', tip: p?.tip_contract ?? 'cim', norma: txt(p?.norma_ore_zi ?? 8),
    exclusiv: p?.exclusiv_pe_proiect ?? false, de: p?.data_inceput ?? '', pana: p?.data_sfarsit ?? '', cuvinte: (p?.cuvinte_banca ?? []).join(', '), obs: p?.observatii ?? '' })
  const [eroare, setEroare] = useState<string | null>(null)
  const set = (k: string, val: string | boolean) => setV(x => ({ ...x, [k]: val }))
  async function salveaza() {
    setEroare(null)
    const norma = nr(v.norma)
    if (!v.nume.trim()) return setEroare('Numele persoanei.')
    if (!(norma > 0 && norma <= 8)) return setEroare('Norma: ore pe zi, între 1 și 8.')
    if (!v.de) return setEroare('Data de început a contractului pe proiect.')
    const rand = { nume: v.nume.trim(), functie: v.functie.trim() || null, tip_contract: v.tip, norma_ore_zi: norma, exclusiv_pe_proiect: v.exclusiv,
      data_inceput: v.de, data_sfarsit: v.pana || null, cuvinte_banca: v.cuvinte.split(',').map(s => s.trim().toLowerCase()).filter(Boolean), observatii: v.obs.trim() || null }
    setLucreaza(true)
    const { error } = p ? await supabase.from('persoane_proiect').update(rand).eq('id', p.id) : await supabase.from('persoane_proiect').insert({ ...rand, contract_id: contractId })
    setLucreaza(false)
    if (error) setEroare(error.message); else await gata(p ? `${rand.nume}: datele au fost salvate.` : `${rand.nume} a fost adăugat.`)
  }
  return (
    <div className="detaliu-op spatiu">
      <div className="campuri">
        <label className="lat2">Nume<input value={v.nume} onChange={e => set('nume', e.target.value)} /></label>
        <label>Funcția în proiect<input value={v.functie} onChange={e => set('functie', e.target.value)} placeholder="ex. coordonator, cercetător" /></label>
        <label>Tip contract<select value={v.tip} onChange={e => set('tip', e.target.value)}>{Object.entries(TIP_CONTRACT).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
        <label>Normă (ore/zi)<input inputMode="decimal" value={v.norma} onChange={e => set('norma', e.target.value)} /></label>
        <label>Pe proiect de la<input type="date" value={v.de} onChange={e => set('de', e.target.value)} /></label>
        <label>Până la (gol = în continuare)<input type="date" value={v.pana} onChange={e => set('pana', e.target.value)} /></label>
        <label className="lat2">Cum apare în extras (cuvinte, separate prin virgulă)<input value={v.cuvinte} onChange={e => set('cuvinte', e.target.value)} placeholder="ex. popescu" /></label>
        <label className="lat2 bifa-camp"><input type="checkbox" checked={v.exclusiv} onChange={e => set('exclusiv', e.target.checked)} /> Lucrează exclusiv pe proiect (se declară toate zilele, pe bază de declarație, fără pontaj zilnic)</label>
        <label className="lat2">Observații<input value={v.obs} onChange={e => set('obs', e.target.value)} /></label>
      </div>
      {eroare && <div className="alerta rosu">{eroare}</div>}
      <div className="rand-butoane">
        <button className="buton mic-b" disabled={lucreaza} onClick={salveaza}>{lucreaza ? 'Se salvează…' : 'Salvează'}</button>
        <button className="buton-text" disabled={lucreaza} onClick={inchide}>Renunță</button>
      </div>
    </div>
  )
}

// Calculul standard al salariului (România, fără deducere personală): CAS 25%, CASS 10%, impozit 10% din (brut − CAS − CASS), CAM 2,25%.
function calculStandard(brut: number) {
  const cas = Math.round(brut * 0.25), cass = Math.round(brut * 0.10)
  const imp = Math.round((brut - cas - cass) * 0.10)
  return { contrib: cas + cass, imp, net: brut - cas - cass - imp, cam: Math.round(brut * 0.0225) }
}

function FormLuna({ p, zileAn, l, ultima, lucreaza, setLucreaza, inchide, gata, sterge }: {
  p: Persoana; zileAn: number | null; l?: Luna; ultima?: Luna; lucreaza: boolean; setLucreaza: (b: boolean) => void; inchide: () => void; gata: (t: string) => Promise<void>; sterge?: () => void
}) {
  const urm = ultima ? (() => { const d = new Date(ultima.luna); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 7) })() : p.data_inceput.slice(0, 7)
  const baza = l ?? ultima
  const [v, setV] = useState({ luna: l ? l.luna.slice(0, 7) : urm, brut: txt(baza?.salariu_brut), contrib: txt(baza?.contributii_angajat), imp: txt(baza?.impozit),
    net: txt(baza?.salariu_net), cam: txt(baza?.contributii_angajator), fractie: txt(l ? 100 * Number(l.fractie_luna) : 100), zile: txt(l?.zile_proiect),
    confirmat: l?.confirmat ?? true, obs: l?.observatii ?? '' })
  const [eroare, setEroare] = useState<string | null>(null)
  const set = (k: string, val: string | boolean) => setV(x => ({ ...x, [k]: val }))
  function recalculeaza() {
    const c = calculStandard(nr(v.brut)); setV(x => ({ ...x, contrib: txt(c.contrib), imp: txt(c.imp), net: txt(c.net), cam: txt(c.cam) }))
  }
  const fr = nr(v.fractie) / 100
  const zileDisp = zileAn == null ? null : zileAn / 12 * fr * Number(p.norma_ore_zi) / 8
  async function salveaza() {
    setEroare(null)
    const brut = nr(v.brut)
    if (!/^\d{4}-\d{2}$/.test(v.luna)) return setEroare('Luna, în forma AAAA-LL.')
    if (!(brut > 0)) return setEroare('Salariul brut trebuie să fie mai mare decât 0.')
    if (!(fr > 0 && fr <= 1)) return setEroare('Partea din lună lucrată: între 1% și 100%.')
    const zile = v.zile.trim() === '' ? null : nr(v.zile)
    if (zile != null && !(zile >= 0)) return setEroare('Zilele pe proiect: un număr (poate avea zecimale).')
    if (zileDisp == null) return setEroare('Programul acestui contract nu are definită regula zilelor productive pe an. Adaug-o în biblioteca de programe înainte de a introduce salarii.')
    if (zile != null && zile > zileDisp + 0.005) return setEroare(`În această lună se pot declara cel mult ${num(zileDisp)} zile (${num(zileAn)} ÷ 12 × partea din lună × normă).`)
    const rand = { luna: `${v.luna}-01`, salariu_brut: brut, contributii_angajat: nr(v.contrib), impozit: nr(v.imp), salariu_net: nr(v.net), contributii_angajator: nr(v.cam),
      fractie_luna: Math.round(fr * 10000) / 10000, zile_proiect: zile, confirmat: v.confirmat, sursa: v.confirmat ? 'stat_de_plata' : (l?.sursa ?? 'stat_de_plata'), observatii: v.obs.trim() || null }
    setLucreaza(true)
    const { error } = l ? await supabase.from('luni_personal').update(rand).eq('id', l.id) : await supabase.from('luni_personal').insert({ ...rand, persoana_id: p.id })
    setLucreaza(false)
    if (error) setEroare(error.message.includes('duplicate') ? 'Luna aceasta există deja pentru persoană.' : error.message)
    else await gata(`${p.nume}, ${lunaText(rand.luna)}: salvat.`)
  }
  const cost = nr(v.brut) + nr(v.cam)
  return (
    <div className="detaliu-op spatiu">
      <div className="campuri">
        <label>Luna<input type="month" value={v.luna} disabled={!!l} onChange={e => set('luna', e.target.value)} /></label>
        <label>Salariu brut (lei)<input inputMode="decimal" value={v.brut} onChange={e => set('brut', e.target.value)} /></label>
        <label>CAS + CASS (lei)<input inputMode="decimal" value={v.contrib} onChange={e => set('contrib', e.target.value)} /></label>
        <label>Impozit (lei)<input inputMode="decimal" value={v.imp} onChange={e => set('imp', e.target.value)} /></label>
        <label>Salariu net (lei)<input inputMode="decimal" value={v.net} onChange={e => set('net', e.target.value)} /></label>
        <label>CAM – angajator (lei)<input inputMode="decimal" value={v.cam} onChange={e => set('cam', e.target.value)} /></label>
        <label>Partea din lună lucrată (%)<input inputMode="decimal" value={v.fractie} onChange={e => set('fractie', e.target.value)} /></label>
        <label>Zile lucrate pe proiect{p.exclusiv_pe_proiect ? ' (nu e nevoie: exclusiv)' : ''}<input inputMode="decimal" value={v.zile} disabled={p.exclusiv_pe_proiect} onChange={e => set('zile', e.target.value)} placeholder={zileDisp == null ? 'regulă lipsă' : `max. ${num(zileDisp)}`} /></label>
        <label className="lat2 bifa-camp"><input type="checkbox" checked={v.confirmat} onChange={e => set('confirmat', e.target.checked)} /> Sumele sunt verificate cu statul de plată</label>
        <label className="lat2">Observații<input value={v.obs} onChange={e => set('obs', e.target.value)} /></label>
      </div>
      <p className="mic">Cost lunar {num(cost)} lei · zile disponibile {zileDisp == null ? '—' : num(zileDisp)} · rată zilnică {zileDisp ? num(cost / zileDisp) : '—'} lei.
        {' '}<button className="link-mic" type="button" onClick={recalculeaza}>calculează taxele din brut</button></p>
      {eroare && <div className="alerta rosu">{eroare}</div>}
      <div className="rand-butoane">
        <button className="buton mic-b" disabled={lucreaza} onClick={salveaza}>{lucreaza ? 'Se salvează…' : 'Salvează'}</button>
        <button className="buton-text" disabled={lucreaza} onClick={inchide}>Renunță</button>
        {sterge && <button className="buton-text rosu-text" disabled={lucreaza} onClick={sterge}>Șterge luna</button>}
      </div>
    </div>
  )
}

function RandLegare({ o, pers, contractId, lucreaza, setLucreaza, gata }: {
  o: Op; pers: Persoana[]; contractId: string; lucreaza: boolean; setLucreaza: (b: boolean) => void; gata: (t: string) => Promise<void>
}) {
  const net = o.tip === 'plata_salarii'
  const d = new Date(o.data_operatiune); d.setDate(1); d.setMonth(d.getMonth() - 1)
  const text = (o.descriere_banca ?? '').toLowerCase()
  const ghicit = pers.find(p => p.cuvinte_banca.some(c => c && text.includes(c)))
  const [luna, setLuna] = useState(d.toISOString().slice(0, 7))
  const [persoana, setPersoana] = useState(ghicit?.id ?? '')
  const [eroare, setEroare] = useState<string | null>(null)
  async function leaga() {
    setEroare(null)
    if (net && !persoana) return setEroare('Alegeți persoana.')
    setLucreaza(true)
    const { error } = await supabase.from('personal_plati').insert({ contract_id: contractId, operatiune_id: o.id, tip: net ? 'net' : 'taxe', luna: `${luna}-01`, persoana_id: net ? persoana : null })
    setLucreaza(false)
    if (error) setEroare(error.message); else await gata('Plata a fost legată.')
  }
  return (
    <tr>
      <td className="nowrap">{data(o.data_operatiune)}</td>
      <td>{net ? 'Salariu' : 'Taxe'}</td>
      <td className="lat">{o.cine ?? ''}</td>
      <td className="n tare">{num(o.suma)}</td>
      <td>
        <div className="rand-butoane" style={{ flexWrap: 'wrap' }}>
          {net && <select value={persoana} onChange={e => setPersoana(e.target.value)}><option value="">— persoana —</option>{pers.map(p => <option key={p.id} value={p.id}>{p.nume}</option>)}</select>}
          <input type="month" value={luna} onChange={e => setLuna(e.target.value)} />
          <button className="buton mic-b" disabled={lucreaza} onClick={leaga}>Leagă</button>
        </div>
        {eroare && <div className="mic rosu-text">{eroare}</div>}
      </td>
    </tr>
  )
}

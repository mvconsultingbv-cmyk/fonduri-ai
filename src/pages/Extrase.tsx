import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { bani, data, iban as fmtIban, num } from '../lib/format'
import { citesteExtrasBCR, rot, verifica, type ExtrasCitit } from '../lib/extrasBCR'
import { amprenta, textCuPozitii } from '../lib/pdfText'

// Extrasele de cont: lanțul de solduri pe fiecare cont și încărcarea extraselor noi (PDF).
// PDF-ul e citit în browser; înainte de salvare se arată tot ce s-a citit și verificările.
// Salvarea (extras + operațiuni) se face într-un singur pas în baza de date, care mai verifică o dată:
// dubluri, perioade suprapuse, totaluri, lanțul de solduri, perioada contului mixt.

type Cont = {
  id: string; iban: string; moneda: string; denumire: string | null; sold_deschidere: number; data_deschidere: string
  activ: boolean; mixt_de_la: string | null; mixt_pana_la: string | null
}
type Extras = {
  id: string; cont_id: string; numar: string; data_inceput: string; data_sfarsit: string; sold_initial: number; sold_final: number
  total_debit: number; total_credit: number; fisier_cale: string; fisier_amprenta: string; incarcat_la: string
}
type Verif = { ok: boolean | null; text: string }
type Element = {
  cheie: string; nume: string; stare: 'citesc' | 'gata' | 'eroare' | 'salvez' | 'salvat'; mesaj?: string
  extras?: ExtrasCitit; cont?: Cont; fisier?: File; hash?: string; verif?: Verif[]; deschis?: boolean
}

const TIP: Record<string, string> = {
  incasare_finantare: 'Încasare finanțare', plata_furnizor: 'Plată furnizor', plata_salarii: 'Salarii', plata_taxe: 'Taxe și contribuții',
  comision_bancar: 'Comision bancar', dobanda: 'Dobândă', schimb_valutar: 'Schimb valutar', transfer_intern: 'Transfer între conturi',
  transfer_cont_propriu: 'Cont propriu asociație', retragere_numerar: 'Retragere numerar', depunere_numerar: 'Depunere numerar',
  restituire: 'Restituire', altele: 'Altele',
}

const ziua = (d: string, delta: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + delta); return x.toISOString().slice(0, 10) }
const sfarsitLunaTrecuta = () => { const x = new Date(); x.setUTCDate(1); x.setUTCDate(0); return x.toISOString().slice(0, 10) }

export default function Extrase() {
  const { id } = useParams()
  const [conturi, setConturi] = useState<Cont[] | null>(null)
  const [extrase, setExtrase] = useState<Extras[]>([])
  const [nrOp, setNrOp] = useState<Record<string, number>>({})
  const [eroare, setEroare] = useState<string | null>(null)
  const [coada, setCoada] = useState<Element[]>([])
  const [mesaj, setMesaj] = useState<{ cls: string; text: string } | null>(null)

  const incarca = useCallback(async () => {
    if (!id) return
    const c = await supabase.from('conturi').select('id,iban,moneda,denumire,sold_deschidere,data_deschidere,activ,mixt_de_la,mixt_pana_la').eq('contract_id', id).order('moneda').order('data_deschidere')
    if (c.error) { setEroare('Conturile nu au putut fi citite.'); return }
    const ids = (c.data ?? []).map(x => x.id)
    const e = ids.length ? await supabase.from('extrase').select('id,cont_id,numar,data_inceput,data_sfarsit,sold_initial,sold_final,total_debit,total_credit,fisier_cale,fisier_amprenta,incarcat_la').in('cont_id', ids).order('data_inceput') : { data: [], error: null }
    if (e.error) { setEroare('Extrasele nu au putut fi citite.'); return }
    const numar: Record<string, number> = {}
    for (let de = 0; ids.length; de += 1000) {
      const o = await supabase.from('operatiuni').select('extras_id').in('cont_id', ids).range(de, de + 999)
      if (o.error) break
      for (const r of o.data ?? []) numar[r.extras_id] = (numar[r.extras_id] ?? 0) + 1
      if ((o.data ?? []).length < 1000) break
    }
    setConturi(c.data as Cont[]); setExtrase(e.data as Extras[]); setNrOp(numar)
  }, [id])
  useEffect(() => { incarca() }, [incarca])

  // Verificarea lanțului pentru un extras citit, față de ce e deja salvat pe cont
  const verificaLant = useCallback((x: ExtrasCitit, cont: Cont): Verif => {
    const pe = extrase.filter(e => e.cont_id === cont.id)
    const supr = pe.find(e => e.data_inceput <= x.data_sfarsit && e.data_sfarsit >= x.data_inceput)
    if (supr) return { ok: false, text: `Perioada se suprapune cu extrasul nr. ${supr.numar} (${data(supr.data_inceput)} – ${data(supr.data_sfarsit)}), deja încărcat.` }
    const ant = pe.filter(e => e.data_sfarsit < x.data_inceput).at(-1)
    const urm = pe.find(e => e.data_inceput > x.data_sfarsit)
    if (ant && rot(ant.sold_final) !== rot(x.sold_initial)) return { ok: false, text: `Soldul inițial ${num(x.sold_initial)} nu e egal cu soldul final ${num(ant.sold_final)} al extrasului anterior (nr. ${ant.numar}, până la ${data(ant.data_sfarsit)}).` }
    if (urm && rot(urm.sold_initial) !== rot(x.sold_final)) return { ok: false, text: `Soldul final ${num(x.sold_final)} nu e egal cu soldul inițial ${num(urm.sold_initial)} al extrasului următor (nr. ${urm.numar}, de la ${data(urm.data_inceput)}).` }
    if (cont.mixt_pana_la && x.operatiuni.some(o => o.data_operatiune > cont.mixt_pana_la!)) return { ok: false, text: `Contul e al proiectului doar până la ${data(cont.mixt_pana_la)} (cont mixt), iar extrasul are operațiuni de după.` }
    const parti: string[] = []
    if (ant) parti.push(ant.data_sfarsit === ziua(x.data_inceput, -1) ? `continuă extrasul nr. ${ant.numar}` : `după extrasul nr. ${ant.numar}, dar lipsesc zilele ${data(ziua(ant.data_sfarsit, 1))} – ${data(ziua(x.data_inceput, -1))}`)
    else parti.push(rot(x.sold_initial) === rot(cont.sold_deschidere) || x.data_inceput > cont.data_deschidere ? 'primul extras al contului' : `soldul inițial diferă de soldul de deschidere (${num(cont.sold_deschidere)})`)
    if (urm) parti.push(`se leagă de extrasul nr. ${urm.numar}`)
    return { ok: true, text: `Lanțul de solduri: ${parti.join('; ')}.` }
  }, [extrase])

  async function adaugaFisiere(lista: FileList | null) {
    if (!lista || !conturi) return
    setMesaj(null)
    const noi: Element[] = [...lista].map((f, i) => ({ cheie: `${Date.now()}-${i}-${f.name}`, nume: f.name, stare: 'citesc', fisier: f }))
    setCoada(c => [...noi, ...c])
    for (const el of noi) {
      const f = el.fisier!
      let rez: Partial<Element>
      try {
        if (f.type && f.type !== 'application/pdf') throw new Error('Nu e un fișier PDF.')
        const buf = await f.arrayBuffer()
        const hash = await amprenta(buf)
        const deja = extrase.find(e => e.fisier_amprenta === hash)
        if (deja) throw new Error(`Fișierul e deja încărcat (extrasul nr. ${deja.numar}, ${data(deja.data_inceput)} – ${data(deja.data_sfarsit)}).`)
        if (coada.some(c => c.hash === hash)) throw new Error('Același fișier e deja în lista de mai jos.')
        const text = await textCuPozitii(buf)
        const x = citesteExtrasBCR(text, conturi.map(c => ({ iban: c.iban, proiect_pana_la: c.mixt_pana_la })))
        const cont = conturi.find(c => c.iban === x.iban)
        if (!cont) throw new Error(`Extrasul e pentru contul ${fmtIban(x.iban)}, care nu e un cont al acestui contract.`)
        if (cont.moneda !== x.moneda) throw new Error(`Extrasul e în ${x.moneda}, contul e în ${cont.moneda}.`)
        const verif: Verif[] = [...verifica(x), verificaLant(x, cont), ...x.avertismente.map(a => ({ ok: null, text: a }))]
        rez = { stare: 'gata', extras: x, cont, hash, verif, deschis: true }
      } catch (e) {
        rez = { stare: 'eroare', mesaj: e instanceof Error ? e.message : String(e) }
      }
      setCoada(c => c.map(z => z.cheie === el.cheie ? { ...z, ...rez } : z))
    }
  }

  async function salveaza(el: Element): Promise<boolean> {
    const x = el.extras!, cont = el.cont!
    setCoada(c => c.map(z => z.cheie === el.cheie ? { ...z, stare: 'salvez', mesaj: undefined } : z))
    const cale = `${id}/${cont.id}/${el.hash}.pdf`
    const up = await supabase.storage.from('extrase').upload(cale, el.fisier!, { contentType: 'application/pdf', upsert: false })
    if (up.error && !/exists|duplicate/i.test(up.error.message)) {
      setCoada(c => c.map(z => z.cheie === el.cheie ? { ...z, stare: 'gata', mesaj: `Fișierul nu a putut fi urcat: ${up.error.message}` } : z))
      return false
    }
    const { operatiuni, avertismente: _a, banca: _b, titular: _t, cui_titular: _c, data_emitere: _d, ...antet } = x
    void _a; void _b; void _t; void _c; void _d
    const r = await supabase.rpc('incarca_extras', {
      p_cont: cont.id,
      p_extras: { ...antet, fisier_cale: cale, fisier_amprenta: el.hash },
      p_operatiuni: operatiuni.map(o => ({ ...o, referinta: o.referinta || null })),
    })
    if (r.error) {
      setCoada(c => c.map(z => z.cheie === el.cheie ? { ...z, stare: 'gata', mesaj: r.error.message } : z))
      return false
    }
    setCoada(c => c.map(z => z.cheie === el.cheie ? { ...z, stare: 'salvat', deschis: false, mesaj: `Salvat: ${r.data.operatiuni} operațiuni.` } : z))
    return true
  }

  async function salveazaToate() {
    const gata = coada.filter(z => z.stare === 'gata' && z.verif?.every(v => v.ok !== false))
      .sort((a, b) => (a.cont!.iban + a.extras!.data_inceput).localeCompare(b.cont!.iban + b.extras!.data_inceput))
    let n = 0
    for (const el of gata) if (await salveaza(el)) n++
    await incarca()
    setMesaj({ cls: n ? 'verde' : 'galben', text: n ? `${n} ${n === 1 ? 'extras salvat' : 'extrase salvate'}. Operațiunile noi așteaptă pe ecranul de validare.` : 'Nu s-a salvat niciun extras.' })
  }

  async function salveazaUnul(el: Element) {
    const ok = await salveaza(el)
    await incarca()
    if (ok) setMesaj({ cls: 'verde', text: `Extrasul nr. ${el.extras!.numar} (${data(el.extras!.data_inceput)} – ${data(el.extras!.data_sfarsit)}) a fost salvat. Operațiunile lui așteaptă pe ecranul de validare.` })
  }

  // După fiecare salvare, verificările de lanț ale celorlalte extrase din listă se refac
  useEffect(() => {
    setCoada(c => c.map(z => z.stare === 'gata' && z.extras && z.cont
      ? { ...z, verif: [...verifica(z.extras), verificaLant(z.extras, z.cont), ...z.extras.avertismente.map(a => ({ ok: null, text: a }))] } : z))
  }, [verificaLant])

  async function deschidePdf(cale: string) {
    const { data: u, error } = await supabase.storage.from('extrase').createSignedUrl(cale, 300)
    if (error || !u) { setMesaj({ cls: 'rosu', text: 'PDF-ul nu a putut fi deschis.' }); return }
    window.open(u.signedUrl, '_blank', 'noopener')
  }

  const lanturi = useMemo(() => (conturi ?? []).map(c => construiesteLant(c, extrase.filter(e => e.cont_id === c.id))), [conturi, extrase])

  if (eroare) return <div className="alerta rosu">{eroare}</div>
  if (!conturi) return <div className="gol">Se încarcă extrasele…</div>

  const deSalvat = coada.filter(z => z.stare === 'gata' && z.verif?.every(v => v.ok !== false)).length
  const goluri = lanturi.reduce((s, l) => s + l.randuri.filter(r => r.tip === 'lipsa').length, 0)
  const urmeaza = lanturi.filter(l => l.randuri.some(r => r.tip === 'urmeaza')).length
  const rupte = lanturi.reduce((s, l) => s + l.randuri.filter(r => r.tip === 'extras' && r.rupt).length, 0)

  return (
    <>
      <Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link>
      <section className="titlu-pagina">
        <h1>Extrase de cont</h1>
        <p>Fiecare cont trebuie să aibă extrasele unul după altul, fără goluri: soldul final al unui extras e soldul inițial al următorului. Așa știm că nicio operațiune nu lipsește.</p>
      </section>

      <section className="cifre">
        <div className="cifra"><div className="cifra-eticheta">Conturi</div><div className="cifra-valoare">{conturi.length}</div><div className="cifra-sub">ale contractului</div></div>
        <div className="cifra"><div className="cifra-eticheta">Extrase încărcate</div><div className="cifra-valoare">{extrase.length}</div><div className="cifra-sub">{Object.values(nrOp).reduce((s, n) => s + n, 0)} operațiuni</div></div>
        <div className={`cifra ${goluri ? '' : 'accent'}`}><div className="cifra-eticheta">Perioade fără extras</div><div className={`cifra-valoare ${goluri ? 'rosu-text' : ''}`}>{goluri}</div><div className="cifra-sub">{goluri ? 'de cerut de la bancă' : 'lanț complet'}{urmeaza ? ` · ${urmeaza} ${urmeaza === 1 ? 'cont așteaptă' : 'conturi așteaptă'} extrasele noi` : ''}</div></div>
        <div className="cifra"><div className="cifra-eticheta">Lanț de solduri rupt</div><div className={`cifra-valoare ${rupte ? 'rosu-text' : ''}`}>{rupte}</div><div className="cifra-sub">{rupte ? 'de verificat' : 'toate se leagă'}</div></div>
      </section>

      <section className="bloc">
        <div className="bloc-titlu"><h2>Încarcă extrase noi</h2>
          <p>PDF-urile descărcate din George / BCR Business. Le puteți alege pe mai multe deodată, în orice ordine: aplicația recunoaște contul după IBAN și le așază în ordinea datelor.</p></div>
        <label className="zona-incarcare">
          <input type="file" accept="application/pdf,.pdf" multiple onChange={e => { adaugaFisiere(e.target.files); e.target.value = '' }} />
          <span>Alege extrasele (PDF)</span>
          <span className="mic gri">Fișierul e citit pe calculatorul dvs.; se urcă doar când apăsați „Salvează”.</span>
        </label>
        {mesaj && <div className={`alerta ${mesaj.cls}`} style={{ marginTop: 12 }}>{mesaj.text}{mesaj.cls === 'verde' && <> <Link className="link-mic" to={`/contract/${id}/operatiuni`}>Deschide validarea →</Link></>}</div>}
        {coada.length > 0 && (
          <div className="coada-extrase">
            {deSalvat > 1 && <div className="rand-butoane"><button className="buton" onClick={salveazaToate}>Salvează toate cele {deSalvat} extrase verificate</button></div>}
            {coada.map(el => <CardCitit key={el.cheie} el={el} salveaza={() => salveazaUnul(el)}
              renunta={() => setCoada(c => c.filter(z => z.cheie !== el.cheie))}
              comuta={() => setCoada(c => c.map(z => z.cheie === el.cheie ? { ...z, deschis: !z.deschis } : z))} />)}
          </div>
        )}
      </section>

      {lanturi.map(l => (
        <section key={l.cont.id} className="bloc fara-padding">
          <div className="bloc-titlu cap-cont">
            <div>
              <h2>{l.cont.denumire ?? fmtIban(l.cont.iban)}</h2>
              <p className="mono">{fmtIban(l.cont.iban)} · {l.cont.moneda}{l.cont.mixt_pana_la ? ` · cont mixt până la ${data(l.cont.mixt_pana_la)} (după această dată nu mai e al proiectului)` : ''}</p>
            </div>
            <div className="n">
              <div className="mic gri">Sold la {l.ultim ? data(l.ultim.data_sfarsit) : data(l.cont.data_deschidere)}</div>
              <div className="tare">{bani(l.ultim ? l.ultim.sold_final : l.cont.sold_deschidere, l.cont.moneda)}</div>
            </div>
          </div>
          <div className="tabel-wrap">
            <table className="tabel-op">
              <thead><tr><th>Extras</th><th>Perioada</th><th className="n">Sold inițial</th><th className="n">Plăți (debit)</th><th className="n">Încasări (credit)</th><th className="n">Sold final</th><th className="n">Operațiuni</th><th>Lanț</th><th /></tr></thead>
              <tbody>
                {l.randuri.map((r, i) => r.tip === 'extras' ? (
                  <tr key={r.e.id} className={r.rupt ? 'rand-rosu' : ''}>
                    <td className="tare">nr. {r.e.numar}</td>
                    <td className="nowrap">{data(r.e.data_inceput)} – {data(r.e.data_sfarsit)}</td>
                    <td className="n">{num(r.e.sold_initial)}</td>
                    <td className="n">{num(r.e.total_debit)}</td>
                    <td className="n">{num(r.e.total_credit)}</td>
                    <td className="n tare">{num(r.e.sold_final)}</td>
                    <td className="n">{nrOp[r.e.id] ?? 0}</td>
                    <td className="nowrap">{r.rupt ? <span className="eticheta rosu" title={r.rupt}>rupt</span> : <span className="eticheta verde">✓ se leagă</span>}
                      {r.rupt && <div className="mic rosu-text">{r.rupt}</div>}</td>
                    <td><button className="link-mic" onClick={() => deschidePdf(r.e.fisier_cale)}>PDF</button></td>
                  </tr>
                ) : (
                  <tr key={`g${i}`} className="rand-lipsa">
                    <td className="tare">{r.tip === 'urmeaza' ? 'urmează' : 'lipsește'}</td>
                    <td className="nowrap">{data(r.de)} – {data(r.pana)}</td>
                    <td colSpan={7} className="mic">{r.tip === 'urmeaza'
                      ? 'Extrasele de după ultimul încărcat. Descărcați-le din George și încărcați-le mai sus.'
                      : 'Nu există extras pentru aceste zile. Cereți-l băncii (sau descărcați-l din George) și încărcați-l, ca lanțul să fie complet.'}</td>
                  </tr>
                ))}
                {l.randuri.length === 0 && <tr><td colSpan={9} className="gol-rand">Niciun extras încărcat pentru acest cont.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p className="nota">Formatul acceptat acum: extrasele BCR în PDF. Pentru o bancă nouă, primul extras se trimite la M.V. Consulting, care adaugă formatul băncii în bibliotecă.</p>
    </>
  )
}

type RandLant = { tip: 'extras'; e: Extras; rupt: string | null } | { tip: 'lipsa' | 'urmeaza'; de: string; pana: string }

function construiesteLant(cont: Cont, ex: Extras[]) {
  const randuri: RandLant[] = []
  let prec: Extras | null = null
  for (const e of [...ex].sort((a, b) => a.data_inceput.localeCompare(b.data_inceput))) {
    if (prec && e.data_inceput > ziua(prec.data_sfarsit, 1)) randuri.push({ tip: 'lipsa', de: ziua(prec.data_sfarsit, 1), pana: ziua(e.data_inceput, -1) })
    if (!prec && e.data_inceput > cont.data_deschidere) randuri.push({ tip: 'lipsa', de: cont.data_deschidere, pana: ziua(e.data_inceput, -1) })
    const asteptat = prec ? prec.sold_final : (e.data_inceput <= cont.data_deschidere ? cont.sold_deschidere : null)
    const rupt = asteptat != null && rot(asteptat) !== rot(e.sold_initial)
      ? `sold inițial ${num(e.sold_initial)}, dar ${prec ? 'extrasul anterior se încheie' : 'contul s-a deschis'} cu ${num(asteptat)}` : null
    randuri.push({ tip: 'extras', e, rupt })
    prec = e
  }
  // după ultimul extras: până la sfârșitul perioadei mixte (conturile vechi) sau până la luna trecută (conturile proiectului)
  const limita = cont.mixt_pana_la ?? (cont.activ ? sfarsitLunaTrecuta() : null)
  const de = prec ? ziua(prec.data_sfarsit, 1) : cont.data_deschidere
  if (limita && de <= limita) randuri.push({ tip: cont.mixt_pana_la ? 'lipsa' : 'urmeaza', de, pana: limita })
  return { cont, randuri, ultim: prec }
}

function CardCitit({ el, salveaza, renunta, comuta }: { el: Element; salveaza: () => void; renunta: () => void; comuta: () => void }) {
  const x = el.extras
  if (el.stare === 'citesc') return <div className="card-extras"><span className="tare">{el.nume}</span> <span className="gri">· se citește…</span></div>
  if (el.stare === 'eroare' || !x || !el.cont) return (
    <div className="card-extras eroare">
      <div className="card-extras-sus"><span className="tare">{el.nume}</span><button className="link-mic" onClick={renunta}>închide</button></div>
      <div className="mic rosu-text">{el.mesaj}</div>
    </div>
  )
  const blocat = el.verif?.some(v => v.ok === false)
  const deb = x.operatiuni.filter(o => o.sens === 'debit').length
  return (
    <div className={`card-extras ${el.stare === 'salvat' ? 'salvat' : blocat ? 'eroare' : ''}`}>
      <div className="card-extras-sus">
        <div>
          <div className="tare">Extras nr. {x.numar} · {data(x.data_inceput)} – {data(x.data_sfarsit)}
            {el.stare === 'salvat' && <span className="eticheta verde" style={{ marginLeft: 8 }}>salvat</span>}</div>
          <div className="mic gri">{el.cont.denumire ?? ''} · <span className="mono">{fmtIban(x.iban)}</span> · {el.nume}</div>
        </div>
        <div className="n">
          <div className="mic gri">sold {num(x.sold_initial)} → <b>{num(x.sold_final)}</b> {x.moneda}</div>
          <div className="mic gri">{x.operatiuni.length} operațiuni: {deb} plăți, {x.operatiuni.length - deb} încasări</div>
        </div>
      </div>
      {el.stare !== 'salvat' && (
        <>
          <ul className="verificari">
            {el.verif?.map((v, i) => <li key={i} className={v.ok === false ? 'rosu-text' : v.ok ? 'verde-text' : 'gri'}>{v.ok === false ? '✗' : v.ok ? '✓' : '•'} {v.text}</li>)}
          </ul>
          {el.mesaj && <div className="alerta rosu spatiu">{el.mesaj}</div>}
          <div className="rand-butoane">
            <button className="buton mic-b" disabled={blocat || el.stare === 'salvez'} onClick={salveaza}>{el.stare === 'salvez' ? 'Se salvează…' : 'Salvează extrasul'}</button>
            <button className="buton-text" onClick={comuta}>{el.deschis ? 'Ascunde operațiunile' : 'Vezi operațiunile'}</button>
            <button className="buton-text" disabled={el.stare === 'salvez'} onClick={renunta}>Renunță</button>
          </div>
          {el.deschis && (
            <div className="tabel-wrap" style={{ marginTop: 10 }}>
              <table className="tabel-op">
                <thead><tr><th>#</th><th>Data</th><th className="lat">Ce scrie banca</th><th className="n">Plată</th><th className="n">Încasare</th><th>Tip propus</th></tr></thead>
                <tbody>
                  {x.operatiuni.map(o => (
                    <Fragment key={o.rand}>
                      <tr>
                        <td className="gri">{o.rand}</td>
                        <td className="nowrap">{data(o.data_operatiune)}{o.data_tranzactie && o.data_tranzactie !== o.data_operatiune && <div className="mic gri">card: {data(o.data_tranzactie)}</div>}</td>
                        <td className="lat mic">{o.descriere.length > 170 ? o.descriere.slice(0, 170) + '…' : o.descriere}</td>
                        <td className="n">{o.sens === 'debit' ? num(o.suma) : ''}</td>
                        <td className="n">{o.sens === 'credit' ? num(o.suma) : ''}</td>
                        <td className="nowrap"><span className="eticheta">{TIP[o.tip_propus] ?? o.tip_propus}</span>{o.parinte_rand && <div className="mic gri">la rândul {o.parinte_rand}</div>}
                          {o.curs && <div className="mic gri">curs {o.curs}</div>}</td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={3}>Total</td><td className="n">{num(x.total_debit)}</td><td className="n">{num(x.total_credit)}</td><td /></tr></tfoot>
              </table>
            </div>
          )}
        </>
      )}
      {el.stare === 'salvat' && <div className="mic verde-text">{el.mesaj}</div>}
    </div>
  )
}

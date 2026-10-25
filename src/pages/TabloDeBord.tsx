import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { bani, curs, data, iban, MOD_CALCUL, num, procent, STARE_CONTRACT, TIP_TRANSA } from '../lib/format'

type Contract = {
  id: string; numar_contract: string; cod_proiect: string | null; titlu: string | null
  valoare_finantare_eur: number; data_inceput: string; data_sfarsit: string; stare: string
  organizatii: { denumire: string; cui: string | null } | null
  programe: { denumire: string; moneda: string; regula_curs: string | null; sursa_curs_referinta: string } | null
}
type Perioada = { perioada: number; data_inceput: string; data_sfarsit: string; curs: number | null; nr_zile: number; provizoriu: boolean }
type StarePerioada = { numar: number; stare: string }
type Cont = { id: string; iban: string; moneda: string; denumire: string | null; mixt_de_la: string | null; mixt_pana_la: string | null; banci: { denumire: string } | null }
type Sold = { cont_id: string; sold_din_operatiuni: number; sold_ultim_extras: number | null; data_ultim_extras: string | null }
type Capitol = { capitol: string; buget_capitol: number; pondere_procent: number; total_incasat: number; incasat_repartizat: number; cheltuit_eur: number; cheltuit_lei_neconvertit: number; semnal_depasire: boolean }
type Pozitie = { capitol: string; denumire: string; mod_calcul: string; procent: number | null; ordine: number }
type Transa = { id: string; numar: number; tip: string; suma_asteptata_eur: number | null; termen: string | null; operatiune_id: string | null }
type Veriga = { extras_id: string; cont_id: string; numar: string; data_inceput: string; data_sfarsit: string; sold_initial: number; sold_final: number; stare_lant: string; nr_operatiuni: number; operatiuni_complete: boolean }

type DateTablou = {
  contract: Contract; perioade: Perioada[]; stari: StarePerioada[]; conturi: Cont[]; solduri: Sold[]
  capitole: Capitol[]; pozitii: Pozitie[]; transe: Transa[]; lant: Veriga[]
}

const STARE_LANT: Record<string, { text: string; cls: string }> = {
  ok: { text: 'în regulă', cls: 'verde' },
  veriga_lipsa: { text: 'lipsește un extras înainte', cls: 'rosu' },
  suprapunere: { text: 'se suprapune cu cel anterior', cls: 'rosu' },
  pauza_de_verificat: { text: 'pauză între extrase – de verificat', cls: 'galben' },
}

export default function TabloDeBord() {
  const { id } = useParams()
  const [d, setD] = useState<DateTablou | null>(null)
  const [eroare, setEroare] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    ;(async () => {
      const [k, p, sp, c, s, cap, poz, t, l] = await Promise.all([
        supabase.from('contracte').select('id,numar_contract,cod_proiect,titlu,valoare_finantare_eur,data_inceput,data_sfarsit,stare,organizatii(denumire,cui),programe(denumire,moneda,regula_curs,sursa_curs_referinta)').eq('id', id).maybeSingle(),
        supabase.from('v_curs_perioade').select('perioada,data_inceput,data_sfarsit,curs,nr_zile,provizoriu').eq('contract_id', id).order('perioada'),
        supabase.from('perioade_raportare').select('numar,stare').eq('contract_id', id),
        supabase.from('conturi').select('id,iban,moneda,denumire,mixt_de_la,mixt_pana_la,banci(denumire)').eq('contract_id', id).order('moneda', { ascending: false }),
        supabase.from('v_solduri_conturi').select('cont_id,sold_din_operatiuni,sold_ultim_extras,data_ultim_extras').eq('contract_id', id),
        supabase.from('v_repartizare_incasari').select('capitol,buget_capitol,pondere_procent,total_incasat,incasat_repartizat,cheltuit_eur,cheltuit_lei_neconvertit,semnal_depasire').eq('contract_id', id),
        supabase.from('pozitii_buget').select('capitol,denumire,mod_calcul,procent,ordine').eq('contract_id', id).order('ordine'),
        supabase.from('transe').select('id,numar,tip,suma_asteptata_eur,termen,operatiune_id').eq('contract_id', id).order('numar'),
        supabase.from('v_lant_extrase').select('extras_id,cont_id,numar,data_inceput,data_sfarsit,sold_initial,sold_final,stare_lant,nr_operatiuni,operatiuni_complete').eq('contract_id', id).order('data_inceput'),
      ])
      const err = [k, p, sp, c, s, cap, poz, t, l].find(r => r.error)
      if (err || !k.data) { setEroare(k.data === null && !err ? 'Contractul nu există sau nu aveți acces la el.' : 'Datele nu au putut fi citite.'); return }
      setD({
        contract: k.data as unknown as Contract, perioade: (p.data ?? []) as Perioada[], stari: (sp.data ?? []) as StarePerioada[],
        conturi: (c.data ?? []) as unknown as Cont[], solduri: (s.data ?? []) as Sold[], capitole: (cap.data ?? []) as Capitol[],
        pozitii: (poz.data ?? []) as Pozitie[], transe: (t.data ?? []) as Transa[], lant: (l.data ?? []) as Veriga[],
      })
    })()
  }, [id])

  const calc = useMemo(() => {
    if (!d) return null
    const azi = new Date().toISOString().slice(0, 10)
    const curenta = d.perioade.find(p => azi >= p.data_inceput && azi <= p.data_sfarsit) ?? d.perioade[d.perioade.length - 1]
    const cursCurent = curenta?.curs ? Number(curenta.curs) : null

    const buget = d.capitole.reduce((a, c) => a + Number(c.buget_capitol), 0)
    const incasat = Number(d.capitole[0]?.total_incasat ?? 0)
    const chEur = d.capitole.reduce((a, c) => a + Number(c.cheltuit_eur), 0)
    const chLei = d.capitole.reduce((a, c) => a + Number(c.cheltuit_lei_neconvertit), 0)
    const chEchiv = chEur + (cursCurent ? chLei / cursCurent : 0)

    const conturi = d.conturi.map(c => {
      const s = d.solduri.find(x => x.cont_id === c.id)
      const sold = Number(s?.sold_din_operatiuni ?? 0)
      const echiv = c.moneda === 'EUR' ? sold : cursCurent ? sold / cursCurent : null
      return { ...c, sold, s, echiv }
    })
    const disponibilEchiv = conturi.reduce((a, c) => a + (c.echiv ?? 0), 0)

    const capitole = d.pozitii.map(p => {
      const c = d.capitole.find(x => x.capitol === p.capitol)
      const chEurC = Number(c?.cheltuit_eur ?? 0)
      const chLeiC = Number(c?.cheltuit_lei_neconvertit ?? 0)
      const chEchivC = chEurC + (cursCurent ? chLeiC / cursCurent : 0)
      const bug = Number(c?.buget_capitol ?? 0)
      return { ...p, buget: bug, pondere: Number(c?.pondere_procent ?? 0), incasat: Number(c?.incasat_repartizat ?? 0), chLei: chLeiC, chEchiv: chEchivC, ramas: bug - chEchivC, depasire: !!c?.semnal_depasire }
    })

    const fara = d.lant.length === 0
    return { curenta, cursCurent, buget, incasat, chEur, chLei, chEchiv, conturi, disponibilEchiv, capitole, fara }
  }, [d])

  if (eroare) return <><Link to="/" className="inapoi">← Contracte</Link><div className="alerta rosu">{eroare}</div></>
  if (!d || !calc) return <div className="gol">Se încarcă tabloul de bord…</div>

  const k = d.contract
  const moneda = k.programe?.moneda ?? 'EUR'
  const atentionari: { cls: string; text: string }[] = []
  if (calc.fara) atentionari.push({ cls: 'galben', text: 'Nu s-a încărcat încă niciun extras de cont: soldurile și cheltuielile vor apărea după încărcarea extraselor.' })
  if (d.transe.length === 0) atentionari.push({ cls: 'galben', text: 'Nu sunt înregistrate tranșele de finanțare: „Încasat” rămâne 0 până la legarea primei încasări de o tranșă.' })
  for (const c of d.conturi) if (c.mixt_de_la) atentionari.push({ cls: 'albastru', text: `Contul ${c.denumire ?? iban(c.iban)} a fost folosit și pentru alte activități între ${data(c.mixt_de_la)} și ${data(c.mixt_pana_la)}: operațiunile din acest interval se marchează una câte una „aferente” sau „neaferente” proiectului.` })
  for (const v of d.lant) if (v.stare_lant !== 'ok') atentionari.push({ cls: STARE_LANT[v.stare_lant]?.cls ?? 'galben', text: `Extrasul ${v.numar} (${data(v.data_inceput)}–${data(v.data_sfarsit)}): ${STARE_LANT[v.stare_lant]?.text ?? v.stare_lant}.` })
  if (calc.capitole.some(c => c.depasire)) atentionari.push({ cls: 'rosu', text: 'Cel puțin un capitol a cheltuit mai mult decât partea lui din banii primiți.' })

  return (
    <>
      <Link to="/" className="inapoi">← Contracte</Link>

      <section className="antet">
        <div>
          <div className="cod">{k.cod_proiect} · {k.programe?.denumire}</div>
          <h1>{k.organizatii?.denumire}</h1>
          <div className="detaliu">
            Contract nr. {k.numar_contract} · CUI {k.organizatii?.cui ?? '—'} · {data(k.data_inceput)} – {data(k.data_sfarsit)}
          </div>
        </div>
        <span className={`stare stare-${k.stare}`}>{STARE_CONTRACT[k.stare] ?? k.stare}</span>
      </section>

      <section className="cifre">
        <Cifra eticheta="Buget aprobat" valoare={bani(calc.buget || k.valoare_finantare_eur, moneda)} />
        <Cifra eticheta="Primit de la finanțator" valoare={bani(calc.incasat, moneda)} sub={calc.buget ? `${procent((100 * calc.incasat) / calc.buget)} din buget` : undefined} />
        <Cifra eticheta="Cheltuit (decontat)" valoare={bani(calc.chEchiv, moneda)} sub={calc.chLei ? `din care ${bani(calc.chLei, 'RON')} convertiți estimativ` : 'echivalent la cursul HEAT'} />
        <Cifra eticheta="Bani în conturi acum" valoare={bani(calc.disponibilEchiv, moneda)} sub="echivalent la cursul perioadei curente" accent />
      </section>

      {atentionari.length > 0 && (
        <section className="atentionari">
          {atentionari.map((a, i) => <div key={i} className={`alerta ${a.cls}`}>{a.text}</div>)}
        </section>
      )}

      <section className="bloc">
        <div className="bloc-titlu">
          <h2>Conturile proiectului</h2>
          <p>Soldul calculat din operațiunile încărcate, comparat cu soldul ultimului extras.</p>
        </div>
        <div className="tabel-wrap">
          <table>
            <thead><tr><th>Cont</th><th>Monedă</th><th className="n">Sold</th><th className="n">Sold ultim extras</th><th className="n">Echivalent {moneda}</th></tr></thead>
            <tbody>
              {calc.conturi.map(c => (
                <tr key={c.id}>
                  <td><div className="tare">{c.denumire ?? c.banci?.denumire}</div><div className="mic gri mono">{iban(c.iban)}</div></td>
                  <td>{c.moneda === 'RON' ? 'lei' : c.moneda}</td>
                  <td className="n tare">{num(c.sold)}</td>
                  <td className="n">{c.s?.sold_ultim_extras != null ? <>{num(c.s.sold_ultim_extras)}<div className="mic gri">la {data(c.s.data_ultim_extras)}</div></> : <span className="gri">fără extrase</span>}</td>
                  <td className="n">{c.echiv != null ? num(c.echiv) : '—'}</td>
                </tr>
              ))}
              {calc.conturi.length === 0 && <tr><td colSpan={5} className="gol-rand">Niciun cont înregistrat.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bloc">
        <div className="bloc-titlu">
          <h2>Bugetul pe capitole</h2>
          <p>Banii primiți se împart pe capitole după ponderea fiecăruia în buget și se reîmpart la fiecare tranșă nouă.</p>
        </div>
        <div className="tabel-wrap">
          <table>
            <thead><tr><th>Capitol</th><th className="n">Buget</th><th className="n">Pondere</th><th className="n">Primit (repartizat)</th><th className="n">Cheltuit</th><th className="n">Rămas din buget</th><th>Execuție</th></tr></thead>
            <tbody>
              {calc.capitole.map(c => {
                const pct = c.buget ? Math.min(100, (100 * c.chEchiv) / c.buget) : 0
                return (
                  <tr key={c.capitol} className={c.depasire ? 'rand-rosu' : ''}>
                    <td><div className="tare">{c.capitol} · {c.denumire}</div><div className="mic gri">{MOD_CALCUL[c.mod_calcul] ?? c.mod_calcul}{c.mod_calcul === 'procent' && c.procent ? ` · ${c.procent}% din costurile directe A + C` : ''}</div></td>
                    <td className="n">{num(c.buget)}</td>
                    <td className="n">{procent(c.pondere)}</td>
                    <td className="n">{num(c.incasat)}</td>
                    <td className="n">{num(c.chEchiv)}{c.chLei > 0 && <div className="mic gri">{bani(c.chLei, 'RON')}</div>}</td>
                    <td className="n tare">{num(c.ramas)}</td>
                    <td><div className="bara-progres"><span style={{ width: `${pct}%` }} /></div><div className="mic gri">{procent(pct)}</div></td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr><td>Total</td><td className="n">{num(calc.buget)}</td><td className="n">100,0%</td><td className="n">{num(calc.incasat)}</td><td className="n">{num(calc.chEchiv)}</td><td className="n">{num(calc.buget - calc.chEchiv)}</td><td /></tr>
            </tfoot>
          </table>
        </div>
        <p className="nota">Sume în {moneda}. Cheltuielile în lei apar aici convertite estimativ la cursul perioadei curente; în raportare se folosește cursul perioadei în care au fost făcute.</p>
      </section>

      <div className="doua-coloane">
        <section className="bloc">
          <div className="bloc-titlu">
            <h2>Cursul de referință pe perioade</h2>
            <p>{k.programe?.regula_curs}</p>
          </div>
          <div className="tabel-wrap">
            <table>
              <thead><tr><th>Perioada</th><th>Interval</th><th className="n">Curs {k.programe?.sursa_curs_referinta}</th><th>Stare</th></tr></thead>
              <tbody>
                {d.perioade.map(p => {
                  const st = d.stari.find(s => s.numar === p.perioada)?.stare
                  return (
                    <tr key={p.perioada} className={calc.curenta?.perioada === p.perioada ? 'rand-curent' : ''}>
                      <td className="tare">Perioada {p.perioada}</td>
                      <td>{data(p.data_inceput)} – {data(p.data_sfarsit)}</td>
                      <td className="n mono">{curs(p.curs)}<div className="mic gri">{p.nr_zile} zile cu curs</div></td>
                      <td>
                        {p.provizoriu ? <span className="eticheta galben">provizoriu</span> : <span className="eticheta verde">definitiv</span>}
                        {st === 'raportata' && <span className="eticheta">raportată</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="nota">„Provizoriu” = perioada nu s-a încheiat; media se recalculează zilnic până la ultima zi a perioadei.</p>
        </section>

        <section className="bloc">
          <div className="bloc-titlu">
            <h2>Tranșele de finanțare</h2>
            <p>Ce trebuie să primească firma de la finanțator și ce a primit deja.</p>
          </div>
          {d.transe.length === 0 ? (
            <div className="gol mic-gol">Nu sunt înregistrate tranșe. Se adaugă din contract (prefinanțare, plăți intermediare, plata finală).</div>
          ) : (
            <div className="tabel-wrap">
              <table>
                <thead><tr><th>Nr.</th><th>Tip</th><th className="n">Sumă așteptată</th><th>Termen</th><th>Stare</th></tr></thead>
                <tbody>
                  {d.transe.map(t => (
                    <tr key={t.id}>
                      <td>{t.numar}</td><td>{TIP_TRANSA[t.tip] ?? t.tip}</td>
                      <td className="n">{t.suma_asteptata_eur != null ? num(t.suma_asteptata_eur) : '—'}</td>
                      <td>{data(t.termen)}</td>
                      <td>{t.operatiune_id ? <span className="eticheta verde">încasată</span> : <span className="eticheta">așteptată</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="bloc">
        <div className="bloc-titlu">
          <h2>Lanțul extraselor</h2>
          <p>Soldul final al fiecărui extras trebuie să fie soldul inițial al următorului. Orice verigă lipsă e semnalată.</p>
        </div>
        {calc.conturi.map(c => {
          const verigi = d.lant.filter(v => v.cont_id === c.id)
          return (
            <div key={c.id} className="lant">
              <div className="lant-cont">{c.denumire ?? iban(c.iban)}</div>
              {verigi.length === 0 ? <div className="gol mic-gol">Niciun extras încărcat pentru acest cont.</div> : (
                <div className="tabel-wrap">
                  <table>
                    <thead><tr><th>Extras</th><th>Interval</th><th className="n">Sold inițial</th><th className="n">Sold final</th><th className="n">Operațiuni</th><th>Verificare</th></tr></thead>
                    <tbody>
                      {verigi.map(v => (
                        <tr key={v.extras_id}>
                          <td className="tare">{v.numar}</td><td>{data(v.data_inceput)} – {data(v.data_sfarsit)}</td>
                          <td className="n">{num(v.sold_initial)}</td><td className="n">{num(v.sold_final)}</td>
                          <td className="n">{v.nr_operatiuni}{!v.operatiuni_complete && <div className="mic rosu-text">incomplete</div>}</td>
                          <td><span className={`eticheta ${STARE_LANT[v.stare_lant]?.cls ?? ''}`}>{STARE_LANT[v.stare_lant]?.text ?? v.stare_lant}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </section>
    </>
  )
}

function Cifra({ eticheta, valoare, sub, accent }: { eticheta: string; valoare: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`cifra ${accent ? 'accent' : ''}`}>
      <div className="cifra-eticheta">{eticheta}</div>
      <div className="cifra-valoare">{valoare}</div>
      {sub && <div className="cifra-sub">{sub}</div>}
    </div>
  )
}

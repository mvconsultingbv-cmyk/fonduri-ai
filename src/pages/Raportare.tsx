import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { bani, curs, data, num, procent } from '../lib/format'

// Raportare pe perioade: situația financiară pe capitole, în EUR, la cursul de referință al perioadei.
// Calculul e făcut în baza de date (v_raport_perioade), pe aceleași reguli ca tabloul de bord:
//  - A Personal: eligibilul lunilor de salariu din perioadă (după regula programului), deja în EUR;
//  - C.1 / C.3: plățile alocate capitolului în perioadă; leii ÷ cursul perioadei; stornările anulează originalul;
//  - C.2 Echipamente: doar amortizarea lunilor scurse din perioadă, nu prețul de cumpărare;
//  - E Indirecte: procentul din contract (25%) aplicat la suma costurilor directe ale perioadei.
// „Neconfirmat” = sume propuse de aplicație și încă neconfirmate de utilizator (ex. lunile de salariu).

type Rand = {
  perioada_id: string; perioada: number; data_inceput: string; data_sfarsit: string; stare: string; raportata_la: string | null
  curs: number | null; provizoriu: boolean | null
  pozitie_id: string; capitol: string; cod: string; denumire: string; mod_calcul: string; procent: number | null; ordine: number
  buget_eur: number; cheltuit_eur: number; cheltuit_lei: number; eligibil_eur: number | null; neconfirmat_eur: number | null
  nr_elemente: number; nr_neconfirmate: number
}

const SURSA: Record<string, (r: Rand) => string> = {
  pontaj: r => `${r.nr_elemente} ${r.nr_elemente === 1 ? 'lună' : 'luni'} de salariu${r.nr_neconfirmate ? `, ${r.nr_neconfirmate} neconfirmate` : ''}`,
  plati: r => `${r.nr_elemente} plăți${Number(r.cheltuit_lei) ? ` · ${bani(r.cheltuit_lei, 'RON')} convertiți` : ''}${Number(r.cheltuit_eur) ? ` · ${bani(r.cheltuit_eur, 'EUR')} direct` : ''}`,
  amortizare: r => `amortizare, ${r.nr_elemente} echipamente${Number(r.cheltuit_lei) ? ` · ${bani(r.cheltuit_lei, 'RON')}` : ''}`,
  procent: r => `${num(r.procent)}% din costurile directe`,
}

const csvNum = (v: number | null | undefined) => (v == null ? '' : Number(v).toFixed(2).replace('.', ','))

export default function Raportare() {
  const { id } = useParams()
  const [randuri, setRanduri] = useState<Rand[] | null>(null)
  const [eroare, setEroare] = useState<string | null>(null)
  const [aleasa, setVedere] = useState<number | null>(null)

  useEffect(() => {
    if (!id) return
    supabase.from('v_raport_perioade').select('*').eq('contract_id', id).order('perioada').order('ordine').then(({ data: d, error }) => {
      if (error) setEroare('Datele nu au putut fi citite.')
      else setRanduri((d ?? []) as Rand[])
    })
  }, [id])

  const perioade = useMemo(() => {
    const m = new Map<number, Rand>()
    for (const r of randuri ?? []) if (!m.has(r.perioada)) m.set(r.perioada, r)
    return [...m.values()].sort((a, b) => a.perioada - b.perioada)
  }, [randuri])

  const vedere = aleasa ?? perioade[0]?.perioada ?? null

  const tabel = useMemo(() => {
    if (!randuri || vedere == null) return null
    const aici = randuri.filter(r => r.perioada === vedere)
    const linii = aici.map(r => {
      const pana = randuri.filter(x => x.pozitie_id === r.pozitie_id && x.perioada <= vedere)
      const cumulat = pana.reduce((a, x) => a + Number(x.eligibil_eur ?? 0), 0)
      const buget = Number(r.buget_eur)
      return { r, eligibil: Number(r.eligibil_eur ?? 0), neconf: Number(r.neconfirmat_eur ?? 0), cumulat, buget, ramas: buget - cumulat, exec: buget ? (cumulat / buget) * 100 : 0 }
    })
    const t = linii.reduce((a, l) => ({ eligibil: a.eligibil + l.eligibil, neconf: a.neconf + l.neconf, cumulat: a.cumulat + l.cumulat, buget: a.buget + l.buget }), { eligibil: 0, neconf: 0, cumulat: 0, buget: 0 })
    return { p: aici[0], linii, t }
  }, [randuri, vedere])

  function exportCsv() {
    if (!tabel) return
    const { p, linii, t } = tabel
    const cap = ['Capitol', 'Denumire', 'Buget EUR', `Eligibil perioada ${p.perioada} EUR`, 'din care neconfirmat EUR', 'Cumulat EUR', 'Rămas EUR', 'Execuție %', 'Calcul']
    const rows = linii.map(l => [l.r.cod, l.r.denumire, csvNum(l.buget), csvNum(l.eligibil), csvNum(l.neconf), csvNum(l.cumulat), csvNum(l.ramas), csvNum(l.exec), SURSA[l.r.mod_calcul]?.(l.r) ?? ''])
    rows.push(['TOTAL', '', csvNum(t.buget), csvNum(t.eligibil), csvNum(t.neconf), csvNum(t.cumulat), csvNum(t.buget - t.cumulat), csvNum(t.buget ? (t.cumulat / t.buget) * 100 : 0), ''])
    const antet = [[`Perioada ${p.perioada}: ${data(p.data_inceput)} – ${data(p.data_sfarsit)}`], [`Curs de referință: ${curs(p.curs)}${p.provizoriu ? ' (provizoriu)' : ''}`], [`Generat: ${new Date().toLocaleString('ro-RO')}`], []]
    const text = [...antet, cap, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `raport-perioada-${p.perioada}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  if (eroare) return <><Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link><div className="alerta rosu">{eroare}</div></>
  if (!randuri) return <div className="gol">Se încarcă raportarea…</div>
  if (!tabel) return <><Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link><div className="gol">Contractul nu are perioade de raportare definite.</div></>

  const { p, linii, t } = tabel
  const inCurs = !!p.provizoriu
  const pondereNeconf = t.eligibil ? (t.neconf / t.eligibil) * 100 : 0

  return (
    <>
      <Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link>
      <section className="titlu-pagina">
        <h1>Raportare pe perioade</h1>
        <p>Situația financiară pe capitole, în euro, la cursul de referință al perioadei: ce s-ar declara finanțatorului pentru fiecare perioadă de raportare.</p>
      </section>

      <section className="file-vederi">
        {perioade.map(x => (
          <button key={x.perioada} className={`fila ${vedere === x.perioada ? 'activa' : ''}`} onClick={() => setVedere(x.perioada)}>
            Perioada {x.perioada} · {data(x.data_inceput)} – {data(x.data_sfarsit)}
          </button>
        ))}
      </section>

      <section className="cifre">
        <div className="cifra accent"><div className="cifra-eticheta">Eligibil în perioadă</div><div className="cifra-valoare mic-v">{bani(t.eligibil, 'EUR')}</div><div className="cifra-sub">la cursul {curs(p.curs)}{p.provizoriu ? ' (provizoriu)' : ''}</div></div>
        <div className="cifra"><div className="cifra-eticheta">Din care neconfirmat</div><div className="cifra-valoare mic-v">{bani(t.neconf, 'EUR')}</div><div className="cifra-sub">{procent(pondereNeconf)} din total</div></div>
        <div className="cifra"><div className="cifra-eticheta">Cumulat de la început</div><div className="cifra-valoare mic-v">{bani(t.cumulat, 'EUR')}</div><div className="cifra-sub">{procent(t.buget ? (t.cumulat / t.buget) * 100 : 0)} din buget</div></div>
        <div className="cifra"><div className="cifra-eticheta">Stare perioadă</div><div className="cifra-valoare mic-v">{p.stare === 'raportata' ? 'raportată' : inCurs ? 'în curs' : 'deschisă'}</div><div className="cifra-sub">{p.raportata_la ? `închisă la ${data(p.raportata_la.slice(0, 10))}` : 'datele se mai pot corecta'}</div></div>
      </section>

      {t.neconf > 0 && <div className="alerta galben spatiu">
        <b>{bani(t.neconf, 'EUR')}</b> din această perioadă sunt doar <b>propuse</b> de aplicație (de exemplu lunile de salariu încă neconfirmate în ecranul <Link to={`/contract/${id}/personal`}>Personal</Link>), împreună cu partea lor de costuri indirecte. Cifrele devin definitive după confirmare.
      </div>}
      {p.provizoriu && <div className="alerta galben spatiu">Perioada e încă în curs: cursul de referință e media zilelor scurse până azi și se schimbă până la {data(p.data_sfarsit)}. Toate sumele convertite din lei se recalculează singure.</div>}
      {!p.provizoriu && p.stare !== 'raportata' && <div className="alerta albastru spatiu">
        <b>Perioada s-a încheiat, dar nu e încă închisă în aplicație.</b> Dacă raportul ei a fost deja depus la finanțator, documentul depus se va putea încărca aici, iar ecranul va arăta diferențele pe fiecare capitol față de cifrele de mai jos. Abia după aceea perioada se închide; după închidere, nimic din ea nu se mai poate modifica.
      </div>}

      <section className="bloc fara-padding">
        <div className="tabel-wrap">
          <table className="tabel-op">
            <thead><tr>
              <th>Capitol</th><th className="n">Buget</th><th className="n">Eligibil în perioadă</th><th className="n">din care neconfirmat</th>
              <th className="n">Cumulat</th><th className="n">Rămas din buget</th><th className="n">Execuție</th>
            </tr></thead>
            <tbody>
              {linii.map(l => (
                <tr key={l.r.pozitie_id}>
                  <td><b>{l.r.cod}</b> {l.r.denumire !== l.r.cod ? l.r.denumire : ''}<div className="mic gri">{SURSA[l.r.mod_calcul]?.(l.r)}</div></td>
                  <td className="n">{num(l.buget)}</td>
                  <td className="n tare">{num(l.eligibil)}</td>
                  <td className={`n ${l.neconf ? 'rosu-text' : 'gri'}`}>{l.neconf ? num(l.neconf) : '—'}</td>
                  <td className="n">{num(l.cumulat)}</td>
                  <td className={`n ${l.ramas < 0 ? 'rosu-text tare' : ''}`}>{num(l.ramas)}</td>
                  <td className="n">{procent(l.exec)}</td>
                </tr>
              ))}
              <tr className="rand-total">
                <td><b>Total</b></td>
                <td className="n tare">{num(t.buget)}</td>
                <td className="n tare">{num(t.eligibil)}</td>
                <td className="n tare">{t.neconf ? num(t.neconf) : '—'}</td>
                <td className="n tare">{num(t.cumulat)}</td>
                <td className="n tare">{num(t.buget - t.cumulat)}</td>
                <td className="n tare">{procent(t.buget ? (t.cumulat / t.buget) * 100 : 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div className="rand-butoane spatiu"><button className="buton" onClick={exportCsv}>Descarcă tabelul (CSV, se deschide în Excel)</button></div>

      <p className="nota">
        Toate sumele sunt în EUR. Cheltuielile plătite în lei se transformă la cursul de referință al perioadei ({curs(p.curs)}), adică media zilnică BCE pe perioadă (regula din contract), nu la cursul băncii; diferența de curs se vede în ecranul <Link to={`/contract/${id}/schimburi`}>Schimburi valutare</Link>.
        Echipamentele intră doar cu amortizarea lunilor scurse, nu cu prețul de cumpărare. Costurile indirecte (E) se calculează automat din costurile directe și nu au facturi proprii.
        Plățile intră în perioada în care au fost alocate pe capitol (de regulă, perioada în care s-a făcut plata).
      </p>
    </>
  )
}

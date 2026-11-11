import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { bani, curs, data, num } from '../lib/format'

// Schimburi valutare. Pentru fiecare schimb EUR → lei arătăm trei cursuri:
//  - cursul băncii (cât a primit efectiv asociația);
//  - cursul BCE din ziua schimbului (ca să se vadă cât a reținut banca);
//  - cursul de referință al perioadei (regula programului: media zilnică BCE pe perioada de raportare).
// Leii cheltuiți pe proiect se raportează în EUR la cursul de referință. Dacă banca a dat mai puțini lei
// decât cursul de referință, o parte din euro „se pierde” la raportare: diferența de curs nu se decontează.
// Calculul e făcut în baza de date (v_schimburi_valutare).

type Schimb = {
  id: string; data: string; moneda_vanduta: string; moneda_cumparata: string
  suma_eur: number; suma_lei: number; curs_banca: number; descriere: string | null
  aferenta_proiect: boolean | null; data_curs_bce: string | null; curs_bce_zi: number | null
  perioada: number | null; curs_referinta: number | null; provizoriu: boolean | null
  cost_banca_lei: number | null; lei_in_eur_la_referinta: number | null; diferenta_eur: number | null
}

type Tot = { n: number; eur: number; lei: number; costBanca: number; dif: number; laRef: number }
const gol = (): Tot => ({ n: 0, eur: 0, lei: 0, costBanca: 0, dif: 0, laRef: 0 })

export default function Schimburi() {
  const { id } = useParams()
  const [lista, setLista] = useState<Schimb[] | null>(null)
  const [eroare, setEroare] = useState<string | null>(null)
  const [vedere, setVedere] = useState<number | 'toate'>('toate')

  useEffect(() => {
    if (!id) return
    supabase.from('v_schimburi_valutare').select('*').eq('contract_id', id).order('data').then(({ data: d, error }) => {
      if (error) setEroare('Datele nu au putut fi citite.')
      else setLista(d as Schimb[])
    })
  }, [id])

  const perioade = useMemo(() => {
    const m = new Map<number, { curs: number | null; provizoriu: boolean }>()
    for (const s of lista ?? []) if (s.perioada != null && !m.has(s.perioada)) m.set(s.perioada, { curs: s.curs_referinta, provizoriu: !!s.provizoriu })
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [lista])

  const vizibile = useMemo(() => (lista ?? []).filter(s => vedere === 'toate' || s.perioada === vedere), [lista, vedere])

  const tot = useMemo(() => {
    const t = gol()
    for (const s of vizibile) {
      if (s.aferenta_proiect === false) continue
      t.n++; t.eur += Number(s.suma_eur); t.lei += Number(s.suma_lei)
      t.costBanca += Number(s.cost_banca_lei ?? 0); t.dif += Number(s.diferenta_eur ?? 0); t.laRef += Number(s.lei_in_eur_la_referinta ?? 0)
    }
    return t
  }, [vizibile])

  if (eroare) return <><Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link><div className="alerta rosu">{eroare}</div></>
  if (!lista) return <div className="gol">Se încarcă schimburile valutare…</div>

  const cursMediuBanca = tot.eur ? tot.lei / tot.eur : null
  const neaferente = vizibile.filter(s => s.aferenta_proiect === false).length
  const areProvizoriu = vizibile.some(s => s.provizoriu)

  return (
    <>
      <Link to={`/contract/${id}`} className="inapoi">← Tabloul de bord</Link>
      <section className="titlu-pagina">
        <h1>Schimburi valutare</h1>
        <p>Fiecare schimb din euro în lei, cu cursul primit de la bancă comparat cu cursul BCE din ziua respectivă și cu cursul de referință al programului.</p>
      </section>

      <section className="file-vederi">
        <button className={`fila ${vedere === 'toate' ? 'activa' : ''}`} onClick={() => setVedere('toate')}>Toate <span className="contor">{lista.length}</span></button>
        {perioade.map(([p, x]) => (
          <button key={p} className={`fila ${vedere === p ? 'activa' : ''}`} onClick={() => setVedere(p)}>
            Perioada {p} · curs {curs(x.curs)}{x.provizoriu ? ' (provizoriu)' : ''}
            <span className="contor">{lista.filter(s => s.perioada === p).length}</span>
          </button>
        ))}
      </section>

      <section className="cifre">
        <div className="cifra"><div className="cifra-eticheta">Euro schimbați</div><div className="cifra-valoare mic-v">{bani(tot.eur, 'EUR')}</div><div className="cifra-sub">{tot.n} schimburi pe proiect</div></div>
        <div className="cifra"><div className="cifra-eticheta">Lei primiți</div><div className="cifra-valoare mic-v">{bani(tot.lei, 'RON')}</div><div className="cifra-sub">curs mediu al băncii {curs(cursMediuBanca)}</div></div>
        <div className="cifra"><div className="cifra-eticheta">Reținut de bancă</div><div className="cifra-valoare mic-v">{bani(tot.costBanca, 'RON')}</div><div className="cifra-sub">față de cursul BCE din ziua schimbului</div></div>
        <div className="cifra accent"><div className="cifra-eticheta">Diferență de curs</div><div className="cifra-valoare mic-v">{bani(tot.dif, 'EUR')}</div><div className="cifra-sub">{tot.dif < 0 ? 'nu se decontează' : 'câștig la raportare'}</div></div>
      </section>

      <div className="alerta albastru spatiu">
        <b>Ce înseamnă:</b> leii cheltuiți pe proiect se raportează în euro la cursul de referință al perioadei (media zilnică BCE pe perioada de raportare, regula din contract).
        Pentru {bani(tot.eur, 'EUR')} schimbați, asociația a primit {bani(tot.lei, 'RON')}. La cursul de referință, acești lei valorează {bani(tot.laRef, 'EUR')}.
        {tot.dif < 0
          ? <> Diferența de <b>{bani(-tot.dif, 'EUR')}</b> este o pierdere de curs: nu se poate deconta din proiect și rămâne în sarcina asociației.</>
          : <> Diferența de {bani(tot.dif, 'EUR')} este în favoarea proiectului.</>}
        {' '}Din ea, aproximativ {bani(tot.costBanca, 'RON')} reprezintă marja băncii față de cursul BCE; restul vine din diferența dintre cursul BCE din ziua schimbului și media pe toată perioada.
      </div>

      {areProvizoriu && <div className="alerta galben spatiu">Cursul perioadei 2 este <b>provizoriu</b>: e media zilelor scurse până acum și se schimbă până la sfârșitul perioadei (31.05.2027). Diferența de curs pentru perioada 2 se va recalcula singură.</div>}
      {neaferente > 0 && <div className="alerta galben spatiu">{neaferente} {neaferente === 1 ? 'schimb e marcat' : 'schimburi sunt marcate'} ca neaferente proiectului (contul mixt) și nu intră în totaluri.</div>}

      <section className="bloc fara-padding">
        <div className="tabel-wrap">
          <table className="tabel-op">
            <thead><tr>
              <th>Data</th><th className="n">EUR vânduți</th><th className="n">Lei primiți</th>
              <th className="n">Curs bancă</th><th className="n">Curs BCE</th><th className="n">Reținut (lei)</th>
              <th className="n">Curs ref.</th><th className="n">Lei în EUR la ref.</th><th className="n">Diferență (EUR)</th>
            </tr></thead>
            <tbody>
              {vizibile.map(s => (
                <tr key={s.id} className={s.aferenta_proiect === false ? 'rand-lipsa' : ''}>
                  <td className="nowrap">{data(s.data)}<div className="mic gri">{s.perioada ? `perioada ${s.perioada}` : ''}{s.aferenta_proiect === false ? ' · neaferent' : ''}</div></td>
                  <td className="n tare">{num(s.suma_eur)}</td>
                  <td className="n">{num(s.suma_lei)}</td>
                  <td className="n">{curs(s.curs_banca)}</td>
                  <td className="n">{curs(s.curs_bce_zi)}{s.data_curs_bce && s.data_curs_bce !== s.data ? <div className="mic gri">din {data(s.data_curs_bce)}</div> : null}</td>
                  <td className="n">{s.cost_banca_lei != null ? num(s.cost_banca_lei) : '—'}</td>
                  <td className="n">{curs(s.curs_referinta)}{s.provizoriu ? <div className="mic gri">provizoriu</div> : null}</td>
                  <td className="n">{s.lei_in_eur_la_referinta != null ? num(s.lei_in_eur_la_referinta) : '—'}</td>
                  <td className={`n tare ${Number(s.diferenta_eur) < 0 ? 'rosu-text' : 'verde-text'}`}>{s.diferenta_eur != null ? num(s.diferenta_eur) : '—'}</td>
                </tr>
              ))}
              {vizibile.length === 0 && <tr><td colSpan={9} className="gol-rand">Niciun schimb valutar. Schimburile apar aici după încărcarea extraselor.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <p className="nota">„Lei în EUR la ref.” = leii primiți ÷ cursul de referință al perioadei în care a avut loc schimbul. Calculul pornește de la ipoteza că leii se cheltuiesc în aceeași perioadă de raportare; dacă se cheltuiesc în perioada următoare, se aplică cursul acelei perioade.</p>
    </>
  )
}

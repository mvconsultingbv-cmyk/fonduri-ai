import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { bani, data, STARE_CONTRACT } from '../lib/format'

type Rand = {
  id: string
  numar_contract: string
  cod_proiect: string | null
  titlu: string | null
  valoare_finantare_eur: number
  data_inceput: string
  data_sfarsit: string
  stare: string
  organizatii: { denumire: string; cui: string | null } | null
  programe: { denumire: string; moneda: string } | null
}

export default function Contracte() {
  const [randuri, setRanduri] = useState<Rand[] | null>(null)
  const [eroare, setEroare] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('contracte')
      .select('id,numar_contract,cod_proiect,titlu,valoare_finantare_eur,data_inceput,data_sfarsit,stare,organizatii(denumire,cui),programe(denumire,moneda)')
      .order('data_inceput', { ascending: false })
      .then(({ data, error }) => {
        if (error) setEroare('Contractele nu au putut fi citite.')
        else setRanduri(data as unknown as Rand[])
      })
  }, [])

  return (
    <>
      <div className="titlu-pagina">
        <h1>Contracte de finanțare</h1>
        <p>Fiecare contract înseamnă participarea unei firme la un grant, cu contul ei de proiect.</p>
      </div>
      {eroare && <div className="alerta rosu">{eroare}</div>}
      {!randuri && !eroare && <div className="gol">Se încarcă…</div>}
      {randuri?.length === 0 && <div className="gol">Nu aveți încă acces la niciun contract.</div>}
      <div className="grila-contracte">
        {randuri?.map(c => (
          <Link key={c.id} to={`/contract/${c.id}`} className="card-contract">
            <div className="card-sus">
              <span className="cod">{c.cod_proiect ?? '—'}</span>
              <span className={`stare stare-${c.stare}`}>{STARE_CONTRACT[c.stare] ?? c.stare}</span>
            </div>
            <div className="firma">{c.organizatii?.denumire}</div>
            <div className="detaliu">{c.programe?.denumire} · contract nr. {c.numar_contract}</div>
            <div className="valoare">{bani(c.valoare_finantare_eur, c.programe?.moneda ?? 'EUR')}</div>
            <div className="detaliu">{data(c.data_inceput)} – {data(c.data_sfarsit)}</div>
            <span className="deschide">Tabloul de bord →</span>
          </Link>
        ))}
      </div>
    </>
  )
}

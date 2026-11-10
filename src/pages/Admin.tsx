import { Link } from 'react-router-dom'
import { ECRANE_ADMIN, STADIU } from '../ecrane'

export default function Admin() {
  return (
    <>
      <Link to="/" className="inapoi">← Contracte</Link>
      <section className="titlu-pagina"><h1>Administrare</h1><p>Biblioteci comune tuturor firmelor client și accesul utilizatorilor.</p></section>
      <div className="grila-contracte">
        {ECRANE_ADMIN.map(e => (
          <Link key={e.cheie} to={`/admin/${e.cheie}`} className="card-contract">
            <div className="card-sus"><span className="cod">{e.grup}</span><span className={`eticheta ${STADIU[e.stadiu].cls}`}>{STADIU[e.stadiu].text}</span></div>
            <div className="firma">{e.titlu}</div>
            <div className="detaliu">{e.rost}</div>
          </Link>
        ))}
      </div>
    </>
  )
}

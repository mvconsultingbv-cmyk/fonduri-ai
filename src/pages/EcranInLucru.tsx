import { Link, useParams } from 'react-router-dom'
import { ECRANE_ADMIN, ECRANE_CONTRACT, STADIU } from '../ecrane'

// Pagina pentru ecranele încă nefăcute: ce vor face și ce e deja pregătit.
export default function EcranInLucru({ admin }: { admin?: boolean }) {
  const { id, ecran } = useParams()
  const e = (admin ? ECRANE_ADMIN : ECRANE_CONTRACT).find(x => x.cheie === ecran)
  const inapoi = admin ? '/admin' : `/contract/${id}`
  if (!e) return <><Link to={inapoi} className="inapoi">← Înapoi</Link><div className="gol">Ecranul nu există.</div></>
  return (
    <>
      <section className="titlu-pagina">
        <div className="cod">{e.grup}</div>
        <h1>{e.titlu} <span className={`eticheta ${STADIU[e.stadiu].cls}`}>{STADIU[e.stadiu].text}</span></h1>
        <p>{e.rost}</p>
      </section>
      <div className="doua-coloane">
        <section className="bloc">
          <div className="bloc-titlu"><h2>Ce va face</h2></div>
          <ul className="lista-puncte">{(e.vaFace ?? []).map((t, i) => <li key={i}>{t}</li>)}</ul>
        </section>
        <section className="bloc">
          <div className="bloc-titlu"><h2>Ce e deja pregătit</h2><p>În baza de date, sub ecran.</p></div>
          <ul className="lista-puncte">{(e.pregatit ?? []).map((t, i) => <li key={i}>{t}</li>)}</ul>
        </section>
      </div>
      <div className="gol mic-gol">Ecranul nu e încă construit. Spune-i lui Claude când vrei să-l facem.</div>
    </>
  )
}

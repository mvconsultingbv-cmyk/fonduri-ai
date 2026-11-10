import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { ECRANE_CONTRACT, STADIU } from './ecrane'

// Meniul unui contract: toate ecranele, grupate; cele încă nefăcute sunt marcate „în lucru”.
export default function ContractLayout() {
  const { id } = useParams()
  const grupuri = [...new Set(ECRANE_CONTRACT.map(e => e.grup))]
  return (
    <div className="cu-meniu">
      <nav className="meniu-contract" aria-label="Ecranele contractului">
        <Link to="/" className="meniu-link meniu-inapoi">← Toate contractele</Link>
        {grupuri.map(g => (
          <div key={g} className="meniu-grup">
            <div className="meniu-grup-titlu">{g}</div>
            {ECRANE_CONTRACT.filter(e => e.grup === g).map(e => (
              <NavLink key={e.cheie} end to={`/contract/${id}${e.cheie ? '/' + e.cheie : ''}`} className={({ isActive }) => `meniu-link ${isActive ? 'activ' : ''}`}>
                <span>{e.titlu}</span>
                {e.stadiu !== 'gata' && <span className={`punct ${STADIU[e.stadiu].cls}`} title={STADIU[e.stadiu].text} />}
              </NavLink>
            ))}
          </div>
        ))}
        <div className="meniu-legenda"><span className="punct galben" /> în lucru <span className="punct albastru-e" /> parțial</div>
      </nav>
      <div className="cu-meniu-continut"><Outlet /></div>
    </div>
  )
}

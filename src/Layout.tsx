import { Link, Outlet } from 'react-router-dom'
import { useAuth } from './auth'

export default function Layout() {
  const { utilizator, sesiune, iesire } = useAuth()
  return (
    <div className="cadru">
      <header className="bara">
        <Link to="/" className="marca mic">
          <span className="marca-semn">€</span>
          <span className="marca-nume">Fonduri europene</span>
        </Link>
        <div className="bara-dreapta">
          <span className="cine">
            {utilizator?.nume || sesiune?.user.email}
            {utilizator?.este_admin_platforma && <span className="eticheta">administrator</span>}
          </span>
          <button className="buton-text" onClick={iesire}>Ieșire</button>
        </div>
      </header>
      <main className="continut"><Outlet /></main>
    </div>
  )
}

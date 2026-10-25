import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import Layout from './Layout'
import Login from './pages/Login'
import Contracte from './pages/Contracte'
import TabloDeBord from './pages/TabloDeBord'
import Operatiuni from './pages/Operatiuni'
import Documente from './pages/Documente'
import Echipamente from './pages/Echipamente'

function Poarta() {
  const { incarcare, sesiune, utilizator, iesire } = useAuth()
  if (incarcare) return <div className="gol ecran">Se încarcă…</div>
  if (!sesiune) return <Login />
  if (!utilizator || !utilizator.activ)
    return (
      <div className="login-pagina">
        <div className="login-card">
          <h2>Cont neactivat</h2>
          <p>Contul {sesiune.user.email} există, dar nu a fost încă activat de administrator pentru nicio firmă.</p>
          <button className="buton" onClick={iesire}>Ieșire</button>
        </div>
      </div>
    )
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Contracte />} />
        <Route path="contract/:id" element={<TabloDeBord />} />
        <Route path="contract/:id/operatiuni" element={<Operatiuni />} />
        <Route path="contract/:id/documente" element={<Documente />} />
        <Route path="contract/:id/echipamente" element={<Echipamente />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider><Poarta /></AuthProvider>
    </BrowserRouter>
  )
}

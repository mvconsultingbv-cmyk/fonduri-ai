import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import Layout from './Layout'
import Login from './pages/Login'
import Contracte from './pages/Contracte'
import TabloDeBord from './pages/TabloDeBord'
import Operatiuni from './pages/Operatiuni'
import Documente from './pages/Documente'
import Echipamente from './pages/Echipamente'
import ContractLayout from './ContractLayout'
import EcranInLucru from './pages/EcranInLucru'
import Admin from './pages/Admin'

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
        <Route path="contract/:id" element={<ContractLayout />}>
          <Route index element={<TabloDeBord />} />
          <Route path="operatiuni" element={<Operatiuni />} />
          <Route path="documente" element={<Documente />} />
          <Route path="echipamente" element={<Echipamente />} />
          <Route path=":ecran" element={<EcranInLucru />} />
        </Route>
        <Route path="admin" element={<Admin />} />
        <Route path="admin/:ecran" element={<EcranInLucru admin />} />
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

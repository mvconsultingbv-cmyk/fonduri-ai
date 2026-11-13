import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import Layout from './Layout'
import Login from './pages/Login'
import Contracte from './pages/Contracte'
import TabloDeBord from './pages/TabloDeBord'
import Operatiuni from './pages/Operatiuni'
import Documente from './pages/Documente'
import Echipamente from './pages/Echipamente'
import Extrase from './pages/Extrase'
import Schimburi from './pages/Schimburi'
import Raportare from './pages/Raportare'
import Transe from './pages/Transe'
import Transferuri from './pages/Transferuri'
import Buget from './pages/Buget'
import Personal from './pages/Personal'
import Numerar from './pages/Numerar'
import Contrapartide from './pages/Contrapartide'
import ContractLayout from './ContractLayout'
import EcranInLucru from './pages/EcranInLucru'
import Admin from './pages/Admin'
import Jurnal from './pages/Jurnal'
import Utilizatori from './pages/Utilizatori'
import Firme from './pages/Firme'
import Programe from './pages/Programe'
import Banci from './pages/Banci'
import ContractNou from './pages/ContractNou'
import SeteazaParola from './pages/SeteazaParola'

function Poarta() {
  const { incarcare, sesiune, utilizator, iesire, parolaNoua } = useAuth()
  if (incarcare) return <div className="gol ecran">Se încarcă…</div>
  if (!sesiune) return <Login />
  if (parolaNoua && utilizator?.activ) return <SeteazaParola />
  if (!utilizator || !utilizator.activ)
    return (
      <div className="login-pagina">
        <div className="login-card">
          <h2>Cont neactivat</h2>
          <p>Contul {sesiune.user.email} nu este activ în aplicație (nu a fost încă înregistrat sau a fost dezactivat). Contactați M.V. Consulting.</p>
          <button className="buton" onClick={iesire}>Ieșire</button>
        </div>
      </div>
    )
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Contracte />} />
        <Route path="contract-nou" element={<ContractNou />} />
        <Route path="contract-nou/:id" element={<ContractNou />} />
        <Route path="contract/:id" element={<ContractLayout />}>
          <Route index element={<TabloDeBord />} />
          <Route path="operatiuni" element={<Operatiuni />} />
          <Route path="documente" element={<Documente />} />
          <Route path="echipamente" element={<Echipamente />} />
          <Route path="extrase" element={<Extrase />} />
          <Route path="schimburi" element={<Schimburi />} />
          <Route path="personal" element={<Personal />} />
          <Route path="numerar" element={<Numerar />} />
          <Route path="contrapartide" element={<Contrapartide />} />
          <Route path="raportare" element={<Raportare />} />
          <Route path="transe" element={<Transe />} />
          <Route path="transferuri" element={<Transferuri />} />
          <Route path="buget" element={<Buget />} />
          <Route path="jurnal" element={<Jurnal />} />
          <Route path="echipa" element={<Utilizatori peContract />} />
          <Route path=":ecran" element={<EcranInLucru />} />
        </Route>
        <Route path="admin" element={<Admin />} />
        <Route path="admin/jurnal" element={<Jurnal general />} />
        <Route path="admin/utilizatori" element={<Utilizatori />} />
        <Route path="admin/firme" element={<Firme />} />
        <Route path="admin/programe" element={<Programe />} />
        <Route path="admin/banci" element={<Banci />} />
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

import { useState, type FormEvent } from 'react'
import { supabase, LINK_EXPIRAT } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [parola, setParola] = useState('')
  const [eroare, setEroare] = useState<string | null>(LINK_EXPIRAT ? 'Linkul de activare a expirat sau a fost deja folosit. Cereți un link nou celui care v-a invitat (managerul contractului sau M.V. Consulting).' : null)
  const [trimite, setTrimite] = useState(false)

  async function intra(e: FormEvent) {
    e.preventDefault()
    setEroare(null)
    setTrimite(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: parola })
    setTrimite(false)
    if (error) setEroare(error.message.includes('Invalid') ? 'Email sau parolă greșite.' : 'Nu s-a putut face conectarea. Încercați din nou.')
  }

  return (
    <div className="login-pagina">
      <form className="login-card" onSubmit={intra}>
        <div className="marca">
          <span className="marca-semn">€</span>
          <div>
            <div className="marca-nume">Fonduri europene</div>
            <div className="marca-sub">Monitorizarea cheltuirii · M.V. Consulting</div>
          </div>
        </div>
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required />
        </label>
        <label>
          Parolă
          <input type="password" autoComplete="current-password" value={parola} onChange={e => setParola(e.target.value)} required />
        </label>
        {eroare && <div className="alerta rosu">{eroare}</div>}
        <button className="buton" disabled={trimite}>{trimite ? 'Se verifică…' : 'Intră în aplicație'}</button>
        <p className="nota">Conturile se creează prin invitație, de M.V. Consulting sau de managerul contractului. Ați uitat parola? Cereți-le un link nou.</p>
      </form>
    </div>
  )
}

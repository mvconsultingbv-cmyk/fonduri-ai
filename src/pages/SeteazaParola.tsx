import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth'

// Ecranul în care ajunge omul după ce deschide linkul de invitare sau un „link nou”:
// își alege parola, apoi intră în aplicație. Linkul l-a conectat deja (o singură dată).
export default function SeteazaParola() {
  const { sesiune, utilizator, parolaAleasa, iesire } = useAuth()
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [eroare, setEroare] = useState<string | null>(null)
  const [trimite, setTrimite] = useState(false)

  async function salveaza(e: FormEvent) {
    e.preventDefault()
    setEroare(null)
    if (p1.length < 10) return setEroare('Parola trebuie să aibă cel puțin 10 caractere.')
    if (p1 !== p2) return setEroare('Cele două parole nu coincid.')
    setTrimite(true)
    const { error } = await supabase.auth.updateUser({ password: p1 })
    setTrimite(false)
    if (error) {
      const m = error.message.toLowerCase()
      return setEroare(m.includes('pwned') || m.includes('leak') || m.includes('weak')
        ? 'Această parolă apare în listele de parole compromise publicate pe internet. Alegeți alta.'
        : m.includes('same') ? 'Alegeți o parolă diferită de cea veche.' : 'Parola nu a putut fi salvată. Încercați din nou.')
    }
    parolaAleasa()
  }

  return (
    <div className="login-pagina">
      <form className="login-card" onSubmit={salveaza}>
        <div className="marca">
          <span className="marca-semn">€</span>
          <div>
            <div className="marca-nume">Fonduri europene</div>
            <div className="marca-sub">Alegeți-vă parola</div>
          </div>
        </div>
        <p>Bun venit{utilizator?.nume ? `, ${utilizator.nume}` : ''}! Contul <b>{sesiune?.user.email}</b> e pregătit. Alegeți o parolă cu care veți intra de acum înainte.</p>
        <label>Parola nouă<input type="password" autoComplete="new-password" value={p1} onChange={e => setP1(e.target.value)} required /></label>
        <label>Repetați parola<input type="password" autoComplete="new-password" value={p2} onChange={e => setP2(e.target.value)} required /></label>
        {eroare && <div className="alerta rosu">{eroare}</div>}
        <button className="buton" disabled={trimite}>{trimite ? 'Se salvează…' : 'Salvează parola și intră'}</button>
        <button type="button" className="buton-text" onClick={iesire}>Nu sunt eu — ieșire</button>
        <p className="nota">Cel puțin 10 caractere. Nu folosiți o parolă pe care o aveți și în alte locuri.</p>
      </form>
    </div>
  )
}

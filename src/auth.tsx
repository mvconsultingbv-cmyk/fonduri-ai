import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

export type Utilizator = {
  id: string
  nume: string | null
  email: string | null
  este_admin_platforma: boolean
  activ: boolean
  organizatie_id: string | null
}

type Ctx = {
  incarcare: boolean
  sesiune: Session | null
  utilizator: Utilizator | null
  iesire: () => Promise<void>
}

const AuthCtx = createContext<Ctx>({ incarcare: true, sesiune: null, utilizator: null, iesire: async () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sesiune, setSesiune] = useState<Session | null>(null)
  const [utilizator, setUtilizator] = useState<Utilizator | null>(null)
  const [incarcare, setIncarcare] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSesiune(data.session)
      if (!data.session) setIncarcare(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSesiune(s)
      if (!s) { setUtilizator(null); setIncarcare(false) }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // Profilul din tabelul „utilizatori” (citit separat de evenimentul de autentificare).
  useEffect(() => {
    const uid = sesiune?.user.id
    if (!uid) return
    let anulat = false
    setIncarcare(true)
    supabase.from('utilizatori').select('id,nume,email,este_admin_platforma,activ,organizatie_id').eq('id', uid).maybeSingle()
      .then(({ data }) => { if (!anulat) { setUtilizator((data as Utilizator) ?? null); setIncarcare(false) } })
    return () => { anulat = true }
  }, [sesiune?.user.id])

  const iesire = async () => { await supabase.auth.signOut() }

  return <AuthCtx.Provider value={{ incarcare, sesiune, utilizator, iesire }}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)

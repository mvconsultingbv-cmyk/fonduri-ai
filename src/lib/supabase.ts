import { createClient } from '@supabase/supabase-js'

// Adresa proiectului Supabase „Fonduri-AI” și cheia PUBLICĂ.
// Cheia publică e făcută să stea în aplicație: fără un cont autentificat
// nu vede nimic, pentru că fiecare tabel are reguli de acces (RLS).
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://egrhfhwrsnydtlfnhdkw.supabase.co'
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_6SeJPBrrnYXiVF74CmLs1g_jqBijVPE'

// Venit dintr-un link de invitare sau de parolă nouă? Citim tipul din adresă înainte ca
// biblioteca Supabase să o curețe: după invitare omul trebuie să-și aleagă parola.
const hash = new URLSearchParams(typeof window !== 'undefined' ? window.location.hash.slice(1) : '')
export const TIP_LINK: 'invite' | 'recovery' | null =
  hash.get('type') === 'invite' ? 'invite' : hash.get('type') === 'recovery' ? 'recovery' : null
export const LINK_EXPIRAT = hash.get('error_code') === 'otp_expired' || (hash.get('error') === 'access_denied' && !!hash.get('error_description'))

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
})

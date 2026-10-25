import { createClient } from '@supabase/supabase-js'

// Adresa proiectului Supabase „Fonduri-AI” și cheia PUBLICĂ.
// Cheia publică e făcută să stea în aplicație: fără un cont autentificat
// nu vede nimic, pentru că fiecare tabel are reguli de acces (RLS).
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://egrhfhwrsnydtlfnhdkw.supabase.co'
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_6SeJPBrrnYXiVF74CmLs1g_jqBijVPE'

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
})

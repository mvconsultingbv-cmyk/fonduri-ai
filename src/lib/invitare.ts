import { supabase } from './supabase'

// Apelul funcției „invita-utilizator” de pe serverul Supabase (vezi supabase/functions/invita-utilizator).
// Întoarce fie datele, fie mesajul de eroare pe înțeles, scris de funcție.
export async function cheamaInvitare<T = Record<string, unknown>>(corp: Record<string, unknown>): Promise<{ date?: T; eroare?: string }> {
  const { data, error } = await supabase.functions.invoke('invita-utilizator', { body: corp })
  if (!error) return { date: data as T }
  try {
    const ctx = (error as { context?: Response }).context
    const j = ctx ? await ctx.json() : null
    if (j?.eroare) return { eroare: j.eroare }
  } catch { /* răspuns fără JSON */ }
  return { eroare: 'Serverul nu a răspuns. Încercați din nou.' }
}

export const ROLURI: Record<string, { text: string; rost: string }> = {
  manager: { text: 'Manager', rost: 'lucrează pe toate datele contractului și poate invita oameni pe contract' },
  responsabil_financiar: { text: 'Responsabil financiar', rost: 'lucrează pe datele contractului (extrase, facturi, alocări), fără să invite oameni' },
  director_program: { text: 'Director de program', rost: 'citește tot și aprobă modificările de buget; nu introduce date' },
  cititor: { text: 'Cititor', rost: 'doar citește (de ex. auditor, contabil extern)' },
}

// Textul gata de trimis omului invitat
export function mesajInvitatie(nume: string, link: string, nou: boolean) {
  const subiect = nou ? 'Invitație în aplicația Fonduri europene (M.V. Consulting)' : 'Link nou pentru aplicația Fonduri europene'
  const corp = `Bună ziua, ${nume},\n\n` +
    (nou ? 'Ați fost invitat(ă) în aplicația Fonduri europene, folosită pentru urmărirea cheltuirii banilor din proiect.\n\n'
         : 'Iată un link nou pentru aplicația Fonduri europene.\n\n') +
    `Deschideți linkul de mai jos și alegeți-vă o parolă:\n${link}\n\n` +
    'Linkul se poate folosi o singură dată și expiră în aproximativ o oră. Dacă a expirat, cereți unul nou.\n' +
    'După ce v-ați ales parola, intrați oricând la https://fonduri-ai.vercel.app cu adresa de email și parola.\n\nM.V. Consulting'
  return { subiect, corp }
}

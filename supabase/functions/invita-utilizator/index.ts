// Funcția „invita-utilizator” — rulează pe serverul Supabase, nu în pagina utilizatorului.
// Are nevoie de cheia de administrator a bazei de date (ca să creeze conturi), cheie care nu are voie
// să ajungă în browser. Pagina îi trimite doar cererea; funcția verifică întâi dreptul celui care cere.
//
// Acțiuni:
//  - invita:      creează contul (sau găsește omul existent), îl trece în aplicație și îi dă rolul pe contract.
//                 Întoarce un link de activare pe care cel care invită îl trimite omului (email, WhatsApp).
//                 Nu trimitem noi emailul: serviciul de email inclus în Supabase trimite doar către membrii
//                 echipei Supabase și are o limită de câteva mesaje pe oră.
//  - link_nou:    un link nou de setare a parolei (link expirat sau parolă uitată).
//                 Administratorul: pentru oricine. Managerul: doar pentru cei invitați pe contractele lui
//                 care nu s-au conectat niciodată.
//  - verifica_cui: datele firmei de la ANAF (denumire, adresă, TVA), pentru ecranul Firme client.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const URL_SB = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APLICATIA = 'https://fonduri-ai.vercel.app/'
const ROLURI = ['manager', 'responsabil_financiar', 'cititor', 'director_program']

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const raspuns = (corp: unknown, status = 200) =>
  new Response(JSON.stringify(corp), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const eroare = (mesaj: string, status = 400) => raspuns({ eroare: mesaj }, status)

function adresaIntoarcere(req: Request) {
  const o = req.headers.get('origin') ?? ''
  if (/^https:\/\/fonduri-ai(-[a-z0-9-]+)?\.vercel\.app$/.test(o) || /^http:\/\/localhost:\d+$/.test(o)) return o + '/'
  return APLICATIA
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return eroare('Metodă nepermisă.', 405)

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const admin = createClient(URL_SB, SERVICE, { auth: { persistSession: false } })
  const { data: cine, error: eCine } = await admin.auth.getUser(jwt)
  if (eCine || !cine?.user) return eroare('Trebuie să fiți conectat.', 401)
  // clientul „în numele celui care cere”: regulile de acces și jurnalul îl văd pe el
  const caCel = createClient(URL_SB, ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false },
  })

  const { data: eu } = await admin.from('utilizatori').select('id,activ,este_admin_platforma').eq('id', cine.user.id).maybeSingle()
  if (!eu?.activ) return eroare('Contul dumneavoastră nu este activ.', 403)
  const eAdmin = !!eu.este_admin_platforma

  let corp: Record<string, unknown>
  try { corp = await req.json() } catch { return eroare('Cerere invalidă.') }
  const actiune = String(corp.actiune ?? '')

  // ---------- verifica_cui ----------
  if (actiune === 'verifica_cui') {
    if (!eAdmin) return eroare('Doar administratorul adaugă firme.', 403)
    const cui = String(corp.cui ?? '').toUpperCase().replace(/^RO/, '').replace(/\D/g, '')
    if (!/^\d{2,10}$/.test(cui)) return eroare('CUI invalid.')
    try {
      const azi = new Date().toISOString().slice(0, 10)
      const r = await fetch('https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ cui: Number(cui), data: azi }]),
      })
      const j = await r.json()
      const f = j?.found?.[0]
      if (!f) return raspuns({ gasit: false, cui })
      return raspuns({
        gasit: true, cui,
        denumire: f.date_generale?.denumire ?? null,
        adresa: f.date_generale?.adresa ?? null,
        platitor_tva: !!f.inregistrare_scop_Tva?.scpTVA,
        inactiv: !!f.stare_inactiv?.statusInactivi,
      })
    } catch {
      return raspuns({ gasit: false, cui, indisponibil: true })
    }
  }

  // ---------- invita ----------
  if (actiune === 'invita') {
    const email = String(corp.email ?? '').trim().toLowerCase()
    const nume = String(corp.nume ?? '').trim()
    const telefon = corp.telefon ? String(corp.telefon).trim() : null
    const contract = corp.contract_id ? String(corp.contract_id) : null
    const rol = corp.rol ? String(corp.rol) : null
    const organizatie = eAdmin && corp.organizatie_id ? String(corp.organizatie_id) : null
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return eroare('Adresa de email nu e validă.')
    if (!nume) return eroare('Completați numele.')
    if (rol && !ROLURI.includes(rol)) return eroare('Rol necunoscut.')
    if ((contract && !rol) || (!contract && rol)) return eroare('Alegeți atât contractul, cât și rolul.')
    if (!eAdmin) {
      if (!contract) return eroare('Alegeți contractul pe care îl invitați.')
      if (rol === 'director_program') return eroare('Doar administratorul poate numi un director de program.', 403)
      const { data: r } = await admin.from('roluri_contract').select('rol').eq('contract_id', contract).eq('utilizator_id', eu.id).maybeSingle()
      if (r?.rol !== 'manager') return eroare('Doar managerul contractului sau administratorul pot invita.', 403)
    }

    // omul există deja în aplicație? atunci doar primește rolul
    const { data: existent } = await admin.from('utilizatori').select('id,activ').ilike('email', email.replace(/[\\%_]/g, c => '\\' + c)).maybeSingle()
    if (existent) {
      if (!existent.activ) return eroare('Acest om are contul dezactivat. Administratorul îl poate reactiva.')
      if (contract && rol) {
        const { error } = await caCel.rpc('adauga_utilizator_invitat', {
          p_id: existent.id, p_nume: nume, p_telefon: telefon, p_organizatie: null, p_contract: contract, p_rol: rol,
        })
        if (error) return eroare(error.message)
      }
      return raspuns({ existent: true, utilizator_id: existent.id })
    }

    const redirectTo = adresaIntoarcere(req)
    let { data: gen, error: eGen } = await admin.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo } })
    let creatAcum = true
    if (eGen) {
      // contul de autentificare există, dar fără fișă în aplicație (de ex. o invitație anterioară întreruptă)
      creatAcum = false
      const r2 = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } })
      gen = r2.data; eGen = r2.error
    }
    if (eGen || !gen?.user) return eroare('Contul nu a putut fi creat: ' + (eGen?.message ?? 'eroare necunoscută'))

    const { error: eRpc } = await caCel.rpc('adauga_utilizator_invitat', {
      p_id: gen.user.id, p_nume: nume, p_telefon: telefon, p_organizatie: organizatie, p_contract: contract, p_rol: rol,
    })
    if (eRpc) {
      if (creatAcum) await admin.auth.admin.deleteUser(gen.user.id)   // nu lăsăm conturi pe jumătate
      return eroare(eRpc.message)
    }
    return raspuns({ existent: false, utilizator_id: gen.user.id, link: gen.properties?.action_link })
  }

  // ---------- link_nou ----------
  if (actiune === 'link_nou') {
    const tinta = String(corp.utilizator_id ?? '')
    const { data: om } = await admin.from('utilizatori').select('id,email,activ,este_admin_platforma').eq('id', tinta).maybeSingle()
    if (!om) return eroare('Utilizator necunoscut.', 404)
    if (!om.activ) return eroare('Contul e dezactivat.')
    if (!eAdmin) {
      const { data: a } = await admin.auth.admin.getUserById(tinta)
      if (om.este_admin_platforma || a?.user?.last_sign_in_at)
        return eroare('Pentru cineva care s-a conectat deja, linkul nou îl dă doar administratorul.', 403)
      const { data: rolurileLui } = await admin.from('roluri_contract').select('contract_id').eq('utilizator_id', tinta)
      const { data: aleMele } = await admin.from('roluri_contract').select('contract_id').eq('utilizator_id', eu.id).eq('rol', 'manager')
      const mele = new Set((aleMele ?? []).map(r => r.contract_id))
      if (!rolurileLui?.length || !rolurileLui.every(r => mele.has(r.contract_id)))
        return eroare('Omul are roluri și pe contracte unde nu sunteți manager; linkul îl dă administratorul.', 403)
    }
    const { data: gen, error } = await admin.auth.admin.generateLink({
      type: 'recovery', email: om.email, options: { redirectTo: adresaIntoarcere(req) },
    })
    if (error) return eroare('Linkul nu a putut fi generat: ' + error.message)
    return raspuns({ link: gen.properties?.action_link })
  }

  return eroare('Acțiune necunoscută.')
})

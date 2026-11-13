-- 027a: raportul depus la finanțator, comparația pe capitole, închiderea și redeschiderea perioadei.
-- General pentru orice program: capitolele sunt cele din bugetul contractului, nimic specific Horizon/HEAT.

-- 1. Raportul depus: unul pe perioadă.
create table public.rapoarte_depuse (
  id            uuid primary key default gen_random_uuid(),
  perioada_id   uuid not null unique references public.perioade_raportare(id),
  contract_id   uuid not null references public.contracte(id),
  data_depunere date not null,
  referinta     text,                       -- nr. de înregistrare / identificatorul din portalul finanțatorului
  fisier_cale   text,
  fisier_amprenta text check (fisier_amprenta is null or fisier_amprenta ~ '^[0-9a-f]{64}$'),
  fisier_nume   text,
  observatii    text,
  creat_de      uuid default auth.uid() references public.utilizatori(id),
  creat_la      timestamptz not null default now(),
  actualizat_la timestamptz not null default now()
);
comment on table public.rapoarte_depuse is 'Raportul financiar depus la finanțator pentru o perioadă de raportare (antet + document).';

-- 2. Sumele declarate pe fiecare capitol, plus „fotografia” cifrelor aplicației la închidere.
create table public.raport_depus_linii (
  id               uuid primary key default gen_random_uuid(),
  raport_id        uuid not null references public.rapoarte_depuse(id) on delete cascade,
  contract_id      uuid not null references public.contracte(id),
  pozitie_buget_id uuid not null references public.pozitii_buget(id),
  suma_declarata_eur numeric(14,2),         -- null = încă necompletat
  explicatie       text,                    -- obligatorie când declarat ≠ aplicație
  aplicatie_la_inchidere_eur numeric(14,2), -- completat automat la închiderea perioadei
  creat_la         timestamptz not null default now(),
  actualizat_la    timestamptz not null default now(),
  unique (raport_id, pozitie_buget_id)
);
comment on table public.raport_depus_linii is 'Suma declarată la finanțator pe fiecare capitol și explicația diferenței față de aplicație.';
create index on public.raport_depus_linii (pozitie_buget_id);
create index on public.rapoarte_depuse (contract_id);
create index on public.raport_depus_linii (contract_id);

-- 3. Istoricul redeschiderilor (doar administratorul, cu motiv).
create table public.redeschideri_perioade (
  id          uuid primary key default gen_random_uuid(),
  perioada_id uuid not null references public.perioade_raportare(id),
  contract_id uuid not null references public.contracte(id),
  motiv       text not null check (length(btrim(motiv)) >= 10),
  inchisa_la  timestamptz,           -- când fusese închisă
  redeschisa_de uuid default auth.uid() references public.utilizatori(id),
  redeschisa_la timestamptz not null default now()
);
create index on public.redeschideri_perioade (perioada_id);
create index on public.redeschideri_perioade (contract_id);

-- 4. Completări automate și blocare cât perioada e închisă.
create or replace function privat.pregateste_raport_depus()
returns trigger language plpgsql set search_path = '' as $$
declare v_stare public.stare_perioada;
begin
  if tg_op <> 'DELETE' then
    new.contract_id := (select contract_id from public.perioade_raportare where id = new.perioada_id);
  end if;
  select stare into v_stare from public.perioade_raportare
   where id = case when tg_op = 'DELETE' then old.perioada_id else new.perioada_id end;
  if v_stare = 'raportata' then
    raise exception 'Perioada este închisă: raportul depus nu se mai modifică. Doar administratorul o poate redeschide, cu motiv.';
  end if;
  if tg_op = 'UPDATE' and new.perioada_id <> old.perioada_id then
    raise exception 'Raportul nu se mută pe altă perioadă.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create or replace function privat.pregateste_linie_raport()
returns trigger language plpgsql set search_path = '' as $$
declare v_raport record; v_poz_contract uuid;
begin
  select r.contract_id, pr.stare into v_raport
    from public.rapoarte_depuse r join public.perioade_raportare pr on pr.id = r.perioada_id
   where r.id = case when tg_op = 'DELETE' then old.raport_id else new.raport_id end;
  if v_raport.stare = 'raportata' and current_setting('fonduri.inchidere', true) is distinct from 'da' then
    raise exception 'Perioada este închisă: sumele declarate nu se mai modifică.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.contract_id := v_raport.contract_id;
  select contract_id into v_poz_contract from public.pozitii_buget where id = new.pozitie_buget_id;
  if v_poz_contract is distinct from new.contract_id then
    raise exception 'Capitolul aparține altui contract.';
  end if;
  if tg_op = 'UPDATE' and (new.raport_id <> old.raport_id or new.pozitie_buget_id <> old.pozitie_buget_id) then
    raise exception 'Linia nu se mută pe alt raport sau alt capitol.';
  end if;
  -- „Fotografia” de la închidere o scrie doar închiderea.
  if current_setting('fonduri.inchidere', true) is distinct from 'da' then
    new.aplicatie_la_inchidere_eur := case when tg_op = 'UPDATE' then old.aplicatie_la_inchidere_eur end;
  end if;
  new.explicatie := nullif(btrim(new.explicatie), '');
  return new;
end $$;

create trigger a_pregateste before insert or update or delete on public.rapoarte_depuse
  for each row execute function privat.pregateste_raport_depus();
create trigger z_actualizat before update on public.rapoarte_depuse
  for each row execute function privat.seteaza_actualizat();
create trigger zz_jurnal after insert or update or delete on public.rapoarte_depuse
  for each row execute function privat.scrie_jurnal();

create trigger a_pregateste before insert or update or delete on public.raport_depus_linii
  for each row execute function privat.pregateste_linie_raport();
create trigger z_actualizat before update on public.raport_depus_linii
  for each row execute function privat.seteaza_actualizat();
create trigger zz_jurnal after insert or update or delete on public.raport_depus_linii
  for each row execute function privat.scrie_jurnal();

create or replace function privat.redeschidere_needitabila()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Istoricul redeschiderilor nu se modifică și nu se șterge.'; end $$;
create trigger a_needitabil before update or delete on public.redeschideri_perioade
  for each row execute function privat.redeschidere_needitabila();
create trigger zz_jurnal after insert on public.redeschideri_perioade
  for each row execute function privat.scrie_jurnal();

-- 5. Securitate: citesc toți cei cu rol pe contract; scriu cei care pot scrie pe contract.
alter table public.rapoarte_depuse enable row level security;
alter table public.raport_depus_linii enable row level security;
alter table public.redeschideri_perioade enable row level security;

create policy citire on public.rapoarte_depuse for select using (privat.poate_citi(contract_id));
create policy adaugare on public.rapoarte_depuse for insert with check (privat.poate_scrie((select contract_id from public.perioade_raportare where id = perioada_id)));
create policy modificare on public.rapoarte_depuse for update using (privat.poate_scrie(contract_id)) with check (privat.poate_scrie(contract_id));
create policy stergere on public.rapoarte_depuse for delete using (privat.poate_scrie(contract_id));

create policy citire on public.raport_depus_linii for select using (privat.poate_citi(contract_id));
create policy adaugare on public.raport_depus_linii for insert with check (privat.poate_scrie((select contract_id from public.rapoarte_depuse where id = raport_id)));
create policy modificare on public.raport_depus_linii for update using (privat.poate_scrie(contract_id)) with check (privat.poate_scrie(contract_id));
create policy stergere on public.raport_depus_linii for delete using (privat.poate_scrie(contract_id));

create policy citire on public.redeschideri_perioade for select using (privat.poate_citi(contract_id));
-- inserarea se face doar prin funcția redeschide_perioada (fără politică de insert).

grant select, insert, update, delete on public.rapoarte_depuse, public.raport_depus_linii to authenticated;
grant select on public.redeschideri_perioade to authenticated;

-- Jurnalul știe contractul noilor tabele.
create or replace function privat.contract_din_jurnal(p_tabel text, r jsonb)
 returns uuid language plpgsql stable security definer set search_path to '' as $function$
declare v uuid;
begin
  if r is null then return null; end if;
  v := case
    when p_tabel = 'contracte' then (r->>'id')::uuid
    when p_tabel in ('conturi','documente','echipamente','exceptii_contract','modificari_buget','perioade_raportare',
                     'persoane_proiect','personal_plati','pozitii_buget','transe','roluri_contract',
                     'rapoarte_depuse','raport_depus_linii','redeschideri_perioade') then (r->>'contract_id')::uuid
    when p_tabel in ('alocari_lei','avansuri_numerar','cheltuieli_indirecte','decontari','echipamente_plati','reconcilieri','justificari_avans')
      then privat.contract_operatiune((r->>'operatiune_id')::uuid)
    when p_tabel in ('operatiuni','extrase') then privat.contract_cont((r->>'cont_id')::uuid)
    when p_tabel = 'luni_personal' then privat.contract_persoana((r->>'persoana_id')::uuid)
    when p_tabel = 'modificari_buget_linii' then privat.contract_modificare((r->>'modificare_id')::uuid)
    when p_tabel = 'schimburi_valutare' then coalesce(privat.contract_operatiune((r->>'operatiune_vanzare_id')::uuid), privat.contract_operatiune((r->>'operatiune_cumparare_id')::uuid))
    when p_tabel = 'transferuri_interne' then coalesce(privat.contract_operatiune((r->>'operatiune_iesire_id')::uuid), privat.contract_operatiune((r->>'operatiune_intrare_id')::uuid))
    else null end;
  return v;
exception when others then return null;
end $function$;

-- 6. Comparația: cifrele aplicației lângă cele declarate.
--    Cât perioada e deschisă, aplicația = calculul de acum; după închidere = fotografia de la închidere.
create or replace view public.v_comparatie_raport with (security_invoker = true) as
select v.contract_id, v.perioada_id, v.perioada, v.stare, v.pozitie_id, v.cod, v.denumire, v.ordine, v.mod_calcul,
       r.id as raport_id, l.id as linie_id,
       case when v.stare = 'raportata' then l.aplicatie_la_inchidere_eur else round(coalesce(v.eligibil_eur, 0), 2) end as aplicatie_eur,
       round(coalesce(v.neconfirmat_eur, 0), 2) as neconfirmat_eur,
       l.suma_declarata_eur as declarat_eur,
       l.suma_declarata_eur - case when v.stare = 'raportata' then l.aplicatie_la_inchidere_eur else round(coalesce(v.eligibil_eur, 0), 2) end as diferenta_eur,
       l.explicatie
  from public.v_raport_perioade v
  left join public.rapoarte_depuse r on r.perioada_id = v.perioada_id
  left join public.raport_depus_linii l on l.raport_id = r.id and l.pozitie_buget_id = v.pozitie_id;
grant select on public.v_comparatie_raport to authenticated;

-- Sumă în format românesc: 92.794,07
create or replace function privat.fmt_eur(p numeric) returns text language sql immutable set search_path = '' as $$
  select translate(to_char(p, 'FM999G999G990D00'), ',.', '.,') $$;

-- 7. Ce împiedică închiderea (folosit de ecran și de baza de date, aceeași listă).
create or replace function privat.probleme_inchidere(p_perioada uuid)
returns setof text language plpgsql stable security definer set search_path = '' as $$
declare p record; r record; c record; v_capete int; v_ultima date; v_prim numeric; x record; v_prov boolean;
begin
  select * into p from public.perioade_raportare where id = p_perioada;
  if p.id is null then return next 'Perioada nu există.'; return; end if;
  if p.data_sfarsit >= current_date then
    return next format('Perioada se încheie la %s: se poate închide abia după această dată.', to_char(p.data_sfarsit, 'DD.MM.YYYY'));
  end if;
  select cp.provizoriu into v_prov from public.v_curs_perioade cp where cp.contract_id = p.contract_id and cp.perioada = p.numar;
  if coalesce(v_prov, false) then return next 'Cursul de referință al perioadei nu e încă definitiv.'; end if;
  if exists (select 1 from public.perioade_raportare a where a.contract_id = p.contract_id and a.numar < p.numar and a.stare <> 'raportata') then
    return next 'Perioadele anterioare trebuie închise întâi, în ordine.';
  end if;
  -- extrasele: lanț complet până la sfârșitul perioadei
  for c in select * from public.conturi where contract_id = p.contract_id and data_deschidere <= p.data_sfarsit loop
    select count(*) filter (where extras_anterior_id is null), max(data_sfarsit)
      into v_capete, v_ultima from public.extrase where cont_id = c.id and data_inceput <= p.data_sfarsit;
    if v_capete = 0 or v_ultima is null or v_ultima < p.data_sfarsit then
      return next format('Contul %s nu are extrase până la %s.', c.iban, to_char(p.data_sfarsit, 'DD.MM.YYYY'));
    elsif v_capete > 1 then
      return next format('Contul %s are o verigă lipsă în lanțul de extrase.', c.iban);
    else
      select sold_initial into v_prim from public.extrase where cont_id = c.id and extras_anterior_id is null;
      if v_prim <> c.sold_deschidere then
        return next format('Primul extras al contului %s nu pornește de la soldul de deschidere.', c.iban);
      end if;
    end if;
  end loop;
  -- raportul depus
  select * into r from public.rapoarte_depuse where perioada_id = p_perioada;
  if r.id is null then
    return next 'Raportul depus la finanțator nu a fost introdus.';
  else
    if r.fisier_cale is null then return next 'Documentul raportului depus nu e atașat.'; end if;
    for x in select * from public.v_comparatie_raport where perioada_id = p_perioada order by ordine loop
      if x.neconfirmat_eur <> 0 then
        return next format('Capitolul %s are %s EUR încă neconfirmați în aplicație.', x.cod, privat.fmt_eur(x.neconfirmat_eur));
      end if;
      if x.declarat_eur is null then
        return next format('Capitolul %s: suma declarată nu e completată (scrieți 0 dacă nu s-a declarat nimic).', x.cod);
      elsif x.diferenta_eur <> 0 and x.explicatie is null then
        return next format('Capitolul %s: diferența de %s EUR față de aplicație nu e explicată.', x.cod, privat.fmt_eur(x.diferenta_eur));
      end if;
    end loop;
  end if;
end $$;

-- 8. Perioada: închiderea doar cu toate verificările trecute și de cine are drept; redeschiderea doar de administrator.
create or replace function privat.inchide_perioada()
returns trigger language plpgsql set search_path = '' as $function$
declare v_prob text;
begin
  if tg_op = 'DELETE' then
    if old.stare = 'raportata' then raise exception 'Perioada închisă nu se șterge.'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.stare = 'raportata' then
    if new.stare = 'deschisa' and current_setting('fonduri.redeschidere', true) = old.id::text and privat.e_admin()
       and (to_jsonb(new) - array['stare','raportata_la','raportata_de','actualizat_la']) = (to_jsonb(old) - array['stare','raportata_la','raportata_de','actualizat_la']) then
      new.raportata_la := null; new.raportata_de := null;
      return new;
    end if;
    raise exception 'Perioada % este închisă. Doar administratorul o poate redeschide, cu motiv.', old.numar;
  end if;
  if new.stare = 'raportata' then
    if tg_op = 'INSERT' then raise exception 'O perioadă nouă nu poate fi creată direct închisă.'; end if;
    if current_setting('fonduri.inchidere', true) is distinct from 'da' then
      raise exception 'Perioada se închide doar din ecranul Raportare (butonul „Închide perioada”).';
    end if;
    select string_agg(t, ' ') into v_prob from privat.probleme_inchidere(new.id) t;
    if v_prob is not null then raise exception 'Perioada nu se poate închide: %', v_prob; end if;
    new.raportata_la := now();
    new.raportata_de := (select auth.uid());
  end if;
  return new;
end $function$;

-- Verificarea pentru ecran.
create or replace function public.verifica_inchidere_perioada(p_perioada uuid)
returns setof text language plpgsql stable security definer set search_path = '' as $$
begin
  if not privat.poate_citi((select contract_id from public.perioade_raportare where id = p_perioada)) then
    raise exception 'Nu aveți acces la această perioadă.';
  end if;
  return query select * from privat.probleme_inchidere(p_perioada);
end $$;

-- Închiderea: administratorul sau directorul de program. Fotografiază cifrele aplicației, apoi blochează perioada.
create or replace function public.inchide_perioada_raportare(p_perioada uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c uuid;
begin
  if (select auth.uid()) is null then raise exception 'Închiderea se face din aplicație, de un utilizator conectat.'; end if;
  select contract_id into v_c from public.perioade_raportare where id = p_perioada for update;
  if v_c is null then raise exception 'Perioada nu există.'; end if;
  if not privat.poate_aproba_buget(v_c) then
    raise exception 'Perioada o închide administratorul sau directorul de program.';
  end if;
  perform set_config('fonduri.inchidere', 'da', true);
  update public.raport_depus_linii l
     set aplicatie_la_inchidere_eur = c.aplicatie_eur
    from public.v_comparatie_raport c
   where c.linie_id = l.id and c.perioada_id = p_perioada;
  update public.perioade_raportare set stare = 'raportata' where id = p_perioada;
  perform set_config('fonduri.inchidere', '', true);
end $$;

-- Redeschiderea: doar administratorul, doar ultima perioadă închisă, cu motiv scris.
create or replace function public.redeschide_perioada(p_perioada uuid, p_motiv text)
returns void language plpgsql security definer set search_path = '' as $$
declare p record;
begin
  if not privat.e_admin() then raise exception 'Doar administratorul poate redeschide o perioadă.'; end if;
  if length(btrim(coalesce(p_motiv, ''))) < 10 then raise exception 'Scrieți motivul redeschiderii (cel puțin 10 caractere).'; end if;
  select * into p from public.perioade_raportare where id = p_perioada for update;
  if p.id is null then raise exception 'Perioada nu există.'; end if;
  if p.stare <> 'raportata' then raise exception 'Perioada nu este închisă.'; end if;
  if exists (select 1 from public.perioade_raportare a where a.contract_id = p.contract_id and a.numar > p.numar and a.stare = 'raportata') then
    raise exception 'Se redeschide întâi perioada următoare, care e și ea închisă.';
  end if;
  insert into public.redeschideri_perioade (perioada_id, contract_id, motiv, inchisa_la)
  values (p.id, p.contract_id, btrim(p_motiv), p.raportata_la);
  perform set_config('fonduri.redeschidere', p.id::text, true);
  update public.perioade_raportare set stare = 'deschisa' where id = p.id;
  perform set_config('fonduri.redeschidere', '', true);
end $$;

revoke all on function public.verifica_inchidere_perioada(uuid), public.inchide_perioada_raportare(uuid), public.redeschide_perioada(uuid, text) from public, anon;
grant execute on function public.verifica_inchidere_perioada(uuid), public.inchide_perioada_raportare(uuid), public.redeschide_perioada(uuid, text) to authenticated;
revoke all on function privat.probleme_inchidere(uuid) from public, anon, authenticated;

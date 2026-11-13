-- 028a – Biblioteca de bănci
-- 1. Banca are codul din IBAN (RO: caracterele 5–8, de ex. RNCB = BCR) și observații.
-- 2. Bănci și formate de extras cu aprobare (ca la programe): cine și când aprobă se notează automat;
--    un format aprobat nu se mai rescrie (se face o versiune nouă); un format se aprobă doar la o bancă aprobată.
-- 3. Formatul spune ce cititor folosește aplicația: BCR_PDF_V1 (PDF-ul BCR) sau MT940 (standardul SWIFT, orice bancă).
-- 4. IBAN-ul contului se verifică (cifra de control) și banca se recunoaște din IBAN.
-- 5. Un extras se încarcă doar într-un format aprobat al băncii contului; extrasul ține minte formatul folosit.

-- 1 ------------------------------------------------------------------
alter table public.banci add column if not exists cod_iban text, add column if not exists observatii text;
alter table public.banci add constraint banci_cod_iban_format check (cod_iban is null or cod_iban ~ '^[A-Z0-9]{4}$');
create unique index if not exists banci_tara_cod_iban_uk on public.banci (tara, cod_iban) where cod_iban is not null;
update public.banci set cod_iban = 'RNCB' where cod_bic = 'RNCBROBU' and cod_iban is null;

-- 3 ------------------------------------------------------------------
alter table public.formate_extras add constraint formate_extras_cititor check (
  structura ? 'cititor' and structura->>'cititor' in ('BCR_PDF_V1', 'MT940'));

-- 2 ------------------------------------------------------------------
create or replace function privat.aprobare_banci()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if new.stare = 'aprobata' and (tg_op = 'INSERT' or old.stare <> 'aprobata') then
    new.aprobat_de := (select auth.uid()); new.aprobat_la := now();
  elsif new.stare = 'propusa' then
    new.aprobat_de := null; new.aprobat_la := null;
  end if;

  if tg_table_name = 'banci' then
    if tg_op = 'UPDATE' and old.stare = 'retrasa' and new.stare <> 'retrasa' then
      raise exception 'O bancă retrasă nu se mai reactivează.';
    end if;
    if tg_op = 'UPDATE' and new.stare = 'propusa' and old.stare = 'aprobata'
       and exists (select 1 from public.formate_extras f where f.banca_id = new.id and f.stare = 'aprobata') then
      raise exception 'Banca are formate de extras aprobate. Retrageți întâi formatele.';
    end if;
    if tg_op = 'UPDATE' and new.stare = 'retrasa' and old.stare <> 'retrasa' then
      update public.formate_extras set stare = 'retrasa' where banca_id = new.id and stare <> 'retrasa';
    end if;
    return new;
  end if;

  -- formate_extras
  if tg_op = 'INSERT' then
    new.versiune := coalesce((select max(f.versiune) from public.formate_extras f where f.banca_id = new.banca_id), 0) + 1;
  else
    if new.banca_id <> old.banca_id then raise exception 'Formatul nu se mută la altă bancă.'; end if;
    if old.stare in ('aprobata', 'retrasa') and
       (to_jsonb(new) - array['stare','aprobat_de','aprobat_la','actualizat_la','observatii']) is distinct from
       (to_jsonb(old) - array['stare','aprobat_de','aprobat_la','actualizat_la','observatii']) then
      raise exception 'Un format aprobat sau retras nu se mai rescrie. Faceți o versiune nouă a lui.';
    end if;
    if old.stare = 'retrasa' and new.stare <> 'retrasa' then
      raise exception 'Un format retras nu se mai reactivează. Faceți o versiune nouă.';
    end if;
  end if;
  if new.stare = 'aprobata' and (select b.stare from public.banci b where b.id = new.banca_id) <> 'aprobata' then
    raise exception 'Aprobați întâi banca, apoi formatul ei de extras.';
  end if;
  return new;
end $function$;

create trigger b_aprobare before insert or update on public.banci
  for each row execute function privat.aprobare_banci();
create trigger b_aprobare before insert or update on public.formate_extras
  for each row execute function privat.aprobare_banci();

-- 4 ------------------------------------------------------------------
create or replace function privat.iban_valid(p_iban text)
returns boolean language plpgsql immutable set search_path to '' as $function$
declare s text; d text := ''; c text; i int;
begin
  s := upper(replace(coalesce(p_iban, ''), ' ', ''));
  if s !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$' then return false; end if;
  if left(s, 2) = 'RO' and length(s) <> 24 then return false; end if;
  s := substr(s, 5) || left(s, 4);
  for i in 1..length(s) loop
    c := substr(s, i, 1);
    d := d || case when c ~ '[0-9]' then c else (ascii(c) - 55)::text end;
  end loop;
  return (d::numeric % 97) = 1;
end $function$;

create or replace function privat.banca_din_iban()
returns trigger language plpgsql security definer set search_path to '' as $function$
declare v_cod text; v_b record; v_ales record;
begin
  new.iban := upper(replace(new.iban, ' ', ''));
  if not privat.iban_valid(new.iban) then
    raise exception 'IBAN-ul % nu e valid (cifra de control nu se potrivește). Verificați-l.', new.iban;
  end if;
  if left(new.iban, 2) <> 'RO' then return new; end if;   -- conturi din alte țări: banca se alege de mână
  v_cod := substr(new.iban, 5, 4);
  select id, denumire into v_b from public.banci where tara = 'RO' and cod_iban = v_cod and stare <> 'retrasa';
  if new.banca_id is null then
    if v_b.id is null then
      raise exception 'Banca cu codul % (din IBAN) nu e încă în biblioteca de bănci. M.V. Consulting o adaugă.', v_cod;
    end if;
    new.banca_id := v_b.id;
  else
    select denumire, cod_iban into v_ales from public.banci where id = new.banca_id;
    if v_ales.cod_iban is not null and v_ales.cod_iban <> v_cod then
      raise exception 'IBAN-ul % are codul de bancă %, nu % (%).', new.iban, v_cod, v_ales.cod_iban, v_ales.denumire;
    end if;
  end if;
  return new;
end $function$;

create trigger a_banca_din_iban before insert or update of iban, banca_id on public.conturi
  for each row execute function privat.banca_din_iban();

-- 5 ------------------------------------------------------------------
-- formatul folosit la încărcare: cel ales în tranzacția curentă (setat de incarca_extras), altfel ultimul aprobat
create or replace function privat.format_banca(p_banca uuid)
returns uuid language sql stable set search_path to '' as $function$
  select coalesce(
    (select f.id from public.formate_extras f
      where f.id = nullif(current_setting('fonduri.format_extras', true), '')::uuid and f.banca_id = p_banca),
    (select f.id from public.formate_extras f where f.banca_id = p_banca and f.stare = 'aprobata' order by f.versiune desc limit 1))
$function$;

alter function public.incarca_extras(uuid, jsonb, jsonb) set schema privat;
alter function privat.incarca_extras(uuid, jsonb, jsonb) rename to incarca_extras_baza;
revoke execute on function privat.incarca_extras_baza(uuid, jsonb, jsonb) from public, anon;

create or replace function public.incarca_extras(p_cont uuid, p_extras jsonb, p_operatiuni jsonb, p_format uuid default null)
returns jsonb language plpgsql set search_path to '' as $function$
declare v_banca uuid; v_f record; v_fmt uuid;
begin
  select banca_id into v_banca from public.conturi where id = p_cont;
  if v_banca is null then raise exception 'Contul nu există sau nu aveți acces la el.'; end if;
  v_fmt := coalesce(p_format, privat.format_banca(v_banca));
  select f.id, f.banca_id, f.stare, f.valabil_de_la, f.denumire into v_f
    from public.formate_extras f where f.id = v_fmt;
  if v_f.id is null or v_f.stare <> 'aprobata' then
    raise exception 'Banca acestui cont nu are încă un format de extras aprobat. M.V. Consulting îl aprobă în Biblioteca de bănci.';
  end if;
  if v_f.banca_id <> v_banca then
    raise exception 'Formatul „%” e al altei bănci decât banca contului.', v_f.denumire;
  end if;
  if v_f.valabil_de_la is not null and (p_extras->>'data_sfarsit')::date < v_f.valabil_de_la then
    raise exception 'Formatul „%” e valabil de la %; extrasul e mai vechi.', v_f.denumire, to_char(v_f.valabil_de_la, 'DD.MM.YYYY');
  end if;
  perform set_config('fonduri.format_extras', v_f.id::text, true);
  return privat.incarca_extras_baza(p_cont, p_extras, p_operatiuni);
end $function$;
revoke execute on function public.incarca_extras(uuid, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.incarca_extras(uuid, jsonb, jsonb, uuid) to authenticated;

-- extrasele vechi (toate BCR PDF) primesc formatul cu care au fost citite
update public.extrase e set format_extras_id = f.id
  from public.conturi c, public.formate_extras f
 where e.format_extras_id is null and c.id = e.cont_id and f.banca_id = c.banca_id and f.structura->>'cititor' = 'BCR_PDF_V1';

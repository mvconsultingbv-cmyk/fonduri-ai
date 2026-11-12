-- 026a – Horizon complet (sesiunea 15)
-- 1) Bifa „intră în baza capitolelor procentuale” (de ex. baza indirectelor), în bibliotecă și pe contract.
-- 2) Avertisment anual pentru zilele declarate pe persoană (regula zile_productive_an).
-- 3) Reguli Horizon noi, propuse (de aprobat de M.V. Consulting).

-- 1. Coloana nouă -----------------------------------------------------------
alter table public.capitole_program add column intra_baza_procent boolean not null default true;
alter table public.pozitii_buget   add column intra_baza_procent boolean not null default true;
comment on column public.capitole_program.intra_baza_procent is
  'Dacă suma capitolului intră în baza de calcul a capitolelor procentuale (de ex. indirectele 25% la Horizon). La Horizon nu intră B (subcontractare) și D.1 (sprijin financiar către terți).';
comment on column public.pozitii_buget.intra_baza_procent is
  'Copiată din capitolul programului la crearea contractului. Dacă suma capitolului intră în baza capitolelor procentuale.';

-- Horizon: B nu intră; D se împarte în D.1 (nu intră) și D.2 (intră).
update public.capitole_program cp set intra_baza_procent = false
  from public.programe p where p.id = cp.program_id and p.cod = 'HORIZON-EUROPE' and cp.cod = 'B';
update public.capitole_program cp
   set cod = 'D.1', capitol = 'D.1', denumire = 'Sprijin financiar către terți',
       descriere_eligibilitate = 'Granturi sau premii acordate de beneficiar unor terți, doar dacă sunt prevăzute în Anexa 1. MGA art. 6.2.D.1. Nu intră în baza costurilor indirecte.',
       intra_baza_procent = false
  from public.programe p where p.id = cp.program_id and p.cod = 'HORIZON-EUROPE' and cp.cod = 'D';
update public.capitole_program cp set ordine = 8
  from public.programe p where p.id = cp.program_id and p.cod = 'HORIZON-EUROPE' and cp.cod = 'E';
insert into public.capitole_program (program_id, capitol, cod, denumire, descriere_eligibilitate, mod_calcul, procent, optional, ordine, intra_baza_procent)
select p.id, 'D.2', 'D.2', 'Alte categorii de costuri',
       'Infrastructuri de cercetare, bunuri și servicii facturate intern, costuri de achiziții publice etc., doar dacă sunt prevăzute în contract. MGA art. 6.2.D.2–D.5. Intră în baza costurilor indirecte.',
       'plati', null, true, 7, true
  from public.programe p where p.cod = 'HORIZON-EUROPE';
update public.capitole_program cp
   set descriere_eligibilitate = 'Calculate automat: 25% din costurile directe eligibile care intră în bază (fără subcontractare B și fără sprijin financiar către terți D.1). Fără documente. MGA art. 6.2.E.'
  from public.programe p where p.id = cp.program_id and p.cod = 'HORIZON-EUROPE' and cp.cod = 'E';

-- Bugetul inițial protejat include acum și bifa.
create or replace function privat.protejeaza_buget_initial()
returns trigger language plpgsql security definer set search_path to '' as $function$
declare v_c uuid := case when tg_op = 'DELETE' then old.contract_id else new.contract_id end;
begin
  if (select auth.uid()) is not null and not privat.e_admin()
     and (select stare from public.contracte where id = v_c) not in ('in_pregatire') then
    if tg_op <> 'UPDATE' or (new.suma_initiala_eur, new.mod_calcul, new.procent, new.cod, new.contract_id, new.intra_baza_procent)
                            is distinct from (old.suma_initiala_eur, old.mod_calcul, old.procent, old.cod, old.contract_id, old.intra_baza_procent) then
      raise exception 'Bugetul inițial se schimbă doar cât contractul e în pregătire. După aceea folosiți Modificări de buget.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $function$;

-- Bugetul la o dată: capitolele procentuale urmează doar capitolele din bază.
create or replace function public.buget_la_data(p_contract uuid, p_la date default current_date)
returns table(pozitie_id uuid, contract_id uuid, capitol text, cod text, denumire text, mod_calcul mod_calcul,
              suma_initiala_eur numeric, modificari_aprobate_eur numeric, suma_in_vigoare_eur numeric, procent numeric, ordine integer)
language sql stable set search_path to 'public' as $function$
  with dif as (
    select l.pozitie_id, sum(l.diferenta_eur) as d
      from modificari_buget_linii l
      join modificari_buget m on m.id = l.modificare_id
     where m.contract_id = p_contract and m.stare = 'aprobata'
       and coalesce(m.data_efect, m.data_document) <= p_la
     group by l.pozitie_id
  ), baza as (
    select coalesce(sum(dif.d), 0) as d
      from dif join pozitii_buget p on p.id = dif.pozitie_id
     where p.mod_calcul <> 'procent' and p.intra_baza_procent
  )
  select p.id, p.contract_id, p.capitol, p.cod, p.denumire, p.mod_calcul, p.suma_initiala_eur,
         x.v, p.suma_initiala_eur + x.v, p.procent, p.ordine
    from pozitii_buget p
    cross join baza b
    left join dif on dif.pozitie_id = p.id
    cross join lateral (select case when p.mod_calcul = 'procent'
                                    then round(b.d * p.procent / 100, 2)
                                    else coalesce(dif.d, 0) end as v) x
   where p.contract_id = p_contract
$function$;

-- Verificarea contractului: baza = capitolele nepercentuale bifate.
create or replace function public.verifica_contract(p_contract uuid)
returns table(nivel text, zona text, mesaj text)
language plpgsql stable security definer set search_path to '' as $function$
declare c record; p record; v_buget numeric; v_baza numeric; r record; v_prev date; v_n int; v_transe numeric;
begin
  if not privat.poate_citi(p_contract) then return; end if;
  select * into c from public.contracte where id = p_contract;
  if c.id is null then return; end if;
  select * into p from public.programe where id = c.program_id;

  if p.id is null then
    return query select 'blocant','Program','Alegeți programul de finanțare.';
  else
    if p.stare <> 'aprobata' then
      return query select 'blocant','Program', format('Programul %s nu e încă aprobat de M.V. Consulting în biblioteca de programe.', p.denumire);
    end if;
    select count(*) into v_n from public.reguli_program where program_id = p.id and stare = 'propusa';
    if v_n > 0 then
      return query select 'blocant','Program', format('Programul %s are %s reguli neaprobate. Contractul pornește doar cu reguli verificate.', p.denumire, v_n);
    end if;
  end if;

  if coalesce(btrim(c.numar_contract),'') = '' then return query select 'blocant','Date','Lipsește numărul contractului.'; end if;
  if coalesce(c.valoare_finantare_eur,0) <= 0 then return query select 'blocant','Date','Valoarea finanțării trebuie să fie mai mare decât zero.'; end if;
  if c.data_inceput is null or c.data_sfarsit is null or c.data_sfarsit <= c.data_inceput then
    return query select 'blocant','Date','Perioada contractului nu e corectă (data de sfârșit trebuie să fie după cea de început).';
  end if;

  select coalesce(sum(suma_initiala_eur),0),
         coalesce(sum(suma_initiala_eur) filter (where mod_calcul <> 'procent' and intra_baza_procent),0), count(*)
    into v_buget, v_baza, v_n from public.pozitii_buget where contract_id = p_contract;
  if v_n = 0 then
    return query select 'blocant','Buget','Bugetul nu are niciun capitol.';
  elsif abs(v_buget - coalesce(c.valoare_finantare_eur,0)) > 0.01 then
    return query select 'blocant','Buget', format('Capitolele adună %s, iar valoarea contractului e %s. Trebuie să fie egale.',
      to_char(v_buget,'FM999G999G990D00'), to_char(c.valoare_finantare_eur,'FM999G999G990D00'));
  end if;
  for r in select cod, procent, suma_initiala_eur from public.pozitii_buget where contract_id = p_contract and mod_calcul = 'procent' loop
    if abs(round(v_baza * r.procent / 100, 2) - r.suma_initiala_eur) > 1 then
      return query select 'atentie','Buget', format('Capitolul %s (%s%%) are %s; %s%% din capitolele care intră în bază ar da %s. Verificați baza de calcul din contract.',
        r.cod, r.procent, to_char(r.suma_initiala_eur,'FM999G999G990D00'), r.procent, to_char(round(v_baza*r.procent/100,2),'FM999G999G990D00'));
    end if;
  end loop;

  v_prev := null; v_n := 0;
  for r in select numar, data_inceput, data_sfarsit from public.perioade_raportare where contract_id = p_contract order by data_inceput loop
    v_n := v_n + 1;
    if r.data_sfarsit < r.data_inceput then
      return query select 'blocant','Perioade', format('Perioada %s se termină înainte să înceapă.', r.numar);
    end if;
    if v_prev is null and r.data_inceput <> c.data_inceput then
      return query select 'atentie','Perioade', 'Prima perioadă de raportare nu începe odată cu contractul.';
    end if;
    if v_prev is not null and r.data_inceput <> v_prev + 1 then
      return query select 'blocant','Perioade', format('Între perioade există o pauză sau o suprapunere (perioada %s).', r.numar);
    end if;
    v_prev := r.data_sfarsit;
  end loop;
  if v_n = 0 then
    return query select 'blocant','Perioade','Nu există nicio perioadă de raportare.';
  elsif v_prev <> c.data_sfarsit then
    return query select 'atentie','Perioade','Ultima perioadă de raportare nu se termină odată cu contractul.';
  end if;

  select count(*) into v_n from public.conturi where contract_id = p_contract;
  if v_n = 0 then
    return query select 'blocant','Conturi','Contractul nu are niciun cont bancar.';
  elsif p.id is not null and not exists (select 1 from public.conturi where contract_id = p_contract and moneda = p.moneda) then
    return query select 'atentie','Conturi', format('Niciun cont în moneda programului (%s). Banii de la finanțator vin de regulă în această monedă.', p.moneda);
  end if;

  select coalesce(sum(suma_asteptata_eur),0), count(*) into v_transe, v_n from public.transe where contract_id = p_contract;
  if v_n = 0 then
    return query select 'atentie','Tranșe','Nu e introdusă nicio tranșă. Se pot adăuga și după activare.';
  elsif v_transe > coalesce(c.valoare_finantare_eur,0) + 0.01 then
    return query select 'blocant','Tranșe','Tranșele adună mai mult decât valoarea contractului.';
  end if;

  if not exists (select 1 from public.roluri_contract where contract_id = p_contract and rol = 'manager') then
    return query select 'atentie','Echipa','Contractul nu are încă un manager. Îl puteți invita din ecranul Echipa contractului.';
  end if;
end $function$;

-- Modificările de buget: capitolele procentuale cresc doar cu partea din bază.
create or replace function public.probleme_modificare_buget(p_id uuid)
returns text[] language plpgsql stable set search_path to 'public' as $function$
declare
  m modificari_buget; c contracte; pr text[] := '{}'; r record;
  v_data date; v_perm numeric; v_max numeric; v_d numeric; v_db numeric; v_pct numeric; v_total numeric; n int;
begin
  select * into m from modificari_buget where id = p_id;
  if not found then return array['Modificarea nu există.']; end if;
  select * into c from contracte where id = m.contract_id;
  v_data := coalesce(m.data_efect, m.data_document);

  select count(*) into n from modificari_buget_linii where modificare_id = p_id;
  if n = 0 then pr := pr || 'Modificarea nu are nicio linie de buget.'::text; end if;

  for r in select p.cod from modificari_buget_linii l join pozitii_buget p on p.id = l.pozitie_id
            where l.modificare_id = p_id and p.mod_calcul = 'procent' loop
    pr := pr || format('Capitolul %s se calculează procentual și se ajustează singur; nu se modifică direct.', r.cod);
  end loop;

  if v_data < c.data_inceput or v_data > c.data_sfarsit then
    pr := pr || format('Data de efect (%s) e în afara perioadei contractului (%s – %s).',
                       to_char(v_data, 'DD.MM.YYYY'), to_char(c.data_inceput, 'DD.MM.YYYY'), to_char(c.data_sfarsit, 'DD.MM.YYYY'));
  end if;

  select coalesce(sum(l.diferenta_eur), 0), coalesce(sum(l.diferenta_eur) filter (where p.intra_baza_procent), 0) into v_d, v_db
    from modificari_buget_linii l join pozitii_buget p on p.id = l.pozitie_id
   where l.modificare_id = p_id and p.mod_calcul <> 'procent';

  if m.tip = 'mutare' then
    if v_d <> 0 then
      pr := pr || format('O mutare între capitole trebuie să adune zero: ce scade dintr-un capitol crește în altul. Acum diferența este %s EUR.', v_d);
    end if;
    v_perm := valoare_regula(m.contract_id, 'mutari_fara_act_permise', v_data);
    if v_perm is null then
      pr := pr || 'Programul nu are în bibliotecă regula „mutari_fara_act_permise”. Completați-o înainte de a aproba mutări fără act adițional.'::text;
    elsif v_perm = 0 then
      pr := pr || 'Programul nu permite mutări între capitole fără act adițional.'::text;
    else
      v_max := valoare_regula(m.contract_id, 'mutari_fara_act_procent_max', v_data);
      if v_max is not null then
        for r in
          select p.cod, p.suma_initiala_eur as ini,
                 l.diferenta_eur + coalesce((select sum(l2.diferenta_eur)
                                               from modificari_buget_linii l2
                                               join modificari_buget m2 on m2.id = l2.modificare_id
                                              where l2.pozitie_id = p.id and m2.stare = 'aprobata'
                                                and m2.tip = 'mutare' and m2.id <> p_id), 0) as cum
            from modificari_buget_linii l join pozitii_buget p on p.id = l.pozitie_id
           where l.modificare_id = p_id and p.mod_calcul <> 'procent'
        loop
          if r.ini = 0 or abs(r.cum) * 100 / r.ini > v_max then
            pr := pr || format('Capitolul %s s-ar modifica în total cu %s față de bugetul inițial, peste limita de %s%% a programului. E nevoie de act adițional.',
                               r.cod, case when r.ini = 0 then 'o sumă nouă' else round(abs(r.cum) * 100 / r.ini, 2) || '%' end, v_max);
          end if;
        end loop;
      end if;
    end if;
  else
    if m.document_id is null then
      pr := pr || 'Actul adițional trebuie atașat (încărcat în ecranul Facturi și documente) înainte de aprobare.'::text;
    end if;
  end if;

  for r in select b.cod, b.suma_in_vigoare_eur + coalesce(l.diferenta_eur, 0) as rez
             from buget_la_data(m.contract_id, greatest(v_data, current_date)) b
             left join modificari_buget_linii l on l.pozitie_id = b.pozitie_id and l.modificare_id = p_id
            where b.mod_calcul <> 'procent' and b.suma_in_vigoare_eur + coalesce(l.diferenta_eur, 0) < 0 loop
    pr := pr || format('Capitolul %s ar ajunge la un buget negativ (%s EUR).', r.cod, r.rez);
  end loop;

  select coalesce(sum(procent), 0) into v_pct from pozitii_buget where contract_id = m.contract_id and mod_calcul = 'procent';
  select sum(suma_in_vigoare_eur) into v_total from buget_la_data(m.contract_id, greatest(v_data, current_date));
  v_total := coalesce(v_total, 0) + v_d + round(v_db * v_pct / 100, 2);
  if v_total > c.valoare_finantare_eur + 0.005 then
    pr := pr || format('Bugetul total ar ajunge la %s EUR, peste valoarea contractului (%s EUR). Dacă actul adițional mărește finanțarea, actualizați întâi valoarea contractului.',
                       v_total, c.valoare_finantare_eur);
  end if;
  return pr;
end $function$;

-- Raportarea pe perioade: capitolele procentuale din eligibilul capitolelor bifate.
create or replace view public.v_raport_perioade with (security_invoker = true) as
 WITH per AS (
         SELECT pr.id AS perioada_id, pr.contract_id, pr.numar, pr.data_inceput, pr.data_sfarsit, pr.stare, pr.raportata_la, cp.curs, cp.provizoriu
           FROM perioade_raportare pr
             LEFT JOIN v_curs_perioade cp ON cp.contract_id = pr.contract_id AND cp.perioada = pr.numar
        ), plati AS (
         SELECT COALESCE(d_1.perioada_id, o2.perioada_id) AS perioada_id,
            d_1.pozitie_buget_id,
            sum(d_1.suma) FILTER (WHERE c.moneda = 'EUR'::bpchar AND d_1.stare <> 'propusa'::stare_decontare) AS eur,
            sum(d_1.suma) FILTER (WHERE c.moneda = 'RON'::bpchar AND d_1.stare <> 'propusa'::stare_decontare) AS lei,
            sum(d_1.suma) FILTER (WHERE c.moneda = 'EUR'::bpchar AND d_1.stare = 'propusa'::stare_decontare) AS eur_propus,
            sum(d_1.suma) FILTER (WHERE c.moneda = 'RON'::bpchar AND d_1.stare = 'propusa'::stare_decontare) AS lei_propus,
            count(*) FILTER (WHERE d_1.stare = 'aprobata'::stare_decontare AND d_1.storneaza_id IS NULL) AS nr
           FROM decontari d_1
             LEFT JOIN decontari o2 ON o2.id = d_1.storneaza_id
             JOIN operatiuni o ON o.id = d_1.operatiune_id
             JOIN conturi c ON c.id = o.cont_id
          WHERE d_1.stare = ANY (ARRAY['aprobata'::stare_decontare, 'stornata'::stare_decontare, 'propusa'::stare_decontare])
          GROUP BY COALESCE(d_1.perioada_id, o2.perioada_id), d_1.pozitie_buget_id
        ), pers AS (
         SELECT v_personal_luni.contract_id, v_personal_luni.perioada,
            sum(v_personal_luni.eligibil_eur) AS eur,
            sum(v_personal_luni.eligibil_eur) FILTER (WHERE NOT v_personal_luni.confirmat) AS neconf,
            count(*) AS nr,
            count(*) FILTER (WHERE NOT v_personal_luni.confirmat) AS nr_neconf
           FROM v_personal_luni
          GROUP BY v_personal_luni.contract_id, v_personal_luni.perioada
        ), amort AS (
         SELECT v_amortizare_perioade.contract_id, v_amortizare_perioade.perioada,
            sum(v_amortizare_perioade.eligibil_pana_acum) FILTER (WHERE v_amortizare_perioade.moneda = 'EUR'::bpchar) AS eur,
            sum(v_amortizare_perioade.eligibil_pana_acum) FILTER (WHERE v_amortizare_perioade.moneda = 'RON'::bpchar) AS lei,
            count(*) FILTER (WHERE v_amortizare_perioade.luni_scurse > 0) AS nr
           FROM v_amortizare_perioade
          GROUP BY v_amortizare_perioade.contract_id, v_amortizare_perioade.perioada
        ), directe AS (
         SELECT p.contract_id, p.perioada_id, p.numar AS perioada, p.data_inceput, p.data_sfarsit, p.stare, p.raportata_la, p.curs, p.provizoriu,
            b.pozitie_id, b.capitol, b.cod, b.denumire, b.mod_calcul, pb.procent, pb.ordine, pb.intra_baza_procent,
            b.suma_in_vigoare_eur AS buget_eur,
                CASE b.mod_calcul
                    WHEN 'plati'::mod_calcul THEN COALESCE(pl.eur, 0::numeric)
                    WHEN 'amortizare'::mod_calcul THEN COALESCE(am.eur, 0::numeric)
                    ELSE 0::numeric
                END AS cheltuit_eur,
                CASE b.mod_calcul
                    WHEN 'plati'::mod_calcul THEN COALESCE(pl.lei, 0::numeric)
                    WHEN 'amortizare'::mod_calcul THEN COALESCE(am.lei, 0::numeric)
                    ELSE 0::numeric
                END AS cheltuit_lei,
                CASE b.mod_calcul
                    WHEN 'plati'::mod_calcul THEN COALESCE(pl.eur, 0::numeric) + COALESCE(pl.lei, 0::numeric) / NULLIF(p.curs, 0::numeric)
                    WHEN 'amortizare'::mod_calcul THEN COALESCE(am.eur, 0::numeric) + COALESCE(am.lei, 0::numeric) / NULLIF(p.curs, 0::numeric)
                    WHEN 'pontaj'::mod_calcul THEN COALESCE(pe.eur, 0::numeric)
                    ELSE NULL::numeric
                END AS eligibil_eur,
                CASE b.mod_calcul
                    WHEN 'plati'::mod_calcul THEN COALESCE(pl.eur_propus, 0::numeric) + COALESCE(pl.lei_propus, 0::numeric) / NULLIF(p.curs, 0::numeric)
                    WHEN 'pontaj'::mod_calcul THEN COALESCE(pe.neconf, 0::numeric)
                    ELSE 0::numeric
                END AS neconfirmat_eur,
                CASE b.mod_calcul
                    WHEN 'plati'::mod_calcul THEN COALESCE(pl.nr, 0::bigint)
                    WHEN 'pontaj'::mod_calcul THEN COALESCE(pe.nr, 0::bigint)
                    WHEN 'amortizare'::mod_calcul THEN COALESCE(am.nr, 0::bigint)
                    ELSE 0::bigint
                END AS nr_elemente,
                CASE b.mod_calcul
                    WHEN 'pontaj'::mod_calcul THEN COALESCE(pe.nr_neconf, 0::bigint)
                    ELSE 0::bigint
                END AS nr_neconfirmate
           FROM per p
             JOIN v_buget_in_vigoare b ON b.contract_id = p.contract_id
             JOIN pozitii_buget pb ON pb.id = b.pozitie_id
             LEFT JOIN plati pl ON pl.perioada_id = p.perioada_id AND pl.pozitie_buget_id = b.pozitie_id
             LEFT JOIN pers pe ON pe.contract_id = p.contract_id AND pe.perioada = p.numar
             LEFT JOIN amort am ON am.contract_id = p.contract_id AND am.perioada = p.numar
        )
 SELECT contract_id, perioada_id, perioada, data_inceput, data_sfarsit, stare, raportata_la, curs, provizoriu,
    pozitie_id, capitol, cod, denumire, mod_calcul, procent, ordine, buget_eur, cheltuit_eur, cheltuit_lei,
    round(CASE WHEN mod_calcul = 'procent'::mod_calcul
               THEN procent / 100::numeric * (SELECT COALESCE(sum(x.eligibil_eur), 0::numeric) FROM directe x
                                               WHERE x.perioada_id = d.perioada_id AND x.mod_calcul <> 'procent'::mod_calcul AND x.intra_baza_procent)
               ELSE eligibil_eur END, 2) AS eligibil_eur,
    round(CASE WHEN mod_calcul = 'procent'::mod_calcul
               THEN procent / 100::numeric * (SELECT COALESCE(sum(x.neconfirmat_eur), 0::numeric) FROM directe x
                                               WHERE x.perioada_id = d.perioada_id AND x.mod_calcul <> 'procent'::mod_calcul AND x.intra_baza_procent)
               ELSE neconfirmat_eur END, 2) AS neconfirmat_eur,
    nr_elemente, nr_neconfirmate
   FROM directe d;

-- 2. Zile declarate pe an, pe persoană -------------------------------------
-- O persoană e recunoscută în toate contractele firmei după contrapartida ei (dacă e legată), altfel după rândul de personal.
create or replace view public.v_personal_zile_an with (security_invoker = true) as
with l as (
  select v.contract_id, v.persoana_id, v.nume, pp.contrapartida_id,
         extract(year from v.luna)::int as an, v.zile_declarate, v.zile_disponibile, v.zile_proiect,
         v.exclusiv_pe_proiect, v.zile_productive_an
    from v_personal_luni v join persoane_proiect pp on pp.id = v.persoana_id
), pe_contract as (
  select contract_id, persoana_id, nume, contrapartida_id, an,
         round(coalesce(sum(zile_declarate), 0), 2) as zile_declarate,
         round(coalesce(sum(greatest(zile_proiect - zile_disponibile, 0)) filter (where not exclusiv_pe_proiect), 0), 2) as zile_taiate,
         max(zile_productive_an) as limita
    from l group by contract_id, persoana_id, nume, contrapartida_id, an
)
select a.contract_id, a.persoana_id, a.nume, a.an, a.zile_declarate, a.zile_taiate, a.limita,
       round(coalesce((select sum(b.zile_declarate) from pe_contract b
                        where b.an = a.an and b.contrapartida_id = a.contrapartida_id), a.zile_declarate), 2) as zile_toate_contractele,
       (select count(distinct b.contract_id) from pe_contract b
         where b.an = a.an and b.contrapartida_id = a.contrapartida_id) as nr_contracte,
       a.limita is not null and
       coalesce((select sum(b.zile_declarate) from pe_contract b
                  where b.an = a.an and b.contrapartida_id = a.contrapartida_id), a.zile_declarate) > a.limita as depaseste
  from pe_contract a;
comment on view public.v_personal_zile_an is
  'Zilele declarate pe an pentru fiecare persoană, pe contract și adunate pe toate contractele firmei (după contrapartidă), comparate cu regula zile_productive_an a programului.';
grant select on public.v_personal_zile_an to authenticated;

-- 3. Reguli Horizon noi, propuse ------------------------------------------
insert into public.reguli_program (program_id, cod, titlu, text_regula, articol_sursa, document_sursa, versiune, stare, valoare, unitate)
select p.id, x.cod, x.titlu, x.txt, x.art, 'Horizon Europe – Model Grant Agreement (MGA) și Fișa de date (Data Sheet)', 1, 'propusa', x.val, x.u
  from public.programe p
  cross join (values
    ('mecanism_asigurare_procent', 'Mecanismul de asigurare reciprocă (MIM)',
     'Din prefinanțare, Comisia reține o contribuție la Mecanismul de asigurare reciprocă, egală cu acest procent din valoarea maximă a grantului. Suma se restituie de regulă la plata finală. Banii primiți efectiv la prefinanțare sunt deci mai mici decât prefinanțarea din contract.',
     'MGA art. 22.3.2; Data Sheet pct. 4.2', 5::numeric, '% din valoarea grantului'),
    ('plafon_plati_procent', 'Plafonul plăților înainte de plata finală',
     'Prefinanțarea și plățile intermediare adunate nu pot depăși acest procent din valoarea maximă a grantului. Restul se primește doar la plata finală, după aprobarea raportului final.',
     'MGA art. 22.3; Data Sheet pct. 4.2 (payment ceiling)', 90, '% din valoarea grantului'),
    ('prag_certificat_cfs_eur', 'Pragul pentru certificatul de audit (CFS)',
     'La raportul final e obligatoriu un certificat privind situațiile financiare (CFS), emis de un auditor independent, dacă beneficiarul cere o contribuție UE pe costuri reale de cel puțin această sumă (cumulat pe tot proiectul).',
     'MGA art. 24.2; Data Sheet pct. 4.3', 430000, 'EUR'),
    ('pierderi_curs_eligibile', 'Pierderile din curs valutar',
     'Pierderile din schimbul valutar nu sunt costuri eligibile. Diferența dintre cursul băncii și cursul de referință al programului rămâne în sarcina beneficiarului.',
     'MGA art. 6.3 (ineligible costs)', 0, 'da = 1 / nu = 0'),
    ('tva_deductibila_eligibila', 'TVA deductibilă',
     'TVA pe care beneficiarul o poate deduce sau recupera nu este eligibilă. TVA nedeductibilă (de exemplu la un neplătitor de TVA) este eligibilă.',
     'MGA art. 6.3 (ineligible costs)', 0, 'da = 1 / nu = 0')
  ) as x(cod, titlu, txt, art, val, u)
 where p.cod = 'HORIZON-EUROPE';

-- 026b (aplicată separat): verifica_contract nu e apelabilă fără autentificare
revoke execute on function public.verifica_contract(uuid) from public, anon;
grant execute on function public.verifica_contract(uuid) to authenticated;

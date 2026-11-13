-- 030a · Cititorul PDF Patria Bank (sesiunea 20, 13.11.2026)
-- 1. Formatele de extras pot folosi și cititorul PATRIA_PDF_V1.
-- 2. Patria Bank (deja în bibliotecă) primește un format PDF propus. Îl aprobă M.V. Consulting, după probă.

alter table public.formate_extras drop constraint if exists formate_extras_cititor;
alter table public.formate_extras add constraint formate_extras_cititor check (
  structura ? 'cititor' and structura->>'cititor' in ('BCR_PDF_V1', 'ING_PDF_V1', 'PATRIA_PDF_V1', 'MT940'));

insert into public.formate_extras (banca_id, versiune, denumire, tip_fisier, structura, observatii)
select b.id, coalesce((select max(f.versiune) from public.formate_extras f where f.banca_id = b.id), 0) + 1,
  'Patria Bank – extras de cont PDF', 'pdf',
  jsonb_build_object(
    'cititor', 'PATRIA_PDF_V1',
    'antet', jsonb_build_array('Client: … / Cod client: …; CUI: …', 'IBAN: …', 'Valuta: MONEDA', 'Data generare extras de cont: ZZ-LL-AAAA'),
    'solduri', 'Sold Initial / Total tranzactii Debit / Total tranzactii Credit / Sold Final (în antet) + rândul TOTAL la sfârșitul tabelului',
    'perioada', 'Tranzactii decontate in perioada ZZ-LL-AAAA - ZZ-LL-AAAA',
    'numar', 'extrasul nu are număr; se compune din perioadă (ZZ.LL-ZZ.LL.AAAA)',
    'coloane', jsonb_build_object('data_tranzactie_x_max', 70, 'data_decontare_x', jsonb_build_array(70, 130), 'descriere_x', jsonb_build_array(130, 370), 'debit_x', jsonb_build_array(370, 455), 'credit_x', jsonb_build_array(455, 535), 'sold_x_min', 535),
    'sume', 'punct la zecimale; soldul după fiecare operațiune cu CR (pozitiv) sau DB (negativ)',
    'referinta', 'la sfârșitul descrierii (de ex. OPRPTI.11839322); comisionul are aceeași referință ca operațiunea'),
  'Cititor scris și testat pe extrasul M.V. Consulting 01–22.01.2026 (cont RON închis, 20 de operațiuni, sold verificat pe fiecare rând). De re-testat pe un extras dintr-o altă lună și pe unul în EUR, când apar.'
from public.banci b
where b.cod_iban = 'CARP' and b.stare <> 'retrasa'
  and not exists (select 1 from public.formate_extras f where f.banca_id = b.id and f.structura->>'cititor' = 'PATRIA_PDF_V1');

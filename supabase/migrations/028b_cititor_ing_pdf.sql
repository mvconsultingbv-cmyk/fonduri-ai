-- 028b · Cititorul PDF ING Business (sesiunea 18, 13.11.2026)
-- ING nu exportă MT940 pentru conturile de firmă, deci extrasele ING se citesc din PDF.
-- 1. Formatele de extras pot folosi și cititorul ING_PDF_V1.
-- 2. ING intră în Biblioteca de bănci ca propusă, cu un format PDF propus. Le aprobă M.V. Consulting, după probă.

alter table public.formate_extras drop constraint if exists formate_extras_cititor;
alter table public.formate_extras add constraint formate_extras_cititor check (
  structura ? 'cititor' and structura->>'cititor' in ('BCR_PDF_V1', 'ING_PDF_V1', 'MT940'));

insert into public.banci (denumire, cod_bic, tara, cod_iban, observatii)
select 'ING Bank N.V. Amsterdam – Sucursala București', 'INGBROBU', 'RO', 'INGB',
       'ING Business nu exportă MT940; extrasele se citesc din PDF (sold verificat după fiecare operațiune).'
where not exists (select 1 from public.banci where cod_iban = 'INGB');

insert into public.formate_extras (banca_id, versiune, denumire, tip_fisier, structura, observatii)
select b.id, 1, 'ING – extras de cont PDF (ING Business)', 'pdf',
  jsonb_build_object(
    'cititor', 'ING_PDF_V1',
    'antet', jsonb_build_array('Extras de cont', 'Nr.… / ZZ.LL.AAAA', 'Cont curent principal | MONEDA', 'IBAN cu spații', 'TITULAR | CUI …'),
    'solduri', 'Sold initial / Total creditari (n) / Total debitari (n) / Sold final / Perioada (ZZ - ZZ.LL.AAAA)',
    'coloane', jsonb_build_object('data_referinta_x_max', 140, 'descriere_x', jsonb_build_array(140, 300), 'sume_x_min', 300),
    'sume', 'virgulă la mii, punct la zecimale; plățile cu minus; ultima sumă de pe rând = soldul intermediar',
    'sfarsit', 'SFARSIT EXTRAS DE CONT'),
  'Cititor scris și testat pe extrasul M.V. Consulting din 10.2026 (23 de operațiuni, sold verificat pe fiecare rând).'
from public.banci b
where b.cod_iban = 'INGB'
  and not exists (select 1 from public.formate_extras f where f.banca_id = b.id and f.structura->>'cititor' = 'ING_PDF_V1');

-- 029a – Bancă nouă din extras (sesiunea 19, 13.11.2026)
-- 1) Registrul de referință al codurilor de bancă din IBAN (România: caracterele 5–8).
--    E doar o listă de ajutor pentru completarea fișei băncii: nu aprobă nimic. Fișa propusă din extras
--    o aprobă tot M.V. Consulting, în Biblioteca de bănci. Codurile vechi (bănci preluate) rămân în listă,
--    pentru că IBAN-urile clienților lor rămân valabile la banca care le-a preluat.
-- 2) O bancă retrasă nu mai blochează codul ei: aceeași bancă se poate adăuga din nou.

create table if not exists public.registru_coduri_banci (
  tara char(2) not null default 'RO',
  cod_iban text not null check (cod_iban ~ '^[A-Z0-9]{4}$'),
  denumire text not null,
  cod_bic text,
  observatii text,
  sursa text not null,
  primary key (tara, cod_iban)
);
alter table public.registru_coduri_banci enable row level security;
create policy citire on public.registru_coduri_banci for select to authenticated using (true);
-- fără politici de scriere: lista se schimbă doar prin migrații
comment on table public.registru_coduri_banci is 'Listă de referință: codul din IBAN → denumirea și BIC-ul băncii. Folosită de „Bancă nouă din extras”. Nu înlocuiește aprobarea din Biblioteca de bănci.';

insert into public.registru_coduri_banci (tara, cod_iban, denumire, cod_bic, observatii, sursa) values
 ('RO','RNCB','Banca Comercială Română (BCR)','RNCBROBU',null,'listă publică SWIFT/BIC, nov. 2026'),
 ('RO','BTRL','Banca Transilvania','BTRLRO22',null,'listă publică SWIFT/BIC, nov. 2026'),
 ('RO','BRDE','BRD – Groupe Société Générale','BRDEROBU',null,'listă publică SWIFT/BIC, nov. 2026'),
 ('RO','RZBR','Raiffeisen Bank','RZBRROBU',null,'listă publică SWIFT/BIC, nov. 2026'),
 ('RO','BACX','UniCredit Bank','BACXROBU',null,'listă publică SWIFT/BIC, nov. 2026'),
 ('RO','INGB','ING Bank N.V. Amsterdam – Sucursala București','INGBROBU',null,'listă publică SWIFT/BIC, nov. 2026'),
 ('RO','CECE','CEC Bank','CECEROBU',null,'listă publică SWIFT/BIC, nov. 2026'),
 ('RO','OTPV','OTP Bank România','OTPVROBU','Preluată de Banca Transilvania; verificați denumirea actuală.','listă publică SWIFT/BIC, nov. 2026'),
 ('RO','WBAN','Intesa Sanpaolo Bank Romania','WBANRO22',null,'listă publică SWIFT/BIC, nov. 2026'),
 ('RO','UGBI','Garanti BBVA','UGBIROBU',null,'listă publică SWIFT/BIC, nov. 2026'),
 ('RO','BREL','Libra Internet Bank','BRELROBU',null,'listă publică SWIFT/BIC, nov. 2026'),
 ('RO','CARP','Patria Bank','CARPRO22','Fostă Banca Comercială Carpatica.','listă publică SWIFT/BIC, nov. 2026'),
 ('RO','BRMA','Exim Banca Românească','BRMAROBU',null,'listă publică SWIFT/BIC, nov. 2026'),
 ('RO','EXIM','EximBank','EXIMROBU','Unită cu Banca Românească (Exim Banca Românească); verificați denumirea actuală.','listă publică SWIFT/BIC, nov. 2026'),
 ('RO','FNNB','Nexent Bank (fostă Credit Europe Bank)','FNNBROBU','Credit Europe Bank a devenit Nexent Bank în iunie 2025.','listă publică SWIFT/BIC, nov. 2026'),
 ('RO','CRCO','Creditcoop – Banca Centrală Cooperatistă','CRCOROBU',null,'listă publică SWIFT/BIC, nov. 2026'),
 ('RO','MIRO','ProCredit Bank','MIROROBU',null,'listă publică SWIFT/BIC, nov. 2026'),
 ('RO','REVO','Revolut Bank UAB – Sucursala România','REVOROBB',null,'listă publică SWIFT/BIC, nov. 2026'),
 ('RO','TREZ','Trezoreria Statului','TREZROBU','Conturi de trezorerie (instituții publice).','listă publică SWIFT/BIC, nov. 2026'),
 ('RO','EGNA','Vista Bank (Romania)','EGNAROBX',null,'listă publică SWIFT/BIC, nov. 2026'),
 ('RO','CITI','Citibank Europe – Sucursala România','CITIROBU',null,'listă publică SWIFT/BIC, nov. 2026'),
 ('RO','FTSB','BNP Paribas – Sucursala București','FTSBROBU',null,'listă publică SWIFT/BIC, nov. 2026'),
 ('RO','BFER','Techventures Bank (fostă Banca Feroviară)','BFERROBU','Verificați denumirea actuală.','listă publică SWIFT/BIC, nov. 2026'),
 ('RO','PORL','Porsche Bank Romania','PORLROBU',null,'listă publică SWIFT/BIC, nov. 2026'),
 ('RO','NBOR','Banca Națională a României','NBORROBU',null,'listă publică SWIFT/BIC, nov. 2026'),
 ('RO','BUCU','Alpha Bank România','BUCUROBU','Fuzionată cu UniCredit Bank în august 2025; IBAN-urile vechi rămân la UniCredit.','listă publică SWIFT/BIC, nov. 2026'),
 ('RO','PIRB','First Bank','PIRBROBU','Fuzionată cu Intesa Sanpaolo Bank în octombrie 2025; IBAN-urile vechi rămân la Intesa.','listă publică SWIFT/BIC, nov. 2026'),
 ('RO','BPOS','Bancpost','BPOSROBU','Preluată de Banca Transilvania; IBAN-urile vechi rămân la BT.','listă publică SWIFT/BIC, nov. 2026'),
 ('RO','MIND','Idea Bank','MINDROBU','Preluată de Banca Transilvania; IBAN-urile vechi rămân la BT.','listă publică SWIFT/BIC, nov. 2026'),
 ('RO','CRDZ','Crédit Agricole Bank Romania','CRDZROBU','Preluată de Vista Bank; IBAN-urile vechi rămân la Vista.','listă publică SWIFT/BIC, nov. 2026')
on conflict (tara, cod_iban) do nothing;

-- o bancă retrasă nu mai ocupă codul din IBAN
drop index if exists public.banci_tara_cod_iban_uk;
create unique index banci_tara_cod_iban_uk on public.banci (tara, cod_iban) where cod_iban is not null and stare <> 'retrasa';

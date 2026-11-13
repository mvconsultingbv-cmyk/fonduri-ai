// Harta completă a aplicației: toate ecranele planificate, cu stadiul fiecăruia.
// Ecranele „gata” au pagina lor; celelalte deschid o pagină „în lucru” cu ce vor face
// și ce e deja pregătit în baza de date.

export type Stadiu = 'gata' | 'partial' | 'in_lucru'
export type Ecran = {
  cheie: string            // partea din adresă: /contract/:id/<cheie>  (sau /admin/<cheie>)
  titlu: string
  grup: string
  stadiu: Stadiu
  rost: string             // la ce folosește, într-o propoziție
  vaFace?: string[]        // ce va face (pentru ecranele încă nefăcute)
  pregatit?: string[]      // ce există deja în baza de date
}

export const STADIU: Record<Stadiu, { text: string; cls: string }> = {
  gata: { text: 'funcțional', cls: 'verde' },
  partial: { text: 'parțial', cls: 'albastru-e' },
  in_lucru: { text: 'în lucru', cls: 'galben' },
}

export const ECRANE_CONTRACT: Ecran[] = [
  { cheie: '', titlu: 'Tablou de bord', grup: 'Privire de ansamblu', stadiu: 'gata',
    rost: 'Bugetul, banii primiți, cheltuiți și disponibili, conturile, cursul și tranșele.' },

  { cheie: 'extrase', titlu: 'Extrase de cont', grup: 'Bani', stadiu: 'gata',
    rost: 'Lanțul de solduri pe fiecare cont și încărcarea extraselor noi (PDF BCR), cu verificare înainte de salvare.' },
  { cheie: 'operatiuni', titlu: 'Validarea operațiunilor', grup: 'Bani', stadiu: 'gata',
    rost: 'Aferent / neaferent, confirmarea tipului, alocarea pe capitole, cheltuieli indirecte.' },
  { cheie: 'schimburi', titlu: 'Schimburi valutare', grup: 'Bani', stadiu: 'gata',
    rost: 'Fiecare schimb EUR → lei: cursul băncii, cursul BCE din ziua schimbului și cursul programului, cu diferența de curs care nu se decontează.' },
  { cheie: 'transferuri', titlu: 'Transferuri și cont propriu', grup: 'Bani', stadiu: 'gata',
    rost: 'Perechea ieșire–intrare pentru fiecare transfer între conturile contractului și motivul fiecărei mișcări cu contul propriu al firmei, cu ce datorează proiectul firmei și invers.' },
  { cheie: 'numerar', titlu: 'Numerar și avansuri', grup: 'Bani', stadiu: 'gata',
    rost: 'Fiecare retragere de numerar e un avans: cine are banii, până când, și justificarea cu bonuri/facturi sau redepunere în cont.' },

  { cheie: 'documente', titlu: 'Facturi și documente', grup: 'Cheltuieli', stadiu: 'gata',
    rost: 'Încărcarea facturilor, potrivirea cu plățile, statutul de TVA.' },
  { cheie: 'personal', titlu: 'Personal și pontaje (A)', grup: 'Cheltuieli', stadiu: 'gata',
    rost: 'Persoanele, salariul lunar și zilele pe proiect: eligibil = zile × (cost lunar ÷ 17,92), legat de plățile de salarii și taxe din extrase.' },
  { cheie: 'echipamente', titlu: 'Echipamente (C.2)', grup: 'Cheltuieli', stadiu: 'gata',
    rost: 'Achiziții legate de plată; pe proiect intră doar amortizarea.' },
  { cheie: 'contrapartide', titlu: 'Furnizori și beneficiari', grup: 'Cheltuieli', stadiu: 'gata',
    rost: 'Registrul celor plătiți și al celor de la care se încasează, propus din extrase: tip, CUI, părți legate, dubluri de unit și semnale de audit.' },

  { cheie: 'transe', titlu: 'Tranșe de finanțare', grup: 'Buget și raportare', stadiu: 'gata',
    rost: 'Tranșele din contract, legarea fiecărei încasări din extras de tranșa ei și împărțirea banilor primiți pe capitole.' },
  { cheie: 'buget', titlu: 'Modificări de buget', grup: 'Buget și raportare', stadiu: 'gata',
    rost: 'Mutări între capitole și acte adiționale, propuse și aprobate de administrator sau de directorul de program, cu bugetul în vigoare la orice dată.' },
  { cheie: 'raportare', titlu: 'Raportare pe perioade', grup: 'Buget și raportare', stadiu: 'gata',
    rost: 'Situația cheltuielilor pe perioada de raportare, în EUR, la cursul perioadei; raportul depus la finanțator, comparația pe capitole și închiderea perioadei.' },
  { cheie: 'jurnal', titlu: 'Jurnal', grup: 'Buget și raportare', stadiu: 'gata',
    rost: 'Cine a schimbat ce și când, cu valoarea veche și cea nouă — pentru audit. Scris automat de baza de date, nu se poate modifica sau șterge.' },
  { cheie: 'echipa', titlu: 'Echipa contractului', grup: 'Acces', stadiu: 'gata',
    rost: 'Cine are acces la contract și cu ce rol; managerul și administratorul invită oameni și le schimbă rolul.' },
]

export const ECRANE_ADMIN: Ecran[] = [
  { cheie: 'jurnal', titlu: 'Jurnal general', grup: 'Administrare', stadiu: 'gata',
    rost: 'Cine a schimbat ce și când în bibliotecile comune (programe, bănci) și în administrare (utilizatori, firme).' },
  { cheie: 'programe', titlu: 'Biblioteca de programe', grup: 'Administrare', stadiu: 'gata',
    rost: 'Fișa fiecărui program de finanțare (Horizon Europe, PNRR, POR etc.): capitolele standard ale bugetului și regulile cu articolul din ghid, cu versiuni și aprobare de M.V. Consulting.' },
  { cheie: 'banci', titlu: 'Biblioteca de bănci', grup: 'Administrare', stadiu: 'in_lucru',
    rost: 'Cum arată extrasele fiecărei bănci, învățat din fiecare extras încărcat.',
    vaFace: ['Formatul extrasului pe bancă și versiuni.', 'Aprobarea unui format nou.'],
    pregatit: ['Tabelele de bănci și formate de extras; BCR e introdusă (în stare „propusă”).'] },
  { cheie: 'utilizatori', titlu: 'Utilizatori și roluri', grup: 'Administrare', stadiu: 'gata',
    rost: 'Toți oamenii din aplicație, invitarea lor, rolul pe fiecare contract (manager, responsabil financiar, director de program, cititor), link nou, dezactivare.' },
  { cheie: 'firme', titlu: 'Firme client', grup: 'Administrare', stadiu: 'gata',
    rost: 'Firmele beneficiare, cu verificarea CUI-ului la ANAF și contractele fiecăreia.' },
]

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
  { cheie: 'transferuri', titlu: 'Transferuri și cont propriu', grup: 'Bani', stadiu: 'partial',
    rost: 'Bani mutați între conturile proiectului sau către / dinspre contul propriu al asociației.',
    vaFace: ['Perechea ieșire–intrare pentru fiecare transfer între conturile proiectului.', 'Motivul fiecărei mișcări cu contul propriu (alimentare, recuperare overhead, recuperare comisioane, returnare).', 'Soldul „datorat” între proiect și asociație.'],
    pregatit: ['Tabelul de transferuri interne și motivele pentru contul propriu.', 'Tipul se poate deja schimba din ecranul de validare.'] },
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

  { cheie: 'transe', titlu: 'Tranșe de finanțare', grup: 'Buget și raportare', stadiu: 'partial',
    rost: 'Ce trebuie să primească asociația de la finanțator și ce a primit.',
    vaFace: ['Adăugarea tranșelor din contract (prefinanțare, plăți intermediare, plata finală).', 'Legarea fiecărei încasări din extras de tranșa ei.', 'Reîmpărțirea automată a banilor primiți pe capitole la fiecare tranșă.'],
    pregatit: ['Tabelul de tranșe și repartizarea proporțională pe capitole (se vede pe tabloul de bord).'] },
  { cheie: 'buget', titlu: 'Modificări de buget', grup: 'Buget și raportare', stadiu: 'in_lucru',
    rost: 'Mutări de bani între capitole, prin act adițional sau notificare.',
    vaFace: ['Înregistrarea unei modificări cu documentul ei.', 'Bugetul în vigoare la orice dată.'],
    pregatit: ['Tabelele de modificări și bugetul în vigoare calculat automat.'] },
  { cheie: 'raportare', titlu: 'Raportare pe perioade', grup: 'Buget și raportare', stadiu: 'in_lucru',
    rost: 'Situația cheltuielilor pe perioada de raportare, în EUR, la cursul perioadei.',
    vaFace: ['Raportul pe capitole pentru perioada 1 (iun 2024 – nov 2025) și perioada 2.', 'Costurile indirecte (E) calculate automat: 25% din A + C.', 'Închiderea perioadei: după raportare, nimic din ea nu se mai modifică.', 'Export pentru portalul finanțatorului.'],
    pregatit: ['Perioadele, cursul mediu BCE pe perioadă și blocarea datelor după raportare.'] },
  { cheie: 'jurnal', titlu: 'Jurnal', grup: 'Buget și raportare', stadiu: 'in_lucru',
    rost: 'Cine a schimbat ce și când — pentru audit.',
    vaFace: ['Lista tuturor modificărilor, filtrabilă după persoană, dată și tip.'],
    pregatit: ['Fiecare modificare e deja înregistrată automat în jurnal (nu se poate șterge).'] },
]

export const ECRANE_ADMIN: Ecran[] = [
  { cheie: 'programe', titlu: 'Biblioteca de programe', grup: 'Administrare', stadiu: 'in_lucru',
    rost: 'Regulile fiecărui program de finanțare (Horizon Europe, PNRR, POR etc.), aprobate de M.V. Consulting.',
    vaFace: ['Regulile programului cu articolul din ghid (curs, eligibilitate, TVA, amortizare).', 'Aprobarea unei reguli noi propuse de aplicație la citirea unui contract.', 'Excepțiile specifice unui contract.'],
    pregatit: ['Tabelele de programe, reguli și excepții; Horizon Europe e introdus (în stare „propusă”).'] },
  { cheie: 'banci', titlu: 'Biblioteca de bănci', grup: 'Administrare', stadiu: 'in_lucru',
    rost: 'Cum arată extrasele fiecărei bănci, învățat din fiecare extras încărcat.',
    vaFace: ['Formatul extrasului pe bancă și versiuni.', 'Aprobarea unui format nou.'],
    pregatit: ['Tabelele de bănci și formate de extras; BCR e introdusă (în stare „propusă”).'] },
  { cheie: 'utilizatori', titlu: 'Utilizatori și roluri', grup: 'Administrare', stadiu: 'in_lucru',
    rost: 'Cine are acces la ce contract și cu ce rol (manager, responsabil financiar, cititor).',
    vaFace: ['Invitarea unui utilizator nou.', 'Atribuirea rolului pe fiecare contract.', 'Firmele client și contractele lor.'],
    pregatit: ['Rolurile și regulile de acces sunt deja aplicate în baza de date.'] },
]

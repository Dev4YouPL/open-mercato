# Manufacturing MVP — zakres biznesowy

## Status dokumentu

**Propozycja pierwszego wydania do walidacji z klientami.**

Ten dokument określa, co użytkownik otrzyma w pierwszym użytecznym wydaniu Manufacturing i jaką wartość biznesową ma ono dostarczyć. Nie jest specyfikacją techniczną i nie przesądza o API, bazie danych, integracji modułów ani sposobie implementacji.

### Granica dokumentu i jego review

Jest to nadrzędny zakres biznesowy, a nie materiał przekazywany bezpośrednio do implementacji. Review tego dokumentu powinno oceniać wartość dla klienta, granice MVP, spójność opisanych zachowań oraz zgodność z przyjętymi założeniami prostoty i elastyczności.

Brak szczegółów potrzebnych do implementacji nie jest błędem tego dokumentu. Osobne, małe specyfikacje określą między innymi dokładne pola, walidacje danych, przypadki brzegowe, komunikaty błędów, sposób zapisu historii, zachowanie przy równoczesnych operacjach, szczegóły interfejsu oraz scenariusze akceptacyjne i testowe.

Uwaga z review powinna blokować ten dokument tylko wtedy, gdy wskazuje sprzeczność biznesową, niejasną wartość dla klienta albo brak decyzji zmieniającej zakres MVP. Pozostałe uwagi należy zapisać jako materiał wejściowy do właściwej małej specyfikacji, bez rozszerzania tego dokumentu.

## Decyzja produktowa

Pierwsze wydanie Manufacturing nie będzie samym edytorem BOM ani szerokim systemem planowania produkcji.

Przykładowy pełny scenariusz dostępny w MVP wygląda następująco. Pokazuje typowy przebieg pracy, ale nie narzuca kolejności działań:

```text
utworzenie BOM
→ aktywowanie BOM
→ utworzenie zlecenia
→ wydanie materiałów
→ przyjęcie produktu
→ podstawowa historia
→ pełne wycofanie błędnej operacji
```

Po jego przejściu użytkownik ma zobaczyć realną zmianę stanów magazynowych oraz pełne powiązanie tej zmiany ze zleceniem produkcyjnym.

## Założenia i świadome kompromisy MVP

Manufacturing MVP ma przede wszystkim rejestrować decyzje użytkownika i wykonane ruchy magazynowe. Nie ma jeszcze sterować przebiegiem produkcji ani narzucać firmie jednego sposobu pracy.

Zakres został celowo oparty na prostym tworzeniu, przeglądaniu, edycji i usuwaniu danych (podejście CRUD-first) oraz na ręcznych decyzjach użytkownika, ponieważ:

- moduł ma jak najszybciej dostarczyć użyteczny przepływ od BOM do zmiany stanów magazynowych;
- na tym etapie nie znamy jeszcze wspólnego procesu, który odpowiadałby większości firm produkcyjnych;
- przedwczesne reguły i automatyczne przejścia ograniczyłyby elastyczność oraz zwiększyły koszt wdrożenia;
- Manufacturing jest modułem open source, który użytkownicy i integratorzy mogą rozszerzać o własne procesy, zasady i automatyzacje;
- bardziej restrykcyjne zachowania powinny powstawać później jako małe, osobno uzasadnione rozszerzenia.

Dlatego MVP świadomie:

- pozwala użytkownikowi ręcznie zarządzać statusem zlecenia;
- nie wymusza kolejności statusów ani zgodności statusu z wykonanymi operacjami;
- nie wymusza kolejności wycofywania wydania i przyjęcia;
- pozwala utrzymywać wiele aktywnych BOM dla jednego wariantu i wymaga świadomego wyboru;
- pozwala edytować zlecenie również po wykonaniu operacji magazynowych;
- pozwala obsługiwać produkcję wyłącznie wewnątrz Manufacturing, bez dodawania funkcji produkcyjnych w innych częściach systemu;
- korzysta z jednostek miary i zasad magazynowych już dostępnych w Open Mercato.

Elastyczność nie oznacza utraty integralności zapisanych operacji. System nadal chroni przed podwójnym wykonaniem lub podwójnym wycofaniem tej samej operacji, nie zmienia historycznych ruchów po edycji zlecenia i nie pozwala usunąć historii wykonanych ruchów.

## Problem klienta

Małe firmy produkcyjne i montażowe często utrzymują strukturę produktu w arkuszu, dokumentach albo wiedzy pracowników. Zużycie komponentów i przyjęcie gotowego produktu rejestrują później jako niezależne operacje magazynowe.

Powoduje to:

- wielokrotne przepisywanie tych samych danych;
- brak połączenia między planem produkcji a ruchami magazynowymi;
- trudność w ustaleniu, z czego wykonano konkretny produkt;
- ryzyko podwójnego wydania lub przyjęcia;
- nieczytelną korektę pomyłek;
- zależność procesu od arkuszy i pamięci pracowników.

## Wartość dostarczana przez MVP

MVP daje firmie jedno miejsce, w którym można:

- opisać, z czego składa się produkt;
- oznaczyć BOM jako aktywny i dostępny do użycia w produkcji;
- zaplanować wykonanie konkretnej ilości produktu;
- rozliczyć zużycie materiałów;
- przyjąć gotowy produkt na magazyn;
- sprawdzić, kto, kiedy i w ramach którego zlecenia wykonał operację;
- poprawić błąd bez usuwania historii.

Realną wartością nie jest samo zapisanie BOM. Jest nią rejestracja zamiany materiałów w gotowy produkt w jednym czytelnym procesie.

## Pierwszy profil klienta

MVP jest przeznaczony dla firmy, która:

- prowadzi prostą produkcję dyskretną lub montaż;
- posiada produkty, warianty, magazyny, lokalizacje i stany magazynowe w Open Mercato;
- produkuje konkretny wariant wyrobu z magazynowanych komponentów;
- realizuje produkcję jako jeden ręcznie kontrolowany etap;
- wydaje cały wymagany zestaw materiałów;
- przyjmuje pełną zaplanowaną ilość produktu;
- opisuje produkt za pomocą jednej, płaskiej listy magazynowanych komponentów;
- nie potrzebuje jeszcze zaawansowanego planowania ani automatyzacji hali.

## Zakres funkcjonalny

### 1. Definiowanie BOM

Użytkownik może:

- utworzyć BOM dla konkretnego wariantu produktu;
- dodać komponenty potrzebne do jego wykonania;
- określić ilość każdego komponentu;
- edytować aktywny i nieaktywny BOM;
- usunąć BOM, który nie został użyty w zleceniu.

### 2. Aktywność BOM

BOM może być:

- aktywny — można go wybrać w nowym zleceniu;
- nieaktywny — nie można go wybrać w nowym zleceniu.

Nowy BOM jest nieaktywny. Użytkownik może w dowolnym momencie edytować BOM oraz ręcznie zmienić jego aktywność.

Aktywny BOM musi wskazywać produkt wynikowy, zawierać co najmniej jeden komponent, a każda jego pozycja musi mieć komponent i dodatnią ilość. Edycja aktywnego BOM musi zachować te podstawowe warunki.

Jeden wariant produktu może mieć wiele aktywnych BOM. System nie wybiera BOM automatycznie i nie wskazuje jednego jako obowiązującego.

Dezaktywacja lub późniejsza edycja BOM nie zmienia danych zapisanych we wcześniej wykonanych operacjach.

Nowe zlecenie może wskazywać wyłącznie aktywny BOM. Istniejące zlecenie zachowuje wybrany BOM również po jego dezaktywacji. Jeżeli użytkownik później zmienia BOM na zleceniu, również może wybrać wyłącznie jeden z aktywnych BOM.

### 3. Tworzenie zlecenia produkcyjnego

Użytkownik może:

- utworzyć zlecenie i wybrać jeden z aktywnych BOM dla produkowanego wariantu;
- podać planowaną ilość produktu;
- wybrać jedno miejsce pobrania wszystkich materiałów;
- wybrać jedno miejsce przyjęcia produktu gotowego;
- zobaczyć wymagane ilości bezpośrednich komponentów;
- zapisać zlecenie;
- swobodnie edytować jego produkt, BOM, ilość, miejsca magazynowe i status.

BOM wybrany w zleceniu musi dotyczyć produkowanego wariantu. Użytkownik może zmienić produkt albo BOM, ale po zmianie musi pozostać zgodna para produktu i BOM.

Zlecenie zachowuje wskazanie BOM wybranego przez użytkownika. System nie podstawia BOM automatycznie.

Manufacturing korzysta z jednostek miary i zasad ilościowych już zdefiniowanych dla produktów i stanów magazynowych w Open Mercato. Nie pozwala wybierać innej jednostki w BOM i nie wykonuje własnych przeliczeń.

Zlecenie można edytować również po wykonaniu wydania, przyjęcia lub korekty. Edycja nie zmienia, nie usuwa i nie przelicza wcześniej wykonanych ruchów magazynowych. Historia pokazuje dane rzeczywiście zapisane w chwili wykonania każdej operacji.

Każda nowa operacja korzysta z aktualnych danych zlecenia. System nie porównuje ich z wcześniejszymi operacjami i nie próbuje automatycznie uzgadniać powstałych różnic.

Zlecenie bez ruchów magazynowych można usunąć. Zlecenie posiadające ruchy można oznaczyć jako anulowane, ale nie można usunąć jego historii.

### 4. Realizacja zlecenia

Dostępne statusy zlecenia:

```text
Robocze | W realizacji | Zakończone | Anulowane
```

Użytkownik ręcznie wybiera status i może przejść z dowolnego statusu do dowolnego innego statusu. Wydanie, przyjęcie i korekta nie zmieniają statusu automatycznie. Status ma charakter informacyjny i nie potwierdza, jakie operacje magazynowe rzeczywiście wykonano.

Żaden status, w tym „Anulowane”, nie blokuje edycji zlecenia ani wykonania operacji magazynowej.

Anulowanie jest wyłącznie ręcznym ustawieniem statusu „Anulowane”. Nie wycofuje ruchów magazynowych, nie uruchamia korekt i nie usuwa historii. Wcześniejsze wydania, przyjęcia i korekty pozostają widoczne.

Użytkownik również ręcznie decyduje, kiedy wydać materiały i kiedy przyjąć produkt. System nie uruchamia tych operacji automatycznie.

### 5. Wydanie materiałów

Uprawniony użytkownik może wydać pełny zestaw bezpośrednich komponentów wymaganych przez zlecenie.

System:

- pokazuje, jakie materiały i ilości zostaną wydane;
- przed wykonaniem sprawdza dostępność całego wymaganego zestawu w jednym wybranym miejscu;
- zmniejsza właściwe stany magazynowe;
- wiąże wydanie ze zleceniem;
- nie wykonuje drugiego aktywnego wydania dla tego samego zlecenia.

Jeżeli brakuje choć jednego komponentu, system nie wydaje żadnego materiału i wskazuje braki. Po ich uzupełnieniu użytkownik ponawia całą operację. Wydanie kończy się w całości powodzeniem albo nie zmienia stanów magazynowych.

### 6. Przyjęcie produktu gotowego

Uprawniony użytkownik może przyjąć pełną planowaną ilość produktu. MVP nie uzależnia przyjęcia od wcześniejszego wydania materiałów.

System:

- zwiększa stan produktu w wybranym miejscu;
- wiąże przyjęcie ze zleceniem;
- chroni przed drugim aktywnym przyjęciem dla tego samego zlecenia;
- domyka pełny scenariusz operacyjny, ale nie zmienia automatycznie statusu zlecenia.

Przyjęcie kończy się w całości powodzeniem albo nie zmienia stanu magazynowego.

### 7. Podstawowa historia produkcji

Na szczegółach zlecenia użytkownik widzi:

- aktualnie wskazany BOM i planowaną ilość produktu;
- BOM, ilości i miejsca zapisane przy każdej wykonanej operacji;
- wymagane i wydane komponenty;
- przyjęty produkt;
- daty wykonania operacji;
- osoby wykonujące operacje;
- powiązane ruchy magazynowe;
- informację, czy wydanie lub przyjęcie zostało wycofane.

Użytkownik powinien móc odpowiedzieć na pytania:

- które ruchy magazynowe są powiązane z tym zleceniem;
- jakie materiały rzeczywiście wydano;
- jaki produkt i w jakiej ilości przyjęto;
- kto i kiedy wykonał operację;
- czy operacja została później skorygowana.

Historia w MVP jest prostą częścią szczegółów zlecenia. Nie obejmuje osobnego modułu audytowego, zaawansowanej osi czasu, raportowania ani genealogii produktu.

### 8. Pełne wycofanie błędnej operacji

Uprawniony użytkownik może w całości wycofać błędne wydanie materiałów albo w całości wycofać błędne przyjęcie produktu.

Korekta:

- nie usuwa pierwotnej operacji;
- tworzy przeciwny ruch magazynowy;
- pozostaje powiązana z pierwotną operacją i zleceniem;
- wykorzystuje dane rzeczywiście zaksięgowanej operacji;
- pozostawia historię dla użytkownika;
- po poprawnym wycofaniu pozwala ponownie wykonać właściwą operację.

MVP nie pozwala zmienić pojedynczej pozycji ani ilości w ramach istniejącej operacji. Użytkownik wycofuje całą operację i wykonuje ją ponownie poprawnie.

System nie narzuca kolejności korekt. Użytkownik może wycofać wydanie albo przyjęcie niezależnie od tego, czy druga operacja pozostaje aktywna. Jest to świadomy kompromis MVP: system chroni poprawność pojedynczego ruchu magazynowego, ale nie ocenia jeszcze poprawności całego procesu produkcyjnego.

Tej samej operacji nie można wycofać więcej niż raz. Wycofanie zawsze wykorzystuje dokładne dane pierwotnej operacji i nie pozwala użytkownikowi podać innych ilości.

Po pełnym wycofaniu wydanie albo przyjęcie przestaje być aktywne. Użytkownik może wtedy ponownie wykonać operację tego samego typu na podstawie aktualnych danych zlecenia.

Jeżeli pełne wycofanie nie może zostać wykonane, użytkownik otrzymuje czytelną informację. MVP nie próbuje automatycznie naprawiać takiej sytuacji ani prowadzić rozbudowanego procesu odzyskiwania.

### 9. Uprawnienia i bezpieczeństwo pracy

MVP rozróżnia tylko dwa poziomy dostępu do całego modułu Manufacturing:

- przeglądanie — użytkownik może zobaczyć BOM, zlecenia, historię oraz powiązane operacje;
- zarządzanie — użytkownik może wykonywać wszystkie działania dostępne w module, w tym tworzyć, edytować i usuwać dozwolone dane, zmieniać statusy, aktywować i dezaktywować BOM oraz wykonywać wydania, przyjęcia i korekty.

Prawo do zarządzania obejmuje również prawo do przeglądania. MVP nie rozdziela dostępu osobno dla BOM, zleceń, statusów, operacji magazynowych, anulowania ani korekt. Bardziej szczegółowy podział uprawnień może zostać dodany później, jeżeli potwierdzi go rzeczywista potrzeba klientów.

Użytkownik widzi i zmienia wyłącznie dane swojej organizacji.

## Przykładowy scenariusz

Firma montuje produkt X z komponentów A oraz B.

1. Użytkownik tworzy BOM produktu X.
2. Dodaje komponenty A i B.
3. Aktywuje BOM produktu X.
4. Tworzy zlecenie na pięć sztuk produktu X i wybiera aktywny BOM.
5. Wybiera jedno miejsce wydania materiałów i jedno miejsce przyjęcia produktu.
6. System pokazuje zapotrzebowanie na pięć sztuk A i dziesięć sztuk B.
7. Użytkownik ręcznie ustawia status „W realizacji”.
8. System sprawdza dostępność całego zestawu, a użytkownik wydaje materiały.
9. System zmniejsza stany A i B.
10. Użytkownik przyjmuje pięć sztuk X, a system zwiększa stan produktu X.
11. Użytkownik ręcznie ustawia status „Zakończone”.
12. Użytkownik może zobaczyć podstawową historię albo w całości wycofać błędną operację i wykonać ją ponownie.

## Poza zakresem MVP

Pierwsze wydanie nie obejmuje:

- routingu i operacji technologicznych;
- Work Centers, czasu pracy i wydajności;
- harmonogramowania i planowania zdolności produkcyjnych;
- MRP i automatycznego planowania zapotrzebowania;
- automatycznego tworzenia zleceń dla podzespołów;
- wielopoziomowych BOM i rozwijania struktury podzespołów;
- automatycznego powiązania zleceń nadrzędnych i podrzędnych;
- automatycznego wyboru domyślnego albo najnowszego BOM;
- narzucania jednego aktywnego BOM dla wariantu;
- wielu miejsc pobrania materiałów w jednym zleceniu;
- osobnego miejsca pobrania dla każdej pozycji BOM;
- przeliczania jednostek miary;
- częściowego wydania materiałów;
- częściowego przyjęcia produktu;
- produkcji ilości innej niż zaplanowana;
- nadprodukcji, niedoprodukcji, braków, odpadu i złomu;
- backflush i automatycznego zużycia materiałów;
- zamienników i alternatywnych komponentów;
- automatycznych rezerwacji materiałów;
- partii i numerów seryjnych;
- zaawansowanej identyfikowalności i genealogii;
- korekty pojedynczej pozycji lub samej ilości;
- automatycznej naprawy częściowo wykonanych operacji;
- automatycznego anulowania wraz z sekwencją korekt;
- automatycznej zmiany statusu zlecenia;
- wymuszania kolejności statusów, operacji magazynowych i korekt;
- blokowania edycji zlecenia na podstawie jego statusu lub wykonanych operacji;
- rozbudowanych stanów i procesów obsługi błędów;
- automatycznych ponowień w tle;
- kontroli jakości;
- kosztowania produkcji, WIP i odchyleń;
- rozliczania pracy ludzi i maszyn;
- importu i eksportu danych produkcyjnych;
- zbiorczych operacji i zaawansowanych raportów;
- wielostopniowych akceptacji i segregacji obowiązków;
- automatyzacji hali, MES i pracy offline.

MVP nie dodaje również pól, akcji, linków ani widoków do interfejsów katalogu, magazynu lub innych modułów. Wszystkie informacje o produkcji są prezentowane wewnątrz modułu Manufacturing.

Nieobsługiwany przypadek ma zostać jasno odrzucony. System nie powinien zgadywać zachowania ani uruchamiać ukrytej automatyzacji.

## Kryteria gotowości biznesowej

MVP jest gotowy do pilota, gdy uprawniony użytkownik może przejść cały proces bez pomocy technicznej:

1. utworzyć i aktywować płaski BOM;
2. wybrać aktywny BOM i utworzyć zlecenie na pełną ilość produktu;
3. wydać wszystkie bezpośrednie komponenty;
4. przyjąć pełną ilość produktu gotowego;
5. zobaczyć podstawową historię produkcji i powiązane ruchy magazynowe;
6. otrzymać informację o brakujących materiałach bez częściowej zmiany stanów i ponowić całą operację po ich uzupełnieniu;
7. w całości wycofać błędne wydanie lub przyjęcie i wykonać operację ponownie;
8. ręcznie zmienić status zlecenia, w tym oznaczyć je jako anulowane, bez automatycznej zmiany ruchów magazynowych;
9. edytować zlecenie bez zmiany historycznych operacji magazynowych.

## Hipoteza walidacyjna

MVP potwierdza swoją wartość, jeżeli podczas uzgodnionego pilota:

- co najmniej trzy niezależne organizacje przejdą pełny proces bez własnych zmian w module;
- co najmniej dwie organizacje utworzą i ukończą kolejne zlecenie po pierwszej próbie;
- użytkownicy samodzielnie poradzą sobie z kontrolowanym błędem i korektą;
- uczestnicy ograniczą użycie arkuszy i niezależnych korekt magazynowych;
- zespół będzie potrafił wskazać następny przyrost produktu na podstawie powtarzających się potrzeb klientów.

Przed rozpoczęciem pilota należy zapisać czas jego trwania i sposób zbierania wyników. Kryteriów nie należy zmieniać po zobaczeniu rezultatów.

## Zasada dalszego rozwoju

Ten dokument odpowiada na pytanie **co ma działać dla klienta**.

Nie określa:

- modelu danych;
- API;
- kontraktów między modułami;
- sposobu integracji z magazynem;
- mechanizmu ponawiania i korekt;
- szczegółów interfejsu;
- planu implementacji;
- technicznych przypadków testowych.

Przed rozpoczęciem każdego fragmentu powstaje mała, osobna specyfikacja. Pierwsze planowane obszary to:

1. podstawowy BOM z ręcznie ustawianą aktywnością;
2. podstawowe zlecenie produkcyjne;
3. pełne wydanie materiałów;
4. pełne przyjęcie produktu;
5. podstawowa historia produkcji;
6. pełne wycofanie operacji i ręczne statusy zlecenia;
7. końcowy scenariusz end-to-end.

Akceptacja zakresu biznesowego nie oznacza automatycznej zgody na konkretną architekturę ani rozpoczęcie implementacji wszystkich obszarów jednocześnie.

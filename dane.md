# 📊 Zestawienie Danych Źródłowych

## 1. 🏛️ RCL (Rządowy Proces Legislacyjny)
**Źródło:** `legislacja.rcl.gov.pl` (Strona HTML)
**Synchronizacja:** `src/services/rclSync.ts`
**Komenda:** `npm run sync:rcl`

| Nazwa Pola | Opis | Przykład | Czy synchronizujemy? |
|------------|------|----------|----------------------|
| **Tytuł projektu** | Pełna nazwa aktu prawnego | *Projekt rozporządzenia Ministra Zdrowia w sprawie...* | ✅ TAK |
| **Numer w wykazie** | Numer z wykazu prac legislacyjnych rządu | *MZ1632* | ✅ TAK (jako `registryNumber`) |
| **Wnioskodawca** | Organ zgłaszający projekt | *Minister Zdrowia* | ✅ TAK (jako `submittingEntity`) |
| **Data utworzenia** | Data rozpoczęcia prac w RCL | *2025-01-15* | ✅ TAK |
| **Data modyfikacji** | Data ostatniej zmiany na stronie | *2025-02-20* | ✅ TAK (ukryte w metadanych) |
| **Status** | Status procesu (np. Konsultacje, Zakończony) | *Konsultacje publiczne* | ✅ TAK |
| **Działy administracji** | Kategorie tematyczne | *Zdrowie* | ✅ TAK (jako tagi) |
| **Hasła (Słowa kluczowe)** | Tagi przypisane do projektu | *leki, refundacja* | ✅ TAK (jako tagi) |
| **Osoba odpowiedzialna** | Imię i nazwisko osoby prowadzące projekt | *Jan Kowalski - Dyrektor Departamentu...* | ✅ TAK (jako `responsiblePerson`) |
| **Podstawa prawna** | Przepis upoważniający do wydania aktu | *Art. 12 ust. 1 ustawy o...* | ✅ TAK |
| **Projekt UE** | Czy realizuje prawo UE | *TAK/NIE* | ✅ TAK |
| **Link do Sejmu** | Link do przebiegu prac w Sejmie (jeśli trafił) | *http://sejm.gov.pl/...* | ✅ TAK (ekstrahujemy ID) |
| **Etapy procesu** | Lista kroków (Konsultacje, Uzgodnienia, etc.) | *(Lista dat i nazw etapów)* | ✅ TAK |
| **Załączniki** | Dokumenty (PDF, DOCX) przy każdym etapie | *Projekt.pdf, OSR.pdf, Opinia.docx* | ✅ TAK |
| **Wersje dokumentu** | Różne wersje projektu w czasie | *Wersja z dnia X, Wersja z dnia Y* | ❌ NIE (pobieramy tylko aktualną lub wszystkie w etapach) |
| **Instytucje opiniujące** | Lista podmiotów zgłaszających uwagi | *Naczelna Rada Lekarska, Związek Pracodawców...* | ❌ NIE |
| **Komentarze publiczne** | Uwagi zgłoszone przez obywateli/instytucje | *(Treść uwag w plikach lub tabelach)* | ❌ NIE (tylko jako załączniki) |
| **Wyniki głosowań KRM** | Decyzje Komitetu Rady Ministrów | *Przyjęty z uwagami / Odesłany* | ❌ NIE |

---

## 2. 🏛️ API Sejmu (Parlament)
**Źródło:** `api.sejm.gov.pl` (JSON)
**Synchronizacja:** `src/services/sejmSync.ts`
**Komenda:** `npm run sync:sejm`

| Nazwa Pola (`key`) | Opis | Przykład | Czy synchronizujemy? |
|--------------------|------|----------|----------------------|
| `title` | Tytuł druku sejmowego | *Rządowy projekt ustawy o zmianie...* | ✅ TAK |
| `number` | Numer druku | *1630* | ✅ TAK |
| `term` | Kadencja Sejmu | *10* | ✅ TAK |
| `documentType` | Typ dokumentu | *projekt ustawy* | ✅ TAK |
| `description` | Krótki opis celu ustawy | *Projekt dotyczy zwiększenia bezpieczeństwa...* | ✅ TAK (jako `summary`) |
| `rclNum` | Numer projektu w RCL | *RM-0610-147-25* | ✅ TAK (kluczowe do łączenia!) |
| `processStartDate` | Data wpłynięcia do Sejmu | *2025-08-06* | ✅ TAK |
| `changeDate` | Data ostatniej zmiany statusu | *2025-11-21T11:31:08* | ❌ NIE |
| `passed` | Czy ustawa została uchwalona | *true/false* | ✅ TAK (do statusu) |
| `ue` | Czy dotyczy prawa UE | *YES/NO* | ❌ NIE |
| `urgencyStatus` | Tryb pilny | *URGENT / NORMAL* | ❌ NIE |
| `principleOfSubsidiarity`| Zasada pomocniczości | *true/false* | ❌ NIE |
| `stages[]` | Lista etapów legislacyjnych | *(Tablica obiektów)* | ✅ TAK |
| `stages[].voting` | Szczegółowe wyniki głosowań | *{yes: 240, no: 203, abstain: 0...}* | ❌ NIE (mamy placeholder `votes`, ale nie wypełniamy) |
| `stages[].rapporteurName`| Imię i nazwisko posła sprawozdawcy | *Mateusz Bochenek* | ❌ NIE |
| `stages[].committeeCode` | Kod komisji sejmowej | *ASW (Administracji i Spraw Wewnętrznych)* | ❌ NIE |
| `stages[].decision` | Decyzja (np. skierowano, uchwalono) | *uchwalono* | ✅ TAK (jako opis etapu) |
| `stages[].textAfter3` | Link do tekstu po III czytaniu | *https://.../1630_u3.pdf* | ❌ NIE |
| `links[]` | Linki zewnętrzne (ISAP, ELI) | *(Tablica linków)* | ✅ TAK |
| `eli` | Identyfikator ELI (European Legislation Identifier) | *(String)* | ❌ NIE |

---

## 3. 📋 Gov.pl (Wykaz Prac Legislacyjnych)
**Źródło:** API/Archiwum Wykazu Prac Legislacyjnych (JSON/CSV)
**Synchronizacja:** `src/services/govSync.ts`
**Komenda:** `npm run sync:gov`

| Nazwa Pola | Opis | Przykład | Czy synchronizujemy? |
|------------|------|----------|----------------------|
| `Tytuł` | Tytuł projektu | *Projekt ustawy o zmianie ustawy o...* | ✅ TAK |
| `Numer Projektu` | Numer w wykazie prac | *UD123* | ✅ TAK |
| `Typ dokumentu` | Rodzaj aktu | *Projekt ustawy* | ✅ TAK |
| `Organ odpowiedzialny` | Ministerstwo prowadzące | *Ministerstwo Cyfryzacji* | ✅ TAK |
| `Osoba odpowiedzialna` | Minister/Wiceminister nadzorujący | *Krzysztof Gawkowski - Wiceprezes Rady Ministrów* | ✅ TAK |
| `Data sporządzenia` | Data wpisania do wykazu | *2024-01-01* | ✅ TAK |
| `Planowany termin przyjęcia`| Kiedy rząd planuje przyjąć projekt | *IV kwartał 2025* | ❌ NIE |
| `Istota rozwiązań` | Szczegółowy opis co zmienia ustawa | *Rozwiązanie to ma na celu...* | ✅ TAK (jako `summary`) |
| `Cele projektu` | Uzasadnienie "dlaczego" | *Potrzeba dostosowania prawa do...* | ❌ NIE (często długi tekst) |
| `Status` | Status w wykazie | *W pracach rządu / Zrealizowany* | ✅ TAK |
| `Kontakt` | Dane kontaktowe do departamentu | *Departament Prawny, tel...* | ❌ NIE |
| `Podstawa wpisania` | Dlaczego projekt powstał | *Realizacja umowy koalicyjnej* | ❌ NIE |

## 🔗 Schemat Łączenia Danych

```
┌─────────────────────────────────────────────────────────────┐
│                        Gov.pl                                │
│  (Wykaz prac legislacyjnych rządu)                          │
└─────────────────────┬───────────────────────────────────────┘
                      │ numer projektu
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                         RCL                                  │
│  (Rządowy Proces Legislacyjny)                              │
│  - Etapy konsultacji, uzgodnień                             │
│  - Opinie, załączniki                                        │
│  - Link do Sejmu gdy projekt trafia do parlamentu           │
└─────────────────────┬───────────────────────────────────────┘
                      │ sejmRplId (np. RM-0610-167-25)
                      │ dopasowanie przez rclNum lub tytuł
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                       Sejm API                               │
│  (Proces legislacyjny w parlamencie)                        │
│  - Czytania w Sejmie                                         │
│  - Prace komisji                                             │
│  - Głosowania (szczegółowe wyniki)                          │
│  - Senat, Prezydent                                          │
│  - Link do Dz.U. gdy opublikowany                           │
└─────────────────────────────────────────────────────────────┘
```

## ⚠️ Potencjalne Braki / Do Rozważenia

1. **Wyniki głosowań (Sejm)** – Dane są dostępne (kto jak głosował, liczby), ale obecnie zapisujemy tylko pusty obiekt.
2. **Osoby odpowiedzialne (RCL/Sejm)** – Mamy dane posłów sprawozdawców i urzędników, można by budować bazę "kto za co odpowiada".
3. **Komisje Sejmowe** – Wiemy do jakiej komisji trafił projekt (kod `ASW`, `ZDR` itp.), co pozwoliłoby filtrować ustawy po komisjach.
4. **Teksty jednolite/po czytaniach** – Linki do PDFów po 3. czytaniu lub tekstów ujednoliconych są w API Sejmu, a my ich nie pobieramy.

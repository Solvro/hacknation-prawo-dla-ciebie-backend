# Prawo dla Ciebie - System Zarządzania Dokumentami Prawnymi

System do przechowywania i zarządzania dokumentami prawnymi z procesem legislacyjnym, komentarzami, analizą AI i relacjami między dokumentami.

## 🛠️ Technologie

- **Node.js** + **TypeScript**
- **Prisma ORM** - modelowanie danych
- **Supabase** (PostgreSQL) - baza danych
- **Express.js** - REST API

## 📁 Struktura projektu

```
prawo-dla-ciebie/
├── prisma/
│   ├── schema.prisma    # Schemat bazy danych
│   └── seed.ts          # Import danych z JSON
├── src/
│   ├── index.ts         # Serwer Express + API
│   └── lib/
│       ├── prisma.ts    # Prisma Client
│       └── supabase.ts  # Supabase Client
├── dane.json            # Dane źródłowe
├── package.json
└── .env                 # Konfiguracja
```

## 🚀 Instalacja

### 1. Zainstaluj zależności

```bash
npm install
```

### 2. Skonfiguruj bazę danych

Edytuj plik `.env` i uzupełnij hasło do bazy Supabase:

```env
DATABASE_URL="postgresql://postgres.vxtgtfkyuyedawjxoskm:[TWOJE-HASŁO]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.vxtgtfkyuyedawjxoskm:[TWOJE-HASŁO]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
```

### 3. Wygeneruj Prisma Client

```bash
npm run prisma:generate
```

### 4. Synchronizuj schemat z bazą

```bash
npm run prisma:push
```

### 5. Załaduj dane z dane.json

```bash
npm run seed
```

### 6. Uruchom serwer

```bash
npm run dev
```

Serwer: `http://localhost:3000`

## 📡 API Endpoints

### Dokumenty

| Metoda | Endpoint | Opis |
|--------|----------|------|
| GET | `/api/documents` | Lista wszystkich dokumentów |
| GET | `/api/documents/:id` | Szczegóły dokumentu |
| GET | `/api/search` | Wyszukiwanie dokumentów |

#### Parametry wyszukiwania `/api/search`

- `q` - tekst w tytule/streszczeniu
- `status` - DRAFT, SEJM, SENATE, PRESIDENT, ACCEPTED, REJECTED
- `type` - USTAWA, ROZPORZADZENIE, UCHWALA, etc.
- `tag` - nazwa tagu
- `sector` - nazwa sektora

### Głosowanie

| Metoda | Endpoint | Opis |
|--------|----------|------|
| POST | `/api/documents/:id/vote` | Głosuj na dokument |
| POST | `/api/opinions/:id/vote` | Głosuj na opinię |

```bash
# Przykład
curl -X POST http://localhost:3000/api/documents/1/vote \
  -H "Content-Type: application/json" \
  -d '{"type": "up"}'
```

### Komentarze

| Metoda | Endpoint | Opis |
|--------|----------|------|
| POST | `/api/documents/:id/comments` | Dodaj komentarz |
| GET | `/api/documents/:id/comments` | Pobierz komentarze |

```bash
# Przykład
curl -X POST http://localhost:3000/api/documents/1/comments \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Mój komentarz",
    "sectionExternalId": "art-1",
    "isAnonymous": false,
    "authorName": "Jan Kowalski"
  }'
```

### Filtry i metadane

| Metoda | Endpoint | Opis |
|--------|----------|------|
| GET | `/api/tags` | Lista tagów |
| GET | `/api/sectors` | Lista sektorów |
| GET | `/api/stakeholders` | Lista interesariuszy |
| GET | `/api/stats` | Statystyki systemu |

## 🗄️ Model danych

### Główne encje

| Model | Opis |
|-------|------|
| `LegalDocument` | Dokument prawny (ustawa, rozporządzenie, etc.) |
| `ResponsiblePerson` | Osoba odpowiedzialna za dokument |
| `Votes` | Głosy za/przeciw dokumentowi |
| `Tag`, `Sector`, `Stakeholder` | Klasyfikacja dokumentów |
| `Link` | Linki zewnętrzne |
| `TimelineEvent` | Etapy procesu legislacyjnego |
| `Attachment` | Załączniki do etapów |
| `ContentSection` | Artykuły/sekcje dokumentu |
| `Opinion` | Opinie do artykułów |
| `Comment` | Komentarze użytkowników |
| `AiAnalysis` | Analiza AI (sentiment, wpływ, ryzyka) |
| `DocumentRelation` | Relacje między dokumentami |

## 🔧 Komendy

```bash
npm run dev          # Uruchom w trybie dev
npm run build        # Buduj do produkcji
npm start            # Uruchom produkcyjnie

npm run prisma:generate  # Generuj Prisma Client
npm run prisma:push      # Synchronizuj schemat z bazą
npm run prisma:migrate   # Migracje (dev)
npm run prisma:studio    # Przeglądarka bazy danych

npm run seed             # Załaduj dane z dane.json
```

## 📝 Licencja

MIT

# Prawo dla Ciebie - Backend

Backend systemu "Prawo dla Ciebie", służącego do agregacji, analizy (AI) i udostępniania informacji o procesach legislacyjnych w Polsce. System integruje dane z Rządowego Centrum Legislacji (RCL) oraz api.sejm.gov.pl.

## 🚀 Uruchomienie

### Wymagania
*   Node.js (v18+)
*   Baza danych PostgreSQL (np. Supabase)

### Instalacja

1.  Zainstaluj zależności:
    ```bash
    npm install
    ```

2.  Skonfiguruj zmienne środowiskowe w `.env`:
    ```env
    DATABASE_URL="postgresql://user:password@host:port/db"
    DIRECT_URL="postgresql://user:password@host:port/db"
    OPENAI_API_KEY="sk-..."
    # Opcjonalne:
    GOOGLE_GENERATIVE_AI_API_KEY="AI..."
    OFFICIAL_API_TOKEN="twoj-tajny-token"
    ```

3.  Przygotuj bazę danych:
    ```bash
    npx prisma generate
    npx prisma db push
    ```

4.  Uruchom serwer deweloperski:
    ```bash
    npm run dev
    ```

Serwer dostępny będzie pod adresem: `http://localhost:3000`.

## 📚 Dokumentacja API (Swagger)

Pełna dokumentacja endpointów dostępna jest pod adresem:
👉 **[http://localhost:3000/docs](http://localhost:3000/docs)**

### Kluczowe endpointy V3 (dla Urzędnika)
Chronione tokenem `OFFICIAL_API_TOKEN`.
*   `GET /api/v3/official/documents` - Lista dokumentów (uproszczona)
*   `GET /api/v3/official/documents/:id` - Szczegóły dokumentu
*   `POST /api/v3/official/documents` - Dodawanie dokumentu
*   `POST /api/v3/official/documents/:id/timeline` - Dodawanie etapu
*   `GET /api/v3/official/comments` - Moderacja komentarzy

## 🔄 Synchronizacja Danych

System posiada skrypty do pobierania danych z zewnętrznych źródeł:

1.  **RCL (Rządowe Centrum Legislacji)**:
    ```bash
    npm run sync:rcl [startPage] [pages]
    # np. npm run sync:rcl 1 5
    ```

2.  **Sejm (api.sejm.gov.pl)**:
    ```bash
    npm run sync:sejm [startId] [endId]
    # np. npm run sync:sejm 1000 2000
    ```
    Skrypt Sejmowy automatycznie łączy procesy z istniejącymi dokumentami w bazie (po RPLID).

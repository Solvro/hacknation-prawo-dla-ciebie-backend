
/**
 * Oblicza dystans Levenshteina między dwoma ciągami znaków.
 * Jest to liczba operacji (wstawienie, usunięcie, zamiana) potrzebnych do przekształcenia jednej napisu w drugą.
 */
export function levenshteinDistance(a: string, b: string): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];

    // Inicjalizacja pierwszego wiersza i kolumny
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    // Wypełnianie macierzy
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // zamiana
                    Math.min(
                        matrix[i][j - 1] + 1, // wstawienie
                        matrix[i - 1][j] + 1  // usunięcie
                    )
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

/**
 * Sprawdza, czy dwa tytuły są podobne.
 * Używa znormalizowanych ciągów (małe litery, usunięte białe znaki) i dystansu Levenshteina.
 * 
 * @param title1 Pierwszy tytuł
 * @param title2 Drugi tytuł
 * @param thresholdAllowed Maksymalna dopuszczalna różnica (domyślnie zależna od długości)
 */
export function areTitlesSimilar(title1: string, title2: string): boolean {
    if (!title1 || !title2) return false;

    // Normalizacja: małe litery, usuń podwójne spacje, trim
    const t1 = title1.toLowerCase().replace(/\s+/g, ' ').trim();
    const t2 = title2.toLowerCase().replace(/\s+/g, ' ').trim();

    if (t1 === t2) return true;

    // Jeśli jeden zawiera drugi w całości i różnica długości jest mała
    if ((t1.includes(t2) || t2.includes(t1)) && Math.abs(t1.length - t2.length) < 10) {
        return true;
    }

    const distance = levenshteinDistance(t1, t2);

    // Dopuszczalny błąd: 
    // Dla krótkich tekstów (< 50 znaków): max 3 znaki lub 10%
    // Dla długich tekstów: max 10% długości dłuższego tekstu, ale nie więcej niż 15 znaków
    // Użytkownik prosił: "może się różnić o kilka znaków czy słowo, ale to maks"

    const maxLength = Math.max(t1.length, t2.length);
    const allowedDistance = Math.min(15, Math.ceil(maxLength * 0.15)); // Dopuszczamy 15% różnicy, max 15 znaków

    return distance <= allowedDistance;
}


/**
 * Calculates Levenshtein distance between two strings.
 * This is the number of operations (insertion, deletion, substitution) needed to transform one string into another.
 */
export function levenshteinDistance(a: string, b: string): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];

    // Initialize first row and column
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    // Fill matrix
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    Math.min(
                        matrix[i][j - 1] + 1, // insertion
                        matrix[i - 1][j] + 1  // deletion
                    )
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

/**
 * Checks if two titles are similar.
 * Uses normalized strings (lowercase, removed extra spaces) and Levenshtein distance.
 * 
 * @param title1 First title
 * @param title2 Second title
 */
export function areTitlesSimilar(title1: string, title2: string): boolean {
    if (!title1 || !title2) return false;

    // Normalization: lowercase, remove double spaces, trim
    const t1 = title1.toLowerCase().replace(/\s+/g, ' ').trim();
    const t2 = title2.toLowerCase().replace(/\s+/g, ' ').trim();

    if (t1 === t2) return true;

    // If one contains the other entirely and length difference is small
    if ((t1.includes(t2) || t2.includes(t1)) && Math.abs(t1.length - t2.length) < 10) {
        return true;
    }

    const distance = levenshteinDistance(t1, t2);

    // Allowed error:
    // For short texts (< 50 chars): max 3 chars or 10%
    // For long texts: max 15% of longer text length, but no more than 15 chars
    // Heuristic: "Can differ by a few characters or a word, but that's max"

    const maxLength = Math.max(t1.length, t2.length);
    const allowedDistance = Math.min(15, Math.ceil(maxLength * 0.15)); // Allow 15% difference, max 15 chars

    return distance <= allowedDistance;
}

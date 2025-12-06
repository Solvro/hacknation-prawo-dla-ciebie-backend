/**
 * Test porównawczy: zakończony vs niezakończony projekt
 */

import * as cheerio from 'cheerio';

const BASE_URL = 'https://legislacja.rcl.gov.pl';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

async function fetchHtml(url: string): Promise<string> {
    const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT }
    });
    return response.text();
}

async function analyzeProject(rclId: string, description: string) {
    const url = `${BASE_URL}/projekt/${rclId}`;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔍 ${description}: ${rclId}`);
    console.log(`   URL: ${url}`);

    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    const pageText = $('body').text();
    const pageTextLower = pageText.toLowerCase();

    // Sprawdź różne warunki
    console.log('\n📋 Warunki:');
    console.log('   - "skierowanie aktu do ogłoszenia":', pageTextLower.includes('skierowanie aktu do ogłoszenia'));
    console.log('   - "zakończenie prac":', pageTextLower.includes('zakończenie prac'));
    console.log('   - "projekt został opublikowany":', pageTextLower.includes('projekt został opublikowany'));

    // Szukaj publikatora Dz.U.
    const dzuMatch = pageText.match(/Dz\.?U\.?\s*(\d{4})\s*r?\.?\s*poz\.?\s*(\d+)/i);
    console.log('   - Dz.U. match:', dzuMatch ? `${dzuMatch[1]} poz. ${dzuMatch[2]}` : 'NIE ZNALEZIONO');

    // Szukaj linków
    console.log('\n🔗 Linki do dziennikustaw.gov.pl:');
    $('a[href*="dziennikustaw.gov.pl"]').each((i, el) => {
        const href = $(el).attr('href') || '';
        console.log(`   ${i + 1}. ${href}`);

        // Sprawdź czy link jest pełny
        const isComplete = /\/DU\/\d{4}\/\d+/.test(href);
        console.log(`      Pełny link: ${isComplete ? 'TAK' : 'NIE'}`);
    });
}

async function main() {
    // Poprawnie zakończony
    await analyzeProject('12403258', 'POPRAWNIE ZAKOŃCZONY');

    // Niepoprawnie oznaczony
    await analyzeProject('12404961', 'NIEPOPRAWNIE OZNACZONY jako zakończony');

    // Dla porównania - projekt w trakcie
    await analyzeProject('12404962', 'Projekt w trakcie (najnowszy)');
}

main()
    .then(() => console.log('\n✅ Analiza zakończona'))
    .catch(console.error);

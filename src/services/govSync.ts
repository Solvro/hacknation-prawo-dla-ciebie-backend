import { prisma } from '../lib/prisma';
import { areTitlesSimilar, levenshteinDistance } from '../utils/stringComparison';
import { DocumentType, DocumentLevel, DocumentStatus, TimelineStatus } from '@prisma/client';

// Interfejs dla danych z API gov.pl
interface GovProject {
    "Tytuł": string;
    "pageId": string;
    "pageUrl": string;
    "pageOrder"?: string;
    "Numer Projektu"?: string;
    "Numer projektu"?: string;
    "Typ dokumentu"?: string;
    "Data publikacji"?: string;
    "Rodzaj dokumentu"?: string;
    "Status realizacji"?: string;
    "Informacja dodatkowa"?: string;
    "Informacja o rezygnacji z prac nad projektem"?: string;
    "Organ odpowiedzialny za opracowanie projektu"?: string;
    "Osoba odpowiedzialna za opracowanie projektu"?: string;
    "Planowany termin wydania rozporządzenia/data wydania"?: string;
    "Planowany termin przyjęcia projektu przez RM"?: string;
    "Organ współpracujący przy opracowaniu projektu"?: string;
    "Organ odpowiedzialny za przedłożenie projektu RM"?: string;
    "Istota rozwiązań planowanych w projekcie, w tym proponowane środki realizacji"?: string;
    "Cele projektu oraz informacja o przyczynach i potrzebie rozwiązań planowanych w projekcie"?: string;
}

// Mapowanie typu dokumentu
function parseDocumentType(rodzaj?: string): DocumentType {
    if (!rodzaj) return DocumentType.INNE;

    const lower = rodzaj.toLowerCase();
    if (lower.includes('ustaw')) return DocumentType.USTAWA;
    if (lower.includes('rozporządz') || lower.includes('rozporzadz')) return DocumentType.ROZPORZADZENIE;
    if (lower.includes('uchwał') || lower.includes('uchwal')) return DocumentType.UCHWALA;
    if (lower.includes('zarządz') || lower.includes('zarzadz')) return DocumentType.ZARZADZENIE;
    if (lower.includes('obwieszcz')) return DocumentType.OBWIESZCZENIE;

    return DocumentType.INNE;
}

// Parsowanie statusu
function parseStatus(statusJson?: string): DocumentStatus {
    if (!statusJson) return DocumentStatus.DRAFT;

    try {
        const parsed = JSON.parse(statusJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
            const status = parsed[0]?.value?.toLowerCase() || '';
            if (status.includes('zrealizowany') || status.includes('ogłoszony') || status.includes('ogloszony')) {
                return DocumentStatus.ACCEPTED;
            }
        }
    } catch {
        // Ignore parse errors
    }

    return DocumentStatus.DRAFT;
}

// Parsowanie JSON array string do tekstu
function parseJsonArrayToString(jsonStr?: string): string | null {
    if (!jsonStr) return null;

    try {
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed)) {
            return parsed.map(item => item.value || item.id || item).join(', ');
        }
    } catch {
        return jsonStr;
    }

    return null;
}

// Ekstrakcja tagów z tytułu i treści
function extractTags(project: GovProject): string[] {
    const tags: Set<string> = new Set();
    const title = project["Tytuł"]?.toLowerCase() || '';

    if (title.includes('ustaw')) tags.add('ustawa');
    if (title.includes('rozporządz') || title.includes('rozporzadz')) tags.add('rozporządzenie');
    if (title.includes('uchwał') || title.includes('uchwal')) tags.add('uchwała');
    if (title.includes('psychiatr')) tags.add('psychiatria');
    if (title.includes('zdrow')) tags.add('zdrowie');
    if (title.includes('transport')) tags.add('transport');
    if (title.includes('budżet') || title.includes('budzet')) tags.add('budżet');
    if (title.includes('bezpieczeń') || title.includes('bezpieczen')) tags.add('bezpieczeństwo');
    if (title.includes('służb') || title.includes('sluzb')) tags.add('służby');
    if (title.includes('cyfryzac') || title.includes('cyfrowy')) tags.add('cyfryzacja');
    if (title.includes('mediów') || title.includes('mediow') || title.includes('telewiz') || title.includes('radio')) tags.add('media');

    // Parsuj organ odpowiedzialny
    const organ = parseJsonArrayToString(project["Organ odpowiedzialny za opracowanie projektu"]);
    if (organ) {
        tags.add(organ);
    }

    return Array.from(tags);
}

// Ekstrakcja sektorów
function extractSectors(project: GovProject): string[] {
    const sectors: Set<string> = new Set();
    const title = project["Tytuł"]?.toLowerCase() || '';

    if (title.includes('zdrow') || title.includes('szpital') || title.includes('psychiatr')) {
        sectors.add('Zdrowie');
    }
    if (title.includes('transport') || title.includes('drog')) {
        sectors.add('Transport');
    }
    if (title.includes('energet') || title.includes('energi')) {
        sectors.add('Energetyka');
    }
    if (title.includes('administrac')) {
        sectors.add('Administracja publiczna');
    }
    if (title.includes('bezpieczeń') || title.includes('bezpieczen') || title.includes('policj')) {
        sectors.add('Bezpieczeństwo');
    }
    if (title.includes('finans') || title.includes('budżet') || title.includes('budzet')) {
        sectors.add('Finanse publiczne');
    }
    if (title.includes('cyfrow') || title.includes('telekomunik') || title.includes('intern')) {
        sectors.add('Cyfryzacja');
    }

    if (sectors.size === 0) {
        sectors.add('Ogólne');
    }

    return Array.from(sectors);
}

function parseResponsiblePerson(raw: string): { name: string, role: string | null } {
    if (!raw) return { name: raw, role: null };

    // Heuristic: "Name Surname Role Role..."
    // We assume the first two words are name and surname.
    const parts = raw.split(' ');
    if (parts.length < 3) return { name: raw, role: null };

    const name = parts.slice(0, 2).join(' ');
    const role = parts.slice(2).join(' ');

    return { name, role };
}

// Funkcja pomocnicza do upsert taga
async function getOrCreateTag(name: string) {
    return prisma.tag.upsert({
        where: { name },
        create: { name },
        update: {}
    });
}

// Funkcja pomocnicza do upsert sektora
async function getOrCreateSector(name: string) {
    return prisma.sector.upsert({
        where: { name },
        create: { name },
        update: {}
    });
}

// Szukaj dokumentu przez podobieństwo tytułu
async function findBySimilarTitle(title: string): Promise<{ id: number; title: string } | null> {
    const titleParts = [];
    if (title.length > 15) {
        titleParts.push(title.substring(0, 15));
        titleParts.push(title.substring(Math.max(0, title.length - 15)));
        if (title.length > 40) {
            const mid = Math.floor(title.length / 2);
            titleParts.push(title.substring(mid - 10, mid + 10));
        }
    } else {
        titleParts.push(title);
    }

    const candidates = await prisma.legalDocument.findMany({
        where: {
            OR: titleParts.map(part => ({
                title: { contains: part, mode: 'insensitive' }
            }))
        },
        select: { id: true, title: true }
    });

    let bestMatch: { id: number; title: string } | null = null;
    let minDistance = Infinity;

    for (const candidate of candidates) {
        if (areTitlesSimilar(title, candidate.title)) {
            const dist = levenshteinDistance(title.toLowerCase(), candidate.title.toLowerCase());
            if (dist < minDistance) {
                minDistance = dist;
                bestMatch = candidate;
            }
        }
    }

    return bestMatch;
}

// Główna funkcja synchronizacji pojedynczego projektu
async function syncProject(project: GovProject): Promise<{ isNew: boolean }> {
    const pageId = project.pageId;

    // Przygotuj numer projektu (główny identyfikator)
    const registryNumber = project["Numer Projektu"] || project["Numer projektu"] || `GOV-${pageId}`;
    const title = project["Tytuł"];
    const rodzajDoc = parseJsonArrayToString(project["Rodzaj dokumentu"]);
    const type = parseDocumentType(rodzajDoc || title);
    const status = parseStatus(project["Status realizacji"]);

    // Sprawdź, czy dokument już istnieje po numerze projektu (registryNumber)
    // Sprawdź, czy dokument już istnieje po numerze projektu (registryNumber)
    let existing = await prisma.legalDocument.findFirst({
        where: { registryNumber },
        select: { id: true }
    });

    // Jeśli nie znaleziono po numerze, szukaj po tytule
    // if (!existing && title) {
    //     const similar = await findBySimilarTitle(title);
    //     if (similar) {
    //         existing = { id: similar.id };
    //         console.log(`   🔗 Linked by similar title: ${similar.title.substring(0, 40)}...`);
    //     }
    // }

    // Przygotuj streszczenie z dostępnych pól
    // Przygotuj streszczenie z dostępnych pól (priorytet: Cele projektu)
    const goalInfo = project["Cele projektu oraz informacja o przyczynach i potrzebie rozwiązań planowanych w projekcie"];
    const essenceInfo = project["Istota rozwiązań planowanych w projekcie, w tym proponowane środki realizacji"];

    let summary = '';
    if (goalInfo) {
        summary = goalInfo;
    } else if (essenceInfo) {
        summary = essenceInfo;
    }

    // Ogranicz długość streszczenia
    if (summary.length > 5000) {
        summary = summary.substring(0, 4997) + '...';
    }

    // Przygotuj tagi i sektory
    const tagNames = extractTags(project);
    const sectorNames = extractSectors(project);

    const tags = await Promise.all(tagNames.map(t => getOrCreateTag(t)));
    const sectors = await Promise.all(sectorNames.map(s => getOrCreateSector(s)));

    // Parsuj datę publikacji
    let createdAt: Date | undefined;
    if (project["Data publikacji"]) {
        createdAt = new Date(project["Data publikacji"].replace(' ', 'T'));
        if (isNaN(createdAt.getTime())) {
            createdAt = undefined;
        }
    }

    // --- GOV.PL CONTENT PROCESSING (VERSION 1) ---
    // Wstaw "Istota rozwiązań..." jako zawartość (wersja 1)
    const contentSource = essenceInfo || summary;
    let documentId: number;

    if (existing) {
        documentId = existing.id;
        // Aktualizuj istniejący dokument - odłącz stare relacje i podłącz nowe
        await prisma.legalDocument.update({
            where: { id: existing.id },
            data: {
                title,
                type,
                level: DocumentLevel.KRAJOWY,
                location: 'Polska',
                status,
                summary: summary || null,
                submittingEntity: parseJsonArrayToString(project["Organ odpowiedzialny za opracowanie projektu"]),
                tags: { set: tags.map(t => ({ id: t.id })) },
                sectors: { set: sectors.map(s => ({ id: s.id })) },
                updatedAt: new Date()
            }
        });
        console.log(`   📝 Updated: ${title.substring(0, 60)}...`);
    } else {
        // Utwórz nowy dokument
        const document = await prisma.legalDocument.create({
            data: {
                registryNumber,
                title,
                type,
                level: DocumentLevel.KRAJOWY,
                location: 'Polska',
                status,
                summary: summary || null,
                submittingEntity: parseJsonArrayToString(project["Organ odpowiedzialny za opracowanie projektu"]),
                tags: { connect: tags.map(t => ({ id: t.id })) },
                sectors: { connect: sectors.map(s => ({ id: s.id })) },
                createdAt
            }
        });
        documentId = document.id;

        // Dodaj osobę odpowiedzialną jeśli istnieje
        if (project["Osoba odpowiedzialna za opracowanie projektu"]) {
            const rawPerson = project["Osoba odpowiedzialna za opracowanie projektu"];
            const { name, role } = parseResponsiblePerson(rawPerson);

            await prisma.responsiblePerson.create({
                data: {
                    name,
                    role,
                    documentId: document.id
                }
            });
        }

        // Dodaj link do strony gov.pl
        if (project.pageUrl) {
            await prisma.link.create({
                data: {
                    url: `https://www.gov.pl${project.pageUrl}`,
                    description: 'Strona projektu na gov.pl',
                    documentId: document.id
                }
            });
        }

        // Inicjalizuj głosy
        await prisma.votes.create({
            data: {
                up: 0,
                down: 0,
                documentId: document.id
            }
        });

        // Dodaj podstawową analizę AI
        await prisma.aiAnalysis.create({
            data: {
                sentiment: 0,
                documentId: document.id
            }
        });

        // Dodaj zdarzenie powstania
        if (createdAt) {
            await prisma.timelineEvent.create({
                data: {
                    title: "Utworzono wpis w gov.pl",
                    date: createdAt,
                    status: TimelineStatus.DRAFT,
                    description: "Projekt został opublikowany w serwisie gov.pl",
                    documentId: document.id
                }
            });
        }

        console.log(`   ✅ Created: ${title.substring(0, 60)}...`);
    }

    // UPDATE CONTENT FOR BOTH NEW AND EXISTING DOCUMENTS
    if (contentSource && contentSource.length > 0) {
        // Podziel na akapity
        const paragraphs = contentSource.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0);

        if (paragraphs.length > 0) {
            // Opcjonalnie: czyścimy stare sekcje dla wersji 1, żeby nie dublować przy update
            // Uwaga: To usunie stare sekcje wersji 1.
            await prisma.contentSection.deleteMany({
                where: {
                    documentId: documentId,
                    version: 1
                }
            });

            // Zapisz ContentSections
            for (let i = 0; i < paragraphs.length; i++) {
                await prisma.contentSection.create({
                    data: {
                        documentId: documentId,
                        externalId: `gov-${documentId}-v1-${i}`,
                        label: `Akapit ${i + 1}`,
                        text: paragraphs[i],
                        version: 1,
                        order: i
                    }
                });
            }

            // Zaktualizuj latestContent
            await prisma.legalDocument.update({
                where: { id: documentId },
                data: { latestContent: contentSource }
            });
            console.log('      💾 Updated content sections and latestContent');
        }
    }

    return { isNew: !existing };
}

// Funkcja fetchująca dane z API gov.pl
async function fetchGovData(pageId: string): Promise<GovProject[]> {
    const url = `https://www.gov.pl/api/data/registers/search?pageId=${pageId}`;

    console.log(`\n📡 Fetching data from: ${url}`);

    const response = await fetch(url, {
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'PrawoDlaCiebie-Sync/1.0'
        }
    });

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
        console.log('   ⚠️ Response is not an array');
        return [];
    }

    console.log(`   📄 Found ${data.length} projects`);
    return data;
}

// Główna funkcja synchronizacji
export async function syncFromGovPl(): Promise<{ created: number; updated: number; errors: number }> {
    console.log('\n🔄 Starting synchronization with gov.pl API...');
    console.log('━'.repeat(60));

    const stats = { created: 0, updated: 0, errors: 0 };

    // Lista endpoint IDs do synchronizacji
    const pageIds = ['20874196', '20874195'];

    for (const pageId of pageIds) {
        try {
            const projects = await fetchGovData(pageId);

            for (const project of projects) {
                // Filtrowanie po roku 2025
                if (project["Data publikacji"]) {
                    const pubDate = new Date(project["Data publikacji"].replace(' ', 'T'));
                    if (!isNaN(pubDate.getTime()) && pubDate.getFullYear() < 2025) {
                        console.log(`   ⏭️ Skipping old project (${pubDate.getFullYear()}): ${project["Tytuł"].substring(0, 30)}...`);
                        continue;
                    }
                }
                try {
                    const result = await syncProject(project);

                    if (result.isNew) {
                        stats.created++;
                    } else {
                        stats.updated++;
                    }
                } catch (err) {
                    console.error(`   ❌ Error syncing project ${project.pageId}:`, err);
                    stats.errors++;
                }
            }
        } catch (err) {
            console.error(`❌ Error fetching page ${pageId}:`, err);
            stats.errors++;
        }
    }

    console.log('\n' + '━'.repeat(60));
    console.log('✅ Synchronization completed!');
    console.log(`   Created: ${stats.created}`);
    console.log(`   Updated: ${stats.updated}`);
    console.log(`   Errors: ${stats.errors}`);

    return stats;
}

// Uruchom synchronizację jeśli wywołano bezpośrednio
if (require.main === module) {
    syncFromGovPl()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('Fatal error:', err);
            process.exit(1);
        })
        .finally(() => prisma.$disconnect());
}

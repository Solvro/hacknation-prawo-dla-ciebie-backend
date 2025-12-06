import * as cheerio from 'cheerio';
import { prisma } from '../lib/prisma';
import { areTitlesSimilar, levenshteinDistance } from '../utils/stringComparison';
import { DocumentType, DocumentLevel, DocumentStatus, TimelineStatus } from '@prisma/client';

const BASE_URL = 'https://legislacja.rcl.gov.pl';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Rate limiting - opóźnienie między requestami (ms)
const REQUEST_DELAY = 500;

// Interfejsy
interface RclProject {
    rclId: string;
    title: string;
    applicant: string;
    registryNumber: string; // Numer z wykazu
    createdDate: string;
    modifiedDate: string;
}

interface RclProjectDetails {
    rclId: string;
    title: string;
    applicant: string;
    registryNumber: string;
    createdDate: string;
    status: string;
    departments: string[];
    keywords: string[];
    euRegulation?: string;
    legalBasis?: string;
    stages: RclStage[];
    isPublished: boolean; // Czy dokument został opublikowany (zakończył obieg)
    dziennikUstawLink?: string; // Link do Dziennika Ustaw jeśli opublikowany
    sejmRplId?: string; // Id z linku Sejmu RPL (np. RM-0610-167-25)
}

interface RclStage {
    stageId: string;
    name: string;
    modifiedDate?: string;
    url?: string;
}

interface RclAttachment {
    name: string;
    url: string;
    type: string;
    author?: string;
    createdDate?: string;
}

// Funkcja pomocnicza do opóźnienia
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Funkcja do pobierania HTML
async function fetchHtml(url: string): Promise<string> {
    const response = await fetch(url, {
        headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8'
        }
    });

    if (!response.ok) {
        throw new Error(`HTTP error ${response.status} for ${url}`);
    }

    return response.text();
}

// Parsowanie typu dokumentu
function parseDocumentType(title: string): DocumentType {
    const lower = title.toLowerCase();
    if (lower.includes('projekt ustaw') || lower.includes('ustawa')) return DocumentType.USTAWA;
    if (lower.includes('rozporządz') || lower.includes('rozporzadz')) return DocumentType.ROZPORZADZENIE;
    if (lower.includes('uchwał') || lower.includes('uchwal')) return DocumentType.UCHWALA;
    if (lower.includes('zarządz') || lower.includes('zarzadz')) return DocumentType.ZARZADZENIE;
    if (lower.includes('obwieszcz')) return DocumentType.OBWIESZCZENIE;
    return DocumentType.INNE;
}

// Parsowanie statusu
function parseStatus(status: string): DocumentStatus {
    const lower = status.toLowerCase();
    if (lower.includes('przyjęt') || lower.includes('przyjęty') || lower.includes('zamknięt')) return DocumentStatus.ACCEPTED;
    if (lower.includes('archiw')) return DocumentStatus.EXPIRED;
    if (lower.includes('otwart')) return DocumentStatus.DRAFT;
    return DocumentStatus.DRAFT;
}

// Parsowanie statusu etapu
function parseTimelineStatus(stageName: string): TimelineStatus {
    const lower = stageName.toLowerCase();
    if (lower.includes('sejm')) return TimelineStatus.SEJM;
    if (lower.includes('senat')) return TimelineStatus.SENATE;
    if (lower.includes('prezydent')) return TimelineStatus.PRESIDENT;
    if (lower.includes('przyjęt') || lower.includes('ogłosz')) return TimelineStatus.ACCEPTED;
    if (lower.includes('odrzu')) return TimelineStatus.REJECTED;
    return TimelineStatus.DRAFT;
}

// KROK 1: Pobierz listę projektów z danej strony (paginacja przez pNumber)
export async function fetchProjectList(pageNum: number = 1, limit: number = 50): Promise<RclProject[]> {
    // RCL używa parametru pNumber do paginacji (zaczyna od 1)
    const url = `${BASE_URL}/lista?pNumber=${pageNum}`;
    console.log(`📜 Fetching project list from: ${url}`);

    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    const projects: RclProject[] = [];

    // Tabela z projektami - szukamy wierszy w tabeli
    $('table tbody tr, table tr').slice(0, limit).each((_, row) => {
        const $row = $(row);
        const cells = $row.find('td');

        if (cells.length < 5) return; // Pomijamy nagłówki

        const titleCell = cells.eq(0);
        const link = titleCell.find('a[href*="/projekt/"]');

        const href = link.attr('href') || '';
        const rclIdMatch = href.match(/\/projekt\/(\d+)/);
        const rclId = rclIdMatch ? rclIdMatch[1] : '';

        if (!rclId) return;

        const title = link.text().trim();
        const applicant = cells.eq(1).find('a').text().trim() || cells.eq(1).text().trim();
        const registryNumber = cells.eq(2).find('a').text().trim() || cells.eq(2).text().trim();
        const createdDate = cells.eq(3).text().trim();
        const modifiedDate = cells.eq(4).text().trim();

        projects.push({
            rclId,
            title,
            applicant,
            registryNumber,
            createdDate,
            modifiedDate
        });
    });

    console.log(`   📄 Found ${projects.length} projects on page ${pageNum}`);
    return projects;
}

// KROK 2: Pobierz szczegóły projektu
export async function fetchProjectDetails(rclId: string): Promise<RclProjectDetails | null> {
    const url = `${BASE_URL}/projekt/${rclId}`;
    console.log(`   🔍 Fetching details for project ${rclId}`);

    try {
        const html = await fetchHtml(url);
        const $ = cheerio.load(html);

        const title = $('.rcl-title').first().text().trim();
        const applicant = extractFieldValue($, 'Wnioskodawca:');
        const registryNumber = extractFieldValue($, 'Numer z wykazu:');
        const createdDate = extractFieldValue($, 'Data utworzenia:');
        const status = extractFieldValue($, 'Status projektu:');

        // Działy (departamenty)
        const departments: string[] = [];
        const deptRow = $('div.row:contains("Działy:")');
        deptRow.find('a').each((_, el) => {
            departments.push($(el).text().trim());
        });

        // Hasła (słowa kluczowe)
        const keywords: string[] = [];
        const keywordRow = $('div.row:contains("Hasła:")');
        keywordRow.find('a').each((_, el) => {
            keywords.push($(el).text().trim());
        });

        // EU Regulation
        const euRegulation = extractFieldValue($, 'Projekt realizuje przepisy prawa Unii Europejskiej:');

        // Podstawa prawna
        const legalBasis = $('.clearbox-grey').text().trim();

        // Szukaj linku do Dziennika Ustaw (format: Dz.U. 2025r. poz. 1630)
        // UWAGA: Każda strona RCL ma niepełny link www.dziennikustaw.gov.pl/DU w nagłówku
        // Musimy szukać PEŁNYCH linków z numerem: /DU/YYYY/NNNN
        let dziennikUstawLink: string | undefined;
        const pageText = $('body').text();

        // Metoda 1: Szukaj PEŁNEGO linku do dziennikustaw.gov.pl (z rokiem i numerem)
        $('a[href*="dziennikustaw.gov.pl"]').each((_, el) => {
            const href = $(el).attr('href') || '';
            // Sprawdź czy link zawiera pełną ścieżkę /DU/YYYY/NNNN
            if (/\/DU\/\d{4}\/\d+/.test(href)) {
                dziennikUstawLink = href;
                console.log(`   📜 Found Dz.U. link: ${href}`);
                return false; // break
            }
        });

        // Metoda 2: Jeśli nie znaleziono linku, wyekstrahuj z tekstu "Dz.U. 2025r. poz. 1630"
        if (!dziennikUstawLink) {
            const dzuMatch = pageText.match(/Dz\.?U\.?\s*(\d{4})\s*r?\.?\s*poz\.?\s*(\d+)/i);
            if (dzuMatch) {
                const year = dzuMatch[1];
                const pos = dzuMatch[2];
                dziennikUstawLink = `https://dziennikustaw.gov.pl/DU/${year}/${pos}`;
                console.log(`   📜 Built Dz.U. link from text: ${year} poz. ${pos}`);
            }
        }

        // Sprawdź czy dokument został FAKTYCZNIE opublikowany:
        // - Musi mieć link do Dz.U. z numerem LUB
        // - Tekst "projekt został opublikowany"
        const pageTextLower = pageText.toLowerCase();
        const hasPublicationText = pageTextLower.includes('projekt został opublikowany');
        const isPublished = !!dziennikUstawLink || hasPublicationText;

        // Szukaj linku do Sejmu RPL (np. http://www.sejm.gov.pl/Sejm7.nsf/agent.xsp?symbol=RPL&Id=RM-0610-167-25)
        // Wyciągnij Id dla ustaw przekazanych do Sejmu
        let sejmRplId: string | undefined;
        $('a[href*="sejm.gov.pl"]').each((_, el) => {
            const href = $(el).attr('href') || '';
            // Szukaj parametru Id w URL
            const idMatch = href.match(/[?&]Id=([A-Za-z0-9-]+)/i);
            if (idMatch) {
                sejmRplId = idMatch[1];
                console.log(`   🏛️ Found Sejm RPL Id: ${sejmRplId}`);
                return false;
            }
        });

        // Etapy procesu legislacyjnego
        const stages: RclStage[] = [];
        $('ul.cbp_tmtimeline li').each((_, li) => {
            const $li = $(li);
            const stageId = $li.attr('id') || '';
            const link = $li.find('a[href*="/katalog/"]');
            const name = link.length > 0
                ? link.text().trim()
                : $li.find('.cbp_tmlabel, .cbp_tmlabel_notstart, .cbp_tmlabel_active').text().trim();

            const modifiedDateText = $li.find('.small2:contains("Data ostatniej modyfikacji")').text();
            const modifiedMatch = modifiedDateText.match(/(\d{2}-\d{2}-\d{4})/);
            const modifiedDate = modifiedMatch ? modifiedMatch[1] : undefined;

            const stageUrl = link.attr('href');

            if (stageId && name) {
                stages.push({
                    stageId,
                    name: name.replace(/^\d+\.\s*/, '').trim(),
                    modifiedDate,
                    url: stageUrl ? `${BASE_URL}${stageUrl}` : undefined
                });
            }
        });

        return {
            rclId,
            title,
            applicant,
            registryNumber,
            createdDate,
            status,
            departments,
            keywords,
            euRegulation: euRegulation || undefined,
            legalBasis: legalBasis || undefined,
            stages,
            isPublished,
            dziennikUstawLink,
            sejmRplId
        };
    } catch (err) {
        console.error(`   ❌ Error fetching project ${rclId}:`, err);
        return null;
    }
}

// Pomocnik do ekstrakcji wartości pól
function extractFieldValue($: cheerio.CheerioAPI, label: string): string {
    const row = $(`div.row:contains("${label}")`);
    return row.find('.col-xs-6').text().trim();
}

// KROK 3: Pobierz załączniki z etapu
export async function fetchStageAttachments(stageUrl: string): Promise<RclAttachment[]> {
    console.log(`   📎 Fetching attachments from: ${stageUrl}`);

    try {
        const html = await fetchHtml(stageUrl);
        const $ = cheerio.load(html);
        const attachments: RclAttachment[] = [];

        $('li.doc a[href*="/docs/"]').each((_, el) => {
            const $el = $(el);
            const href = $el.attr('href') || '';
            const name = $el.text().trim();

            // Typ pliku
            const ext = href.split('.').pop()?.toLowerCase() || 'unknown';

            if (ext !== 'pdf') return;

            attachments.push({
                name,
                url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
                type: ext
            });
        });

        console.log(`      Found ${attachments.length} attachments`);
        return attachments;
    } catch (err) {
        console.error(`   ❌ Error fetching attachments:`, err);
        return [];
    }
}

// Funkcja do wyszukiwania dokumentu w bazie - ulepszone szukanie
async function findExistingDocument(registryNumber: string, title: string, applicant: string): Promise<{ id: number; title: string } | null> {
    // 1. Szukaj po numerze z wykazu (registryNumber)
    if (registryNumber) {
        const byNumber = await prisma.legalDocument.findFirst({
            where: { registryNumber },
            select: { id: true, title: true }
        });
        if (byNumber) return byNumber;
    }

    // 2. Pobierz kandydatów z bazy przez częściowe dopasowanie
    const titleParts = [];
    if (title.length > 15) {
        titleParts.push(title.substring(0, 15)); // Początek
        titleParts.push(title.substring(Math.max(0, title.length - 15))); // Koniec
        // Środek dla unikalności
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

    // 3. Filtruj i rankuj kandydatów
    let bestMatch: { id: number; title: string } | null = null;
    let minDistance = Infinity;

    for (const candidate of candidates) {
        // Sprawdź czy są podobne wg naszych kryteriów
        if (areTitlesSimilar(title, candidate.title)) {
            const dist = levenshteinDistance(title.toLowerCase(), candidate.title.toLowerCase());

            // Preferuj mniejszy dystans
            if (dist < minDistance) {
                minDistance = dist;
                bestMatch = candidate;
            }
        }
    }

    return bestMatch;
}

// Funkcja pomocnicza do upsert taga
async function getOrCreateTag(name: string) {
    return prisma.tag.upsert({
        where: { name },
        create: { name },
        update: {}
    });
}

// Główna funkcja synchronizacji jednego projektu
async function syncProject(project: RclProject): Promise<{ isNew: boolean; updated: boolean }> {
    const details = await fetchProjectDetails(project.rclId);
    if (!details) {
        return { isNew: false, updated: false };
    }

    await delay(REQUEST_DELAY);

    // Znajdź istniejący dokument
    const existing = await findExistingDocument(
        details.registryNumber,
        details.title,
        details.applicant
    );

    // Przygotuj tagi z haseł i działów (limit 10)
    const tagNames = [...details.keywords, ...details.departments].filter(Boolean).slice(0, 10);
    const tags = await Promise.all(tagNames.map(t => getOrCreateTag(t)));

    // Parsuj datę - używamy daty z listy projektów (format DD-MM-YYYY)
    let createdAt: Date = new Date();
    const dateStr = project.createdDate;
    if (dateStr) {
        const match = dateStr.match(/(\d{2})-(\d{2})-(\d{4})/);
        if (match) {
            const parsedDate = new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
            if (!isNaN(parsedDate.getTime())) {
                createdAt = parsedDate;
            }
        }
    }

    if (existing) {
        // Określ status - jeśli zrealizowany (ogłoszony) to ACCEPTED
        const finalStatus = details.isPublished ? DocumentStatus.ACCEPTED : parseStatus(details.status);

        // Aktualizuj istniejący dokument z RCL
        await prisma.legalDocument.update({
            where: { id: existing.id },
            data: {
                title: project.title, // Pełny tytuł z listy
                type: parseDocumentType(project.title),
                status: finalStatus,
                summary: details.legalBasis || null,
                sejmRplId: details.sejmRplId || undefined,
                tags: { set: tags.map(t => ({ id: t.id })) },
                updatedAt: new Date()
            }
        });

        // Dodaj link do RCL jeśli nie istnieje
        const rclLink = `${BASE_URL}/projekt/${project.rclId}`;
        const existingRclLink = await prisma.link.findFirst({
            where: { documentId: existing.id, url: rclLink }
        });
        if (!existingRclLink) {
            await prisma.link.create({
                data: {
                    url: rclLink,
                    description: 'Strona projektu w RCL',
                    documentId: existing.id
                }
            });
        }

        // Dodaj link do Dziennika Ustaw jeśli opublikowany
        if (details.dziennikUstawLink) {
            const existingDzuLink = await prisma.link.findFirst({
                where: { documentId: existing.id, url: details.dziennikUstawLink }
            });
            if (!existingDzuLink) {
                await prisma.link.create({
                    data: {
                        url: details.dziennikUstawLink,
                        description: 'Publikacja w Dzienniku Ustaw',
                        documentId: existing.id
                    }
                });
                console.log(`   📜 Added Dz.U. link: ${details.dziennikUstawLink}`);
            }
        }

        // Synchronizuj etapy jako timeline
        for (const stage of details.stages) {
            if (stage.url) {
                await delay(REQUEST_DELAY);
                const attachments = await fetchStageAttachments(stage.url);

                // Parsuj datę etapu
                let stageDate = new Date();
                if (stage.modifiedDate) {
                    const [day, month, year] = stage.modifiedDate.split('-');
                    if (day && month && year) {
                        stageDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                    }
                }

                // Sprawdź czy etap już istnieje
                const existingStage = await prisma.timelineEvent.findFirst({
                    where: {
                        documentId: existing.id,
                        title: stage.name
                    }
                });

                if (!existingStage) {
                    const timelineEvent = await prisma.timelineEvent.create({
                        data: {
                            date: stageDate,
                            status: parseTimelineStatus(stage.name),
                            title: stage.name,
                            description: `Etap procesu legislacyjnego: ${stage.name}`,
                            documentId: existing.id
                        }
                    });

                    // Dodaj załączniki
                    for (const attachment of attachments.slice(0, 20)) { // Limit 20 załączników
                        await prisma.attachment.create({
                            data: {
                                name: attachment.name.substring(0, 255),
                                url: attachment.url,
                                type: attachment.type,
                                timelineEventId: timelineEvent.id
                            }
                        });
                    }
                }
            }
        }

        console.log(`   📝 Updated: ${project.title.substring(0, 50)}...`);
        return { isNew: false, updated: true };
    } else {
        // Określ status - jeśli zrealizowany (ogłoszony) to ACCEPTED
        const finalStatus = details.isPublished ? DocumentStatus.ACCEPTED : parseStatus(details.status);

        // Utwórz nowy dokument - używamy danych z listy projektów (są czystsze)
        const document = await prisma.legalDocument.create({
            data: {
                registryNumber: project.registryNumber || `RCL-${project.rclId}`,
                title: project.title, // Pełny tytuł z listy
                type: parseDocumentType(project.title),
                level: DocumentLevel.KRAJOWY,
                location: 'Polska',
                status: finalStatus,
                summary: details.legalBasis || null,
                submittingEntity: project.applicant, // Wnioskodawca z listy
                sejmRplId: details.sejmRplId || undefined,
                tags: { connect: tags.map(t => ({ id: t.id })) },
                createdAt
            }
        });

        // Dodaj osobę odpowiedzialną
        if (project.applicant) {
            await prisma.responsiblePerson.create({
                data: {
                    name: project.applicant,
                    documentId: document.id
                }
            });
        }

        // Dodaj link do RCL
        await prisma.link.create({
            data: {
                url: `${BASE_URL}/projekt/${project.rclId}`,
                description: 'Strona projektu w RCL',
                documentId: document.id
            }
        });

        // Dodaj link do Dziennika Ustaw jeśli opublikowany
        if (details.dziennikUstawLink) {
            await prisma.link.create({
                data: {
                    url: details.dziennikUstawLink,
                    description: 'Publikacja w Dzienniku Ustaw',
                    documentId: document.id
                }
            });
            console.log(`   📜 Added Dz.U. link: ${details.dziennikUstawLink}`);
        }

        // Inicjalizuj głosy
        await prisma.votes.create({
            data: {
                up: 0,
                down: 0,
                documentId: document.id
            }
        });

        // Dodaj analizę AI
        await prisma.aiAnalysis.create({
            data: {
                sentiment: 0,
                documentId: document.id
            }
        });

        // Synchronizuj etapy
        for (const stage of details.stages) {
            if (stage.url) {
                await delay(REQUEST_DELAY);
                const attachments = await fetchStageAttachments(stage.url);

                let stageDate = new Date();
                if (stage.modifiedDate) {
                    const [day, month, year] = stage.modifiedDate.split('-');
                    if (day && month && year) {
                        stageDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                    }
                }

                const timelineEvent = await prisma.timelineEvent.create({
                    data: {
                        date: stageDate,
                        status: parseTimelineStatus(stage.name),
                        title: stage.name,
                        description: `Etap procesu legislacyjnego: ${stage.name}`,
                        documentId: document.id
                    }
                });

                for (const attachment of attachments.slice(0, 20)) {
                    await prisma.attachment.create({
                        data: {
                            name: attachment.name.substring(0, 255),
                            url: attachment.url,
                            type: attachment.type,
                            timelineEventId: timelineEvent.id
                        }
                    });
                }
            }
        }

        console.log(`   ✅ Created: ${details.title.substring(0, 50)}...`);
        return { isNew: true, updated: false };
    }
}

// Główna funkcja synchronizacji
export async function syncFromRcl(options: {
    startPage?: number;
    pages?: number;
    projectsPerPage?: number
} = {}): Promise<{ created: number; updated: number; errors: number }> {
    const { startPage = 1, pages = 5, projectsPerPage = 50 } = options;

    console.log('\n🔄 Starting synchronization with RCL (legislacja.rcl.gov.pl)...');
    console.log('━'.repeat(60));
    console.log(`📍 Start page: ${startPage}, Pages to sync: ${pages}, Projects per page: ${projectsPerPage}`);

    const stats = { created: 0, updated: 0, errors: 0 };

    // Paginacja RCL zaczyna się od 1
    for (let pageNum = startPage; pageNum < startPage + pages; pageNum++) {
        try {
            console.log(`\n📄 Page ${pageNum}...`);
            const projects = await fetchProjectList(pageNum, projectsPerPage);

            if (projects.length === 0) {
                console.log(`   ⚠️ No projects found on page ${pageNum}, stopping.`);
                break;
            }

            for (const project of projects) {
                try {
                    // Filtruj tylko projekty od 2023 roku
                    const yearMatch = project.createdDate.match(/(\d{4})/);
                    if (yearMatch) {
                        const year = parseInt(yearMatch[1]);
                        if (year < 2025) {
                            console.log(`   ⏭️ Skipping old project (${year}): ${project.title.substring(0, 30)}...`);
                            continue;
                        }
                    }

                    await delay(REQUEST_DELAY);
                    const result = await syncProject(project);

                    if (result.isNew) {
                        stats.created++;
                    } else if (result.updated) {
                        stats.updated++;
                    }
                } catch (err) {
                    console.error(`   ❌ Error syncing project ${project.rclId}:`, err);
                    stats.errors++;
                }
            }

            console.log(`   ✅ Page ${pageNum} done. Created: ${stats.created}, Updated: ${stats.updated}`);
        } catch (err) {
            console.error(`❌ Error fetching page ${pageNum}:`, err);
            stats.errors++;
        }
    }

    console.log('\n' + '━'.repeat(60));
    console.log('✅ RCL Synchronization completed!');
    console.log(`   Created: ${stats.created}`);
    console.log(`   Updated: ${stats.updated}`);
    console.log(`   Errors: ${stats.errors}`);

    return stats;
}

// Uruchom synchronizację jeśli wywołano bezpośrednio
// Użycie: npm run sync:rcl -- [startPage] [pages] [projectsPerPage]
if (require.main === module) {
    const args = process.argv.slice(2);
    const startPage = parseInt(args[0]) || 1;
    const pages = parseInt(args[1]) || 5;
    const projectsPerPage = parseInt(args[2]) || 50;

    syncFromRcl({ startPage, pages, projectsPerPage })
        .then(() => process.exit(0))
        .catch(err => {
            console.error('Fatal error:', err);
            process.exit(1);
        })
        .finally(() => prisma.$disconnect());
}


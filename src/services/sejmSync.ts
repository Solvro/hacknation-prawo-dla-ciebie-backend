/**
 * Synchronizacja z API Sejmu
 * Pobiera procesy legislacyjne z https://api.sejm.gov.pl/sejm/term10/processes/:id
 * i łączy je z dokumentami w bazie (przez rclNum lub podobieństwo tytułów)
 */

import { prisma } from '../lib/prisma';
import { areTitlesSimilar, levenshteinDistance } from '../utils/stringComparison';
import { DocumentType, DocumentLevel, DocumentStatus, TimelineStatus } from '@prisma/client';

const SEJM_API_BASE = 'https://api.sejm.gov.pl/sejm/term10';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// Rate limiting
const REQUEST_DELAY = 200;

// Interfejsy dla API Sejmu
interface SejmProcess {
    number: string;
    title: string;
    titleFinal?: string;
    description?: string;
    documentType: string;
    documentTypeEnum?: string;
    documentDate?: string;
    processStartDate?: string;
    closureDate?: string;
    changeDate?: string;
    passed?: boolean;
    term: number;
    rclNum?: string; // Numer RCL np. "RM-0610-147-25"
    rclLink?: string;
    ELI?: string;
    displayAddress?: string;
    urgencyStatus?: string;
    stages?: SejmStage[];
    links?: { href: string; rel: string }[];
}

interface SejmStage {
    stageName: string;
    stageType: string;
    date?: string;
    decision?: string;
    comment?: string;
    printNumber?: string;
    sittingNum?: number;
    children?: SejmStageChild[];
}

interface SejmStageChild {
    stageName: string;
    stageType: string;
    date?: string;
    printNumber?: string;
    voting?: {
        yes: number;
        no: number;
        abstain: number;
        notParticipating: number;
        description?: string;
    };
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchSejmProcess(id: number): Promise<SejmProcess | null> {
    const url = `${SEJM_API_BASE}/processes/${id}`;

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'application/json'
            }
        });

        if (response.status === 404) {
            return null; // Proces nie istnieje
        }

        if (!response.ok) {
            console.error(`   ⚠️ HTTP ${response.status} for process ${id}`);
            return null;
        }

        return await response.json() as SejmProcess;
    } catch (err) {
        console.error(`   ❌ Error fetching process ${id}:`, err);
        return null;
    }
}

function parseDocumentType(docType: string): DocumentType {
    const lower = docType.toLowerCase();
    if (lower.includes('ustaw')) return DocumentType.USTAWA;
    if (lower.includes('rozporządz')) return DocumentType.ROZPORZADZENIE;
    if (lower.includes('uchwał')) return DocumentType.UCHWALA;
    if (lower.includes('obwieszcz')) return DocumentType.OBWIESZCZENIE;
    return DocumentType.INNE;
}

function parseDocumentStatus(process: SejmProcess): DocumentStatus {
    if (process.passed) return DocumentStatus.ACCEPTED;

    const lastStage = process.stages?.[process.stages.length - 1];
    if (lastStage) {
        const stageName = lastStage.stageName.toLowerCase();
        if (stageName.includes('prezydent')) return DocumentStatus.PRESIDENT;
        if (stageName.includes('senat')) return DocumentStatus.SENATE;
        if (stageName.includes('uchwalon') || stageName.includes('przyjęt')) return DocumentStatus.ACCEPTED;
    }

    return DocumentStatus.SEJM;
}

function parseTimelineStatus(stageName: string): TimelineStatus {
    const lower = stageName.toLowerCase();
    if (lower.includes('senat')) return TimelineStatus.SENATE;
    if (lower.includes('prezydent')) return TimelineStatus.PRESIDENT;
    if (lower.includes('uchwalon') || lower.includes('przyjęt')) return TimelineStatus.ACCEPTED;
    if (lower.includes('odrzu')) return TimelineStatus.REJECTED;
    return TimelineStatus.SEJM;
}

function parseDate(dateStr?: string): Date {
    if (!dateStr) return new Date();
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? new Date() : date;
}

// Szukaj dokumentu w bazie przez rclNum (sejmRplId)
async function findByRclNum(rclNum: string): Promise<{ id: number } | null> {
    return prisma.legalDocument.findFirst({
        where: { sejmRplId: rclNum },
        select: { id: true }
    });
}

// Szukaj dokumentu przez podobieństwo tytułu
async function findBySimilarTitle(title: string): Promise<{ id: number; title: string } | null> {
    // 1. Pobierz kandydatów z bazy przez częściowe dopasowanie
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

    // Zapytanie o kandydatów
    const candidates = await prisma.legalDocument.findMany({
        where: {
            OR: titleParts.map(part => ({
                title: { contains: part, mode: 'insensitive' }
            }))
        },
        select: { id: true, title: true }
    });

    // 2. Filtruj i rankuj kandydatów
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

// Główna funkcja synchronizacji jednego procesu
async function syncSejmProcess(process: SejmProcess): Promise<{ isNew: boolean; updated: boolean; linked: boolean }> {
    // 1. Szukaj przez rclNum
    let existing: { id: number } | null = null;

    if (process.rclNum) {
        existing = await findByRclNum(process.rclNum);
        if (existing) {
            console.log(`   🔗 Linked by rclNum: ${process.rclNum}`);
        }
    }

    // 2. Szukaj przez podobieństwo tytułu
    if (!existing) {
        existing = await findBySimilarTitle(process.title);
        if (existing) {
            console.log(`   🔗 Linked by similar title`);
        }
    }

    const finalStatus = parseDocumentStatus(process);

    if (existing) {
        // Aktualizuj istniejący dokument danymi z Sejmu
        await prisma.legalDocument.update({
            where: { id: existing.id },
            data: {
                printNumber: parseInt(process.number) || undefined,
                termNumber: process.term,
                status: finalStatus,
                sejmRplId: process.rclNum || undefined,
                updatedAt: new Date()
            }
        });

        // Dodaj link do API Sejmu
        const sejmLink = `https://www.sejm.gov.pl/sejm10.nsf/PrzebiegProc.xsp?nr=${process.number}`;
        const existingLink = await prisma.link.findFirst({
            where: { documentId: existing.id, url: sejmLink }
        });
        if (!existingLink) {
            await prisma.link.create({
                data: {
                    url: sejmLink,
                    description: `Przebieg procesu legislacyjnego w Sejmie (druk nr ${process.number})`,
                    documentId: existing.id
                }
            });
        }

        // Synchronizuj etapy jako timeline
        if (process.stages) {
            for (const stage of process.stages) {
                const existingStage = await prisma.timelineEvent.findFirst({
                    where: {
                        documentId: existing.id,
                        title: stage.stageName
                    }
                });

                if (!existingStage) {
                    await prisma.timelineEvent.create({
                        data: {
                            date: parseDate(stage.date),
                            status: parseTimelineStatus(stage.stageName),
                            title: stage.stageName,
                            description: stage.decision || stage.comment || `Etap: ${stage.stageName}`,
                            documentId: existing.id
                        }
                    });
                }
            }
        }

        return { isNew: false, updated: true, linked: !!process.rclNum };
    } else {
        // Utwórz nowy dokument
        const document = await prisma.legalDocument.create({
            data: {
                registryNumber: `SEJM-${process.term}-${process.number}`,
                printNumber: parseInt(process.number) || undefined,
                termNumber: process.term,
                title: process.title,
                type: parseDocumentType(process.documentType),
                level: DocumentLevel.KRAJOWY,
                location: 'Polska',
                status: finalStatus,
                summary: process.description || null,
                sejmRplId: process.rclNum || undefined,
                createdAt: parseDate(process.processStartDate)
            }
        });

        // Dodaj link do Sejmu
        await prisma.link.create({
            data: {
                url: `https://www.sejm.gov.pl/sejm10.nsf/PrzebiegProc.xsp?nr=${process.number}`,
                description: `Przebieg procesu legislacyjnego w Sejmie (druk nr ${process.number})`,
                documentId: document.id
            }
        });

        // Dodaj linki ELI/ISAP
        if (process.links) {
            for (const link of process.links.slice(0, 5)) {
                await prisma.link.create({
                    data: {
                        url: link.href,
                        description: `${link.rel.toUpperCase()} - System prawny`,
                        documentId: document.id
                    }
                });
            }
        }

        // Inicjalizuj głosy
        await prisma.votes.create({
            data: { up: 0, down: 0, documentId: document.id }
        });

        // Analiza AI placeholder
        await prisma.aiAnalysis.create({
            data: { sentiment: 0, documentId: document.id }
        });

        // Etapy jako timeline
        if (process.stages) {
            for (const stage of process.stages) {
                await prisma.timelineEvent.create({
                    data: {
                        date: parseDate(stage.date),
                        status: parseTimelineStatus(stage.stageName),
                        title: stage.stageName,
                        description: stage.decision || stage.comment || `Etap: ${stage.stageName}`,
                        documentId: document.id
                    }
                });
            }
        }

        console.log(`   ✅ Created: ${process.title.substring(0, 50)}...`);
        return { isNew: true, updated: false, linked: false };
    }
}

// Główna funkcja synchronizacji
export async function syncFromSejm(options: {
    startId?: number;
    endId?: number;
    term?: number;
} = {}): Promise<{ created: number; updated: number; linked: number; notFound: number; errors: number }> {
    const { startId = 1, endId = 2000, term = 10 } = options;

    console.log('\n🏛️ Starting synchronization with Sejm API...');
    console.log('━'.repeat(60));
    console.log(`📍 Term: ${term}, Process IDs: ${startId} - ${endId}`);

    const stats = { created: 0, updated: 0, linked: 0, notFound: 0, errors: 0 };

    for (let id = startId; id <= endId; id++) {
        try {
            const process = await fetchSejmProcess(id);
            await delay(REQUEST_DELAY);

            if (!process) {
                stats.notFound++;
                continue;
            }

            console.log(`[${id}/${endId}] ${process.title.substring(0, 50)}...`);

            const result = await syncSejmProcess(process);

            if (result.isNew) {
                stats.created++;
            } else if (result.updated) {
                stats.updated++;
            }
            if (result.linked) {
                stats.linked++;
            }

        } catch (err) {
            console.error(`   ❌ Error syncing process ${id}:`, err);
            stats.errors++;
        }

        // Przerwa co 100 procesów
        if (id % 100 === 0) {
            console.log(`\n⏸️  Progress: ${id}/${endId} (Created: ${stats.created}, Updated: ${stats.updated}, Linked: ${stats.linked})`);
            await delay(1000);
        }
    }

    console.log('\n' + '━'.repeat(60));
    console.log('✅ Sejm Synchronization completed!');
    console.log(`   Created: ${stats.created}`);
    console.log(`   Updated: ${stats.updated}`);
    console.log(`   Linked to RCL: ${stats.linked}`);
    console.log(`   Not found: ${stats.notFound}`);
    console.log(`   Errors: ${stats.errors}`);

    return stats;
}

// Uruchomienie
if (require.main === module) {
    const args = process.argv.slice(2);
    const startId = parseInt(args[0]) || 1;
    const endId = parseInt(args[1]) || 2000;

    syncFromSejm({ startId, endId })
        .then(() => process.exit(0))
        .catch(err => {
            console.error('Fatal error:', err);
            process.exit(1);
        })
        .finally(() => prisma.$disconnect());
}

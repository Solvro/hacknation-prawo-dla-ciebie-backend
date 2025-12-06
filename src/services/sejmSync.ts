/**
 * Synchronizacja z API Sejmu
 * Pobiera procesy legislacyjne z https://api.sejm.gov.pl/sejm/term10/processes/:id
 * i łączy je z dokumentami w bazie (przez rclNum lub podobieństwo tytułów).
 * 
 * Implementuje również pobieranie szczegółowych danych z komisji (stenogramy, wideo)
 * oraz głosowań.
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
    committee?: string; // Kod komisji np. "ASW"
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

interface SejmVoting {
    term: number;
    sitting: number;
    votingNumber: number;
    date: string;
    title: string;
    description?: string;
    topic?: string;
    kind: string;
    yes: number;
    no: number;
    abstain: number;
    notParticipating: number;
    votes: {
        MP: number;
        club: string;
        vote: string; // YES, NO, ABSTAIN, ABSENT
    }[];
}

interface SejmVideo {
    unid: string;
    title: string;
    description?: string;
    img: string;
    url: string;
    duration?: string;
    date: string;
    time: string;
    sitting: number;
    type: string;
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Fetch Helpers ---

async function fetchSejmProcess(id: number): Promise<SejmProcess | null> {
    const url = `${SEJM_API_BASE}/processes/${id}`;
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'application/json'
            }
        });

        if (response.status === 404) return null;
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

async function fetchVotingDetails(term: number, sitting: number, votingNum: number): Promise<SejmVoting | null> {
    const url = `${SEJM_API_BASE}/votings/${sitting}/${votingNum}`;
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        return await response.json() as SejmVoting;
    } catch (err) {
        console.error(`Error fetching voting ${sitting}/${votingNum}:`, err);
        return null;
    }
}

async function fetchVideos(term: number, sitting: number): Promise<SejmVideo[]> {
    const url = `${SEJM_API_BASE}/videos?sitting=${sitting}`;
    try {
        const response = await fetch(url);
        if (!response.ok) return [];
        return await response.json() as SejmVideo[];
    } catch (err) {
        console.error(`Error fetching videos for sitting ${sitting}:`, err);
        return [];
    }
}

async function fetchCommitteeVideos(term: number, committeeCode: string, date: string): Promise<SejmVideo[]> {
    const url = `${SEJM_API_BASE}/videos?comm=${committeeCode}&type=komisja&since=${date}&till=${date}`;
    try {
        const response = await fetch(url);
        if (!response.ok) return [];
        return await response.json() as SejmVideo[];
    } catch (err) {
        console.error(`Error fetching committee videos ${committeeCode} on ${date}:`, err);
        return [];
    }
}

async function fetchCommitteeSitting(term: number, committeeCode: string, date: string): Promise<any | null> {
    const url = `${SEJM_API_BASE}/committees/${committeeCode}/sittings`;
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const sittings = (await response.json()) as any[];
        return sittings.find(s => s.date === date) || null;
    } catch (err) {
        console.error(`Error fetching committee sittings ${committeeCode}:`, err);
        return null;
    }
}

// --- Parsers ---

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

// --- DB Search ---

async function findByRclNum(rclNum: string): Promise<{ id: number } | null> {
    return prisma.legalDocument.findFirst({
        where: { sejmRplId: rclNum },
        select: { id: true }
    });
}

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

// --- Processing Logic ---

async function syncSejmProcess(process: SejmProcess): Promise<{ isNew: boolean; updated: boolean; linked: boolean }> {
    let existing: { id: number } | null = null;

    if (process.rclNum) {
        existing = await findByRclNum(process.rclNum);
        if (existing) console.log(`   🔗 Linked by rclNum: ${process.rclNum}`);
    }

    if (!existing) {
        existing = await findBySimilarTitle(process.title);
        if (existing) console.log(`   🔗 Linked by similar title`);
    }

    const finalStatus = parseDocumentStatus(process);

    if (existing) {
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

        await ensureSejmLink(existing.id, process.number);
        await processStages(existing.id, process);
        await handleCommitteeStages(existing.id, process);

        return { isNew: false, updated: true, linked: !!process.rclNum };
    } else {
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

        await ensureSejmLink(document.id, process.number);

        // Linki ELI/ISAP
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

        // Inity
        await prisma.votes.create({ data: { up: 0, down: 0, documentId: document.id } });
        await prisma.aiAnalysis.create({ data: { sentiment: 0, documentId: document.id } });

        await processStages(document.id, process);
        await handleCommitteeStages(document.id, process);

        console.log(`   ✅ Created: ${process.title.substring(0, 50)}...`);
        return { isNew: true, updated: false, linked: false };
    }
}

async function ensureSejmLink(documentId: number, printNumber: string) {
    const sejmLink = `https://www.sejm.gov.pl/sejm10.nsf/PrzebiegProc.xsp?nr=${printNumber}`;
    const existing = await prisma.link.findFirst({ where: { documentId, url: sejmLink } });
    if (!existing) {
        await prisma.link.create({
            data: {
                url: sejmLink,
                description: `Przebieg procesu legislacyjnego w Sejmie (druk nr ${printNumber})`,
                documentId
            }
        });
    }
}

async function processStages(documentId: number, process: SejmProcess) {
    if (!process.stages) return;

    for (const stage of process.stages) {
        const existingStage = await prisma.timelineEvent.findFirst({
            where: { documentId, title: stage.stageName }
        });

        if (!existingStage) {
            await prisma.timelineEvent.create({
                data: {
                    date: parseDate(stage.date),
                    status: parseTimelineStatus(stage.stageName),
                    title: stage.stageName,
                    description: stage.decision || stage.comment || `Etap: ${stage.stageName}`,
                    documentId
                }
            });
        }

        if (stage.sittingNum && (stage.stageName.toLowerCase().includes('głos') || stage.children?.some(c => c.voting))) {
            await handleVotingsAndVideos(documentId, process, stage);
        }
    }
}

// --- Specific Handlers ---

async function handleVotingsAndVideos(documentId: number, process: SejmProcess, stage: SejmStage) {
    if (!stage.sittingNum) return;

    // 1. Głosowania
    for (const child of stage.children || []) {
        if (child.voting) {
            const listUrl = `${SEJM_API_BASE}/votings/${stage.sittingNum}`;
            try {
                const resp = await fetch(listUrl);
                if (resp.ok) {
                    const votingsList = (await resp.json()) as any[];
                    const relevantVoting = votingsList.find((v: any) =>
                        (v.title && v.title.toLowerCase().includes(process.number)) ||
                        (v.topic && v.topic.toLowerCase().includes(process.number)) ||
                        (v.title && areTitlesSimilar(v.title, process.title))
                    );

                    if (relevantVoting) {
                        const detailedVoting = await fetchVotingDetails(process.term, stage.sittingNum, relevantVoting.votingNumber);
                        if (detailedVoting) {
                            await saveVotingToDb(documentId, detailedVoting);
                        }
                    }
                }
            } catch (e) {
                console.error('Error searching votings:', e);
            }
        }
    }

    // 2. Wideo (Posiedzenia plenarne)
    const videos = await fetchVideos(process.term, stage.sittingNum);
    const relevantVideos = videos.filter(v =>
        (v.title && v.title.includes(`druk nr ${process.number}`)) ||
        (v.description && v.description.includes(`druk nr ${process.number}`))
    );

    for (const video of relevantVideos) {
        const videoUrl = `https://www.sejm.gov.pl/Sejm10.nsf/transmisje_arch.xsp?unid=${video.unid}`;
        const existingLink = await prisma.link.findFirst({ where: { documentId, url: videoUrl } });

        if (!existingLink) {
            await prisma.link.create({
                data: {
                    url: videoUrl,
                    description: `Transmisja: ${video.title} (${video.time})`,
                    documentId
                }
            });
            console.log(`      🎥 Added video link: ${video.title}`);
        }
    }
}

async function handleCommitteeStages(documentId: number, process: SejmProcess) {
    if (!process.stages) return;

    const committeeActivities = new Set<string>();

    for (const stage of process.stages) {
        if (stage.committee && stage.date) {
            const codes = stage.committee.split(' '); // Może być kilka komisji? Przyjmijmy że space separated lub sprawdzamy
            // API często zwraca jeden kod np. "ASW". Ale czasem "ASW, USE".
            const codeList = stage.committee.replace(',', '').split(' ').filter(c => c.length > 0);

            for (const code of codeList) {
                const key = `${code}|${stage.date}`;
                if (!committeeActivities.has(key)) {
                    committeeActivities.add(key);
                    console.log(`      🔎 Checking committee ${code} on ${stage.date}...`);

                    // 1. Stenogram / Posiedzenie
                    const sitting = await fetchCommitteeSitting(process.term, code, stage.date!);
                    if (sitting) {
                        const webUrl = `https://www.sejm.gov.pl/Sejm10.nsf/biuletyn.xsp?skrnr=${code}-${sitting.num}`;
                        const existingLink = await prisma.link.findFirst({ where: { documentId, url: webUrl } });
                        if (!existingLink) {
                            await prisma.link.create({
                                data: {
                                    url: webUrl,
                                    description: `Biuletyn z posiedzenia Komisji ${code} nr ${sitting.num}`,
                                    documentId
                                }
                            });
                            console.log(`      📄 Added committee transcript: ${code} nr ${sitting.num}`);
                        }
                    }

                    // 2. Wideo
                    const videos = await fetchCommitteeVideos(process.term, code, stage.date!);
                    for (const video of videos) {
                        const videoUrl = `https://www.sejm.gov.pl/Sejm10.nsf/transmisje_arch.xsp?unid=${video.unid}`;
                        const existingLink = await prisma.link.findFirst({ where: { documentId, url: videoUrl } });
                        if (!existingLink) {
                            await prisma.link.create({
                                data: {
                                    url: videoUrl,
                                    description: `Transmisja komisji: ${video.title}`,
                                    documentId
                                }
                            });
                            console.log(`      🎥 Added committee video: ${video.title}`);
                        }
                    }
                }
            }
        }
    }
}

async function saveVotingToDb(documentId: number, voting: SejmVoting) {
    const existing = await prisma.parliamentVoting.findFirst({
        where: { documentId, votingNumber: voting.votingNumber, sitting: voting.sitting }
    });
    if (existing) return;

    console.log(`      🗳️ Saving voting #${voting.votingNumber} (Sitting ${voting.sitting})...`);

    const clubStats: Record<string, { yes: number, no: number, abstain: number, absent: number }> = {};
    for (const vote of voting.votes) {
        if (!clubStats[vote.club]) clubStats[vote.club] = { yes: 0, no: 0, abstain: 0, absent: 0 };
        if (vote.vote === 'YES') clubStats[vote.club].yes++;
        else if (vote.vote === 'NO') clubStats[vote.club].no++;
        else if (vote.vote === 'ABSTAIN') clubStats[vote.club].abstain++;
        else clubStats[vote.club].absent++;
    }

    const pv = await prisma.parliamentVoting.create({
        data: {
            documentId,
            sitting: voting.sitting,
            votingNumber: voting.votingNumber,
            date: new Date(voting.date),
            title: voting.title,
            topic: voting.topic,
            description: voting.description,
            kind: voting.kind,
            totalYes: voting.yes,
            totalNo: voting.no,
            totalAbstain: voting.abstain,
            notParticipating: voting.notParticipating
        }
    });

    for (const [club, stats] of Object.entries(clubStats)) {
        await prisma.clubVote.create({
            data: {
                votingId: pv.id,
                club,
                yes: stats.yes,
                no: stats.no,
                abstain: stats.abstain,
                notParticipating: stats.absent
            }
        });
    }
}

// --- Main Loop ---

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

            const procDate = parseDate(process.processStartDate || process.documentDate);
            if (procDate.getFullYear() < 2025) {
                if (id % 100 === 0) console.log(`   Processed ${id}/${endId} (checking dates...)`);
                continue;
            }

            console.log(`[${id}/${endId}] ${process.title.substring(0, 50)}...`);

            const result = await syncSejmProcess(process);

            if (result.isNew) stats.created++;
            else if (result.updated) stats.updated++;
            if (result.linked) stats.linked++;

        } catch (err) {
            console.error(`   ❌ Error syncing process ${id}:`, err);
            stats.errors++;
        }

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
    console.log('   Not found: ' + stats.notFound);
    console.log('   Errors: ' + stats.errors);

    return stats;
}

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

import { PrismaClient, DocumentType, DocumentLevel, DocumentStatus, TimelineStatus } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// ==================== INTERFEJSY ====================

interface JsonResponsiblePerson {
    name: string;
    role?: string;
    email?: string;
}

interface JsonVotes {
    up: number;
    down: number;
}

interface JsonLink {
    url: string;
    description?: string;
}

interface JsonAttachment {
    name?: string;
    title?: string;
    url: string;
    type?: string;
}

interface JsonTimelineEvent {
    date: string;
    status: string;
    title: string;
    description?: string;
    attachments?: JsonAttachment[];
}

interface JsonOpinion {
    text: string;
    upvotes?: number;
    downvotes?: number;
}

interface JsonContentSection {
    id: string;
    label: string;
    text: string;
    version?: number;
    order: number;
    last_updated?: string;
    opinions?: JsonOpinion[];
}

interface JsonAuthor {
    name: string;
    email?: string;
}

interface JsonComment {
    id?: string;
    section_id?: string | null;
    is_anonymous?: boolean;
    author?: JsonAuthor | null;
    text: string;
    created_at?: string;
}

interface JsonAiAnalysis {
    sentiment?: number;
    takeaways?: string[];
    impact?: {
        economic?: string;
        social?: string;
        legal?: string;
        environmental?: string;
    };
    risks?: string[];
    conflicts?: string[];
}

interface JsonRelationship {
    id?: string;
    title: string;
    url?: string;
    context?: string;
}

interface JsonDocument {
    id?: number;
    registry_number: string;
    print_number?: number;
    term_number?: number;
    title: string;
    type?: string;
    level?: string;
    location?: string;
    status?: string;
    summary?: string;
    submitting_entity?: string;
    responsible_person?: JsonResponsiblePerson;
    created_at?: string;
    updated_at?: string;
    votes?: JsonVotes;
    tags?: string[];
    sectors?: string[];
    stakeholders?: string[];
    links?: JsonLink[];
    timeline?: JsonTimelineEvent[];
    content?: JsonContentSection[];
    comments?: JsonComment[];
    ai_analysis?: JsonAiAnalysis;
    relationships?: JsonRelationship[];
}

// ==================== MAPOWANIE TYPÓW ====================

function mapDocumentType(type?: string): DocumentType {
    const mapping: Record<string, DocumentType> = {
        'ustawa': DocumentType.USTAWA,
        'rozporządzenie': DocumentType.ROZPORZADZENIE,
        'rozporzadzenie': DocumentType.ROZPORZADZENIE,
        'uchwała': DocumentType.UCHWALA,
        'uchwala': DocumentType.UCHWALA,
        'obwieszczenie': DocumentType.OBWIESZCZENIE,
        'zarządzenie': DocumentType.ZARZADZENIE,
        'zarzadzenie': DocumentType.ZARZADZENIE,
        'dyrektywa': DocumentType.DYREKTYWA,
    };
    return mapping[type?.toLowerCase() ?? ''] ?? DocumentType.INNE;
}

function mapDocumentLevel(level?: string): DocumentLevel {
    const mapping: Record<string, DocumentLevel> = {
        'krajowy': DocumentLevel.KRAJOWY,
        'regionalny': DocumentLevel.REGIONALNY,
        'lokalny': DocumentLevel.LOKALNY,
        'ue': DocumentLevel.UE,
        'międzynarodowy': DocumentLevel.MIEDZYNARODOWY,
        'miedzynarodowy': DocumentLevel.MIEDZYNARODOWY,
    };
    return mapping[level?.toLowerCase() ?? ''] ?? DocumentLevel.KRAJOWY;
}

function mapDocumentStatus(status?: string): DocumentStatus {
    const mapping: Record<string, DocumentStatus> = {
        'draft': DocumentStatus.DRAFT,
        'sejm': DocumentStatus.SEJM,
        'senate': DocumentStatus.SENATE,
        'senat': DocumentStatus.SENATE,
        'president': DocumentStatus.PRESIDENT,
        'prezydent': DocumentStatus.PRESIDENT,
        'accepted': DocumentStatus.ACCEPTED,
        'rejected': DocumentStatus.REJECTED,
        'withdrawn': DocumentStatus.WITHDRAWN,
        'expired': DocumentStatus.EXPIRED,
    };
    return mapping[status?.toLowerCase() ?? ''] ?? DocumentStatus.DRAFT;
}

function mapTimelineStatus(status?: string): TimelineStatus {
    const mapping: Record<string, TimelineStatus> = {
        'draft': TimelineStatus.DRAFT,
        'sejm': TimelineStatus.SEJM,
        'senate': TimelineStatus.SENATE,
        'senat': TimelineStatus.SENATE,
        'president': TimelineStatus.PRESIDENT,
        'prezydent': TimelineStatus.PRESIDENT,
        'accepted': TimelineStatus.ACCEPTED,
        'rejected': TimelineStatus.REJECTED,
    };
    return mapping[status?.toLowerCase() ?? ''] ?? TimelineStatus.DRAFT;
}

// ==================== POMOCNICZE FUNKCJE ====================

async function getOrCreateTag(name: string) {
    return prisma.tag.upsert({
        where: { name },
        create: { name },
        update: {}
    });
}

async function getOrCreateSector(name: string) {
    return prisma.sector.upsert({
        where: { name },
        create: { name },
        update: {}
    });
}

async function getOrCreateStakeholder(name: string) {
    return prisma.stakeholder.upsert({
        where: { name },
        create: { name },
        update: {}
    });
}

// ==================== GŁÓWNA FUNKCJA SEED ====================

async function seedDocument(doc: JsonDocument) {
    console.log(`\n📄 Importing: ${doc.title}`);

    // 1. Tagi, sektory, interesariusze
    const tags = await Promise.all((doc.tags ?? []).map(t => getOrCreateTag(t)));
    const sectors = await Promise.all((doc.sectors ?? []).map(s => getOrCreateSector(s)));
    const stakeholders = await Promise.all((doc.stakeholders ?? []).map(s => getOrCreateStakeholder(s)));

    // 2. Dokument główny
    const document = await prisma.legalDocument.create({
        data: {
            externalId: doc.id,
            registryNumber: doc.registry_number,
            printNumber: doc.print_number,
            termNumber: doc.term_number,
            title: doc.title,
            type: mapDocumentType(doc.type),
            level: mapDocumentLevel(doc.level),
            location: doc.location ?? 'Polska',
            status: mapDocumentStatus(doc.status),
            summary: doc.summary,
            submittingEntity: doc.submitting_entity,
            createdAt: doc.created_at ? new Date(doc.created_at) : undefined,
            updatedAt: doc.updated_at ? new Date(doc.updated_at) : undefined,
            tags: { connect: tags.map(t => ({ id: t.id })) },
            sectors: { connect: sectors.map(s => ({ id: s.id })) },
            stakeholders: { connect: stakeholders.map(s => ({ id: s.id })) },
        }
    });
    console.log(`   ✅ Document ID: ${document.id}`);

    // 3. Osoba odpowiedzialna
    if (doc.responsible_person) {
        await prisma.responsiblePerson.create({
            data: {
                name: doc.responsible_person.name,
                role: doc.responsible_person.role,
                email: doc.responsible_person.email,
                documentId: document.id
            }
        });
        console.log(`   ✅ Responsible person: ${doc.responsible_person.name}`);
    }

    // 4. Głosy
    if (doc.votes) {
        await prisma.votes.create({
            data: {
                up: doc.votes.up,
                down: doc.votes.down,
                documentId: document.id
            }
        });
        console.log(`   ✅ Votes: ${doc.votes.up}↑ ${doc.votes.down}↓`);
    }

    // 5. Linki
    if (doc.links?.length) {
        await prisma.link.createMany({
            data: doc.links.map(link => ({
                url: link.url,
                description: link.description,
                documentId: document.id
            }))
        });
        console.log(`   ✅ Links: ${doc.links.length}`);
    }

    // 6. Timeline
    if (doc.timeline?.length) {
        for (const event of doc.timeline) {
            const timelineEvent = await prisma.timelineEvent.create({
                data: {
                    date: new Date(event.date),
                    status: mapTimelineStatus(event.status),
                    title: event.title,
                    description: event.description,
                    documentId: document.id
                }
            });

            if (event.attachments?.length) {
                await prisma.attachment.createMany({
                    data: event.attachments.map(att => ({
                        name: att.name ?? att.title ?? 'Załącznik',
                        title: att.title,
                        url: att.url,
                        type: att.type ?? 'pdf',
                        timelineEventId: timelineEvent.id
                    }))
                });
            }
        }
        console.log(`   ✅ Timeline events: ${doc.timeline.length}`);
    }

    // 7. Content (artykuły)
    const sectionMap = new Map<string, number>();
    if (doc.content?.length) {
        for (const section of doc.content) {
            const contentSection = await prisma.contentSection.create({
                data: {
                    externalId: section.id,
                    label: section.label,
                    text: section.text,
                    version: section.version ?? 1,
                    order: section.order,
                    lastUpdated: section.last_updated ? new Date(section.last_updated) : undefined,
                    documentId: document.id
                }
            });
            sectionMap.set(section.id, contentSection.id);

            if (section.opinions?.length) {
                await prisma.opinion.createMany({
                    data: section.opinions.map(op => ({
                        text: op.text,
                        upvotes: op.upvotes ?? 0,
                        downvotes: op.downvotes ?? 0,
                        sectionId: contentSection.id
                    }))
                });
            }
        }
        console.log(`   ✅ Content sections: ${doc.content.length}`);
    }

    // 8. Komentarze
    if (doc.comments?.length) {
        for (const comment of doc.comments) {
            await prisma.comment.create({
                data: {
                    externalId: comment.id,
                    text: comment.text,
                    isAnonymous: comment.is_anonymous ?? false,
                    authorName: comment.author?.name,
                    authorEmail: comment.author?.email,
                    createdAt: comment.created_at ? new Date(comment.created_at) : undefined,
                    documentId: document.id,
                    sectionId: comment.section_id ? sectionMap.get(comment.section_id) : null
                }
            });
        }
        console.log(`   ✅ Comments: ${doc.comments.length}`);
    }

    // 9. Analiza AI
    if (doc.ai_analysis) {
        const analysis = await prisma.aiAnalysis.create({
            data: {
                sentiment: doc.ai_analysis.sentiment ?? 0,
                documentId: document.id
            }
        });

        if (doc.ai_analysis.takeaways?.length) {
            await prisma.aiTakeaway.createMany({
                data: doc.ai_analysis.takeaways.map(t => ({
                    text: t,
                    analysisId: analysis.id
                }))
            });
        }

        if (doc.ai_analysis.impact) {
            const impacts = Object.entries(doc.ai_analysis.impact)
                .filter(([_, desc]) => desc)
                .map(([category, description]) => ({
                    category,
                    description: description!,
                    analysisId: analysis.id
                }));
            if (impacts.length) {
                await prisma.aiImpact.createMany({ data: impacts });
            }
        }

        if (doc.ai_analysis.risks?.length) {
            await prisma.aiRisk.createMany({
                data: doc.ai_analysis.risks.map(r => ({
                    description: r,
                    analysisId: analysis.id
                }))
            });
        }

        if (doc.ai_analysis.conflicts?.length) {
            await prisma.aiConflict.createMany({
                data: doc.ai_analysis.conflicts.map(c => ({
                    description: c,
                    analysisId: analysis.id
                }))
            });
        }
        console.log(`   ✅ AI Analysis`);
    }

    // 10. Relacje
    if (doc.relationships?.length) {
        await prisma.documentRelation.createMany({
            data: doc.relationships.map(rel => ({
                title: rel.title,
                url: rel.url,
                context: rel.context,
                externalDocumentId: rel.id,
                fromDocumentId: document.id
            }))
        });
        console.log(`   ✅ Relationships: ${doc.relationships.length}`);
    }

    return document;
}

// ==================== MAIN ====================

async function main() {
    console.log('🌱 Starting database seed...');
    console.log('━'.repeat(50));

    const dataPath = path.join(__dirname, '..', 'dane.json');

    if (!fs.existsSync(dataPath)) {
        console.log('⚠️  File dane.json not found');
        return;
    }

    const rawData = fs.readFileSync(dataPath, 'utf-8');
    const documents: JsonDocument[] = JSON.parse(rawData);

    console.log(`📚 Found ${documents.length} document(s) to import`);

    for (const doc of documents) {
        await seedDocument(doc);
    }

    console.log('\n' + '━'.repeat(50));
    console.log('✅ Seed completed successfully!');

    // Podsumowanie
    const stats = await prisma.$transaction([
        prisma.legalDocument.count(),
        prisma.tag.count(),
        prisma.sector.count(),
        prisma.stakeholder.count(),
        prisma.comment.count()
    ]);

    console.log(`\n📊 Database stats:`);
    console.log(`   Documents: ${stats[0]}`);
    console.log(`   Tags: ${stats[1]}`);
    console.log(`   Sectors: ${stats[2]}`);
    console.log(`   Stakeholders: ${stats[3]}`);
    console.log(`   Comments: ${stats[4]}`);
}

main()
    .catch((e) => {
        console.error('❌ Seed failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

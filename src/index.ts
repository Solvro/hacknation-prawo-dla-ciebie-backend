import express from 'express';
import cors from 'cors';
import { prisma } from './lib/prisma';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==================== SYNCHRONIZACJA ====================

// Ręczne wywołanie pełnej synchronizacji (gov.pl + RCL)
// app.post('/api/sync/trigger', async (req, res) => {
//     try {
//         console.log('📡 Manual full sync triggered via API');
//         const result = await triggerSync();
//         res.json({
//             message: 'Full synchronization completed (gov.pl + RCL)',
//             result
//         });
//     } catch (error) {
//         console.error('Error triggering sync:', error);
//         res.status(500).json({ error: 'Failed to trigger synchronization' });
//     }
// });

// Ręczne wywołanie synchronizacji tylko RCL
// app.post('/api/sync/rcl', async (req, res) => {
//     try {
//         console.log('📜 Manual RCL sync triggered via API');
//         const result = await triggerRclSync();
//         res.json({
//             message: 'RCL synchronization completed',
//             result
//         });
//     } catch (error) {
//         console.error('Error triggering RCL sync:', error);
//         res.status(500).json({ error: 'Failed to trigger RCL synchronization' });
//     }
// });

// // Status schedulera
// app.get('/api/sync/status', (req, res) => {
//     const status = getSchedulerStatus();
//     res.json(status);
// });

// ==================== DOKUMENTY ====================

// Pobierz wszystkie dokumenty
app.get('/api/documents', async (req, res) => {
    try {
        const documents = await prisma.legalDocument.findMany({
            include: {
                responsiblePerson: true,
                votes: true,
                tags: true,
                sectors: true,
                stakeholders: true,
                links: true,
                timeline: {
                    include: { attachments: true },
                    orderBy: { date: 'asc' }
                },
                content: {
                    include: { opinions: true },
                    orderBy: { order: 'asc' }
                },
                comments: true,
                aiAnalysis: {
                    include: {
                        takeaways: true,
                        impacts: true,
                        risks: true,
                        conflicts: true
                    }
                },
                relatedFrom: true
            },
            orderBy: { updatedAt: 'desc' }
        });
        res.json(documents);
    } catch (error) {
        console.error('Error fetching documents:', error);
        res.status(500).json({ error: 'Failed to fetch documents' });
    }
});

// Pobierz pojedynczy dokument
app.get('/api/documents/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const document = await prisma.legalDocument.findUnique({
            where: { id },
            include: {
                responsiblePerson: true,
                votes: true,
                tags: true,
                sectors: true,
                stakeholders: true,
                links: true,
                timeline: {
                    include: { attachments: true },
                    orderBy: { date: 'asc' }
                },
                content: {
                    include: { opinions: true, comments: true },
                    orderBy: { order: 'asc' }
                },
                comments: true,
                aiAnalysis: {
                    include: {
                        takeaways: true,
                        impacts: true,
                        risks: true,
                        conflicts: true
                    }
                },
                relatedFrom: true
            }
        });

        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }

        res.json(document);
    } catch (error) {
        console.error('Error fetching document:', error);
        res.status(500).json({ error: 'Failed to fetch document' });
    }
});

// Wyszukiwanie dokumentów
app.get('/api/search', async (req, res) => {
    try {
        const { q, status, type, tag, sector } = req.query;

        const documents = await prisma.legalDocument.findMany({
            where: {
                AND: [
                    q ? {
                        OR: [
                            { title: { contains: q as string, mode: 'insensitive' } },
                            { summary: { contains: q as string, mode: 'insensitive' } }
                        ]
                    } : {},
                    status ? { status: status as any } : {},
                    type ? { type: type as any } : {},
                    tag ? { tags: { some: { name: tag as string } } } : {},
                    sector ? { sectors: { some: { name: sector as string } } } : {}
                ]
            },
            include: {
                tags: true,
                sectors: true,
                votes: true,
                responsiblePerson: true
            },
            orderBy: { updatedAt: 'desc' }
        });

        res.json(documents);
    } catch (error) {
        console.error('Error searching documents:', error);
        res.status(500).json({ error: 'Failed to search documents' });
    }
});

// ==================== GŁOSOWANIE ====================

// Głosuj na dokument
app.post('/api/documents/:id/vote', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { type } = req.body; // 'up' lub 'down'

        if (!['up', 'down'].includes(type)) {
            return res.status(400).json({ error: 'Invalid vote type. Use "up" or "down"' });
        }

        const votes = await prisma.votes.upsert({
            where: { documentId: id },
            create: {
                documentId: id,
                up: type === 'up' ? 1 : 0,
                down: type === 'down' ? 1 : 0
            },
            update: {
                [type]: { increment: 1 }
            }
        });

        res.json(votes);
    } catch (error) {
        console.error('Error voting:', error);
        res.status(500).json({ error: 'Failed to vote' });
    }
});

// Głosuj na opinię
app.post('/api/opinions/:id/vote', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { type } = req.body;

        if (!['up', 'down'].includes(type)) {
            return res.status(400).json({ error: 'Invalid vote type' });
        }

        const field = type === 'up' ? 'upvotes' : 'downvotes';
        const opinion = await prisma.opinion.update({
            where: { id },
            data: { [field]: { increment: 1 } }
        });

        res.json(opinion);
    } catch (error) {
        console.error('Error voting on opinion:', error);
        res.status(500).json({ error: 'Failed to vote' });
    }
});

// ==================== KOMENTARZE ====================

// Dodaj komentarz do dokumentu
app.post('/api/documents/:id/comments', async (req, res) => {
    try {
        const documentId = parseInt(req.params.id);
        const { text, sectionExternalId, isAnonymous, authorName, authorEmail } = req.body;

        if (!text || text.trim() === '') {
            return res.status(400).json({ error: 'Comment text is required' });
        }

        // Znajdź sekcję jeśli podano
        let sectionId: number | null = null;
        if (sectionExternalId) {
            const section = await prisma.contentSection.findFirst({
                where: { documentId, externalId: sectionExternalId }
            });
            if (section) {
                sectionId = section.id;
            }
        }

        const comment = await prisma.comment.create({
            data: {
                text: text.trim(),
                documentId,
                sectionId,
                isAnonymous: isAnonymous ?? false,
                authorName: isAnonymous ? null : authorName,
                authorEmail: isAnonymous ? null : authorEmail
            }
        });

        res.status(201).json(comment);
    } catch (error) {
        console.error('Error creating comment:', error);
        res.status(500).json({ error: 'Failed to create comment' });
    }
});

// Pobierz komentarze dokumentu
app.get('/api/documents/:id/comments', async (req, res) => {
    try {
        const documentId = parseInt(req.params.id);

        const comments = await prisma.comment.findMany({
            where: { documentId },
            include: { section: true },
            orderBy: { createdAt: 'desc' }
        });

        res.json(comments);
    } catch (error) {
        console.error('Error fetching comments:', error);
        res.status(500).json({ error: 'Failed to fetch comments' });
    }
});

// ==================== TAGI I FILTRY ====================

// Pobierz wszystkie tagi
app.get('/api/tags', async (req, res) => {
    try {
        const tags = await prisma.tag.findMany({
            include: {
                _count: { select: { documents: true } }
            },
            orderBy: { name: 'asc' }
        });
        res.json(tags);
    } catch (error) {
        console.error('Error fetching tags:', error);
        res.status(500).json({ error: 'Failed to fetch tags' });
    }
});

// Pobierz wszystkie sektory
app.get('/api/sectors', async (req, res) => {
    try {
        const sectors = await prisma.sector.findMany({
            include: {
                _count: { select: { documents: true } }
            },
            orderBy: { name: 'asc' }
        });
        res.json(sectors);
    } catch (error) {
        console.error('Error fetching sectors:', error);
        res.status(500).json({ error: 'Failed to fetch sectors' });
    }
});

// Pobierz wszystkich interesariuszy
app.get('/api/stakeholders', async (req, res) => {
    try {
        const stakeholders = await prisma.stakeholder.findMany({
            include: {
                _count: { select: { documents: true } }
            },
            orderBy: { name: 'asc' }
        });
        res.json(stakeholders);
    } catch (error) {
        console.error('Error fetching stakeholders:', error);
        res.status(500).json({ error: 'Failed to fetch stakeholders' });
    }
});

// ==================== STATYSTYKI ====================

// ==================== NOWE ENDPOINTY V2 (TYP "LAWMATE") ====================

// Endpoint 1: Lista uchwał (lekki, filtrowanie, sortowanie)
app.get('/api/v2/documents', async (req, res) => {
    try {
        const {
            level, // 'KRAJOWY' | 'LOKALNY'
            preconsultations, // 'true' | 'false'
            sort, // 'last_change' | 'created' | 'likes'
            tags, // comma separated
            search, // text search
            page = '1',
            limit = '20'
        } = req.query;

        const pageNum = Math.max(1, parseInt(page as string) || 1);
        const limitNum = Math.max(1, Math.min(100, parseInt(limit as string) || 20)); // Max 100 items per page
        const skip = (pageNum - 1) * limitNum;

        // 1. Budowanie filtrów (where)
        const where: any = {};

        // Level
        if (level) {
            where.level = level;
        }

        // Preconsultations (Prekonsultacje)
        // Zakładamy, że "prekonsultacje" to etap przed pracami w parlamencie, czyli np. PLANOWANY lub KONSULTACJE
        if (preconsultations === 'true') {
            where.status = { in: ['PLANOWANY', 'KONSULTACJE'] };
        } else if (preconsultations === 'false') {
            // Faza prac legislacyjnych lub zakończone
            where.status = { notIn: ['PLANOWANY', 'KONSULTACJE'] };
        }

        // Tagi
        if (tags) {
            const tagList = (tags as string).split(',').map(t => t.trim());
            if (tagList.length > 0) {
                where.tags = {
                    some: {
                        name: { in: tagList, mode: 'insensitive' }
                    }
                };
            }
        }

        // Search (szukanie po tytule, opisie, autorze, treści)
        if (search) {
            const searchStr = search as string;
            where.OR = [
                { title: { contains: searchStr, mode: 'insensitive' } },
                { summary: { contains: searchStr, mode: 'insensitive' } },
                { status: { contains: searchStr, mode: 'insensitive' } as any },
                { responsiblePerson: { name: { contains: searchStr, mode: 'insensitive' } } }
            ];
        }

        // Liczymy całkowitą ilość pasujących dokumentów (dla meta-danych)
        const totalCount = await prisma.legalDocument.count({ where });

        // 2. Sortowanie i Pobieranie danych
        let items: any[] = [];
        let orderBy: any = undefined;

        if (sort === 'created') {
            orderBy = { createdAt: 'desc' };
        } else if (sort === 'last_change' || !sort) {
            orderBy = { updatedAt: 'desc' };
        }
        // Jeśli sort === 'likes', orderBy zostaje undefined, pobierzemy wszystko i posortujemy w RAMie

        if (sort === 'likes') {
            // Strategia dla 'likes': Pobierz wszystko (pasujące do filtrów), posortuj w pamięci, wytnij stronę
            // Uwaga: Przy bardzo dużej bazie to będzie niewydajne. W przyszłości dodać indeks/pole 'upvotesCount'.
            const allDocuments = await prisma.legalDocument.findMany({
                where,
                select: {
                    id: true,
                    title: true,
                    summary: true,
                    status: true,
                    createdAt: true,
                    updatedAt: true,
                    votes: { select: { up: true, down: true } },
                    tags: { select: { name: true } },
                    timeline: {
                        select: { title: true, date: true },
                        orderBy: { date: 'asc' }
                    },
                    links: { select: { url: true, description: true } }
                }
            });

            // Post-processing i sortowanie
            const mapped = allDocuments.map(doc => ({
                id: doc.id,
                title: doc.title,
                summary: doc.summary,
                status: doc.status,
                createdAt: doc.createdAt,
                lastChange: doc.updatedAt,
                upvotes: doc.votes?.up || 0,
                downvotes: doc.votes?.down || 0,
                tags: doc.tags.map(t => t.name),
                schedules: doc.timeline.map(t => ({ title: t.title, date: t.date })),
                links: doc.links
            }));

            mapped.sort((a, b) => b.upvotes - a.upvotes);

            // Paginacja w pamięci
            items = mapped.slice(skip, skip + limitNum);

        } else {
            // Standardowa strategia DB pagination
            const documents = await prisma.legalDocument.findMany({
                where,
                orderBy: orderBy,
                skip: skip,
                take: limitNum,
                select: {
                    id: true,
                    title: true,
                    summary: true,
                    status: true,
                    createdAt: true,
                    updatedAt: true,
                    votes: { select: { up: true, down: true } },
                    tags: { select: { name: true } },
                    timeline: {
                        select: { title: true, date: true },
                        orderBy: { date: 'asc' }
                    },
                    links: { select: { url: true, description: true } }
                }
            });

            items = documents.map(doc => ({
                id: doc.id,
                title: doc.title,
                summary: doc.summary,
                status: doc.status,
                createdAt: doc.createdAt,
                lastChange: doc.updatedAt,
                upvotes: doc.votes?.up || 0,
                downvotes: doc.votes?.down || 0,
                tags: doc.tags.map(t => t.name),
                schedules: doc.timeline.map(t => ({ title: t.title, date: t.date })),
                links: doc.links
            }));
        }

        // 3. Budowanie odpowiedzi
        const totalPages = Math.ceil(totalCount / limitNum);

        res.json({
            data: items,
            meta: {
                total: totalCount,
                page: pageNum,
                limit: limitNum,
                totalPages: totalPages
            }
        });

    } catch (error) {
        console.error('Error in V2 documents endpoint:', error);
        res.status(500).json({ error: 'Failed to fetch documents V2' });
    }
});

// Endpoint 2: Szczegóły dokumentu (Full Info)
app.get('/api/v2/documents/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const document = await prisma.legalDocument.findUnique({
            where: { id },
            include: {
                responsiblePerson: true,
                votes: true,
                tags: true,
                sectors: true,
                stakeholders: true,
                links: true,
                timeline: {
                    include: { attachments: true },
                    orderBy: { date: 'asc' }
                },
                content: {
                    include: { opinions: true, comments: { include: { section: true } } },
                    orderBy: { order: 'asc' }
                },
                comments: {
                    include: { section: true },
                    orderBy: { createdAt: 'desc' }
                },
                aiAnalysis: {
                    include: {
                        takeaways: true,
                        impacts: true,
                        risks: true,
                        conflicts: true
                    }
                },
                relatedFrom: true,
                relatedTo: true,
                parliamentVotings: {
                    include: {
                        clubVotes: true
                    },
                    orderBy: { date: 'desc' }
                }
            }
        });

        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }

        res.json(document);
    } catch (error) {
        console.error('Error fetching document detail V2:', error);
        res.status(500).json({ error: 'Failed to fetch document V2' });
    }
});

app.get('/api/stats', async (req, res) => {
    try {
        const [
            totalDocuments,
            documentsByStatus,
            documentsByType,
            totalComments,
            totalTags
        ] = await Promise.all([
            prisma.legalDocument.count(),
            prisma.legalDocument.groupBy({
                by: ['status'],
                _count: { status: true }
            }),
            prisma.legalDocument.groupBy({
                by: ['type'],
                _count: { type: true }
            }),
            prisma.comment.count(),
            prisma.tag.count()
        ]);

        res.json({
            totalDocuments,
            documentsByStatus: documentsByStatus.reduce((acc, item) => {
                acc[item.status] = item._count.status;
                return acc;
            }, {} as Record<string, number>),
            documentsByType: documentsByType.reduce((acc, item) => {
                acc[item.type] = item._count.type;
                return acc;
            }, {} as Record<string, number>),
            totalComments,
            totalTags
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Prawo dla Ciebie API`);
    console.log(`   Server running on http://localhost:${PORT}`);
    console.log(`\n📡 Endpoints:`);
    console.log(`   GET  /health`);
    console.log(`   GET  /api/documents`);
    console.log(`   GET  /api/documents/:id`);
    console.log(`   GET  /api/search?q=...&status=...&type=...&tag=...`);
    console.log(`   POST /api/documents/:id/vote`);
    console.log(`   POST /api/documents/:id/comments`);
    console.log(`   GET  /api/documents/:id/comments`);
    console.log(`   POST /api/opinions/:id/vote`);
    console.log(`   GET  /api/tags`);
    console.log(`   GET  /api/sectors`);
    console.log(`   GET  /api/stakeholders`);
    console.log(`   GET  /api/stats`);
    console.log(`   POST /api/sync/trigger`);
    console.log(`   GET  /api/sync/status\n`);

    // Uruchom scheduler synchronizacji z gov.pl
    // if (process.env.NODE_ENV !== 'test') {
    // startScheduler();
    // }
});

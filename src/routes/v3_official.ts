import express, { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { DocumentStatus, DocumentType, DocumentLevel } from '@prisma/client';
import { officialAuthMiddleware } from '../middleware/auth';

const router = express.Router();

// Apply Authentication Middleware to all routes in this router
router.use(officialAuthMiddleware);

/**
 * @swagger
 * tags:
 *   name: Official V3
 *   description: Endpoints for official clerks (Urzędnik) to manage legal documents. Protected by Bearer Token.
 * components:
 *   securitySchemes:
 *     BearerAuth:
 *       type: http
 *       scheme: bearer
 * security:
 *   - BearerAuth: []
 */

/**
 * @swagger
 * /api/v3/official/documents:
 *   get:
 *     summary: Get list of documents (simplified official view)
 *     tags: [Official V3]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of documents
 */
router.get('/documents', async (req: Request, res: Response) => {
    try {
        const { status, type, search } = req.query;

        const where: any = {};
        if (status) where.status = status;
        if (type) where.type = type;
        if (search) {
            where.OR = [
                { title: { contains: String(search), mode: 'insensitive' } },
                { registryNumber: { contains: String(search), mode: 'insensitive' } }
            ];
        }

        const documents = await prisma.legalDocument.findMany({
            where,
            select: {
                id: true,
                externalId: true,
                registryNumber: true,
                title: true,
                type: true,
                status: true,
                updatedAt: true
            },
            orderBy: { updatedAt: 'desc' },
            take: 50
        });

        res.json(documents);
    } catch (error) {
        console.error('Error fetching official documents list:', error);
        res.status(500).json({ error: 'Failed to fetch documents' });
    }
});

/**
 * @swagger
 * /api/v3/official/documents/{id}:
 *   get:
 *     summary: Get document details (simplified official view)
 *     tags: [Official V3]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Document details
 *       404:
 *         description: Document not found
 */
router.get('/documents/:id', async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const document = await prisma.legalDocument.findUnique({
            where: { id },
            select: {
                id: true,
                registryNumber: true,
                title: true,
                type: true,
                level: true,
                status: true,
                summary: true,
                createdAt: true,
                updatedAt: true,
                // Include management related relations
                timeline: { orderBy: { date: 'asc' } },
                links: true,
                // Using count to show activity without dumping data
                _count: {
                    select: {
                        comments: true,
                        votes: true
                    }
                }
            }
        });

        if (!document) return res.status(404).json({ error: 'Document not found' });
        res.json(document);
    } catch (error) {
        console.error('Error fetching document details:', error);
        res.status(500).json({ error: 'Failed to fetch document' });
    }
});

/**
 * @swagger
 * /api/v3/official/documents:
 *   post:
 *     summary: Create a new legal document manually
 *     tags: [Official V3]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title:
 *                 type: string
 *               summary:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [USTAWA, ROZPORZADZENIE, UCHWALA, OBWIESZCZENIE, ZARZADZENIE, DYREKTYWA, INNE]
 *               status:
 *                 type: string
 *                 enum: [DRAFT, SEJM, SENATE, PRESIDENT, ACCEPTED, REJECTED, WITHDRAWN, EXPIRED]
 *               level:
 *                 type: string
 *                 enum: [KRAJOWY, REGIONALNY, LOKALNY, UE, MIEDZYNARODOWY]
 *               registryNumber:
 *                 type: string
 *     responses:
 *       201:
 *         description: Document created
 *       500:
 *         description: Server error
 */
router.post('/documents', async (req: Request, res: Response) => {
    try {
        const { title, summary, type, status, level, registryNumber } = req.body;

        if (!title) {
            return res.status(400).json({ error: 'Title is required' });
        }

        const newDoc = await prisma.legalDocument.create({
            data: {
                title,
                summary,
                type: (type as DocumentType) || DocumentType.INNE,
                status: (status as DocumentStatus) || DocumentStatus.DRAFT,
                level: (level as DocumentLevel) || DocumentLevel.KRAJOWY,
                registryNumber: registryNumber || `MANUAL-${Date.now()}`,
                location: 'Polska'
            }
        });

        res.status(201).json(newDoc);
    } catch (error) {
        console.error('Error creating document:', error);
        res.status(500).json({ error: 'Failed to create document' });
    }
});

/**
 * @swagger
 * /api/v3/official/documents/{id}:
 *   put:
 *     summary: Update an existing legal document
 *     tags: [Official V3]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               summary:
 *                 type: string
 *               type:
 *                 type: string
 *               level:
 *                 type: string
 *     responses:
 *       200:
 *         description: Document updated
 *       404:
 *         description: Document not found
 */
router.put('/documents/:id', async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const { title, summary, type, level } = req.body;

        const updatedDoc = await prisma.legalDocument.update({
            where: { id },
            data: {
                title,
                summary,
                type: type ? (type as DocumentType) : undefined,
                level: level ? (level as DocumentLevel) : undefined
            }
        });

        res.json(updatedDoc);
    } catch (error) {
        console.error('Error updating document:', error);
        // Prisma throws specific error if record not found, but generic 500 is okay for MVP
        res.status(500).json({ error: 'Failed to update document or not found' });
    }
});

/**
 * @swagger
 * /api/v3/official/documents/{id}/status:
 *   patch:
 *     summary: Change status of a document
 *     tags: [Official V3]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [DRAFT, SEJM, SENATE, PRESIDENT, ACCEPTED, REJECTED, WITHDRAWN, EXPIRED]
 *     responses:
 *       200:
 *         description: Status updated
 *       400:
 *         description: Invalid status
 */
router.patch('/documents/:id/status', async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const { status } = req.body;

        if (!status) return res.status(400).json({ error: 'Status is required' });

        // Ensure status is valid enum (runtime check)
        const validStatuses = Object.keys(DocumentStatus);
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Allowed: ${validStatuses.join(', ')}` });
        }

        const updated = await prisma.legalDocument.update({
            where: { id },
            data: { status: status as DocumentStatus }
        });

        res.json(updated);
    } catch (error) {
        console.error('Error updating status:', error);
        res.status(500).json({ error: 'Failed to update status' });
    }
});

/**
 * @swagger
 * /api/v3/official/documents/{id}:
 *   delete:
 *     summary: Soft delete (withdraw) or hard delete a document
 *     description: By default performs soft delete (sets status to WITHDRAWN). Pass ?hard=true for permanent delete.
 *     tags: [Official V3]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: hard
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Document processed
 */
router.delete('/documents/:id', async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const hardDelete = req.query.hard === 'true';

        if (hardDelete) {
            await prisma.legalDocument.delete({ where: { id } });
            return res.json({ message: 'Document permanently deleted' });
        } else {
            const updated = await prisma.legalDocument.update({
                where: { id },
                data: { status: DocumentStatus.WITHDRAWN }
            });
            return res.json({ message: 'Document withdrawn (soft delete)', document: updated });
        }
    } catch (error) {
        console.error('Error deleting document:', error);
        res.status(500).json({ error: 'Failed to delete document' });
    }
});

// ==================== TIMELINE MANAGEMENT ====================

/**
 * @swagger
 * /api/v3/official/documents/{id}/timeline:
 *   post:
 *     summary: Add a timeline event to a document
 *     tags: [Official V3]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, date, status]
 *             properties:
 *               title:
 *                 type: string
 *               date:
 *                 type: string
 *                 format: date-time
 *               status:
 *                 type: string
 *                 enum: [DRAFT, SEJM, SENATE, PRESIDENT, ACCEPTED, REJECTED]
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Event created
 */
router.post('/documents/:id/timeline', async (req: Request, res: Response) => {
    try {
        const documentId = parseInt(req.params.id);
        const { title, date, status, description } = req.body;

        if (!title || !date || !status) {
            return res.status(400).json({ error: 'Title, date, and status are required' });
        }

        const event = await prisma.timelineEvent.create({
            data: {
                title,
                date: new Date(date),
                status: status, // Assuming valid enum passed or TS will error/Prisma will throw
                description,
                documentId
            }
        });
        res.status(201).json(event);
    } catch (error) {
        console.error('Error creating timeline event:', error);
        res.status(500).json({ error: 'Failed to create timeline event' });
    }
});

/**
 * @swagger
 * /api/v3/official/timeline/{id}:
 *   put:
 *     summary: Update a timeline event
 *     tags: [Official V3]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               date:
 *                 type: string
 *                 format: date-time
 *               status:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Event updated
 */
router.put('/timeline/:id', async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const { title, date, status, description } = req.body;

        const event = await prisma.timelineEvent.update({
            where: { id },
            data: {
                title,
                date: date ? new Date(date) : undefined,
                status,
                description
            }
        });
        res.json(event);
    } catch (error) {
        console.error('Error updating timeline event:', error);
        res.status(500).json({ error: 'Failed to update timeline event' });
    }
});

/**
 * @swagger
 * /api/v3/official/timeline/{id}:
 *   delete:
 *     summary: Delete a timeline event
 *     tags: [Official V3]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Event deleted
 */
router.delete('/timeline/:id', async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        await prisma.timelineEvent.delete({ where: { id } });
        res.json({ message: 'Timeline event deleted' });
    } catch (error) {
        console.error('Error deleting timeline event:', error);
        res.status(500).json({ error: 'Failed to delete timeline event' });
    }
});

// ==================== LINKS MANAGEMENT ====================

/**
 * @swagger
 * /api/v3/official/documents/{id}/links:
 *   post:
 *     summary: Add a link to a document
 *     tags: [Official V3]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url]
 *             properties:
 *               url:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Link created
 */
router.post('/documents/:id/links', async (req: Request, res: Response) => {
    try {
        const documentId = parseInt(req.params.id);
        const { url, description } = req.body;

        if (!url) return res.status(400).json({ error: 'URL is required' });

        const link = await prisma.link.create({
            data: { url, description, documentId }
        });
        res.status(201).json(link);
    } catch (error) {
        console.error('Error creating link:', error);
        res.status(500).json({ error: 'Failed to create link' });
    }
});

/**
 * @swagger
 * /api/v3/official/links/{id}:
 *   put:
 *     summary: Update a link
 *     tags: [Official V3]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               url:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Link updated
 */
router.put('/links/:id', async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const { url, description } = req.body;

        const link = await prisma.link.update({
            where: { id },
            data: { url, description }
        });
        res.json(link);
    } catch (error) {
        console.error('Error updating link:', error);
        res.status(500).json({ error: 'Failed to update link' });
    }
});

/**
 * @swagger
 * /api/v3/official/links/{id}:
 *   delete:
 *     summary: Delete a link
 *     tags: [Official V3]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Link deleted
 */
router.delete('/links/:id', async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        await prisma.link.delete({ where: { id } });
        res.json({ message: 'Link deleted' });
    } catch (error) {
        console.error('Error deleting link:', error);
        res.status(500).json({ error: 'Failed to delete link' });
    }
});

// ==================== COMMENTS MANAGEMENT (MODERATION) ====================

/**
 * @swagger
 * /api/v3/official/comments:
 *   get:
 *     summary: Get all comments (moderation view)
 *     tags: [Official V3]
 *     parameters:
 *       - in: query
 *         name: documentId
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of comments
 */
router.get('/comments', async (req: Request, res: Response) => {
    try {
        const documentId = req.query.documentId ? parseInt(req.query.documentId as string) : undefined;

        const comments = await prisma.comment.findMany({
            where: documentId ? { documentId } : {},
            orderBy: { createdAt: 'desc' },
            include: { document: { select: { title: true } } }
        });
        res.json(comments);
    } catch (error) {
        console.error('Error fetching comments:', error);
        res.status(500).json({ error: 'Failed to fetch comments' });
    }
});

/**
 * @swagger
 * /api/v3/official/comments/{id}:
 *   delete:
 *     summary: Delete a comment (moderation)
 *     tags: [Official V3]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Comment deleted
 */
router.delete('/comments/:id', async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        await prisma.comment.delete({ where: { id } });
        res.json({ message: 'Comment deleted' });
    } catch (error) {
        console.error('Error deleting comment:', error);
        res.status(500).json({ error: 'Failed to delete comment' });
    }
});

export default router;

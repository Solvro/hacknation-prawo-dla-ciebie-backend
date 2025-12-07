import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearDatabase() {
    console.log('🗑️ Cleaning database...');

    try {
        // Delete all LegalDocuments.
        // Due to Cascade deletes in schema, this should remove:
        // - ResponsiblePerson
        // - Votes
        // - Links
        // - TimelineEvent -> Attachments
        // - ContentSection -> Opinions
        // - Comments
        // - AiAnalysis -> Takeaways, Impacts, Risks, Conflicts
        // - DocumentRelation (from)
        // - ParliamentVoting -> ClubVote

        const deleteDocs = await prisma.legalDocument.deleteMany({});
        console.log(`Deleted ${deleteDocs.count} legal documents.`);

        // Clean dictionaries if needed
        const deleteTags = await prisma.tag.deleteMany({});
        console.log(`Deleted ${deleteTags.count} tags.`);

        const deleteSectors = await prisma.sector.deleteMany({});
        console.log(`Deleted ${deleteSectors.count} sectors.`);

        const deleteStakeholders = await prisma.stakeholder.deleteMany({});
        console.log(`Deleted ${deleteStakeholders.count} stakeholders.`);

        console.log('✅ Database cleared successfully.');
    } catch (error) {
        console.error('❌ Error clearing database:', error);
    } finally {
        await prisma.$disconnect();
    }
}

clearDatabase();


import 'dotenv/config';
import OpenAI from 'openai';
const pdf = require('pdf-parse');
import { prisma } from '../lib/prisma';
import { DocumentRelation, LegalDocument } from '@prisma/client';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Interfejsy dla struktury zwracanej przez AI
interface AiAnalysisResult {
    summary: string;
    tags: string[];
    sectors: string[];
    stakeholders: string[];
    sentiment: number; // -1 do 1
    conclusions: string[];
    impact: {
        economic: string;
        social: string;
        legal: string;
    };
    risks: string[];
    conflicts: string[];
    relatedLaws: {
        title: string;
        context: string;
    }[];
}

async function extractTextFromPdf(url: string): Promise<string> {
    try {
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        const data = await pdf(Buffer.from(buffer));
        return data.text;
    } catch (error) {
        console.error(`Error extracting text from PDF ${url}:`, error);
        return "";
    }
}

function parseContentSections(text: string): { label: string, text: string }[] {
    const sections: { label: string, text: string }[] = [];

    // Normalize newlines
    const cleanText = text.replace(/\r\n/g, '\n').replace(/\n\s*\n/g, '\n\n');

    // Split by Art. or § at start of line (or preceded by newline)
    // Regex: lookahead for newline followed by Art. number or § number
    const splitRegex = /(?=\n(?:Art\.|§)\s*\d+)/g;

    const parts = cleanText.split(splitRegex);

    // First part is preamble or title
    if (parts.length > 0 && parts[0].trim()) {
        sections.push({ label: 'Wstęp', text: parts[0].trim() });
    }

    for (let i = 1; i < parts.length; i++) {
        const part = parts[i].trim();
        if (!part) continue;

        // Extract label (e.g. "Art. 1." or "§ 1.")
        // We take the first line or first few characters as label
        const match = part.match(/^(?:Art\.|§)\s*\d+[a-z]*\.?/);
        const label = match ? match[0] : `Sekcja ${i}`;

        sections.push({ label, text: part });
    }

    return sections;
}

async function analyzeDocument(documentId: number) {
    console.log(`\n🤖 Starting AI analysis for document ID: ${documentId}...`);

    // 1. Pobierz dane dokumentu wraz z załącznikami i sekcjami treści
    const document = await prisma.legalDocument.findUnique({
        where: { id: documentId },
        include: {
            timeline: {
                include: {
                    attachments: true
                }
            },
            content: true,
            // Pobieramy istniejące dane, aby dać AI kontekst lub je nadpisać
            tags: true,
            sectors: true
        }
    });

    if (!document) {
        throw new Error(`Document with ID ${documentId} not found`);
    }

    // 2. Zbierz tekst do analizy
    let fullText = `Tytuł: ${document.title}\n`;
    if (document.summary) fullText += `Obecne streszczenie: ${document.summary}\n`;

    // Treść z sekcji (jeśli są)
    if (document.content && document.content.length > 0) {
        fullText += "\n--- TREŚĆ DOKUMENTU ---\n";
        document.content.sort((a, b) => a.order - b.order).forEach(section => {
            fullText += `${section.label}: ${section.text}\n`;
        });
    }

    // Treść z załączników (szukamy PDFów w timeline)
    // Ograniczamy liczbę załączników/stron żeby nie przekroczyć tokenów
    console.log('   📄 Extracting text from attachments...');
    let attachmentText = "";

    // Zbieramy wszystkie załączniki
    const attachments = document.timeline.flatMap(event => event.attachments).filter(a => a.type.toLowerCase().includes('pdf') || a.url.endsWith('.pdf'));

    // Sortujemy od najnowszych (heurystyka po ID eventu timeline)
    const sortedTimeline = document.timeline.sort((a, b) => b.date.getTime() - a.date.getTime());

    // Bierzemy max 3 najważniejsze PDFy (np. tekst projektu, uzasadnienie)
    let processedPdfs = 0;
    for (const event of sortedTimeline) {
        if (processedPdfs >= 3) break;

        for (const pd of event.attachments) {
            if ((pd.type.toLowerCase().includes('pdf') || pd.url.endsWith('.pdf')) && processedPdfs < 3) {
                console.log(`      Downloading: ${pd.name}...`);
                const text = await extractTextFromPdf(pd.url);
                if (text.length > 100) { // Ignoruj puste/błędne
                    attachmentText += `\n--- ZAŁĄCZNIK: ${pd.name} ---\n${text.substring(0, 50000)}\n`; // Limit znaków na załącznik

                    // Zapisz tekst załącznika w bazie
                    try {
                        await prisma.attachment.update({
                            where: { id: pd.id },
                            data: { textContent: text }
                        });
                        console.log('      💾 Saved attachment text to database');
                    } catch (err) {
                        console.error('      ⚠️ Failed to save attachment text:', err);
                    }

                    processedPdfs++;
                }
            }
        }
    }


    fullText += attachmentText;

    // --- PARSING CONTENT INTO SECTIONS ---
    // Jeśli mamy tekst z załączników, spróbujmy go podzielić na sekcje i zapisać
    let generatedSections: { label: string, text: string }[] = [];
    if (attachmentText.length > 0) {
        console.log('   ✂️ Parsing text into content sections...');
        // Usuń nagłówki "--- ZAŁĄCZNIK... ---" dla czystszego parsowania
        // (Ale zachowaj je w promptcie dla AI)
        const pureLawText = attachmentText.replace(/--- ZAŁĄCZNIK: .*? ---\n/g, '');
        generatedSections = parseContentSections(pureLawText);
        console.log(`      Found ${generatedSections.length} sections`);
    }

    // Ograniczenie całości tekstu (zabezpieczenie dla modelu)
    if (fullText.length > 100000) {
        console.log('   ⚠️ Text too long, truncating...');
        fullText = fullText.substring(0, 100000);
    }

    // 3. Wyślij do OpenAI
    console.log('   🧠 Sending request to OpenAI...');

    const systemPrompt = `
Jesteś zaawansowanym asystentem prawnym AI. Twoim zadaniem jest dogłębna analiza polskiego dokumentu legislacyjnego (projektu ustawy, rozporządzenia itp.).
Na podstawie dostarczonego tekstu (tytuł, treść, załączniki) wygeneruj szczegółową analizę w formacie JSON.
Pamiętaj:
- "sentiment" to liczba od -1 (bardzo negatywny wpływ/odbiór) do 1 (bardzo pozytywny).
- "stakeholders" to grupy społeczne, zawodowe lub instytucje, których dotyczy dokument.
- "impact" podziel na ekonomiczny, społeczny i prawny.
- Przeprowadź krytyczną analizę ryzyk i konfliktów.
- Zasugeruj powiązane akty prawne ("relatedLaws").
- Streszczenie ("summary") powinno być merytoryczne i zwięzłe.
- Tagi i sektory powinny być ogólne (np. "Zdrowie", "Finanse", "Podatki").
    `;

    const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Analizuj poniższy dokument i zwróć wynik w formacie JSON (keys: summary, tags, sectors, stakeholders, sentiment, conclusions, impact {economic, social, legal}, risks, conflicts, relatedLaws {title, context}):\n\n${fullText}` }
        ]
    });

    const content = completion.choices[0].message.content;
    if (!content) {
        throw new Error("Empty response from OpenAI");
    }

    const analysis: AiAnalysisResult = JSON.parse(content);
    console.log('   ✅ Analysis received from OpenAI');

    // 4. Zapisz wyniki w bazie danych
    console.log('   💾 Saving findings to database...');

    try {
        await prisma.$transaction(async (tx) => {
            console.log('      Creating/finding dictionary values (tags, sectors, stakeholders)...');

            // Tagi, Sektory, Interesariusze - przygotowanie ID
            const tagIds = [];
            if (analysis.tags && Array.isArray(analysis.tags)) {
                for (const name of analysis.tags) {
                    const t = await tx.tag.upsert({ where: { name }, create: { name }, update: {} });
                    tagIds.push({ id: t.id });
                }
            }

            const sectorIds = [];
            if (analysis.sectors && Array.isArray(analysis.sectors)) {
                for (const name of analysis.sectors) {
                    const s = await tx.sector.upsert({ where: { name }, create: { name }, update: {} });
                    sectorIds.push({ id: s.id });
                }
            }

            const stakeholderIds = [];
            if (analysis.stakeholders && Array.isArray(analysis.stakeholders)) {
                for (const name of analysis.stakeholders) {
                    const s = await tx.stakeholder.upsert({ where: { name }, create: { name }, update: {} });
                    stakeholderIds.push({ id: s.id });
                }
            }

            console.log('      Updating main document...');

            // Aktualizacja dokumentu
            await tx.legalDocument.update({
                where: { id: documentId },
                data: {
                    summary: analysis.summary || undefined,
                    tags: { set: tagIds },
                    sectors: { set: sectorIds },
                    stakeholders: { set: stakeholderIds }
                }
            });

            // Zapis ContentSections (jeśli wygenerowano)
            if (generatedSections.length > 0) {
                console.log('      Updating Content Sections...');
                // Opcjonalnie: czyścić stare? Tak, jeśli nadpisujemy.
                await tx.contentSection.deleteMany({ where: { documentId } });

                for (let i = 0; i < generatedSections.length; i++) {
                    const sec = generatedSections[i];
                    await tx.contentSection.create({
                        data: {
                            documentId,
                            externalId: `auto-${documentId}-${i}`, // Autogenerowane ID
                            label: sec.label,
                            text: sec.text,
                            order: i,
                            version: 1
                        }
                    });
                }
            }

            console.log('      Updating AI Analysis...');

            // AiAnalysis
            const existingAnalysis = await tx.aiAnalysis.findUnique({ where: { documentId } });
            let analysisId = existingAnalysis?.id;

            if (existingAnalysis) {
                await tx.aiAnalysis.update({
                    where: { id: existingAnalysis.id },
                    data: { sentiment: typeof analysis.sentiment === 'number' ? analysis.sentiment : 0 }
                });
                await tx.aiTakeaway.deleteMany({ where: { analysisId } });
                await tx.aiImpact.deleteMany({ where: { analysisId } });
                await tx.aiRisk.deleteMany({ where: { analysisId } });
                await tx.aiConflict.deleteMany({ where: { analysisId } });
            } else {
                const newAnalysis = await tx.aiAnalysis.create({
                    data: {
                        documentId,
                        sentiment: typeof analysis.sentiment === 'number' ? analysis.sentiment : 0
                    }
                });
                analysisId = newAnalysis.id;
            }

            if (analysisId) {
                // Wnioski
                if (analysis.conclusions && Array.isArray(analysis.conclusions)) {
                    await tx.aiTakeaway.createMany({
                        data: analysis.conclusions.map(text => ({ text, analysisId: analysisId! }))
                    });
                }

                // Impact
                const impacts = [];
                if (analysis.impact) {
                    if (analysis.impact.economic) impacts.push({ category: 'ECONOMIC', description: analysis.impact.economic, analysisId: analysisId! });
                    if (analysis.impact.social) impacts.push({ category: 'SOCIAL', description: analysis.impact.social, analysisId: analysisId! });
                    if (analysis.impact.legal) impacts.push({ category: 'LEGAL', description: analysis.impact.legal, analysisId: analysisId! });
                }

                if (impacts.length > 0) {
                    await tx.aiImpact.createMany({ data: impacts });
                }

                // Risks
                if (analysis.risks && Array.isArray(analysis.risks)) {
                    await tx.aiRisk.createMany({
                        data: analysis.risks.map(description => ({ description, analysisId: analysisId! }))
                    });
                }

                // Conflicts
                if (analysis.conflicts && Array.isArray(analysis.conflicts)) {
                    await tx.aiConflict.createMany({
                        data: analysis.conflicts.map(description => ({ description, analysisId: analysisId! }))
                    });
                }
            }

            // Relacje
            console.log('      Adding relations...');
            if (analysis.relatedLaws && Array.isArray(analysis.relatedLaws)) {
                for (const rel of analysis.relatedLaws) {
                    // Sprawdź czy relacja już istnieje (proste sprawdzenie po tytule)
                    // (Opcjonalnie, tu po prostu dodajemy nową)
                    await tx.documentRelation.create({
                        data: {
                            fromDocumentId: documentId,
                            title: rel.title,
                            context: rel.context
                        }
                    });
                }
            }
        }, {
            maxWait: 10000,
            timeout: 20000
        });
    } catch (txError) {
        console.error('Error in Prisma transaction:', txError);
        throw txError;
    }

    console.log(`   ✨ Analysis completed and saved for Document ID ${documentId}`);
}

async function analyzeBatch(options: {
    newOnly?: boolean;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
}) {
    console.log('\n🚀 Starting batch analysis...');
    console.log(`   Options: ${JSON.stringify(options)}`);

    const where: any = {};

    // 1. Filtrowanie po dacie
    if (options.fromDate || options.toDate) {
        where.createdAt = {};
        if (options.fromDate) where.createdAt.gte = options.fromDate;
        if (options.toDate) where.createdAt.lte = options.toDate;
    }

    // 2. Filtrowanie tylko nowych (bez analizy)
    if (options.newOnly) {
        where.aiAnalysis = null;
    }

    // Pobierz ID dokumentów do przetworzenia
    const documents = await prisma.legalDocument.findMany({
        where,
        select: { id: true, title: true },
        orderBy: { createdAt: 'desc' },
        take: options.limit || 50 // Domyślny limit dla bezpieczeństwa
    });

    console.log(`   📄 Found ${documents.length} documents to analyze`);

    let processed = 0;
    let errors = 0;

    for (const doc of documents) {
        console.log(`\n[${processed + 1}/${documents.length}] Processing: ${doc.title.substring(0, 50)}...`);
        try {
            await analyzeDocument(doc.id);
            processed++;
        } catch (error) {
            console.error(`   ❌ Error analyzing document ${doc.id}:`, error);
            errors++;
        }
    }

    console.log('\n' + '━'.repeat(60));
    console.log(`✅ Batch analysis completed!`);
    console.log(`   Processed: ${processed}`);
    console.log(`   Errors: ${errors}`);
}

async function runCli() {
    const args = process.argv.slice(2);

    // Help
    if (args.includes('--help') || args.length === 0) {
        console.log(`
Usage:
  npm run analyze <id>              Analyze specific document
  npm run analyze -- --new          Analyze all documents without AI analysis
  npm run analyze -- --since <date> Analyze documents created since date (YYYY-MM-DD)
  npm run analyze -- --range <start> <end>  Analyze documents created in range
  npm run analyze -- --limit <n>    Limit number of documents (default 50)
        `);
        return;
    }

    // Single ID
    if (!args[0].startsWith('-')) {
        const id = parseInt(args[0]);
        if (!isNaN(id)) {
            await analyzeDocument(id);
            return;
        }
    }

    // Batch options
    const options: any = {};

    if (args.includes('--new')) {
        options.newOnly = true;
    }

    const sinceIndex = args.indexOf('--since');
    if (sinceIndex !== -1 && args[sinceIndex + 1]) {
        options.fromDate = new Date(args[sinceIndex + 1]);
    }

    const rangeIndex = args.indexOf('--range');
    if (rangeIndex !== -1 && args[rangeIndex + 1] && args[rangeIndex + 2]) {
        options.fromDate = new Date(args[rangeIndex + 1]);
        options.toDate = new Date(args[rangeIndex + 2]);
    }

    const limitIndex = args.indexOf('--limit');
    if (limitIndex !== -1 && args[limitIndex + 1]) {
        options.limit = parseInt(args[limitIndex + 1]);
    }

    await analyzeBatch(options);
}

// Obsługa CLI
if (require.main === module) {
    runCli()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('Fatal error:', err);
            process.exit(1);
        })
        .finally(() => prisma.$disconnect());
}

export { analyzeDocument };

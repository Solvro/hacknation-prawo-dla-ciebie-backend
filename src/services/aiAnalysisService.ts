
import 'dotenv/config';
import OpenAI from 'openai';
import { PDFParse } from 'pdf-parse';
const mammoth = require("mammoth");
import { GoogleGenerativeAI } from "@google/generative-ai";
async function extractTextFromDocx(url: string): Promise<string> {
    try {
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
        return result.value;
    } catch (error) {
        console.error(`Error extracting text from DOCX ${url}:`, error);
        return "";
    }
}
import { prisma } from '../lib/prisma';
import { DocumentRelation, LegalDocument } from '@prisma/client';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Interfaces for AI returned structure
interface AiAnalysisResult {
    summary: string;
    tags: string[];
    sectors: string[];
    stakeholders: string[];
    sentiment: number; // -1 to 1
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
    main_bill_file_name?: string; // AI points to the file name that is the main bill
}

async function extractTextFromPdf(url: string): Promise<string> {
    let parser;
    try {
        parser = new PDFParse({ url });
        const result = await parser.getText();
        return result.text;
    } catch (error) {
        console.error(`Error extracting text from PDF ${url}:`, error);
        return "";
    } finally {
        if (parser) {
            await parser.destroy();
        }
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
        sections.push({ label: 'Introduction', text: parts[0].trim() });
    }

    for (let i = 1; i < parts.length; i++) {
        const part = parts[i].trim();
        if (!part) continue;

        // Extract label (e.g. "Art. 1." or "§ 1.")
        // We take the first line or first few characters as label
        const match = part.match(/^(?:Art\.|§)\s*\d+[a-z]*\.?/);
        const label = match ? match[0] : `Section ${i}`;

        sections.push({ label, text: part });
    }

    return sections;
}

async function analyzeDocument(documentId: number) {
    console.log(`\n🤖 Starting AI analysis for document ID: ${documentId}...`);

    // 1. Fetch document data along with attachments and content sections
    const document = await prisma.legalDocument.findUnique({
        where: { id: documentId },
        include: {
            timeline: {
                include: {
                    attachments: true
                }
            },
            content: true,
            // Fetch existing data to provide context to AI or overwrite it
            tags: true,
            sectors: true,
            links: true,
            responsiblePerson: true
        }
    });

    if (!document) {
        throw new Error(`Document with ID ${documentId} not found`);
    }

    // 2. Collect text for analysis
    let fullText = `Tytuł: ${document.title}\n`;
    if (document.summary) fullText += `Obecne streszczenie: ${document.summary}\n`;

    // Responsible person data
    if (document.responsiblePerson) {
        fullText += `Osoba odpowiedzialna: ${document.responsiblePerson.name} (${document.responsiblePerson.role || 'Brak roli'}, ${document.responsiblePerson.email || 'Brak email'})\n`;
    }

    // Links
    if (document.links && document.links.length > 0) {
        fullText += "Linki:\n";
        document.links.forEach(l => fullText += `- ${l.url} (${l.description || ''})\n`);
    }

    // Timeline - historical context
    if (document.timeline && document.timeline.length > 0) {
        fullText += "\n--- PRZEBIEG PROCESU LEGISLACYJNEGO (Timeline) ---\n";
        // Sort from oldest to newest for context
        const chronology = [...document.timeline].sort((a, b) => a.date.getTime() - b.date.getTime());
        chronology.forEach(event => {
            fullText += `${event.date.toISOString().split('T')[0]} - ${event.status}: ${event.title}\n`;
        });
    }

    // Content from sections (if any)
    if (document.content && document.content.length > 0) {
        fullText += "\n--- TREŚĆ DOKUMENTU (Z BAZY) ---\n";
        document.content.sort((a, b) => a.order - b.order).forEach(section => {
            fullText += `${section.label}: ${section.text}\n`;
        });
    }

    // Content from attachments (search for PDFs in timeline)
    // Limit attachments/pages to avoid exceeding tokens
    console.log('   📄 Extracting text from attachments...');
    let attachmentText = "";

    // Structure to store extracted texts for later bill identification
    const extractedAttachments: { name: string, text: string, id: number }[] = [];
    let attachmentsListStr = "Lista dostępnych plików:\n";

    // Collect all attachments
    const attachments = document.timeline.flatMap(event => event.attachments).filter(a => a.type.toLowerCase().includes('pdf') || a.url.endsWith('.pdf'));

    // Sort by newest (heuristic by timeline event ID)
    const sortedTimeline = document.timeline.sort((a, b) => b.date.getTime() - a.date.getTime());

    // Take all attachments unless we exceed Gemini context limit (approx 1M tokens -> ~4M chars)
    const MAX_TOTAL_CHARS = 3500000;

    for (const event of sortedTimeline) {
        if (fullText.length + attachmentText.length > MAX_TOTAL_CHARS) {
            console.log('   ⚠️ Approaching context limit, stopping attachment extraction.');
            break;
        }

        for (const pd of event.attachments) {
            if (fullText.length + attachmentText.length > MAX_TOTAL_CHARS) break;

            const lowerUrl = pd.url.toLowerCase();
            const lowerType = pd.type.toLowerCase();
            const isPdf = lowerType.includes('pdf') || lowerUrl.endsWith('.pdf');
            const isDoc = lowerType.includes('doc') || lowerUrl.endsWith('.docx') || lowerUrl.endsWith('.doc');

            // Skip files that are evidently not substantive content if we want to save,
            // but user wanted "all", so we take everything that is a text document.

            if (isPdf || isDoc) {
                console.log(`      Downloading: ${pd.name} (Stage: ${event.title})...`);
                let text = "";

                // Try to fetch from DB if already exists (optimization)
                // Previous code didn't have this, but would be good. Keeping fetch/extract logic for now.

                if (isPdf) {
                    text = await extractTextFromPdf(pd.url);
                } else if (isDoc) {
                    text = await extractTextFromDocx(pd.url);
                }

                if (text.length > 50) {
                    const dateStr = event.date.toISOString().split('T')[0];
                    // Increase limit per file since we have a large window
                    const snippet = `\n--- ZAŁĄCZNIK: ${pd.name}\n--- KONTEKST: Etap: ${event.title}, Data: ${dateStr}\n${text.substring(0, 200000)}\n`;

                    if (fullText.length + attachmentText.length + snippet.length > MAX_TOTAL_CHARS) {
                        console.log('   ⚠️ File too large for remaining context, skipping.');
                        continue;
                    }

                    attachmentText += snippet;

                    extractedAttachments.push({
                        name: pd.name,
                        text: text,
                        id: pd.id
                    });

                    attachmentsListStr += `- ${pd.name} (${event.title}, ${dateStr})\n`;

                    // Save attachment text to DB
                    try {
                        await prisma.attachment.update({
                            where: { id: pd.id },
                            data: { textContent: text }
                        });
                        console.log('      💾 Saved attachment text to database');
                    } catch (err) {
                        console.error('      ⚠️ Failed to save attachment text:', err);
                    }
                }
            }
        }
    }


    fullText += attachmentText;

    console.log(`   🧠 Preparing AI request. Text length: ${fullText.length} chars`);

    let analysis: AiAnalysisResult = {} as AiAnalysisResult;
    const OPENAI_CHAR_LIMIT = 60000; // Safe limit for fast/cheaper OpenAI (though 4o has larger context)

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
- "main_bill_file_name": Wskaż nazwę pliku z listy załączników, który zawiera najnowszy główny tekst procedowanej ustawy/projektu (pomiń uzasadnienia, opinie, OSR, jeśli dostępny jest tekst właściwy). Jeśli nie ma ewidentnego tekstu ustawy, zwróć null.
    `;

    console.log(`   --- Checking text length against limit ${OPENAI_CHAR_LIMIT} ---`);
    if (fullText.length > OPENAI_CHAR_LIMIT) {
        console.log('   🌌 Text is large, using Google Gemini (via Vercel AI SDK)...');

        const { google } = require("@ai-sdk/google");
        const { generateText } = require("ai");

        // Ensure Vercel SDK uses our existing API key
        if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && process.env.GOOGLE_API_KEY) {
            process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_API_KEY;
        }

        // Vercel SDK models (based on available models)
        const modelsToTry = ["models/gemini-2.0-flash", "models/gemini-2.0-flash-lite", "models/gemini-flash-latest"];
        let success = false;
        let lastError;

        for (const modelName of modelsToTry) {
            console.log(`   🌌 Trying Google Gemini model (SDK): ${modelName}...`);
            try {
                let currentPromptText = fullText;

                // Truncate only for legacy or specific known limits if needed, but 1.5 flash/pro have massive windows.
                // We'll trust the model by default unless it fails.

                const prompt = `${systemPrompt}\n\nAnalizuj poniższy dokument i zwróć wynik w formacie JSON (keys: summary, tags, sectors, stakeholders, sentiment, conclusions, impact {economic, social, legal}, risks, conflicts, relatedLaws {title, context}, main_bill_file_name).\n${attachmentsListStr}\n\n${currentPromptText}`;

                console.log(`      🚀 Sending request to Gemini SDK (${modelName})...`);

                const { text } = await generateText({
                    model: google(modelName),
                    prompt: prompt,
                });

                console.log(`      Parsing JSON response...`);
                // Clean markdown if present
                const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
                analysis = JSON.parse(cleanText);

                console.log(`   ✅ Analysis received from Google Gemini (${modelName})`);
                success = true;
                break;
            } catch (err: any) {
                console.error(`      ❌ Model ${modelName} failed: ${err.message || err}`);
                lastError = err;
            }
        }

        if (!success) {
            throw lastError || new Error("All Google Gemini models failed");
        }

    } else {
        console.log('   🤖 Using OpenAI...');

        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Analizuj poniższy dokument i zwróć wynik w formacie JSON (keys: summary, tags, sectors, stakeholders, sentiment, conclusions, impact {economic, social, legal}, risks, conflicts, relatedLaws {title, context}, main_bill_file_name).\n${attachmentsListStr}\n\n${fullText}` }
            ]
        });

        const content = completion.choices[0].message.content;
        if (!content) {
            throw new Error("Empty response from OpenAI");
        }
        analysis = JSON.parse(content);
        console.log('   ✅ Analysis received from OpenAI');
    }

    // 4.1. Processing selected bill text (if AI and heuristic agree)
    let selectedBillText = "";

    // a) AI suggestion
    if (analysis.main_bill_file_name) {
        console.log(`   🤖 AI identified main bill file: ${analysis.main_bill_file_name} `);
        const candidate = extractedAttachments.find(a => a.name === analysis.main_bill_file_name);

        if (candidate) {
            // b) Name verification (user heuristic)
            const lower = candidate.name.toLowerCase();
            const looksLikeBill = (lower.includes('projekt') || lower.includes('ustaw') || lower.includes('tekst') || lower.includes('akt')) && !lower.includes('uzasadnienie') && !lower.includes('opinia');

            if (looksLikeBill) {
                console.log(`   ✅ Confirmed by filename rules.Using this text.`);
                selectedBillText = candidate.text;
            } else {
                console.log(`   ⚠️ Filename validation failed(name usually implies justification / opinion).Checking fallback...`);
            }
        }
    }

    // Fallback: If AI did not point or name validation failed, search classically
    // if (!selectedBillText) {
    //     console.log('   🔍 Using standard filename heuristics for bill text...');
    //     const fallback = extractedAttachments.find(a => {
    //         const lower = a.name.toLowerCase();
    //         return (lower.includes('projekt') || lower.includes('tekst') || lower.includes('ustaw'))
    //             && !lower.includes('uzasadnienie')
    //             && !lower.includes('ocena')
    //             && !lower.includes('opinia');
    //     });
    //     if (fallback) {
    //         console.log(`      Found fallback candidate: ${ fallback.name } `);
    //         selectedBillText = fallback.text;
    //     }
    // }

    // Parsing sections
    let generatedSections: { label: string, text: string }[] = [];
    if (selectedBillText) {
        console.log('   ✂️ Parsing identified bill text into content sections...');
        generatedSections = parseContentSections(selectedBillText);
        console.log(`      Found ${generatedSections.length} sections`);
    }

    // 4.2 Save findings to database
    console.log('   💾 Saving findings to database...');

    try {
        await prisma.$transaction(async (tx) => {
            console.log('      Creating/finding dictionary values (tags, sectors, stakeholders)...');

            // Tags, Sectors, Stakeholders - prepare IDs
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

            // Update document
            await tx.legalDocument.update({
                where: { id: documentId },
                data: {
                    summary: analysis.summary || undefined,
                    tags: { set: tagIds },
                    sectors: { set: sectorIds },
                    stakeholders: { set: stakeholderIds }
                }
            });

            // Update latestContent (if bill text found)
            if (selectedBillText) {
                await tx.legalDocument.update({
                    where: { id: documentId },
                    data: { latestContent: selectedBillText }
                });
                console.log('      💾 Updated latestContent with selected bill text');
            }

            // Save ContentSections (if generated)
            if (generatedSections.length > 0) {
                console.log('      Updating Content Sections...');
                await tx.contentSection.deleteMany({ where: { documentId } });

                await tx.contentSection.createMany({
                    data: generatedSections.map((sec, i) => ({
                        documentId,
                        externalId: `auto-${documentId}-${i}`,
                        label: sec.label,
                        text: sec.text,
                        order: i,
                        version: 1
                    }))
                });
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
                // Conclusions
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

            // Relations
            console.log('      Adding relations...');
            if (analysis.relatedLaws && Array.isArray(analysis.relatedLaws)) {
                for (const rel of analysis.relatedLaws) {
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
            maxWait: 20000,
            timeout: 120000
        });
    } catch (txError) {
        console.error('Error in Prisma transaction:', txError);
        throw txError;
    }

    console.log(`   ✨ Analysis completed and saved for Document ID ${documentId} `);
}

async function analyzeBatch(options: {
    newOnly?: boolean;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
}) {
    console.log('\n🚀 Starting batch analysis...');
    console.log(`   Options: ${JSON.stringify(options)} `);

    const where: any = {};

    // 1. Date filtering
    if (options.fromDate || options.toDate) {
        where.createdAt = {};
        if (options.fromDate) where.createdAt.gte = options.fromDate;
        if (options.toDate) where.createdAt.lte = options.toDate;
    }

    // 2. Filter only new (no analysis)
    if (options.newOnly) {
        where.aiAnalysis = null;
    }

    // Fetch IDs of documents to process
    const documents = await prisma.legalDocument.findMany({
        where,
        select: { id: true, title: true },
        orderBy: { createdAt: 'desc' },
        take: options.limit || 50 // Default limit for safety
    });

    console.log(`   📄 Found ${documents.length} documents to analyze`);

    let processed = 0;
    let errors = 0;

    for (const doc of documents) {
        console.log(`\n[${processed + 1}/${documents.length}]Processing: ${doc.title.substring(0, 50)}...`);
        try {
            await analyzeDocument(doc.id);
            processed++;
        } catch (error) {
            console.error(`   ❌ Error analyzing document ${doc.id}: `, error);
            errors++;
        }
    }

    console.log('\n' + '━'.repeat(60));
    console.log(`✅ Batch analysis completed!`);
    console.log(`   Processed: ${processed} `);
    console.log(`   Errors: ${errors} `);
}

async function runCli() {
    const args = process.argv.slice(2);

    // Help
    if (args.includes('--help') || args.length === 0) {
        console.log(`
    Usage:
  npm run analyze < id > Analyze specific document
  npm run analyze-- --new Analyze all documents without AI analysis
  npm run analyze-- --since < date > Analyze documents created since date(YYYY - MM - DD)
  npm run analyze-- --range < start > <end>Analyze documents created in range
  npm run analyze-- --limit < n > Limit number of documents(default 50)
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

    // 3. Limit (default 50, unless --all is passed)
    let limit = 50;
    if (args.includes('--all')) {
        limit = 1000000; // Arbitrary high number for "all"
    } else if (args.indexOf('--limit') !== -1) {
        const limitIndex = args.indexOf('--limit');
        if (args[limitIndex + 1]) {
            limit = parseInt(args[limitIndex + 1]);
        }
    }
    options.limit = limit;

    await analyzeBatch(options);
}

// CLI handler
if (require.main === module) {
    // Log raw args for debugging
    // console.log('Raw Args:', process.argv);

    runCli()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('Fatal error:', err);
            process.exit(1);
        })
        .finally(() => prisma.$disconnect());
}

export { analyzeDocument };

import { sql } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { getDb } from "@/lib/db";
import { knowledgeChunks, knowledgeSources } from "@/lib/db/schema";
import { embedTexts, hasEmbeddings, vectorLiteral } from "./embeddings";
import { chunkText, keywords, orTsQuery } from "./chunk";
import { detectKind, cleanHtml, cleanRtf } from "./file-types";

export type KnowledgeHit = {
  source: string;
  content: string;
  score: number;
  via: "vector" | "text" | "keyword";
};

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

// Dispatch by file type. PDF text via unpdf, .docx via mammoth, .doc via
// word-extractor, HTML/RTF cleaned inline, everything text-like decoded as-is.
export async function extractDocumentText(
  buffer: Buffer,
  filename: string,
  mime?: string | null,
): Promise<string> {
  const kind = detectKind(filename, mime);
  if (!kind) throw new Error("Unsupported file type");
  switch (kind) {
    case "pdf":
      return extractPdfText(buffer);
    case "docx": {
      const { value } = await mammoth.extractRawText({ buffer });
      return value;
    }
    case "doc": {
      const doc = await new WordExtractor().extract(buffer);
      return doc.getBody();
    }
    case "html":
      return cleanHtml(buffer.toString("utf8"));
    case "rtf":
      return cleanRtf(buffer.toString("utf8"));
    default:
      return buffer.toString("utf8");
  }
}

export async function ingestText(input: {
  title: string;
  filename?: string | null;
  byteSize?: number | null;
  text: string;
}) {
  const db = getDb();
  const chunks = chunkText(input.text);
  if (!chunks.length) throw new Error("No readable text found in that document.");
  const [source] = await db
    .insert(knowledgeSources)
    .values({
      title: input.title.slice(0, 300),
      filename: input.filename ?? null,
      byteSize: input.byteSize ?? null,
      charCount: input.text.length,
      chunkCount: chunks.length,
    })
    .returning();
  const rows = await db
    .insert(knowledgeChunks)
    .values(chunks.map((content, i) => ({ sourceId: source.id, chunkIndex: i, content })))
    .returning({ id: knowledgeChunks.id, content: knowledgeChunks.content });
  // Semantic vectors are optional: skip silently when no embeddings model is set.
  if (hasEmbeddings()) {
    try {
      const vectors = await embedTexts(rows.map((r) => r.content), "passage");
      for (let i = 0; i < rows.length; i++) {
        const vec = vectors[i];
        if (!vec?.length) continue;
        await db.execute(
          sql`update knowledge_chunks set embedding = ${vectorLiteral(vec)}::halfvec where id = ${rows[i].id}`,
        );
      }
    } catch (e) {
      console.error("knowledge embedding skipped", e);
    }
  }
  return { source, chunkCount: chunks.length };
}

export async function ingestFile(input: {
  title: string;
  filename?: string | null;
  mime?: string | null;
  buffer: Buffer;
}) {
  const text = await extractDocumentText(
    input.buffer,
    input.filename ?? input.title,
    input.mime,
  );
  return ingestText({
    title: input.title,
    filename: input.filename ?? null,
    byteSize: input.buffer.byteLength,
    text,
  });
}

// Hybrid retrieval: pgvector when embeddings exist, then OR full-text, then a
// keyword (substring) fallback so short/typo'd questions still find a passage.
// Every step degrades on its own so a missing extension or table never breaks
// an answer.
export async function searchKnowledge(question: string, limit = 6): Promise<KnowledgeHit[]> {
  const q = question.trim();
  if (!q) return [];
  const db = getDb();
  const hits: KnowledgeHit[] = [];
  const seen = new Set<string>();
  const push = (source: string, content: string, score: number, via: KnowledgeHit["via"]) => {
    const key = `${source}|${content.slice(0, 80)}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ source, content, score, via });
  };

  if (hasEmbeddings()) {
    try {
      const [vec] = await embedTexts([q], "query");
      if (vec?.length) {
        const literal = vectorLiteral(vec);
        const rows = (await db.execute(sql`
          select s.title as source, c.content as content,
                 1 - (c.embedding <=> ${literal}::halfvec) as score
          from knowledge_chunks c join knowledge_sources s on s.id = c.source_id
          where c.embedding is not null
          order by c.embedding <=> ${literal}::halfvec
          limit ${limit}
        `)) as unknown as Array<{ source: string; content: string; score: number }>;
        for (const r of rows) push(r.source, r.content, Number(r.score), "vector");
      }
    } catch (e) {
      console.error("vector search skipped", e);
    }
  }

  const tsq = orTsQuery(q);
  if (hits.length < limit && tsq) {
    try {
      const rows = (await db.execute(sql`
        select s.title as source, c.content as content,
               ts_rank(to_tsvector('simple', c.content), to_tsquery('simple', ${tsq})) as score
        from knowledge_chunks c join knowledge_sources s on s.id = c.source_id
        where to_tsvector('simple', c.content) @@ to_tsquery('simple', ${tsq})
        order by score desc
        limit ${limit}
      `)) as unknown as Array<{ source: string; content: string; score: number }>;
      for (const r of rows) push(r.source, r.content, Number(r.score), "text");
    } catch (e) {
      console.error("full-text search skipped", e);
    }
  }

  if (hits.length < limit) {
    for (const w of keywords(q, 4)) {
      if (hits.length >= limit) break;
      try {
        const rows = (await db.execute(sql`
          select s.title as source, c.content as content
          from knowledge_chunks c join knowledge_sources s on s.id = c.source_id
          where c.content ilike ${"%" + w + "%"}
          order by length(c.content) asc
          limit 2
        `)) as unknown as Array<{ source: string; content: string; score: number }>;
        for (const r of rows) push(r.source, r.content, 0.01, "keyword");
      } catch (e) {
        console.error("keyword search skipped", e);
      }
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

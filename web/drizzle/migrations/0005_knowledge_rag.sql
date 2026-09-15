-- Knowledge RAG: staff PDF uploads -> chunked, searchable knowledge.
-- Lexical retrieval (full-text + trigram) works today. The nullable `embedding`
-- column plus pgvector lets retrieval upgrade to semantic search the moment an
-- embeddings model is configured (LLM_EMBED_MODEL), with no schema change.
create extension if not exists vector with schema public;
create extension if not exists pg_trgm with schema public;

create table if not exists knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  filename text,
  byte_size integer,
  char_count integer not null default 0,
  chunk_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references knowledge_sources(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index if not exists knowledge_chunks_fts_idx
  on knowledge_chunks using gin (to_tsvector('simple', content));
create index if not exists knowledge_chunks_trgm_idx
  on knowledge_chunks using gin (content gin_trgm_ops);
create index if not exists knowledge_chunks_source_idx
  on knowledge_chunks (source_id, chunk_index);
create index if not exists knowledge_chunks_embedding_idx
  on knowledge_chunks using hnsw (embedding vector_cosine_ops);

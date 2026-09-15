-- Enable ANN search for the 2048-dim embeddings. pgvector's `vector` HNSW
-- index caps at 2000 dimensions, but `halfvec` (float16) HNSW supports up to
-- 4000. Embeddings are currently NULL, so the cast is safe.
drop index if exists knowledge_chunks_embedding_idx;
alter table knowledge_chunks alter column embedding type halfvec(2048);
create index if not exists knowledge_chunks_embedding_idx
  on knowledge_chunks using hnsw (embedding halfvec_cosine_ops);

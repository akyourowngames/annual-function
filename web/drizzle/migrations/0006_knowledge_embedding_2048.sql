-- Move the knowledge embedding column to match the configured embeddings model
-- (NVIDIA NIM nvidia/nemotron-3-embed-1b = 2048 dimensions). Safe while stored
-- embeddings are NULL; they are (re)created on upload.
--
-- No ANN index: pgvector's HNSW/IVFFlat indexes cap at 2000 dimensions, and
-- 2048 exceeds that. An exact cosine scan (ORDER BY embedding <=> query) is
-- fast at event scale and always exact.
drop index if exists knowledge_chunks_embedding_idx;
alter table knowledge_chunks alter column embedding type vector(2048);

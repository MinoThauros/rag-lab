# The retrieval half of RAG: state of practice, late 2026

Research date: 2026-10-22. Sources were gathered in one session of about 15 searches and fetches. Items marked **[prior knowledge, not re-fetched]** are well-known primary sources that I cite from memory (pre-mid-2026 training data) and did not re-verify in this session. **[vendor]** marks a claim from a company that sells the product. **[independent]** marks academic or third-party evidence.

## 1. Embedding models: consensus choices, MTEB/MMTEB status and caveats, multilingual, self-hosting

### Takeaway
There is no single best model. The usual shortlist is a few hosted APIs (Gemini embedding-001, Voyage, Cohere embed-v4, OpenAI text-embedding-3) and a few open-weight models (Qwen3-Embedding at 0.6B, 4B or 8B, plus BGE-M3). Qwen3-Embedding-8B is the usual open-weight pick for multilingual work, which covers English and French. Practitioners treat MTEB as a directional signal only: gaps of one or two points are noise, and the leaderboard should never replace an evaluation on your own corpus.

### Cited Findings
- A guide published March 17, 2026 gives these early-2026 figures. Qwen3-Embedding-8B scores 70.58 on the multilingual board (a mid-2025 number), with 32K context, flexible 32 to 7,168 dimensions and an Apache-2.0 license. NV-Embed-v2 scores 69.32 but carries a non-commercial license (CC-BY-NC-4.0). Gemini embedding-001 scores 68.32 (67.71 on retrieval) at $0.15 per million tokens, with 3,072 dimensions reducible to 768 and only a **2,048-token input limit**. voyage-3-large scores about 67 at $0.06 per million tokens. Cohere embed-v4 scores 65.2 at $0.10 per million tokens, has **128K context** and can be deployed in a VPC or on-prem. text-embedding-3-large scores 64.6 at $0.13 per million tokens and text-embedding-3-small about 62 at $0.02. BGE-M3 scores 63.0 under the MIT license and produces dense, sparse and multi-vector output from one model. Jina v3 scores about 62, but its weights are CC-BY-NC, so commercial self-hosting needs a license. Nomic embed-text-v1.5 scores about 62, has 137M parameters, runs on CPU and is fully open. — [PremAI, Mar 2026](https://www.premai.io/blog/best-embedding-models-for-rag-2026-ranked-by-mteb-score-cost-and-self-hosting)
- The same guide reports three tuning effects. Qwen3-Embedding gains 1–5% when the query carries a task-instruction prefix. Cutting text-embedding-3-large from 3,072 to 1,024 dimensions (Matryoshka truncation) costs about 2% retrieval quality. Voyage claims voyage-3-large beats text-embedding-3-large by 10.58% **[vendor]**. — [PremAI](https://www.premai.io/blog/best-embedding-models-for-rag-2026-ranked-by-mteb-score-cost-and-self-hosting)
- Secondary sources disagree on who leads the English board. One says Gemini Embedding 001 tops the April 2026 snapshot. Another, from May 2026, puts NV-Embed-v2 first at 72.31. — [search summary of blog sources incl. Modal](https://modal.com/blog/mteb-leaderboard-article), [techsy.io](https://techsy.io/en/blog/best-embedding-models-for-rag). The leader changes with the snapshot and the board variant, so check the live board before quoting a rank.
- **Caveats about MTEB:**
  - The score averages roughly 8 task types, and only retrieval predicts RAG quality. — [techsy.io](https://techsy.io/en/blog/mteb-score-explained-rag)
  - Overfitting within datasets is common: models trained on MTEB training splits or paraphrases post big wins on those sets and underperform on held-out corpora. — [ZeroEntropy](https://zeroentropy.dev/concepts/mteb/) **[vendor: sells retrieval models]**
  - Retrieval is scored with binary relevance labels, and the leaderboard should be trusted directionally, where only large gaps mean something. — [Particula](https://particula.tech/blog/mteb-leaderboard-embedding-benchmark-contamination)
  - Several retrieval datasets share one Wikipedia corpus (DBPedia, NQ, TriviaQA), which creates overlap risk. — [Wang et al., arXiv 2401.00368](https://arxiv.org/pdf/2401.00368)
  - The MTEB maintainers have a paper on reproducibility and on how "zero-shot" is defined and filtered on the leaderboard. — [Maintaining MTEB, arXiv 2506.21182](https://arxiv.org/pdf/2506.21182)
- **Serving with vLLM:** Qwen3-Embedding is served with `vllm serve Qwen/Qwen3-Embedding-8B --runner pooling` and exposes an OpenAI-compatible `/embeddings` endpoint. Queries should carry a one-sentence task instruction. — [vLLM docs](https://docs.vllm.ai/projects/ascend/en/latest/tutorials/Qwen3_embedding.html), [vLLM pooling models](https://docs.vllm.ai/en/v0.20.2/models/pooling_models/embed/)
- The Qwen3 family includes both embedding and **reranker** models at 0.6B, 4B and 8B. — [vLLM docs](https://docs.vllm.ai/projects/ascend/en/latest/tutorials/Qwen3_embedding.html)

### Inferences
- **English/French:** French is a high-resource language, so every shortlisted model handles it. The real risks are cross-lingual retrieval (a French query against English documents) and domain jargon, such as Québec legal or administrative French. Qwen3-Embedding, BGE-M3, Cohere embed-v4 and Gemini are all marketed as multilingual. Pick by testing on 50–200 real bilingual queries.
- **Default advice:**
  - Hosted and simple: text-embedding-3-large/small or Voyage.
  - Long documents: Cohere embed-v4, because of its 128K context.
  - Self-hosted or data-residency constraints: Qwen3-Embedding-4B or 8B on vLLM, or BGE-M3 if you also want sparse vectors.
  - Avoid NV-Embed-v2 and Jina weights for commercial self-hosting because of their licenses.
- Gemini's 2,048-token input limit forces chunking, which matters less than it sounds because most pipelines chunk to 256–1,024 tokens anyway.

### Gaps
- I did not retrieve the MMTEB paper (arXiv 2502.13595) or a live leaderboard snapshot from October 2026, so I cannot confirm the current leader.
- I found no data on Voyage 4 or voyage-4-large embedding scores beyond a passing mention.
- I found no direct TEI-vs-vLLM throughput comparison. TEI (Hugging Face Text Embeddings Inference) is widely used, but I have no 2026 source on its Qwen3 support.
- I did not find an independent French-specific retrieval benchmark (e.g., MTEB-French) for 2026.

## 2. Vector stores: options, when pgvector is enough, scale thresholds

### Takeaway
Practitioners broadly agree that the vector-store choice matters less than chunking, embedding and reranking. pgvector is the sensible default for teams already on Postgres, up to roughly 5–10M vectors. Its old filtered-search weakness was largely fixed in version 0.8.0 by iterative index scans, though some edge cases remain. Dedicated stores earn their place for very large scale, many-tenant or very low-latency workloads. Specifically, turbopuffer fits object-storage economics and multi-tenancy, Qdrant and Milvus fit self-hosted scale, and Pinecone fits fully managed deployments.

### Cited Findings
- **pgvector 0.8.0 iterative index scans:** set `hnsw.iterative_scan` to `strict_order` or `relaxed_order` and the index keeps scanning until enough rows pass the filter, or until `hnsw.max_scan_tuples` is hit (default 20,000). — [PostgreSQL.org release](https://www.postgresql.org/about/news/pgvector-080-released-2952/), [pgEdge docs](https://docs.pgedge.com/pgvector/v0-8-0/iterative-index-scans/)
- **The classic filtering failure:** with iterative scans off, a filter matching 10% of rows and `ef_search=40` returns only about 4 rows on average for `LIMIT 10`. — [pgEdge docs](https://docs.pgedge.com/pgvector/v0-8-0/iterative-index-scans/)
- For very selective filters, the pgvector authors advise skipping the ANN index (an exact scan gives 100% recall) or using partial indexes or partitioning. — [PostgreSQL.org](https://www.postgresql.org/about/news/pgvector-080-released-2952/)
- An academic analysis finds pgvector's cost-based planner often misjudges costs and prefers approximate index scans even when an exact sequential scan would give perfect recall at similar latency **[independent]**. — [arXiv 2602.11443](https://arxiv.org/html/2602.11443v1)
- **Scale heuristics:**
  - Naive implementations often succeed at around 1M vectors. Memory becomes critical once the HNSW working set no longer fits in RAM. A dedicated database makes sense for sub-20ms p99 latency or billions of vectors. — [ClickHouse](https://clickhouse.com/resources/engineering/scale-vector-search-postgres) **[vendor: competitor]**
  - Use pgvector under about 5M vectors. — [noqta.tn](https://noqta.tn/en/blog/vector-database-comparison-2026-pgvector-pinecone-qdrant-weaviate)
  - pgvector is "fully production grade" for most workloads under 10M. — [alexcloudstar](https://alexcloudstar.com/blog/vector-database-comparison-2026/)
- pgvector with pgvectorscale (the StreamingDiskANN index) reportedly matches or beats Qdrant at large scale. — [Tiger Data](https://www.tigerdata.com/blog/pgvector-vs-qdrant) **[vendor: maker of pgvectorscale]**
- **turbopuffer:** managed-only, with indexes on object storage. It suits multi-tenant workloads with thousands of namespaces and has a cold-path latency penalty. Linear reportedly moved from Elasticsearch plus pgvector to turbopuffer and cut costs by 70%. — [Sacra](https://sacra.com/c/turbopuffer), [alexcloudstar](https://alexcloudstar.com/blog/vector-database-comparison-2026/)
- **Qdrant:** runs the same engine self-hosted, in a private cloud, managed or at the edge. Using it alongside Postgres means running "two databases and sync logic." — [alexcloudstar](https://alexcloudstar.com/blog/vector-database-comparison-2026/), [encore.dev](https://encore.dev/articles/pgvector-vs-qdrant)
- Several 2026 comparisons agree on three points. Hybrid BM25-plus-vector search is now expected. Quantization is common. Filtered HNSW recall is "largely solved" in pgvector 0.8, Qdrant and Weaviate. For most teams, chunking, embedding and reranking matter more than the store. — [noqta.tn](https://noqta.tn/en/blog/vector-database-comparison-2026-pgvector-pinecone-qdrant-weaviate), [dev.to](https://dev.to/alexcloudstar/vector-database-comparison-2026-pgvector-pinecone-turbopuffer-and-qdrant-55ak)

### Inferences
- **When pgvector is enough:** you already run Postgres, have fewer than about 5–10M vectors, the index fits in RAM, you can live with p95 latency of tens of milliseconds, and you need joins, row-level security or transactional consistency with your business data. This describes most consulting-client RAG projects.
- **Signals to move off pgvector:**
  - hundreds of millions of vectors
  - heavy multi-tenancy with per-tenant indexes
  - a need for native hybrid or sparse search, or multi-vector (ColBERT-style) search
  - index builds or RAM becoming the bottleneck
- Postgres hybrid search is usually built with pgvector plus full-text search (`tsvector`), or with a BM25 extension such as ParadeDB's pg_search or VectorChord-bm25, fused in SQL with RRF. — see [Crunchy Data hybrid search](https://www.crunchydata.com/blog/hybrid-vector-search)

### Gaps
- I found no independent, reproducible 2026 benchmark across pgvector, Qdrant, Weaviate, Milvus, Pinecone, turbopuffer, LanceDB and Chroma at a common scale. Most comparisons are vendor or blog content.
- I found no current verified pricing.
- I did not separately research Elasticsearch/OpenSearch, LanceDB or Chroma in 2026. My general knowledge, not verified this session: Elasticsearch/OpenSearch are the natural choice when an organization already runs them for BM25 search. LanceDB is embedded and file-based. Chroma is popular for prototyping and now offers a hosted cloud.

## 3. Hybrid search and reranking: are they default, and what do they gain?

### Takeaway
Yes. By 2026, "BM25 plus dense retrieval, fused with RRF, then a cross-encoder reranker" is the standard production baseline, not an advanced add-on. The most cited evidence is Anthropic's contextual retrieval study. It cut top-20 retrieval failures from 5.7% to 2.9% with contextual embeddings plus BM25, and to about 1.9% with reranking, a 67% relative reduction. Hosted rerankers have converged in quality, so vendor-reported gaps are now within a few percent.

### Cited Findings
- **Anthropic Contextual Retrieval (Sept 2024, older but still the canonical reference):**
  - Contextual embeddings alone cut the top-20 retrieval failure rate from 5.7% to 3.7% (−35%).
  - Adding contextual BM25 brought it to 2.9% (−49%).
  - Adding a reranker gave −67% in total (about 1.9%).
  - Generating the chunk contexts cost about $1.02 per million document tokens, using prompt caching.
  - Sources: [Anthropic](https://www.anthropic.com/news/contextual-retrieval) **[prior knowledge, not re-fetched; vendor, but methodology published]**, confirmed by [Maginative](https://www.maginative.com/article/anthropics-contextual-retrieval-technique-enhances-rag-accuracy-by-67) and [Gradient Flow](https://gradientflow.com/contextual-retrieval-rag/)
- **Reranker comparisons (all [vendor]):**
  - Voyage rerank-2.5 beats Cohere Rerank v3.5 by 7.94% across 93 datasets, and by 12.70% on MAIR (an instruction-following retrieval benchmark).
  - Voyage rerank-3 beats Cohere Rerank v4.0 Pro by 2.14% and Qwen3-Reranker-8B by 3.31% across those 93 datasets.
  - rerank-3-lite reportedly matches rerank-2.5.
  - Sources: [OpenRouter: Voyage rerank-2.5](https://openrouter.ai/ko-KR/voyageai/rerank-2.5), [OpenRouter: rerank-3](https://openrouter.ai/voyageai/rerank-3), [rerank-3-lite](https://openrouter.ai/voyageai/rerank-3-lite)
- **BEIR, unified top-100 protocol:** jina-reranker-v3.5 scores 63.20 nDCG@10 versus 62.28 for Qwen3-Reranker-4B. This is **[vendor]**, Jina reporting. — [Jina](https://jina.ai/models/jina-reranker-v3.5/)
- **TREC RAG 2025:** the top retrieval-track system (U. Tokyo, nDCG@30 = 0.693, 1st of 12 teams and 46 runs) combined sparse and dense retrievers, HyDE and **LLM reranking**. This is evidence that strong systems stack hybrid retrieval and reranking **[independent]**. — [TREC 2025 UTokyo paper](https://trec.nist.gov/pubs/trec34/papers/UTokyo.rag.pdf)
- 2026 comparisons describe hybrid search as "now expected," with pure dense retrieval no longer the recommended starting point. — [noqta.tn](https://noqta.tn/en/blog/vector-database-comparison-2026-pgvector-pinecone-qdrant-weaviate)

### Inferences
- **Why hybrid works:** dense vectors catch paraphrases ("cancel subscription" matches "terminate plan"). BM25 catches exact tokens such as product codes, names, error strings and legal article numbers, where embeddings are weak. RRF (reciprocal rank fusion) merges the two rankings by summing 1/(k + rank) and needs no score calibration, which is why it became the default fusion method.
- **Why rerank works:** a cross-encoder reads the query and each candidate together, which is much more accurate than comparing two independent vectors, but too slow to run over the whole corpus. So you retrieve about 50–150 candidates cheaply and then rerank to the top 5–20.
- **Reranker tooling:**
  - Hosted: Cohere Rerank (v3.5 or v4) and Voyage rerank.
  - Self-hosted: Qwen3-Reranker (0.6B, 4B, 8B), BGE-reranker-v2-m3 and Jina.
  - Late interaction (ColBERT, ColPali for documents as images) sits between the two as a middle ground. It stays niche because of storage cost (one vector per token), though Qdrant, Vespa and LanceDB support multi-vector search.

### Gaps
- I have no independent, non-vendor head-to-head of current rerankers on a shared benchmark.
- I have no 2026 data on reranker latency or cost.
- I did not find a recent independent study isolating hybrid-vs-dense gains beyond Anthropic's and the BEIR tradition. As background from prior knowledge, not re-verified: BM25 remains competitive on BEIR out-of-domain tasks.

## 4. Query transformation: rewriting, HyDE, multi-query, decomposition, step-back

### Takeaway
These techniques are situational tools, not defaults. The default that has stuck is lightweight LLM query rewriting: turning a conversational follow-up into a standalone query and extracting metadata filters. In 2025–2026, decomposition and multi-query increasingly happen *inside* agentic loops, where the model issues several searches itself, rather than as fixed pipeline stages. HyDE helps in zero-shot or domain-mismatch settings but adds an LLM call to every query. Controlled head-to-head evidence is thin.

### Cited Findings
- **HyDE in TREC RAG 2025:** the first-place retrieval system used a "HyDE Vector Mix" that blends the embeddings of the original query and of a hypothetical answer. It was combined with hybrid retrieval and LLM reranking, so HyDE's own contribution is not isolated. — [TREC 2025 UTokyo](https://trec.nist.gov/pubs/trec34/papers/UTokyo.rag.pdf)
- **Decomposition in TREC RAG 2025:** Glasgow found that decomposing long, multi-aspect queries gives a practical baseline that "remains limited by the quality of query decomposition." Answers often addressed only part of the information need. — [TREC 2025 uogTr](https://trec.nist.gov/pubs/trec34/papers/uogTr.rag.pdf)
- **Multi-query:** it raises recall but typically needs a reranker to manage the expanded candidate set (ARAGOG reports no effectiveness numbers). — [ARAGOG, arXiv 2404.01037](https://arxiv.org/pdf/2404.01037)
- **Original HyDE (2022, older):** zero-shot, it beat BM25 and unsupervised Contriever on TREC DL19/20. — [Gao et al., arXiv 2212.10496](https://arxiv.org/abs/2212.10496) **[prior knowledge]**; [summary](https://systems-analysis.ru/eng/Hypothetical_Document_Embeddings_(HyDE))
- **Practitioner view:** decomposition helps most on multi-hop questions, over-decomposition is a common failure, and a router that decides when to transform the query is recommended. — [tianpan.co, Apr 2026](https://tianpan.co/blog/2026/04/26/query-rewriting-rag-retrieval-shape)

### Inferences
- Step-back prompting (Google DeepMind, 2023) shows up in tutorials more than in production write-ups, so I would class it as niche.
- Modern rerankers and strong embedders shrink HyDE's benefit, and its latency cost is real. Use it when queries and documents look very different, for example short questions against technical prose.

### Gaps
- I found no controlled 2025–2026 study comparing HyDE, multi-query, decomposition and step-back on a common benchmark.

## 5. GraphRAG (Microsoft GraphRAG, LightRAG, LazyGraphRAG)

### Takeaway
GraphRAG is niche, not default. It helps with "global" sensemaking questions over a whole corpus ("what are the main themes across these 5,000 reports?") and with multi-hop entity questions. Full Microsoft GraphRAG indexing is expensive. LazyGraphRAG and LightRAG were built to cut that cost. Independent benchmarks from 2025 find graph methods often *underperform* vanilla RAG on simple fact lookup, and the GraphRAG-Bench authors conclude that lightweight graph frameworks are far more cost-effective.

### Cited Findings
- **LazyGraphRAG [vendor, Microsoft]:**
  - Indexing costs the same as vector RAG, about 0.1% of full GraphRAG's indexing cost.
  - On global queries it matches GraphRAG Global Search at more than 700 times lower query cost.
  - At 4% of GraphRAG global search's query cost, it beat the competing methods on both local and global queries.
  - Microsoft positions it for one-off queries, exploratory analysis and streaming data.
  - Source: [Microsoft Research blog](https://www.microsoft.com/en-us/research/blog/lazygraphrag/)
- **GraphRAG-Bench [independent]:** building the full GraphRAG index took about 79.9M tokens and 11,181 seconds, versus about 10.1M tokens for RAPTOR. — [arXiv 2506.02404](https://arxiv.org/pdf/2506.02404)
- **"When to use Graphs in RAG" [independent]:** LazyGraphRAG indexing took about 591K tokens in total, and lightweight frameworks are "a far more cost-effective solution." The paper examines when GraphRAG beats ordinary RAG. — [arXiv 2506.05690](https://arxiv.org/pdf/2506.05690)
- **Availability:** one secondary source claims that, as of July 2026, LazyGraphRAG ships in Microsoft Discovery and Azure Local rather than in the open-source `graphrag` package. This is unverified. — [techsy.io](https://techsy.io/en/blog/graphrag-guide)
- **Original Microsoft GraphRAG paper (2024):** it builds an LLM-extracted entity graph with community summaries and targets "query-focused summarization" over a whole corpus. — [Edge et al., arXiv 2404.16130](https://arxiv.org/abs/2404.16130) **[prior knowledge]**

### Inferences
- **Consultant framing:** recommend GraphRAG only when (a) users really ask corpus-wide thematic questions, or (b) the domain is entity-dense and multi-hop, such as investigations, compliance relationships or supply chains, and (c) a vector-plus-rerank baseline has measurably failed. Otherwise the indexing cost and pipeline complexity aren't justified.
- LightRAG is the popular open-source lightweight alternative. I have no 2026 performance data on it beyond its inclusion in the benchmarks above.

### Gaps
- I did not extract the per-task accuracy tables from arXiv 2506.05690, which show where graphs win or lose.
- I found no independent replication of LazyGraphRAG's quality claims.

## 6. Agentic RAG, retrieval as a tool, and "agentic search" replacing single-shot retrieval

### Takeaway
By 2026 the frontier pattern is retrieval as a *tool* that an LLM agent calls repeatedly. The agent reformulates, filters, reads and searches again, instead of a single fixed retrieve-then-generate pass. The best-known example is Claude Code, which dropped its vector index in favor of grep, glob and file reads. The consensus is nuanced. For code and other structured, lexically rich corpora that change often, agentic lexical search is simpler and often better. Semantic indexes still add value for fuzzy natural-language corpora, for very large corpora, and for latency- or cost-sensitive single-shot applications. Many people in the field frame "RAG is dead" as "RAG became a tool call."

### Cited Findings
- Boris Cherny (Claude Code lead) said early Claude Code used RAG with a local vector database, but "agentic search generally works better," and it is simpler: no index to keep in sync, no chunking or embedding pipeline, and the agent always sees current files. — reported in [AI Engineer Europe 2026 talk by Kuba Rogut (turbopuffer)](https://www.ai.engineer/talks/UM6sFg_jdlE-rag-is-dead-right-kuba-rogut), [MindStudio](https://www.mindstudio.ai/blog/is-rag-dead-what-ai-coding-agents-use-instead). This is secondhand; I found no primary transcript.
- Rogut's own talk notes that the decision doesn't prove semantic retrieval is unsuitable for every coding agent. Note that he works at a vector database vendor. — [AI Engineer](https://www.ai.engineer/talks/UM6sFg_jdlE-rag-is-dead-right-kuba-rogut)
- A separate AI Engineer Europe 2026 talk benchmarked semantic code retrieval added to Claude Code. It made context discovery more selective, with recall depending on the task. — [AI Engineer talk](https://www.ai.engineer/talks/zKk7sDMGDEQ-benchmarking-semantic-code-retrieval-on-claude)
- Practitioner write-ups argue for combining grep with RAG for code, not choosing one. — [Medium](https://medium.com/@jhanavibehl/code-retrieval-grep-rag-or-both-706cdefd0b70)

### Inferences
- **Why agentic search works:** the model fixes bad queries itself (query transformation for free), can follow references across files (multi-hop for free), and verifies by reading. The costs are more tokens and more latency per question, often 5–20 tool calls and many seconds, versus one retrieval call.
- **Practical pattern for client work:** expose hybrid search (and, where relevant, grep, SQL or metadata filters) as tools to a capable model, and keep a single-shot path for high-volume, low-latency FAQ-style queries. Deep-research products (OpenAI, Google, Anthropic) are this pattern taken to its limit.

### Gaps
- I found no rigorous public benchmark comparing agentic search against single-shot RAG on non-code enterprise corpora, with cost and latency included.
- I did not retrieve practitioner write-ups from Jason Liu or Hamel Husain in this session. Their known stance, from prior knowledge and unverified here, is to treat retrieval as a measurable search problem: build eval sets, measure recall@k, and segment queries before adding techniques.

## 7. Long-context models vs RAG; context rot; prompt-caching economics

### Takeaway
Long context has not replaced retrieval. Models still degrade as input grows, even on trivial tasks ("context rot"). Needle-in-a-haystack scores overstate real long-context ability. Head-to-head studies find no universal winner: long context can win on quality for whole-document synthesis, while RAG is far cheaper and wins when retrieval is good. The emerging practice is to route between the two, and for small, stable corpora (roughly under a few hundred thousand tokens) to put everything in context and rely on prompt caching.

### Cited Findings
- **Chroma "Context Rot" (July 14, 2025) [independent-ish; Chroma sells retrieval]:**
  - 18 models were tested, including Claude Opus 4, GPT-4.1, o3, Gemini 2.5 Pro and Qwen3, across 194,480 LLM calls.
  - Performance degraded with length in every experiment.
  - Lower similarity between the question and the "needle" (the target fact), and the presence of distractors, sped up degradation.
  - Shuffled haystacks counterintuitively beat coherent ones.
  - On LongMemEval (full inputs averaging about 113K tokens versus focused inputs of about 300 tokens), the focused prompts beat the full prompts for every model family.
  - Claude models hallucinated least and abstained more. GPT models hallucinated most.
  - The authors conclude that NIAH-style benchmarks overstate reliability, and they advocate "context engineering."
  - Source: [Chroma Research](https://trychroma.com/research/context-rot)
- **LaRA (ICML 2025) [independent]:** 2,326 test cases, 11 models. The best choice between RAG and long context depends on model capability, context length, task type and retrieval quality: "No Silver Bullet." The authors argue that earlier comparisons suffered from short contexts and data leakage. — [PMLR](https://proceedings.mlr.press/v267/li25dv.html), [arXiv 2502.09977](https://arxiv.org/html/2502.09977v1)
- **Li et al. 2024, "RAG or Long-Context LLMs?" (Google DeepMind) [independent]:** on LongBench and ∞Bench, long context beat RAG on quality while RAG was much cheaper. They proposed "Self-Route," where the model decides whether it can answer from retrieved chunks and otherwise falls back to the full context. This kept quality close to long context at much lower cost. — [arXiv 2407.16833](https://arxiv.org/html/2407.16833v1)
- A claim that long context costs about 26 times more tokens per query than RAG is circulating but **unverified**. — [IntuitionLabs](https://intuitionlabs.ai/articles/long-context-ai-vs-retrieval-rag)
- **RULER (NVIDIA, 2024):** many models claiming 32K+ context fell well short of that "effective context length" on harder-than-NIAH tasks. — [Hsieh et al., arXiv 2404.06654](https://arxiv.org/abs/2404.06654) **[prior knowledge, not re-fetched; older]**
- **"Lost in the Middle" (2023):** information placed mid-context is used less reliably. — [Liu et al., arXiv 2307.03172](https://arxiv.org/abs/2307.03172) **[prior knowledge; older. Chroma's 2025 NIAH test found no notable position effect, so this is partially contested for newer models.]**
- **Prompt caching economics:** cached input tokens are billed at a steep discount on both Anthropic and OpenAI, roughly 90% off for Anthropic cache reads, plus a write premium. This makes "put the whole knowledge base in a cached prefix" viable for small corpora. Anthropic's contextual-retrieval post explicitly recommends simply including the whole knowledge base in the prompt when it is under about 200K tokens (about 500 pages). — [Anthropic contextual retrieval](https://www.anthropic.com/news/contextual-retrieval), [Anthropic prompt caching docs](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching) **[prior knowledge, not re-fetched; check current discounts]**

### Inferences
- **Rule of thumb for clients:**
  - A corpus under about 100–200K tokens that rarely changes: put it in context with caching. There's no RAG pipeline to maintain, and accuracy is often better.
  - Corpora that are larger, change often or need permissions: use RAG.
  - Synthesis over a few long documents: retrieve whole documents (coarse retrieval), then use long context.
- Context rot means that even when everything fits, *less but more relevant* context tends to give better answers. This is the core argument for keeping a retrieval or reranking step.

### Gaps
- I did not re-verify current (late-2026) prompt-caching prices or the context-window sizes of the latest models.
- I found no 2026 follow-up to the Chroma study that covers newer models with million-token contexts.
- The 26x cost figure has no primary source.

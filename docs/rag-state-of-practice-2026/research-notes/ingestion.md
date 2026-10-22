# RAG Ingestion State of Practice (late 2026): Parsing, Cleaning, Chunking, Metadata, Indexing Lifecycle

Research date: 2026-10-22. About 17 tool calls; some subtopics (cleaning, TS ecosystem) were thinly covered and are flagged in Gaps. "Vendor" = benchmark run or published by a party selling one of the compared products.

## 1. Document parsing: tools, consensus picks, and independent benchmarks

### Takeaway
Parsing of born-digital text PDFs is largely solved. The hard parts are tables (merged cells), scans and old documents, formulas, multi-column reading order, and charts. Since 2025 the field has moved from rule/pipeline parsers (PyMuPDF, Unstructured, Docling's classic pipeline, Marker 1.x) toward small specialized vision-language OCR models (PaddleOCR-VL, MinerU2.5, olmOCR, Chandra, dots.ocr, DeepSeek-OCR, GLM-OCR). These models now top both independent benchmarks and can be self-hosted on a single GPU. Cloud APIs (Azure DI, Textract, Google Document AI, Mistral OCR, LlamaParse, Reducto) remain the low-ops choice. Their accuracy claims come mostly from vendors.

### Cited Findings

**OmniDocBench (OpenDataLab/Shanghai AI Lab; CVPR 2025 benchmark; the de facto independent leaderboard for layout-rich parsing)**
- The leaderboard table is labeled "v1.6_full". The README changelog records a v1.6 major update (2026-04-10), a move to v1.7 on 2026-04-30, and new entries added 2026-09-11 (TeleOCR, OvisOCR2, Unlimited-OCR). It is unclear whether the table reflects v1.7. — [OmniDocBench GitHub](https://github.com/opendatalab/OmniDocBench)
- Top specialized VLMs, scored on Overall↑, Text edit distance↓, Formula CDM↑, and Table TEDS↑:
  - TeleOCR: 96.91, 0.027, 96.59, 96.82
  - OvisOCR2: 96.47
  - PaddleOCR-VL-1.6: 96.34, 0.033, 97.53, 94.76
  - MinerU2.5-Pro: 95.75, 0.036, 97.45, 93.42
  - GLM-OCR: 95.22
  - PaddleOCR-VL-1.5: 94.93
  - MinerU-2.5: 93.04
  — [OmniDocBench GitHub](https://github.com/opendatalab/OmniDocBench)
- General-purpose VLMs score lower than the specialized models:
  - Ovis2.6-30B-A3B: 93.70
  - Gemini 3 Pro: 92.91 (table TEDS 89.15)
  - Gemini 3 Flash: 92.62
  - Qwen3-VL-235B: 89.78
  - GPT-5.2: 86.59 (text edit distance 0.114, table TEDS 82.95)
  — [OmniDocBench GitHub](https://github.com/opendatalab/OmniDocBench)
- Classic pipeline tools score lower still. MinerU-Pipeline gets 86.47 overall (table TEDS 81.88). Marker gets 78.44 (table TEDS 65.77, though formulas are good at 85.24). Docling and PP-StructureV3 are listed as evaluated but have no scores in the current table. — [OmniDocBench GitHub](https://github.com/opendatalab/OmniDocBench)
- PaddleOCR-VL-1.6's model card claims SOTA at 96.33% on OmniDocBench v1.6. A Roboflow article from August 2026 reports the same ranking (PaddleOCR-VL 0.9B first, MinerU2.5-Pro 1.2B second, GLM-OCR 0.9B third). — [HF PaddleOCR-VL-1.6](https://huggingface.co/burll/PaddleOCR-VL-1.6); [PaddleOCR-VL-1.6 paper](https://arxiv.org/pdf/2606.03264); [Roboflow](https://roboflow.com/blog/best-open-source-ocr-models)
- The models at the top are small, roughly 0.9B to 1.2B parameters, so they are cheap to self-host. — [Roboflow](https://roboflow.com/blog/best-open-source-ocr-models)

**olmOCR-Bench (AllenAI; uses unit-test style pass/fail checks rather than edit distance)**
- Table from the olmOCR README. Overall score is followed by notable category scores. Asterisked entries were self-reported or third-party.
  - Chandra OCR 0.1.0*: 83.1 (tables 88.0, old scans 50.4)
  - Infinity-Parser 7B*: 82.5
  - olmOCR v0.4.0: 82.4
  - PaddleOCR-VL*: 80.0
  - Marker 1.10.1: 76.1
  - DeepSeek-OCR: 75.7
  - MinerU 2.5.4*: 75.2 (tables 84.9)
  - Mistral OCR API: 72.0 (tables 60.6, old scans 29.3)
  - Nanonets-OCR2-3B: 69.5 (headers/footers only 32.1)
  — [olmOCR GitHub](https://github.com/allenai/olmocr); [olmOCR 2 paper](https://arxiv.org/pdf/2510.19817)
- "Old scans" is the weakest category for every system, at 29 to 50. "Base" (simple text) is about 99 for nearly all of them. This is the clearest numeric evidence that plain text extraction is solved and degraded scans are not. — [olmOCR GitHub](https://github.com/allenai/olmocr)
- olmOCR v0.4.0 (Oct 2025) is Apache-2.0. It needs an NVIDIA GPU with 12 GB or more of memory and costs less than $200 per million pages to self-host. — [olmOCR GitHub](https://github.com/allenai/olmocr)
- Later entries reported by aggregators (unverified against primary sources): Chandra 2 (4B, March 2026) at about 85.9, dots.mocr 83.9, LightOnOCR-2-1B 83.2. — [benchmarklist.com](https://benchmarklist.com/benchmarks/olmocr_bench/); [emelia.io](https://emelia.io/pt/hub/chandra-ocr-tables-handwriting)
- The Mistral OCR 72.0 figure is for the older Mistral OCR API. The Falcon Perception paper reports Mistral OCR 3 at 81.7 on a category-averaged table that is not directly comparable. — [Falcon Perception paper](https://arxiv.org/pdf/2603.27365)

**Note: the two benchmarks rank tools differently.** MinerU and PaddleOCR-VL top OmniDocBench, which is heavy on Chinese and English academic and textbook pages. On olmOCR-Bench, MinerU 2.5.4 sits below Marker. The benchmark you choose changes the winner, so a client's own document sample is the deciding test. — [OmniDocBench](https://github.com/opendatalab/OmniDocBench); [olmOCR](https://github.com/allenai/olmocr)

**Docling (IBM Research → LF AI & Data)**
- Docling is MIT-licensed (bundled models carry their own licenses) and has about 69.4k GitHub stars. — [Docling GitHub](https://github.com/docling-project/docling)
- It covers the broadest range of formats of any tool here:
  - PDF, DOCX, PPTX, XLSX, HTML, EPUB, LaTeX, ODF, XBRL
  - Email (EML, MSG) and images
  - Audio and video, via ASR
  — [Docling GitHub](https://github.com/docling-project/docling)
- It handles layout, reading order, tables, formulas, and code. It supports VLM pipelines (GraniteDocling) and exports lossless JSON or DoclingDocument, Markdown, HTML, and DocTags. It runs locally or air-gapped and ships a docling-serve API server, an MCP server, and integrations with LangChain, LlamaIndex, Haystack, and CrewAI. Python 3.9 support was dropped in 2.70.0. — [Docling GitHub](https://github.com/docling-project/docling)
- Datalab, Marker's maker (vendor claim), ran olmOCR-bench and reports Marker 76.0 vs Docling 50.3 overall, and 83.5 vs 64.0 on born-digital pages. It also reports Marker at 2.9 pages/s vs Docling at 2.1. Docling ran its default pipeline. — via [themenonlab comparison](https://themenonlab.blog/blog/best-open-source-pdf-to-markdown-tools-2026) / [idp-software Datalab profile](https://idp-software.com/vendors/datalab/)

**Cloud and commercial**
- Mistral OCR 3 (model `mistral-ocr-2512`, Dec 2025) costs $2 per 1,000 pages, or $1 per 1,000 via the Batch API. Annotations cost $3 per 1,000. A self-hosting option exists for privacy-sensitive customers. — [Mistral](https://mistral.ai/news/mistral-ocr-3); [The Decoder](https://the-decoder.com/mistral-ocr-3-promises-better-cheaper-document-analysis/)
- Textract and Google Document AI cost roughly $1.50 to $15 per 1,000 pages depending on features (secondary source). — [PyImageSearch](https://pyimagesearch.com/2025/12/23/mistral-ocr-3-technical-review-sota-document-parsing-at-commodity-pricing/)
- RD-TableBench (Reducto's own 1,000 complex tables, vendor-run, with open data and grading code) reports these scores:
  - Reducto: 90.2
  - Azure Document Intelligence: 82.7
  - AWS Textract: 80.9
  - Google Document AI: 64.6

  For LlamaParse Premium, Reducto gave no number. It said LlamaParse struggled with merged cells because it outputs only Markdown tables, and cited a cost of $0.045 per page. — [Reducto Azure eval](https://reducto.ai/blog/evaluating-azure-document-intelligence-for-pdf-parsing); [Reducto LlamaParse eval](https://reducto.ai/blog/evaluating-llamaparse-for-pdf-parsing); [Reducto Google eval](https://reducto.ai/blog/evaluating-google-document-ai-for-pdf-parsing)
- LlamaParse is LlamaIndex's cloud parser, aimed at dense tables, multi-column layouts, charts, and handwriting. In March 2026 LlamaIndex released LiteParse, an open-source, local-first parser with a TypeScript/Node package. — [MarkTechPost](https://www.marktechpost.com/2026/03/19/llamaindex-releases-liteparse-a-cli-and-typescript-native-library-for-spatial-pdf-parsing-in-ai-agent-workflows/); [idp-software](https://idp-software.com/vendors/llamaparse/)

### Inferences
- **Consensus picks by document type** (synthesis; no single source states this):
  - **Born-digital PDFs:** PyMuPDF/pymupdf4llm for speed and simplicity, or Docling or Marker when structure matters.
  - **Scanned or complex-layout documents:** a specialized VLM OCR such as PaddleOCR-VL, MinerU2.5, olmOCR, or Chandra if self-hosting, or Mistral OCR 3, Azure DI, or Reducto in the cloud.
  - **Tables:** VLM OCRs or Reducto/Azure. Avoid plain text extractors and Markdown-only table output when merged cells matter.
  - **Office and HTML:** Docling, because its format coverage is the broadest, or Unstructured.
  - **Calling GPT or Gemini directly:** this works but trails specialized OCR models on OmniDocBench and costs more per page.
- **Self-hostable:** Docling, Marker (open weights; check Datalab's commercial license terms), MinerU, PaddleOCR-VL, olmOCR, Chandra, PyMuPDF (AGPL or commercial license), Unstructured OSS, and LiteParse.
- **Cloud-only or primarily cloud:** LlamaParse, Azure DI (container options exist), Textract, Google Document AI, and Reducto. Mistral OCR is cloud, with self-hosting for enterprise customers.
- Benchmark rankings churn every few months, with a new top model roughly every quarter. A consultant should recommend a parsing interface that keeps the parser swappable, plus a small client-specific evaluation set, rather than committing to one model.

### Gaps
- No independent head-to-head across Unstructured, LlamaParse, Azure DI, Textract, Google DocAI, and Reducto was found. Reducto's RD-TableBench is vendor-run, and the Marker-vs-Docling numbers are vendor-run.
- Docling has no current OmniDocBench or olmOCR-Bench score in the primary tables.
- Current Unstructured details (OSS vs. platform, accuracy) and current pymupdf4llm details were not researched in this session.
- No evidence was gathered on Office or HTML parsing quality. Benchmarks are PDF and image only.

## 2. Cleaning: header/footer removal, dedup, boilerplate, encoding, PII

### Takeaway
Cleaning is mostly handled implicitly by modern layout-aware parsers. They classify headers, footers, and page numbers as layout elements and drop them, and olmOCR-Bench even scores this as a category. Explicit cleaning steps (encoding repair, near-duplicate removal, PII redaction) are standard engineering hygiene, but this session found little 2025-2026 evidence quantifying their impact on RAG.

### Cited Findings
- olmOCR-Bench has a dedicated "headers & footers" category, which shows that suppressing them varies a lot by tool:
  - MinerU: 96.6
  - PaddleOCR-VL: 97.0
  - olmOCR: 96.1
  - Mistral OCR: 93.6
  - Marker: 86.6
  - Nanonets-OCR2-3B: 32.1

  — [olmOCR GitHub](https://github.com/allenai/olmocr)
- LangChain's indexing API deduplicates by hashing content plus metadata (sha1 by default; sha256, sha512, and blake2b available), which skips identical re-ingested documents. — [LangChain indexing docs](https://python.langchain.com/docs/how_to/indexing); [API reference](https://reference.langchain.com/python/langchain-core/indexing/api/index)

### Inferences
- **Typical standard practice** (from general practitioner knowledge, not sourced this session; verify before quoting):
  - ftfy for mojibake and encoding repair
  - Unicode NFKC normalization and de-hyphenation across line breaks
  - Exact-hash dedup, plus MinHash/LSH for near-duplicates in large corpora
  - Microsoft Presidio (open source; NER + regex recognizers, with an anonymizer) for PII detection and redaction before embedding, or cloud equivalents such as AWS Comprehend PII and Azure AI Language PII
  - trafilatura or readability-style extraction to strip HTML boilerplate
- Choosing a parser whose headers/footers score is high removes most of the need for custom regex cleanup on PDFs.

### Gaps
- No 2025-2026 benchmark quantifying how cleaning steps (dedup, PII redaction, boilerplate removal) affect retrieval quality was found.
- Presidio and ftfy primary docs were not fetched in this session, so claims about them are background knowledge.

## 3. Chunking: what evaluations show matters

### Takeaway
The evidence converges on one point: respect natural structure (paragraphs, sections, pages) and use moderate sizes. Expensive embedding-based "semantic chunking" is not reliably worth its cost. Differences among reasonable strategies are often a few points, while naive fixed-character splitting with tiny chunks is clearly bad. Gains from context-injection techniques such as contextual retrieval and late chunking are larger and more consistent than gains from changing split boundaries.

### Cited Findings
- **Chroma Research, "Evaluating Chunking Strategies for Retrieval" (July 2024; older but still widely cited).** Setup: 472 queries over 5 corpora, text-embedding-3-large, 5 chunks retrieved. Results from the appendix:

  | Splitter | Size (tokens) | Recall | Precision |
  |---|---|---|---|
  | TokenTextSplitter | 200 | 86.7% | 5.1% |
  | RecursiveCharacterTextSplitter | 200 | 88.5% | 7.0% |
  | ClusterSemanticChunker | 200 | 89.0% | 6.7% |
  | LLMSemanticChunker | ~240 | 91.7% | 3.9% |

  The takeaway is that recursive splitting at about 200 tokens with no overlap is a strong, cheap default. Primary report: research.trychroma.com/evaluating-chunking (not fetched; figures come via secondary sources). — [techsy.io summary](https://techsy.io/de/blog/rag-chunking-strategien); [plushcap summary](https://www.plushcap.com/companies/chroma/blog/summaries/2024/07)
- **Vectara: "Is Semantic Chunking Worth the Computational Cost?" (Qu, Bao, Tu; arXiv 2410.13070, Oct 2024).** The paper tested document retrieval, evidence retrieval, and answer generation on RAGBench-derived data. It concludes that semantic chunking's computational cost is not justified by consistent gains over fixed-size chunking. — [arXiv](https://arxiv.org/html/2410.13070v1); [Vectara blog](https://www.vectara.com/blog/is-semantic-chunking-worth-the-computational-cost)
- **NVIDIA developer blog (2024): "Finding the Best Chunking Strategy for Accurate AI Responses".** Page-level chunking had the highest average end-to-end accuracy at 0.648, with the lowest standard deviation (0.107). Token-based variants scored 0.603 to 0.645, so the margin is small. The result applies to paginated documents whose pages are coherent units. — [NVIDIA blog](https://developer.nvidia.com/blog/finding-the-best-chunking-strategy-for-accurate-ai-responses/)
- **Shaukat, Adnan, Kuhn (Univ. of Canberra), arXiv 2603.06976 (March 2026), the largest recent sweep.** Setup: 36 strategies × 6 domains × 5 embedding models (1,080 configurations), retrieval only, top 5 chunks, LLM-judged relevance. Mean nDCG@5 by strategy:
  - Paragraph Group Chunking (2 paragraphs, 1-paragraph overlap): ~0.459. Best overall; P@1 ~24%, Hit@5 ~59%.
  - Dynamic token sizing (50 to 200 tokens): ~0.441
  - LLM boundary detection: ~0.415
  - Fixed 100-character chunks (baseline): ~0.244; P@1 ~2-3%

  No single strategy won every domain: paragraph grouping led in legal and maths, dynamic sizing in biology, health, and physics. The embedding model also mattered (bge-m3 0.456 vs MiniLM 0.416). Very fine chunks inflate the index, and very coarse chunks dilute relevance. Limitations: a single LLM judge, single runs, and no proposition chunking. — [arXiv 2603.06976](https://arxiv.org/html/2603.06976v1)
- **Late chunking (Jina AI; Günther et al., arXiv 2409.04701, 2024).** The method embeds the whole document with a long-context embedding model, then mean-pools token embeddings per chunk, so each chunk vector carries document context. Results:
  - A reported 2.70% to 3.63% relative nDCG@10 gain on BEIR (from a third-party summary of the paper).
  - Jina's blog: SciFact went from 64.20 to 66.10. TREC-COVID went from 63.36 to 64.70, but no chunking scored 65.18 there.
  - The gains are modest and depend on the embedding model.

  — [arXiv](https://arxiv.org/html/2409.04701v3); [Jina blog](https://jina.ai/de/news/late-chunking-in-long-context-embedding-models); [alphaXiv summary](https://alphaxiv.org/overview/2409.04701v3)
- **Practitioner defaults.** A PremAI 2026 guide calls recursive splitting at 512 tokens the benchmark-validated default for most RAG applications. This is vendor content. — [PremAI](https://blog.premai.io/rag-chunking-strategies-the-2026-benchmark-guide)
- A DEV Community article cites a February 2026 vendor benchmark in which fixed-size chunking beat semantic chunking on end-to-end answer accuracy. This is secondary and unverified. — [DEV](https://dev.to/saaswithalex/chunking-strategies-why-rag-pipelines-fail-before-model-run-1m40)
- Anthropic notes that standard RAG chunks are "usually no more than a few hundred tokens". Its cost example assumes 800-token chunks. — [Anthropic Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)

### Inferences
- **Practical sizes:** 200 to 512 tokens with 0% to 15% overlap is the mainstream range. Overlap matters less than respecting structure; Chroma found no-overlap recursive splitting competitive. Page-level chunks suit paginated reports.
- **Structure-aware chunking is the 2026 default** for parsed documents: heading-aware splitting that carries the heading path in each chunk, with tables kept whole. Docling's HybridChunker and Unstructured's "by_title" chunking implement this. This is background knowledge; the Docling README fetched here did not mention its chunkers.
- **Semantic (embedding-breakpoint) chunking** is generally not worth it.
- **Proposition chunking** (Dense X Retrieval, Chen et al. 2023) is expensive and rarely used in production. No recent benchmark was found.
- Chunk size interacts with the embedding model and the query type: factoid queries favor smaller chunks, synthesis queries favor larger ones. Teams should tune on their own evaluation set rather than copy a number.

### Gaps
- The primary Chroma report was not fetched, so its figures come via secondaries.
- No 2025-2026 independent evaluation of proposition chunking was found.
- The Vectara paper's exact numeric tables were not extracted.
- The NVIDIA blog was not fetched directly, so its metric definition is unverified.

## 4. Metadata and enrichment: contextual headers, Contextual Retrieval, summaries, filters

### Takeaway
Adding document-level context to each chunk before embedding and BM25 indexing is the best-evidenced ingestion improvement. Anthropic's Contextual Retrieval reports up to a 67% reduction in retrieval failures when combined with BM25 and reranking, at about $1 per million document tokens one-time with prompt caching. Cheaper variants exist: deterministic "contextual chunk headers" (document title plus section path prepended to each chunk) and late chunking. Structured document metadata for filtering (source, date, ACL, doc type, version) is standard and essential for permissions and deletion.

### Cited Findings
- **Anthropic Contextual Retrieval (Sept 2024; still the reference technique).** The baseline top-20 retrieval failure rate was 5.7%. Results:
  - Contextual Embeddings: 3.7% (−35%)
  - Contextual Embeddings + Contextual BM25: 2.9% (−49%)
  - Adding reranking: 1.9% (−67%)

  How it works: Claude 3 Haiku is given the full document and a chunk, and generates 50 to 100 tokens of context that are prepended to the chunk before both embedding and BM25 indexing.

  Cost: $1.02 per million document tokens one-time, with prompt caching. This assumes 8k-token documents and 800-token chunks.

  Recommendations:
  - Combine embeddings with BM25.
  - Use Gemini or Voyage embeddings, which tested best.
  - Retrieve the top 150, rerank, and pass the top 20 chunks.
  - Use domain-specific contextualizer prompts.
  - Skip RAG entirely if the knowledge base is under 200k tokens.

  — [Anthropic](https://www.anthropic.com/news/contextual-retrieval)
- **Late chunking** is an embedding-time alternative that injects context without LLM calls, giving roughly a 3% relative nDCG gain. — [arXiv 2409.04701](https://arxiv.org/html/2409.04701v3)
- LangChain's indexing hash covers page content and metadata, so a metadata change triggers re-indexing. — [LangChain docs](https://python.langchain.com/docs/how_to/indexing)

### Inferences
- Contextual Retrieval's gains were measured by Anthropic, a vendor, on its own datasets. The direction is widely corroborated by practitioners, but independent replications were not gathered in this session.
- The cost has fallen further with cheaper small models and batch APIs. Reprocessing the whole corpus when the context prompt changes is the hidden cost.
- **Typical metadata schema:**
  - doc_id, source_uri, title, section/heading path, page number
  - doc_type, created and updated dates
  - tenant or ACL groups, language
  - content hash and version
  - parser and chunker versions, so a re-parse can be targeted later
- **Doc-level summaries** are mainly used for routing and hierarchical retrieval (summary index → chunks), and less for chunk-level retrieval quality.

### Gaps
- No independent replication of Contextual Retrieval's numbers was retrieved.
- No quantitative study of deterministic contextual chunk headers was retrieved; dsRAG has published claims, but they were not fetched.

## 5. TypeScript/JavaScript ecosystem vs Python, and ingestion service architecture

### Takeaway
Ingestion remains Python-dominated, because the best parsers and OCR models (Docling, MinerU, Marker, PaddleOCR-VL, olmOCR, Unstructured) are Python and GPU-centric. The JS/TS ecosystem covers orchestration, splitting, and indexing (LangChain.js text splitters and indexing API, LlamaIndex.TS), plus lightweight parsing, with LiteParse added in March 2026. It otherwise calls cloud parsers via HTTP. The common architecture is a separate ingestion service or worker queue, often in Python, exposing an HTTP API (e.g., docling-serve) and called from a TS application backend.

### Cited Findings
- LiteParse (LlamaIndex, March 2026) is an open-source local parser with a Node/TS package (`npm i @llamaindex/liteparse`) and a CLI. It produces spatial text and Markdown output for RAG and agent pipelines. Sources disagree on its engine: one says PDF.js plus Tesseract.js, another says PDFium. — [MarkTechPost](https://www.marktechpost.com/2026/03/19/llamaindex-releases-liteparse-a-cli-and-typescript-native-library-for-spatial-pdf-parsing-in-ai-agent-workflows/); [LiteParse README](https://cdn.jsdelivr.net/npm/@llamaindex/liteparse@2.1.2/README.md); [LiteParse docs](https://developers.llamaindex.ai/liteparse/getting_started/)
- LangChain's indexing API (RecordManager, cleanup modes) exists in JS as well as Python. — [LangChain JS indexing](https://js.langchain.com/docs/how_to/indexing)
- Docling ships docling-serve (an API server) and an MCP server, so non-Python stacks can call it as a service. — [Docling GitHub](https://github.com/docling-project/docling)
- LlamaParse provides TypeScript examples for its cloud API. — [LlamaParse TS example](https://developers.llamaindex.ai/llamaparse/parse/examples/parse_pdf_typescript/index.md)

### Inferences
- **Recommended pattern for a TS shop:**
  1. Run a containerized Python parsing service (Docling, MinerU, or a VLM OCR behind vLLM) or use a cloud parser API.
  2. Put a queue in front of it (SQS, BullMQ, Pub/Sub), because parsing is slow and bursty and needs GPUs.
  3. Write normalized output (DoclingDocument JSON or Markdown) to object storage.
  4. Do chunking, enrichment, and embedding in either language.
  5. Upsert to the vector store with a record manager or ledger.

  Keeping raw files and parsed intermediates lets you re-chunk or re-embed without re-parsing, which is the costly GPU step.
- Pure JS parsing (pdf.js, unpdf, LiteParse) is fine for born-digital text PDFs but not competitive on scans or complex tables.

### Gaps
- No sources were retrieved on unpdf, mammoth, or officeparser, or on maturity metrics for LlamaIndex.TS and Mastra RAG.
- No published reference architectures (from AWS, Azure, or Databricks blogs) were fetched in this session.

## 6. Incremental re-indexing, versioning, deletion

### Takeaway
The standard approach is a record ledger that tracks a content hash per source document and per chunk. On re-ingest you skip unchanged items, replace changed ones, and delete chunks from removed sources. LangChain's indexing API is the most documented open implementation. Its main pitfall is that deletion of removed sources only happens in "full" mode, which requires the loader to return the complete dataset.

### Cited Findings
- LangChain's indexing API has four cleanup modes: None, Incremental, Full, and Scoped_Full. Here is how each handles changed and removed documents:
  - **Incremental:** cleans up as it writes. It removes outdated versions when content changes, but not documents whose source was deleted.
  - **Full:** removes stale versions and deleted sources after all batches are written. The loader must return the entire dataset, or valid docs will be deleted.
  - **Scoped_Full:** tracks source IDs in memory, for loaders that can't return everything at once. It does not delete removed sources.
  - **None:** does no cleanup.

  — [LangChain Python docs](https://python.langchain.com/docs/how_to/indexing); [API reference](https://reference.langchain.com/python/langchain-core/indexing/api/index)
- Other mechanics and constraints of the LangChain indexing API:
  - Documents are keyed by a hash of content plus metadata, and users cannot set the uid.
  - The vector store must support add-by-ID and delete-by-ID.
  - Don't use it on a store populated outside the API.
  - Cleanup relies on timestamps.

  — [LangChain docs](https://python.langchain.com/docs/how_to/indexing); [Flowise record managers](https://docs.flowiseai.com/integrations/langchain/record-managers)

### Inferences
- **Production practice beyond LangChain:**
  - Use deterministic chunk IDs, such as `{doc_id}:{version}:{chunk_index}` or a hash of the chunk text.
  - Store doc_id and version in metadata on every chunk so delete-by-filter works.
  - Write the new version, then delete the old one (or flip an "active version" flag) to avoid a retrieval gap.
  - Tombstone deletions coming from source-system webhooks or CDC.
  - Version the parser, chunker, and embedding model, since changing any of them is a full re-index (blue/green index swap).
  - Periodically reconcile the ledger against the source to catch missed deletes.
- In Postgres/pgvector setups, the ledger can simply be a `documents` table (hash, version, status) with chunks linked by a foreign key and cascade delete. This is the simplest way to get transactional consistency.
- The structural weakness of hash-only deduplication: editing one paragraph changes the document hash and causes a full re-embed of that document unless chunk-level hashes are compared. Chunk-level diffing saves embedding cost on large documents.

### Gaps
- No LlamaIndex IngestionPipeline/docstore docs were fetched (it offers upsert or dedup strategies keyed by doc hash; background knowledge).
- No 2025-2026 practitioner write-ups on blue/green re-embedding or ACL propagation were fetched.

# Lab journal

Retrieval-augmented generation, one stage at a time. Each stage is first understood by hand, then built with the tool production teams actually use (see [the research report](rag-state-of-practice-2026/report.md)). Stages are written up here as they're finished.

The source document is *Mathematics for Machine Learning* (`data/maths_for_ML.pdf`, 417 pages): a real PDF with equations, figures, running headers and margin notes. The small Markdown policy in `data/` was the warm-up.

## How it fits together

```
Mac (this project)                         home5070ti (GPU server, over Tailscale)
┌──────────────────────────────┐           ┌───────────────────────────────────┐
│ data/maths_for_ML.pdf ───────┼──────────►│ Docling :5001  (PDF → structure)  │
│ out/book.json ◄──────────────┼───────────│                                   │
│                              │           │                                   │
│ chunk ─► embed ─► store      │           │ vLLM :8000  (Qwen3-8B-FP8)        │
│ question ─► search ─► prompt ┼──────────►│ /v1/chat/completions              │
│               answer ◄───────┼───────────│                                   │
└──────────────────────────────┘           └───────────────────────────────────┘
              │ embeddings
              ▼
   Azure OpenAI (Foundry): text-embedding-3-large
```

- **Parsing** runs on the server's GPU with Docling, only while vLLM is stopped. How to run it on the server: `gpu-node-bootstrap/serving/docling.md`.
- **Generation** runs on the server: `http://home5070ti:8000/v1`, model `Qwen/Qwen3-8B-FP8`, context limit 8,192 tokens.
- **Embeddings** come from Azure OpenAI in our own Azure account.
- **Everything else** (chunking, storage, search, evaluation) runs on the Mac.

## Running

```bash
npm run dev
```

Nodemon watches `src/` and `data/` and reruns `src/index.ts` on every save. Type `rs` + Enter to force a rerun, Ctrl-C to stop. `tsx` runs the TypeScript without type-checking; type errors show in the editor.

## The RAG workflow

| # | Stage | Question it answers | Status |
|---|---|---|---|
| 0 | Setup | Can I iterate fast? | ✅ |
| 1 | Document discovery | What will people ask, and what are the documents really like? | Next |
| 2 | Parsing | How do the documents become clean, structured text? | ✅ (prose, formulas, figures) |
| 3 | Chunking | What are the units of retrieval? | ✅ first version |
| 4 | Embedding | How is meaning turned into vectors? | Model decided |
| 5 | Storage and search | How are the right chunks found? | |
| 6 | Generation | How does the model answer from them, with citations? | |
| 7 | Evaluation | How good is it, and where does it fail? | |

Each stage has a definition of done. Evaluation is listed last but starts in stage 1: the questions collected there are the test set.

### 0. Setup ✅

- [x] `npm run dev` reruns on save and prints to the terminal

### 1. Document discovery

**The first step of any RAG workflow.** Before choosing a single tool, find out two things: what people will ask, and what the documents actually are. Both decide everything after: the parser, how to chunk, what to exclude, and what "good" means.

**Questions.** Collect the questions real users will ask, as many as you can get (20–50 to start), with the answer and where in the documents it lives. These become the evaluation set. Real questions are short and messy; questions you invent tend to be longer and easier, which inflates scores later. The questions also show which document problems matter: if nobody asks about equations, perfect LaTeX matters less; if everyone does, it's the most important part.

**Documents.** Inventory the sources:

- **Formats:** web pages, Markdown, Word, born-digital PDFs, scans
- **Volume** and how often they change
- **Structure:** headings, tables, formulas, figures, multiple columns, forms
- **Noise:** headers and footers, page numbers, boilerplate, tables of contents, indexes, duplicates and outdated versions
- **Languages**
- **Access:** who is allowed to see which documents (retrieval must respect it)

Then pick a **sample of representative pages**, easy and hard, to test parsers on.

**For this lab:** one born-digital PDF typeset in LaTeX (it has a real text layer, so no OCR), 417 A4 pages. Prose with equations, figures with captions, running headers, page numbers, margin notes, numbered definitions, theorems and examples, plus front and back matter (contents, references, index). No access control. No real users, so the questions are written by hand from the book.

**Definition of done**
- [ ] 20 questions with the expected answer and the section or page it comes from, including some about equations and one the book can't answer
- [ ] The document's structure and noise are listed (above)
- [ ] A sample of pages picked for parser testing: plain prose, equation-heavy, a figure, a front-matter page

### 2. Parsing

**Turn each document into clean, structured text:** headings, paragraphs, lists, tables and formulas labelled as such, with the noise removed and each piece's page and position kept for citations. Every later stage depends on this output. The right tool depends on how complex the documents are, which is what discovery found out.

| Documents | Typical tool |
|---|---|
| Already text: web pages, Markdown, Confluence, Notion, Word | Simple loaders or format parsers (remark for Markdown, mammoth for Word). No heavy parser needed |
| Born-digital PDFs, mostly prose | PyMuPDF / pymupdf4llm, or Docling |
| PDFs with layout, tables, formulas | Docling, Marker, MinerU |
| Scans, old documents, handwriting | OCR vision models (PaddleOCR-VL, MinerU) or a managed service such as Azure Document Intelligence |

Choose by testing two or three candidates on the discovery sample and reading the output; the public benchmarks rank tools differently. Whatever the format, the pattern is the same: **parse into structure first, then clean and chunk the structure.**

#### Parser errors at scale

Every parser makes errors (the best score roughly 80–97 on benchmarks, 29–50 on old scans), so with many documents errors are guaranteed. Sort them into two kinds:

| Kind | Example from the book | Handling |
|---|---|---|
| **Systematic:** the same mistake everywhere, with a pattern | Equation numbers absorbed into formulas as `( 2 . 1 )`; the copyright footer sometimes labelled as body text | **One rule fixes every occurrence.** This is where cleaning effort goes |
| **Random:** rare, no pattern | A code snippet read as a formula; one empty formula out of 1,274 | **Measure whether it affects answers; usually accept it.** One-off fixes don't scale |

**Acceptable error has no industry-standard number, and it isn't set at the parsing level.** A parsing error matters only if it causes a wrong or missing answer to a question people actually ask. Agree the target with the client on their question set (for example: the right passage is retrieved X% of the time, the answer is correct Y% of the time), and weigh severity: a wrong answer is worse than "I don't know", so regulated use cases prefer abstaining.

**Workflow for a large corpus: bespoke per class of document, not per document.**

1. **Triage:** classify documents automatically by format, text layer (born-digital or scanned), size, tables. Most corpora collapse into a handful of classes.
2. **Route each class to a parser tier:** cheap for text-like documents, a layout parser for complex PDFs, OCR models or a managed service for scans. Tools are built for this (Unstructured's fast / hi_res / OCR strategies, Docling's pipelines).
3. **Sample-test each class:** 20–50 pages, list the systematic errors, write one cleaning rule per error.
4. **Catch failures with confidence scores:** re-parse low-confidence documents with a stronger tool, or flag them for a person, instead of indexing them silently. Docling returns a `confidence` field.
5. **Prioritize by what's asked:** spend effort on the documents that answer the most important questions.
6. **Measure end to end and keep monitoring:** rerun the question set after each change; feed real failures back into it.

**Done so far**
- **Markdown warm-up:** `src/clean.ts` parses the policy with remark (Markdown → tree), extracts the title and version line as metadata, drops the boilerplate paragraph and unwraps bold and italic.
- **Raw PDF:** `src/index.ts` reads pages with unpdf to look at the raw material: positioned text fragments with fonts and sizes.
- **Docling:** the whole book converted on the server GPU (prose, layout and formulas as LaTeX), saved to `out/book.json`.

**Cleaning (`npm run clean:book`, `src/cleanBook.ts`):** reads `out/book.json`, writes `out/book.clean.json`.
- Drops 58 copies of the footer that Docling labelled as body text (exact match against its furniture strings).
- Extracts equation numbers from 202 formulas (`( 2 . 1 )` → `equationNumbers: ["2.1"]`).
- Moves margin items out of the text flow: 102 terms → keywords, 205 notes → kept with their paragraph, 84 captions → linked to figures.
- Links unattached "Figure N.N" captions to their figure: captioned figures 90 → 164.
- Takes chapters, "Exercises", front matter and back matter from the **PDF's own outline** (bookmarks), and numbered sections ("2.1 …") from Docling. Guessing chapter titles from Docling's headings gave wrong ones ("3 70", "5 Example 5.1"); the outline is authoritative.

**Figure descriptions:** a second Docling run on the GPU with picture description on, calling a vision model (Qwen3-VL-4B on vLLM), saved to `out/book.pictures.json`. 67 of 223 figures were described (smaller ones are skipped by `picture_description_area_threshold`); 10 hit the 300-token cap. Descriptions are confident but can invent relationships; spot-check them.

**Definition of done**
- [x] Markdown parsed into a tree; metadata and clean body logged
- [x] The full book converted by Docling and saved locally
- [x] Prose pages come out clean: no running headers, page numbers or margin notes mixed into paragraphs
- [x] Front and back matter identified so it can be excluded
- [ ] A handful of equations and figure descriptions checked against the book
- Known and accepted for now: 41 formulas with a number mid-formula, 36 captions without a figure on their page, ~150 paragraphs that may contain merged margin text.

### 3. Chunking

Split the parsed document into pieces that each make sense on their own: follow the document's structure (sections, paragraphs), roughly 200–500 tokens, little overlap, each chunk prefixed with its heading path and carrying its page for citations.

**Tokens.** Sizes are counted in tokens, the unit models read, with the **embedding model's tokenizer** (`cl100k_base` via `js-tiktoken`), so the count matches what `text-embedding-3-large` sees. Chunks stay text; tokens are only counted. LaTeX takes far more tokens per character than prose. Factors behind the size: the embedding model's input limit (hard ceiling), retrieval precision (one vector per chunk, so big chunks blur), self-contained meaning (tiny chunks lose context), the generation model's context budget (chunks retrieved × size + prompt + answer), the document's natural units, and the kind of questions asked. Bigger context windows raise the ceilings but don't fix blurry vectors; evaluation decides the final size.

**Chunker (`npm run chunk:book`, `src/chunkBook.ts`):** reads `out/book.clean.json` and the figure descriptions, writes `out/chunks.json`. Docling ships chunkers (the hybrid one is the RAG default), but they only read Docling's own format and would lose our cleanup, so we apply the same rules to our records:

1. Never cross a section: one heading path per chunk.
2. Fill up to 400 tokens.
3. Never split a paragraph or formula; a paragraph longer than the budget alone is split at sentences.
4. Formulas stay with the text they follow (`$$ … $$ (2.1)`).
5. Each figure is its own chunk: number, caption, description.
6. Metadata on every chunk: heading path, pages, keywords, equation numbers, source IDs.
7. Contents pages, references and index are left out.

**First result:** 1,152 chunks (973 text, 179 figures), median 313 tokens (p10 135, p90 390), 312k tokens in total. 40 chunks exceed the budget because a formula block can't be split (largest 2,234 tokens).

**Later:** run Docling's own hybrid chunker on the same book and compare retrieval scores at evaluation time.

### 4. Embedding

**Decided:** Azure OpenAI `text-embedding-3-large`, shortened to 1,536 dimensions with the `dimensions` parameter. Store the model name and dimension next to every vector. Rationale in the 2026-10-22 log.

### 5. Storage and search

Postgres with pgvector for vectors, plus Postgres full-text search for keywords, merged (hybrid search), then a reranker.

### 6. Generation

A prompt with the numbered retrieved chunks, instructions to answer only from them and cite them, and "I don't know" otherwise. Sent to vLLM, or to any other model: the generation model only sees text, so it can change without re-embedding.

### 7. Evaluation

Read real failures first, measure retrieval (was the right chunk retrieved?) separately from the answer (correct, supported, cited), then add pass/fail judges checked against your own labels.

## Learnings

### 2026-10-22

**Direction.** Stop inventing from first principles: understand each step, then use the consensus tool. The research behind each choice is in [docs/rag-state-of-practice-2026/](rag-state-of-practice-2026/report.md). The minimal production-grade stack for the key steps: a structure-aware splitter, an embedding model, Postgres with pgvector plus full-text search, a reranker, the LLM, and a small set of real test questions. A heavy parser only when documents are PDFs or scans; a tracing platform only when there's real traffic.

**Cleaning Markdown: why a tree.** A regex sees characters; a parser applies the format's rules once and labels every piece (heading, paragraph, list, bold). Cleaning becomes "drop this node, unwrap that one" instead of re-guessing structure. The tree immediately showed something the line-based version hid: the version line and the disclaimer were one paragraph. The same pattern (parse into structure, then clean and chunk the structure) is what Docling and Unstructured do for PDFs.

**Raw PDFs.** A PDF stores drawing instructions, not paragraphs: text fragments placed at coordinates in a font. unpdf (pdf.js) exposes them with `getTextContent()`. One prose page of the book had 116 fragments, 8 fonts and 6 font sizes on an A4 page (595 × 842 points); headers, page numbers, margin notes and headings are distinguishable by position, size and font. Paths in code are resolved with `new URL("../data/…", import.meta.url)`, relative to the code file, not the terminal's folder.

**Docling.** An open-source converter (IBM, Linux Foundation, MIT) that renders each page, runs a layout model that labels regions (page header, section header, text, formula, table, picture, caption), assigns the text layer to them, and returns a typed document tree with page and position for every item. It's the common open-source default for mixed documents. It isn't the benchmark leader on formulas (MinerU and PaddleOCR-VL score higher there), and it isn't needed for documents that are already text. Not everyone uses it because many documents are already text, many teams buy platforms that parse internally, specialized models beat it on scans and formulas, and it's a separate service that needs a GPU and memory to be fast.

**docling-serve** is Docling as an HTTP API. It writes no files: results stay in memory, can be downloaded **once**, and expire after a delay. Long jobs go to the async endpoint; poll the status, then download the result yourself. Formula enrichment (equations → LaTeX) is a separate, slow model; its `TailRepetitionStopper` log lines mean it cut off a formula that started repeating filler. On the Mac's CPU a prose page took 3.47 s, and a whole-book job ran out of memory; the book was converted on the server GPU instead. Server setup and findings: `gpu-node-bootstrap/serving/docling.md` and its journal.

```bash
# from rag-lab on the Mac
curl -sS -X POST "http://home5070ti:5001/v1/convert/file/async" -F "files=@data/maths_for_ML.pdf;type=application/pdf" \
  -F "to_formats=md" -F "to_formats=json" -F "do_ocr=false" -F "do_formula_enrichment=true"
curl -sS http://home5070ti:5001/v1/status/poll/TASK_ID
curl -sS http://home5070ti:5001/v1/result/TASK_ID -o out/book.json
```

**Embedding model decision.** Azure OpenAI (Foundry, our own subscription) `text-embedding-3-large`, with `dimensions: 1536`.
- The dimension comes from the embedding model; the database column is declared to match. pgvector stores up to 16,000 dimensions but its HNSW index supports at most 2,000 (`vector`) or 4,000 (`halfvec`), so 3,072 is shortened to 1,536. These models are trained so a prefix of the vector is still a valid vector; cutting to 1,024 costs about 2% retrieval quality.
- "Same model" means the **embedding** model: chunks and questions must be embedded with the same model and dimension. Retrieval itself is arithmetic in the database, and the generation model only ever sees retrieved **text**, so Qwen can be swapped for a frontier model without re-embedding anything.
- Re-embed only when the embedding model or its dimension changes, or when the chunk text changes. Reasons to change it: retrieval misses traced to embeddings after trying chunking, hybrid search and reranking first; cross-language queries; hosting or privacy requirements; model retirement; input length limits; cost at scale. Switch side by side (new column, compare on the test set, then cut over), never by leaderboard deltas of 1–2 points.

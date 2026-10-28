# Lab journal

Retrieval-augmented generation, one stage at a time. Each stage is first understood by hand, then built with the tool production teams actually use (see [the research report](rag-state-of-practice-2026/report.md)). Stages are written up here as they're finished.

The source document is *Mathematics for Machine Learning* (`data/maths_for_ML.pdf`, 417 pages): a real PDF with equations, figures, running headers and margin notes. The small Markdown policy in `data/` was the warm-up.

## How it fits together

```
Mac (this project)                         <gpu-host> (GPU server, over Tailscale)
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
- **Generation** runs on the server: `http://<gpu-host>:8000/v1`, model `Qwen/Qwen3-8B-FP8`, context limit 8,192 tokens.
- **Embeddings** come from Azure OpenAI in our own Azure account.
- **Everything else** (chunking, storage, search, evaluation) runs on the Mac.

## Running

```bash
npm run dev
```

Nodemon watches `src/` and `data/` and reruns `src/explorations/readPdfPage.ts` on every save. Type `rs` + Enter to force a rerun, Ctrl-C to stop. `tsx` runs the TypeScript without type-checking; type errors show in the editor.

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
- **Markdown warm-up:** `src/explorations/cleanMarkdown.ts` parses the policy with remark (Markdown → tree), extracts the title and version line as metadata, drops the boilerplate paragraph and unwraps bold and italic.
- **Raw PDF:** `src/explorations/readPdfPage.ts` reads pages with unpdf to look at the raw material: positioned text fragments with fonts and sizes.
- **Docling:** the whole book converted on the server GPU (prose, layout and formulas as LaTeX), saved to `out/book.json`.

**Cleaning (`npm run clean:book`, `src/ingestion/cleanBook.ts`):** reads `out/book.json`, writes `out/book.clean.json`.
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

**Chunker (`npm run chunk:book`, `src/ingestion/chunkBook.ts`):** reads `out/book.clean.json` and the figure descriptions, writes `out/chunks.json`. Docling ships chunkers (the hybrid one is the RAG default), but they only read Docling's own format and would lose our cleanup, so we apply the same rules to our records:

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
curl -sS -X POST "http://<gpu-host>:5001/v1/convert/file/async" -F "files=@data/maths_for_ML.pdf;type=application/pdf" \
  -F "to_formats=md" -F "to_formats=json" -F "do_ocr=false" -F "do_formula_enrichment=true"
curl -sS http://<gpu-host>:5001/v1/status/poll/TASK_ID
curl -sS http://<gpu-host>:5001/v1/result/TASK_ID -o out/book.json
```

**Embedding model decision.** Azure OpenAI (Foundry, our own subscription) `text-embedding-3-large`, with `dimensions: 1536`.
- The dimension comes from the embedding model; the database column is declared to match. pgvector stores up to 16,000 dimensions but its HNSW index supports at most 2,000 (`vector`) or 4,000 (`halfvec`), so 3,072 is shortened to 1,536. These models are trained so a prefix of the vector is still a valid vector; cutting to 1,024 costs about 2% retrieval quality.
- "Same model" means the **embedding** model: chunks and questions must be embedded with the same model and dimension. Retrieval itself is arithmetic in the database, and the generation model only ever sees retrieved **text**, so Qwen can be swapped for a frontier model without re-embedding anything.
- Re-embed only when the embedding model or its dimension changes, or when the chunk text changes. Reasons to change it: retrieval misses traced to embeddings after trying chunking, hybrid search and reranking first; cross-language queries; hosting or privacy requirements; model retirement; input length limits; cost at scale. Switch side by side (new column, compare on the test set, then cut over), never by leaderboard deltas of 1–2 points.

### 2026-10-23

**Rewrite eval.** A fixed set of test conversations (`evals/rewrite/`) to measure the step that turns a follow-up into a standalone question, before deciding whether to fine-tune it. Each test freezes the conversation (Qwen answers the history once), so a rerun changes only the rewrite. Each rewrite is judged two ways: does it name the right topic (word checks), and does search with it return the right book section in the top 5 (the 5 chunks the answer model reads)? Search is also run with the message as typed (what happens with no rewrite) and with gpt-5.4's rewrite (a strong reference, not a perfect answer key). Cases follow five categories from conversational question-rewriting research (CANARD, QReCC, TREC CAsT): pronoun, implicit topic, two referents, topic change, already standalone. The last two check that the rewriter *doesn't* add anything. Five long conversations each end five ways, one per category, so categories are compared on identical history. A reviewer agent checked every case against the book; ambiguous cases accept every reasonable reading.

**Baseline (88 cases × 3 runs).** Search found the right pages 255/264 times with Qwen3-8B, 259 with gpt-5.4-mini, 257 with gpt-5.4. With frozen input Qwen gives the same rewrite in most runs; a few cases still flip between runs at temperature 0 (likely from vLLM batching requests together, not confirmed), so repeated runs remain necessary. The main failure is shared by all three models: adding the old topic to a complete new question ("How does the EM algorithm work?" → "…in probabilistic PCA"). Training Qwen on gpt-5.4's rewrites would teach it that habit too: distillation copies the teacher's flaws unless the examples are filtered.

**Decision matrix: how to fix a rewriter failure.** Cheapest fix first; fine-tune only when it fails.

| What the eval shows | Meaning | Action |
|---|---|---|
| Qwen fails, frontier succeeds, consistently across many cases | Qwen lacks a skill | Prompt fix → measure; if still failing, fine-tune on the frontier's rewrites |
| Qwen fails, frontier succeeds, in 1–2 cases | Could be a quirk | Write more cases of that shape first |
| All models fail the same way | The instructions don't pin the behavior down | Prompt fix → measure (the teacher shares the flaw) |
| All models fail and the prompt fix doesn't work | Must be learned from examples | Fine-tune on curated examples, not raw frontier output |
| Even the reference rewrite's search misses | Not the rewriter's fault | Fix the test's expected section, or the search |

Pass criteria are written before a run, so the result can't be reinterpreted afterwards.

**Prompt fix for over-rewriting.** Replacing "If it is already standalone, return it unchanged" with "If it already names its own topic, return it unchanged: do not add the conversation's topic to it" fixed most over-rewrites for gpt-5.4 (7 → 16 of 18 runs passing) and gpt-5.4-mini (10 → 14), but Qwen produced word-for-word the same over-rewrites as before. Reverted: it didn't help the model the app runs. Lesson: pass criteria must be judged on the production model.

**Multi-query retrieval: tested, rejected.** Searching with both the message as typed and the rewrite, then merging. Equal-weight merge (RRF): rescued 1 case ("ok now, what is a basis?") and broke 5, where the message alone is meaningless ("is that matrix always symmetric?") and its junk results took slots from the rewrite's. Reserved slot (top 4 from the rewrite, 1 from the message as typed): no change at all, because the one slot went to a nearby-but-wrong section. With only 5 chunks for the answer model, any merge lets in either too much junk or too little help.

**Training books converted.** *Designing Data-Intensive Applications* (an early-release edition, 491 pages) and *Algorithmic and High-Frequency Trading* (360 pages), converted one at a time by `npm run convert:documents` with the node in ingest mode. DDIA: formulas off, 85 s; 115 figures, 88 described. Cartea: formulas on, 20.7 min; 988 formulas decoded to LaTeX, none left undecoded; 95 figures, 90 described. About 45% of DDIA's figure descriptions hit the 300-token cap. Both books keep MML out of training, so the eval measures skill, not memory.

**What the inspection found.** DDIA has no section numbers but a rich PDF outline (187 bookmarks); Cartea has numbered headings but an outline with parts only. Page headers and footers are labelled and set aside in both. Text inside diagrams (≈4,800 fragments such as "ok", "commit", axis labels) is attached to its picture by Docling, so it can be dropped in one rule. DDIA adds code blocks and "Figure 1-1" / "Example 2-1" captions; Cartea puts equation numbers inside the LaTeX (`\text{(5.5b)}`).

**Cartea's text layer: re-OCR or keep?** The PDF is a scan with an old OCR text layer: 496 "�" characters and misread headings ("Electrnnic", "L3" for "1.3"). Ten of the worst pages were converted both ways. Fresh OCR (`force_ocr`) removed all 43 "�" and fixed both headings, but kept 3% fewer words, dropped a figure caption and a sentence, and added its own errors ("meanreversion"). Kept the original layer: its errors are visible and repairable, while dropped text is silent. Of the 496 "�", 334 are inside diagrams (dropped anyway); the rest are mostly unreadable symbols in inline maths. Section numbers get repaired from their position in the sequence during cleaning.

**Ingestion, generalized.** One config per document (`src/ingestion/documents.ts`) replaces the paths and rules hardcoded for MML; each script takes a document id (`npm run clean:book -- ddia`). DDIA's structure comes from its outline (185 of 187 bookmarks matched to headings); Cartea's from its numbered headings, with one OCR-damaged number repaired from the sequence ("L3" → "1.3"). Footnotes attach to the paragraph that cites them, or the one before them when the marker didn't survive extraction; tables keep their cells; DDIA's code blocks stay whole. Result: DDIA 905 chunks, Cartea 974, all loaded and embedded under the owner's account. Cartea has 61 chunks over 400 tokens (up to 1,114): derivations kept whole with their formulas.

**Regression check.** Before refactoring, MML's cleaned records and chunks were saved and the old code was shown to reproduce them; after, the new code had to reproduce them byte for byte. It caught a bug in the refactor (equation numbers "2.1" became "2.173": a regex callback read the match offset as a letter suffix) and one MML quirk (a calculation Docling labelled as code, which the new code-block rule would have fenced). Both fixed; output identical.

**Keeping the eval comparable.** The eval now searches only its own book (`EVAL_DOCUMENT_IDS`). Rerun after loading: search found the right pages 255/264, as before, and the two fixed searches (message as typed, reference rewrite) returned identical results in all 88 cases, proof the new books can't reach the eval.

### 2026-10-28

**Why fine-tune at all.** On this book, Qwen's wrong rewrites are mostly tolerable: search still finds the right pages for about 96% of them. As a product decision, fine-tuning the rewriter isn't justified yet. It is done here to learn the full loop (data, training, serving, measurement) on a real, measured failure. "The adapter didn't help enough to keep" is an acceptable result. Judged mainly on wrong rewrites, with search as the check that nothing broke. Search's own misses (where even the reference rewrite misses) are a separate problem, fixed by other means.

**Held-out set enlarged.** 20 new cases, all held out (8 → 28), not looked at while choosing training data. Three kinds: a self-contained question after 5 turns on another topic (7), picking the right one of several earlier things (7), and follow-ups that do need the topic added (6), to catch an adapter that learns to stop adding context altogether. All about MML, while training data comes from the other two books, so a gain shows the skill rather than the topics. A reviewer agent checked them against the book: four expected-section lists widened, two near-duplicates of dev cases replaced, more forbidden terms. One old label was too strict: in MML "mixture model" only means the Gaussian mixture model, so `hard-pronoun-01` now accepts "mixture" and instead fails a rewrite that drags in the last two topics.

**New baseline (108 cases × 3 runs, Qwen3-8B).** Wrong rewrites: dev 22/240, held-out 20/84. Search found the right pages: dev 232/240, held-out 76/84. On the old 88 cases alone: 27 wrong (29 before, mostly the relabel), 253/264 searches (255, within run-to-run noise). Pass criteria for the adapter, set before training: wrong rewrites halved on dev (≤ 11) and on held-out (≤ 10) separately, searches no worse than baseline minus 4 on either, no category worse by more than 3 runs. Held-out is reported as counts: with 3 to 10 cases per category, one case flipping moves a percentage a lot.

**The summary is part of the problem.** 28 of the 42 wrong rewrites happen in conversations long enough for older turns to be folded into the rolling summary. That summary is written for the answer model ("the user is learning about the Hessian…", definitions, formulas): it loses the order of questions, and states the old topic as if it were current. In one held-out case ("how is the first thing I asked about related to the third?") even gpt-5.4 fails, because the summary no longer says which question came first. The other 14 wrong rewrites happen with the whole conversation visible: those are Qwen's own judgment, and the part fine-tuning is for.

**Next: give the rewriter its own memory before training.** Research on conversational query rewriting (TREC CAsT, TopiOCQA, CHIQ) and long-conversation memory points the same way: rewriters get the earlier user questions verbatim and in order, plus only the latest answer or two; prose summaries keep the fewest tokens and lose order; dropping history on a topic switch is what stops old topics leaking in. In our cases the visible answers average about 2,300 characters, the summary about 270, and all user questions about 75: the cost is in the answers, not the questions. The memory format is settled before generating training data, because an adapter learns the exact input format it is trained on.

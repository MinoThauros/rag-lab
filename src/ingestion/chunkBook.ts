// Chunks a cleaned document (its `clean` file in documents.ts) into its `chunks`
// file, following the same rules as Docling's hybrid chunker, applied to our
// own records. Usage: npm run chunk:book -- [document id]
//
// 1. Never cross a section: a chunk holds records with one heading path.
// 2. Fill up to a token budget, counted with the embedding model's tokenizer.
// 3. Never split a paragraph, formula or code block; a paragraph longer than the
//    budget on its own is split at sentence boundaries, a code block at lines.
// 4. Formulas and code blocks stay with the text they follow.
// 5. Each figure or table is its own chunk: number, caption, table cells, and
//    the vision model's description when there is one.
// 6. Every chunk carries metadata: heading path, pages, keywords, equation numbers.
// 7. Table-of-contents pages, references and index are left out: they mention
//    every topic, so they would match every question a little.
import { readFile, writeFile } from "node:fs/promises";
import { getEncoding } from "js-tiktoken";
import { documentFromArgs } from "./documents.ts";

type BBox = { l: number; t: number; r: number; b: number };
type Matter = "contents" | "front" | "body" | "back";
type TextRecord = {
  id: string;
  type: string;
  text: string;
  page: number;
  bbox: BBox;
  matter: Matter;
  headingPath: string[];
  keywords: string[];
  notes: string[];
  equationNumbers?: string[];
};
type FigureRecord = {
  id: string;
  type: "picture" | "table";
  page: number;
  bbox: BBox;
  matter: Matter;
  headingPath: string[];
  figureNumber?: string;
  caption?: string;
  table?: string;
};
type DoclingPicture = {
  prov?: { page_no: number; bbox: BBox }[];
  meta?: { description?: { text?: string } };
};

export type Chunk = {
  id: string;
  kind: "text" | "figure";
  headingPath: string[];
  text: string; // what gets embedded and what the LLM reads
  tokens: number;
  pages: number[];
  keywords: string[];
  equationNumbers: string[];
  figureNumber?: string;
  sourceIds: string[];
};

// The tokenizer text-embedding-3 uses: counts here match what the embedding model sees.
const encoder = getEncoding("cl100k_base");
const MAX_CHUNK_TOKENS = 400;
const countTokens = (text: string) => encoder.encode(text).length;

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+(?=[A-Z(])/;

const config = documentFromArgs();
const clean = JSON.parse(await readFile(config.clean, "utf8")) as { texts: TextRecord[]; figures: FigureRecord[] };

const INDEXED_MATTER: Matter[] = ["front", "body"];
const texts = clean.texts.filter((r) => INDEXED_MATTER.includes(r.matter));
const figures = clean.figures.filter((f) => INDEXED_MATTER.includes(f.matter));

// Figure descriptions from the vision model (in the Docling output, or a separate
// picture-description run), matched to our figures by page and position.
const described = (
  JSON.parse(await readFile(config.pictures ?? config.docling, "utf8")).document.json_content.pictures as DoclingPicture[]
)
  .filter((p) => p.prov?.[0] && p.meta?.description?.text)
  .map((p) => ({ page: p.prov![0].page_no, bbox: p.prov![0].bbox, text: p.meta!.description!.text! }));

const center = (b: BBox) => ({ x: (b.l + b.r) / 2, y: (b.t + b.b) / 2 });
function descriptionFor(figure: FigureRecord): string | undefined {
  const c = center(figure.bbox);
  return described.find((d) => {
    const dc = center(d.bbox);
    return d.page === figure.page && Math.hypot(dc.x - c.x, dc.y - c.y) < 20;
  })?.text;
}

// How a record reads inside a chunk.
function render(record: TextRecord): string {
  if (record.type === "formula") {
    const numbers = record.equationNumbers?.map((n) => ` (${n})`).join("") ?? "";
    return `$$ ${record.text} $$${numbers}`;
  }
  if (record.type === "code" && config.codeBlocks) return `\`\`\`\n${record.text}\n\`\`\``;
  const notes = record.notes.map((note) => `\nNote: ${note}`).join("");
  return `${record.text}${notes}`;
}

// --- Units: a paragraph plus the formulas and code blocks that follow it -------

type Unit = { records: TextRecord[]; body: string };

const units: Unit[] = [];
for (const record of texts) {
  if (record.type === "section_header") continue; // carried by headingPath instead
  const last = units.at(-1);
  const sameSection = last && last.records[0].headingPath.join() === record.headingPath.join();
  const followsText = record.type === "formula" || (record.type === "code" && config.codeBlocks);
  if (followsText && last && sameSection) {
    last.records.push(record);
    last.body = `${last.body}\n${render(record)}`;
  } else {
    units.push({ records: [record], body: render(record) });
  }
}

// --- Packing ------------------------------------------------------------------

const chunks: Chunk[] = [];
const stats = { oversizedUnitsSplit: 0, oversizedChunksKept: 0, figuresWithDescription: 0 };

const prefix = (headingPath: string[]) =>
  headingPath.length ? `${headingPath.join(" › ")}\n\n` : "";

function emit(records: TextRecord[], body: string) {
  const headingPath = records[0].headingPath;
  const text = prefix(headingPath) + body;
  const tokens = countTokens(text);
  if (tokens > MAX_CHUNK_TOKENS) stats.oversizedChunksKept++;
  chunks.push({
    id: `chunk-${chunks.length}`,
    kind: "text",
    headingPath,
    text,
    tokens,
    pages: [...new Set(records.map((r) => r.page))].sort((a, b) => a - b),
    keywords: [...new Set(records.flatMap((r) => r.keywords))],
    equationNumbers: [...new Set(records.flatMap((r) => r.equationNumbers ?? []))],
    sourceIds: records.map((r) => r.id),
  });
}

let pending: Unit[] = [];
const flush = () => {
  if (!pending.length) return;
  emit(pending.flatMap((u) => u.records), pending.map((u) => u.body).join("\n\n"));
  pending = [];
};

for (const unit of units) {
  const headingPath = unit.records[0].headingPath;
  const sameSection = pending.length && pending[0].records[0].headingPath.join() === headingPath.join();
  if (!sameSection) flush();

  const withUnit = prefix(headingPath) + [...pending, unit].map((u) => u.body).join("\n\n");
  if (countTokens(withUnit) <= MAX_CHUNK_TOKENS) {
    pending.push(unit);
    continue;
  }

  flush();
  if (countTokens(prefix(headingPath) + unit.body) <= MAX_CHUNK_TOKENS) {
    pending.push(unit);
    continue;
  }

  // A single unit over budget: split a plain paragraph at sentences and a code
  // block at lines; a unit with formulas stays whole (an equation cut in half
  // is useless).
  const isCode = config.codeBlocks && unit.records.length === 1 && unit.records[0].type === "code";
  if (!isCode && (unit.records.length > 1 || unit.records[0].type === "formula")) {
    emit(unit.records, unit.body);
    continue;
  }
  stats.oversizedUnitsSplit++;
  const pieces = isCode ? unit.records[0].text.split("\n") : unit.body.split(SENTENCE_BOUNDARY);
  const joiner = isCode ? "\n" : " ";
  const wrap = (part: string) => (isCode ? `\`\`\`\n${part}\n\`\`\`` : part);
  let part = "";
  for (const sentence of pieces) {
    const candidate = part ? `${part}${joiner}${sentence}` : sentence;
    if (part && countTokens(prefix(headingPath) + wrap(candidate)) > MAX_CHUNK_TOKENS) {
      emit(unit.records, wrap(part));
      part = sentence;
    } else {
      part = candidate;
    }
  }
  if (part) emit(unit.records, wrap(part));
}
flush();

// --- Figure chunks --------------------------------------------------------------

for (const figure of figures) {
  const description = descriptionFor(figure);
  if (!figure.caption && !description && !figure.table) continue;
  if (description) stats.figuresWithDescription++;

  const label = figure.figureNumber
    ? `${figure.type === "table" ? "Table" : "Figure"} ${figure.figureNumber}`
    : figure.type === "table" ? "Table" : "Figure";
  const body = [
    figure.caption ? `${label}: ${figure.caption}` : label,
    figure.table ?? "",
    description ? `Description: ${description}` : "",
  ].filter(Boolean).join("\n\n");
  const text = prefix(figure.headingPath) + body;

  chunks.push({
    id: `chunk-${chunks.length}`,
    kind: "figure",
    headingPath: figure.headingPath,
    text,
    tokens: countTokens(text),
    pages: [figure.page],
    keywords: [],
    equationNumbers: [],
    figureNumber: figure.figureNumber,
    sourceIds: [figure.id],
  });
}

await writeFile(config.chunks, JSON.stringify(chunks, null, 2));

const sizes = chunks.filter((c) => c.kind === "text").map((c) => c.tokens).sort((a, b) => a - b);
const pct = (p: number) => sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * p))];
console.log({
  document: config.id,
  recordsLeftOut: clean.texts.length - texts.length,
  chunks: chunks.length,
  textChunks: sizes.length,
  figureChunks: chunks.length - sizes.length,
  ...stats,
  tokens: { min: sizes[0], p10: pct(0.1), median: pct(0.5), p90: pct(0.9), max: sizes.at(-1) },
  totalTokens: chunks.reduce((sum, c) => sum + c.tokens, 0),
});

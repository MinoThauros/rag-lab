// Chunks the cleaned book (out/book.clean.json) into out/chunks.json, following
// the same rules as Docling's hybrid chunker, applied to our own records:
//
// 1. Never cross a section: a chunk holds records with one heading path.
// 2. Fill up to a token budget, counted with the embedding model's tokenizer.
// 3. Never split a paragraph or formula; a paragraph longer than the budget on
//    its own is split at sentence boundaries.
// 4. Formulas stay with the text they follow.
// 5. Each figure is its own chunk: number, caption, and the vision model's
//    description from out/book.pictures.json when there is one.
// 6. Every chunk carries metadata: heading path, pages, keywords, equation numbers.
import { readFile, writeFile } from "node:fs/promises";
import { getEncoding } from "js-tiktoken";

type BBox = { l: number; t: number; r: number; b: number };
type TextRecord = {
  id: string;
  type: string;
  text: string;
  page: number;
  bbox: BBox;
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
  headingPath: string[];
  figureNumber?: string;
  caption?: string;
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

const { texts, figures } = JSON.parse(
  await readFile(new URL("../out/book.clean.json", import.meta.url), "utf8")
) as { texts: TextRecord[]; figures: FigureRecord[] };

// Figure descriptions from the picture-description run (a separate Docling
// conversion), matched to our figures by page and position.
const described = (
  JSON.parse(await readFile(new URL("../out/book.pictures.json", import.meta.url), "utf8"))
    .document.json_content.pictures as DoclingPicture[]
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
  const notes = record.notes.map((note) => `\nNote: ${note}`).join("");
  return `${record.text}${notes}`;
}

// --- Units: a paragraph plus the formulas that follow it ----------------------

type Unit = { records: TextRecord[]; body: string };

const units: Unit[] = [];
for (const record of texts) {
  if (record.type === "section_header") continue; // carried by headingPath instead
  const last = units.at(-1);
  const sameSection = last && last.records[0].headingPath.join() === record.headingPath.join();
  if (record.type === "formula" && last && sameSection) {
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

  // A single unit over budget: split a plain paragraph at sentences; a unit with
  // formulas stays whole (an equation cut in half is useless).
  if (unit.records.length > 1 || unit.records[0].type === "formula") {
    emit(unit.records, unit.body);
    continue;
  }
  stats.oversizedUnitsSplit++;
  let part = "";
  for (const sentence of unit.body.split(SENTENCE_BOUNDARY)) {
    const candidate = part ? `${part} ${sentence}` : sentence;
    if (part && countTokens(prefix(headingPath) + candidate) > MAX_CHUNK_TOKENS) {
      emit(unit.records, part);
      part = sentence;
    } else {
      part = candidate;
    }
  }
  if (part) emit(unit.records, part);
}
flush();

// --- Figure chunks --------------------------------------------------------------

for (const figure of figures) {
  const description = descriptionFor(figure);
  if (!figure.caption && !description) continue;
  if (description) stats.figuresWithDescription++;

  const label = figure.figureNumber
    ? `${figure.type === "table" ? "Table" : "Figure"} ${figure.figureNumber}`
    : figure.type === "table" ? "Table" : "Figure";
  const body = [
    figure.caption ? `${label}: ${figure.caption}` : label,
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

await writeFile(new URL("../out/chunks.json", import.meta.url), JSON.stringify(chunks, null, 2));

const sizes = chunks.filter((c) => c.kind === "text").map((c) => c.tokens).sort((a, b) => a - b);
const pct = (p: number) => sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * p))];
console.log({
  chunks: chunks.length,
  textChunks: sizes.length,
  figureChunks: chunks.length - sizes.length,
  ...stats,
  tokens: { min: sizes[0], p10: pct(0.1), median: pct(0.5), p90: pct(0.9), max: sizes.at(-1) },
  totalTokens: chunks.reduce((sum, c) => sum + c.tokens, 0),
});

// Cleans Docling's output for the book (out/book.json) into our own records
// (out/book.clean.json), ready for chunking. Logs counts only.
//
// 1. Drop page furniture that leaked into the body (exact match against
//    strings Docling labelled as furniture elsewhere).
// 2. Pull equation numbers out of formulas: "( 2 . 1 )" → "2.1".
// 3. Move margin items out of the text flow: terms become keywords, notes stay
//    with their paragraph, captions go to step 4.
// 4. Link unattached "Figure N.N" captions to the figure on the same page.
//
// Chapters and front/back matter come from the PDF's own outline (bookmarks);
// numbered section headings ("2.1 ...") come from Docling.
import { readFile, writeFile } from "node:fs/promises";
import { getDocumentProxy } from "unpdf";

type Ref = { $ref: string };
type BBox = { l: number; t: number; r: number; b: number };
type DoclingNode = {
  self_ref: string;
  parent?: Ref;
  children?: Ref[];
  label: string;
  content_layer?: string;
  text?: string;
  prov?: { page_no: number; bbox: BBox }[];
  captions?: Ref[];
};
type DoclingDocument = {
  body: { children: Ref[] };
  texts: DoclingNode[];
  groups: DoclingNode[];
  pictures: DoclingNode[];
  tables: DoclingNode[];
};

type MarginNote = { kind: "term" | "note" | "caption"; text: string };

// contents: table of contents and title pages; front: foreword; back: references, index.
type Matter = "contents" | "front" | "body" | "back";

type TextRecord = {
  id: string;
  type: string; // Docling label: text, list_item, formula, caption, ...
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
  innerText: string[];
};

const MARGIN_TOLERANCE = 5; // points
const MERGE_GAP = 14; // points between margin fragments that belong together
const TERM_MAX_WORDS = 6;

const FIGURE_PREFIX = /^(?:Figure|Fig\.)\s*(\d+)\s*\.\s*(\d+)/;
const EQUATION_NUMBER = /\(\s*(\d(?:\s*\d)*)\s*\.\s*(\d(?:\s*\d)*)\s*\)/g;
// An equation number ends a row: it's followed only by closing braces, then a
// row break (\\), the end of an environment (\end) or the end of the formula.
const ROW_END_EQUATION_NUMBER =
  /(?:\s*&)*\s*\(\s*(\d(?:\s*\d)*)\s*\.\s*(\d(?:\s*\d)*)\s*\)(?=(?:\s*\})*\s*(?:\\\\|\\end|$))/g;
const HEADING_NUMBER = /^(\d+(?:\.\d+)*)\s/;

const doc = JSON.parse(
  await readFile(new URL("../../out/book.json", import.meta.url), "utf8")
).document.json_content as DoclingDocument;

function resolve(ref: Ref): DoclingNode {
  const [, kind, index] = ref.$ref.split("/");
  return (doc as unknown as Record<string, DoclingNode[]>)[kind][Number(index)];
}

const stats = {
  leakedFurnitureDropped: 0,
  formulasWithNumbers: 0,
  formulasWithInlineNumbersLeft: 0,
  marginTerms: 0,
  marginNotes: 0,
  marginCaptions: 0,
  marginUnattached: 0,
  captionsLinked: 0,
  captionsUnmatched: 0,
};

// --- 1. Furniture strings ----------------------------------------------------

const furnitureStrings = new Set(
  doc.texts
    .filter((t) => t.content_layer === "furniture")
    .map((t) => (t.text ?? "").trim())
    .filter((s) => s.length >= 8)
);

// --- Walk the body in reading order ------------------------------------------

const texts: TextRecord[] = [];
const figures: FigureRecord[] = [];

// --- Outline: chapters by start page ------------------------------------------

type OutlineItem = { title: string; dest: unknown; items?: OutlineItem[] };

const pdf = await getDocumentProxy(
  new Uint8Array(await readFile(new URL("../../data/maths_for_ML.pdf", import.meta.url)))
);
async function pageOf(dest: unknown): Promise<number> {
  const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
  return (await pdf.getPageIndex((explicit as [never])[0])) + 1;
}

// Flattened to: Foreword, each chapter, each "Exercises", References, Index.
const outlineEntries: { title: string; page: number }[] = [];
for (const top of (await pdf.getOutline()) as OutlineItem[]) {
  for (const item of top.items?.length ? top.items : [top]) {
    outlineEntries.push({ title: item.title, page: await pageOf(item.dest) });
  }
}
outlineEntries.sort((a, b) => a.page - b.page);

const firstChapterPage = outlineEntries.find((e) => HEADING_NUMBER.test(`${e.title} `))!.page;
const backMatterPage = outlineEntries.find((e) => e.title === "References")!.page;

function matterOf(page: number): Matter {
  if (page < outlineEntries[0].page) return "contents";
  if (page < firstChapterPage) return "front";
  if (page >= backMatterPage) return "back";
  return "body";
}

// The chapter-level path for a page: ["2 Linear Algebra"], or
// ["2 Linear Algebra", "Exercises"] for the exercises that close a chapter.
function chapterPathOf(page: number): string[] {
  const index = outlineEntries.findLastIndex((e) => e.page <= page);
  if (index < 0) return [];
  const entry = outlineEntries[index];
  if (entry.title === "Exercises" && index > 0) return [outlineEntries[index - 1].title, "Exercises"];
  return [entry.title];
}

// --- Numbered sections from Docling --------------------------------------------

const sectionTitles = new Map<string, string>(); // "2.1" → "2.1 Systems of Linear Equations"
let sectionNumber: string | null = null; // latest numbered section, e.g. "2.3.1"
let localHeading: string | null = null; // latest unnumbered heading ("Example 2.1")
let lastChapterKey = "";

function headingPath(page: number): string[] {
  const chapterPath = chapterPathOf(page);
  const chapterKey = chapterPath.join(" › ");
  if (chapterKey !== lastChapterKey) {
    sectionNumber = null;
    localHeading = null;
    lastChapterKey = chapterKey;
  }
  const chapterNumber = chapterPath[0]?.match(HEADING_NUMBER)?.[1];
  const sections =
    sectionNumber && chapterPath.length === 1 && sectionNumber.split(".")[0] === chapterNumber
      ? sectionNumber
          .split(".")
          .slice(1)
          .map((_, i, parts) => sectionTitles.get([chapterNumber, ...parts.slice(0, i + 1)].join(".")))
          .filter((title): title is string => Boolean(title))
      : [];
  return [...chapterPath, ...sections, ...(localHeading ? [localHeading] : [])];
}

function walk(ref: Ref) {
  const node = resolve(ref);

  if (node.label === "picture" || node.label === "table") {
    const prov = node.prov?.[0];
    if (!prov) return;
    figures.push({
      id: node.self_ref,
      type: node.label,
      page: prov.page_no,
      bbox: prov.bbox,
      matter: matterOf(prov.page_no),
      headingPath: headingPath(prov.page_no),
      caption: node.captions?.map((c) => resolve(c).text ?? "").join(" ") || undefined,
      // Labels inside a figure (axes, diagram words) are its children, not body text.
      innerText: (node.children ?? []).map((c) => resolve(c).text ?? "").filter(Boolean),
    });
    return;
  }

  if (node.label === "list" || node.label === "key_value_area") {
    node.children?.forEach(walk);
    return;
  }

  const text = (node.text ?? "").trim();
  const prov = node.prov?.[0];
  if (!prov || !text || node.content_layer === "furniture") return;

  if (node.label === "section_header") {
    headingPath(prov.page_no); // resets section state when the chapter changes
    const number = text.match(HEADING_NUMBER)?.[1];
    const chapterNumber = chapterPathOf(prov.page_no)[0]?.match(HEADING_NUMBER)?.[1];
    if (number?.includes(".") && number.split(".")[0] === chapterNumber) {
      // A real section of this chapter ("2.1 ..."); stray numbers like "70" are ignored.
      sectionTitles.set(number, text);
      sectionNumber = number;
      localHeading = null;
    } else if (!number) {
      localHeading = text;
    }
  }

  if (node.label === "text" && furnitureStrings.has(text)) {
    stats.leakedFurnitureDropped++;
    return;
  }

  const record: TextRecord = {
    id: node.self_ref,
    type: node.label,
    text,
    page: prov.page_no,
    bbox: prov.bbox,
    matter: matterOf(prov.page_no),
    headingPath: headingPath(prov.page_no),
    keywords: [],
    notes: [],
  };

  // --- 2. Equation numbers ---------------------------------------------------
  if (node.label === "formula") {
    const numbers: string[] = [];
    const latex = text.replace(ROW_END_EQUATION_NUMBER, (_, major: string, minor: string) => {
      numbers.push(`${major.replace(/\s/g, "")}.${minor.replace(/\s/g, "")}`);
      return "";
    });
    if (numbers.length) {
      stats.formulasWithNumbers++;
      record.text = latex.trimEnd().replace(/(?:\s*&)+\s*$/, "");
      record.equationNumbers = numbers;
    }
    if (latex.match(EQUATION_NUMBER)) stats.formulasWithInlineNumbersLeft++;
  }

  texts.push(record);
}

doc.body.children.forEach(walk);

// --- 3. Margin items, page by page -------------------------------------------

function mostCommon(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

function verticalOverlap(a: BBox, b: BBox): number {
  return Math.min(a.t, b.t) - Math.max(a.b, b.b); // BOTTOMLEFT: t > b
}

function verticalDistance(a: BBox, b: BBox): number {
  return Math.abs((a.t + a.b) / 2 - (b.t + b.b) / 2);
}

const pageCaptions: { page: number; bbox: BBox; text: string }[] = [];
const kept: TextRecord[] = [];

const byPage = new Map<number, TextRecord[]>();
for (const record of texts) {
  byPage.set(record.page, [...(byPage.get(record.page) ?? []), record]);
}

for (const [page, records] of byPage) {
  const paragraphs = records.filter((r) => r.type === "text");
  if (paragraphs.length < 2) {
    kept.push(...records);
    continue;
  }

  // The main column, measured from this page's own paragraphs (the layout is mirrored).
  const columnLeft = mostCommon(paragraphs.map((r) => Math.round(r.bbox.l / 5) * 5));
  const columnRight = mostCommon(paragraphs.map((r) => Math.round(r.bbox.r / 5) * 5));
  const isMargin = (r: TextRecord) =>
    r.type !== "section_header" &&
    (r.bbox.r <= columnLeft + MARGIN_TOLERANCE || r.bbox.l >= columnRight - MARGIN_TOLERANCE);

  const main = records.filter((r) => !isMargin(r));
  const margin = records.filter(isMargin);
  kept.push(...main);

  // Merge consecutive fragments on the same side that sit close together.
  const merged: TextRecord[] = [];
  for (const item of margin) {
    const last = merged.at(-1);
    const sameSide = last && (last.bbox.l < columnLeft) === (item.bbox.l < columnLeft);
    if (last && sameSide && last.bbox.b - item.bbox.t < MERGE_GAP) {
      last.text = `${last.text} ${item.text}`;
      last.bbox = { ...last.bbox, b: Math.min(last.bbox.b, item.bbox.b) };
    } else {
      merged.push({ ...item, bbox: { ...item.bbox } });
    }
  }

  for (const item of merged) {
    const kind: MarginNote["kind"] =
      item.type === "caption" || FIGURE_PREFIX.test(item.text)
        ? "caption"
        : item.text.split(/\s+/).length <= TERM_MAX_WORDS && !/[.!?]$/.test(item.text)
          ? "term"
          : "note";

    if (kind === "caption") {
      stats.marginCaptions++;
      pageCaptions.push({ page, bbox: item.bbox, text: item.text });
      continue;
    }

    // Attach to the main-column paragraph that overlaps it most, else the closest one.
    const target =
      main
        .filter((r) => r.type !== "section_header")
        .map((r) => ({ r, overlap: verticalOverlap(r.bbox, item.bbox), distance: verticalDistance(r.bbox, item.bbox) }))
        .sort((a, b) => (b.overlap > 0 || a.overlap > 0 ? b.overlap - a.overlap : a.distance - b.distance))[0]?.r;

    if (!target) {
      stats.marginUnattached++;
      continue;
    }
    if (kind === "term") {
      target.keywords.push(item.text);
      stats.marginTerms++;
    } else {
      target.notes.push(item.text);
      stats.marginNotes++;
    }
  }
}

// --- 4. Link captions to figures ---------------------------------------------

// Captions still in the text flow that no figure claimed.
const claimed = new Set(figures.map((f) => f.caption).filter(Boolean));
const flowCaptions = kept.filter((r) => r.type === "caption" && !claimed.has(r.text));

for (const caption of [...pageCaptions, ...flowCaptions]) {
  const match = caption.text.match(FIGURE_PREFIX);
  const candidates = figures.filter((f) => f.page === caption.page && !f.caption);
  const figure = candidates.sort(
    (a, b) => verticalDistance(a.bbox, caption.bbox) - verticalDistance(b.bbox, caption.bbox)
  )[0];
  if (!figure) {
    stats.captionsUnmatched++;
    continue;
  }
  figure.caption = caption.text;
  stats.captionsLinked++;
}

// Figure numbers for every caption, including the ones Docling linked itself.
for (const figure of figures) {
  const match = figure.caption?.match(FIGURE_PREFIX);
  if (match) figure.figureNumber = `${match[1]}.${match[2]}`;
}

const linkedCaptions = new Set(figures.map((f) => f.caption));
const finalTexts = kept
  .filter((r) => !(r.type === "caption" && linkedCaptions.has(r.text)))
  .sort((a, b) => texts.indexOf(a) - texts.indexOf(b)); // back to reading order

await writeFile(
  new URL("../../out/book.clean.json", import.meta.url),
  JSON.stringify({ texts: finalTexts, figures }, null, 2)
);

console.log({
  ...stats,
  textRecords: finalTexts.length,
  figures: figures.length,
  figuresWithCaption: figures.filter((f) => f.caption).length,
  figuresWithNumber: figures.filter((f) => f.figureNumber).length,
});

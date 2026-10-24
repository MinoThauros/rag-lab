// Cleans a document's Docling output into our own records, ready for chunking.
// Which rules apply, and the files, come from its entry in documents.ts.
// Logs counts only. Usage: npm run clean:book -- [document id]
//
// 1. Drop page furniture that leaked into the body (exact match against
//    strings Docling labelled as furniture elsewhere).
// 2. Pull equation numbers out of formulas: "( 2 . 1 )" → "2.1" (and "(5.5b)").
// 3. Move margin items out of the text flow: terms become keywords, notes stay
//    with their paragraph, captions go to step 4.
// 4. Link unattached captions ("Figure N.N") to the figure on the same page.
// 5. Attach footnotes to the paragraph that cites them.
//
// Structure: chapters from the PDF's own outline (bookmarks) and numbered
// sections ("2.1 ...") from Docling, or the whole hierarchy from the outline
// for books without section numbers. OCR-damaged section numbers ("L3") are
// repaired from their place in the sequence.
// Text inside figures (axis labels, diagram words) never enters the body.
import { readFile, writeFile } from "node:fs/promises";
import { getDocumentProxy } from "unpdf";
import { documentFromArgs } from "./documents.ts";

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
  data?: { grid?: { text?: string }[][] };
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
  type: string; // Docling label: text, list_item, formula, caption, code, footnote, ...
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
  table?: string; // cells, one row per line
};

const config = documentFromArgs();

const MARGIN_TOLERANCE = 5; // points
const MERGE_GAP = 14; // points between margin fragments that belong together
const TERM_MAX_WORDS = 6;

const EQUATION_NUMBER = /\(\s*(\d(?:\s*\d)*)\s*\.\s*(\d(?:\s*\d)*)\s*\)/g;
// An equation number ends a row: it's followed only by closing braces, then a
// row break (\\), the end of an environment (\end) or the end of the formula.
const ROW_END_EQUATION_NUMBER =
  /(?:\s*&)*\s*\(\s*(\d(?:\s*\d)*)\s*\.\s*(\d(?:\s*\d)*)\s*\)(?=(?:\s*\})*\s*(?:\\\\|\\end|$))/g;
// The same with an optional letter ("(5.5b)", "( 5 . 5 \text{a} )"), possibly
// after \quad or wrapped in \text{...}.
const ROW_END_EQUATION_NUMBER_WITH_SUFFIX =
  /(?:\s*&)*\s*(?:\\quad\s*)?(?:\\text\s*\{\s*)?\(\s*(\d(?:\s*\d)*)\s*\.\s*(\d(?:\s*\d)*)\s*(?:\\text\s*\{\s*([a-z])\s*\}|([a-z]))?\s*\)(?:\s*\})?(?=(?:\s*\})*\s*(?:\\\\|\\end|$))/g;
const HEADING_NUMBER = /^(\d+(?:\.\d+)*)\s/;
// Characters old OCR reads in place of digits.
const DIGIT_LOOKALIKES: Record<string, string> = { L: "1", l: "1", I: "1", i: "1", O: "0", o: "0", S: "5" };

const doc = JSON.parse(await readFile(config.docling, "utf8")).document.json_content as DoclingDocument;

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
  sectionNumbersRepaired: 0,
  outlineHeadingsMatched: 0,
  localHeadings: 0,
  footnotesAttachedToCitingParagraph: 0,
  footnotesAttachedByPosition: 0,
  footnotesUnattached: 0,
};
const repairs: string[] = [];

// --- 1. Furniture strings ----------------------------------------------------

const furnitureStrings = new Set(
  doc.texts
    .filter((t) => t.content_layer === "furniture")
    .map((t) => (t.text ?? "").trim())
    .filter((s) => s.length >= 8)
);

// --- Outline ------------------------------------------------------------------

type OutlineItem = { title: string; dest: unknown; items?: OutlineItem[] };

const pdf = await getDocumentProxy(new Uint8Array(await readFile(config.pdf)));
async function pageOf(dest: unknown): Promise<number> {
  const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
  return (await pdf.getPageIndex((explicit as [never])[0])) + 1;
}
const outline = ((await pdf.getOutline()) ?? []) as OutlineItem[];

// "1. Electronic Markets" and "Chapter 1. Reliable, …" read as "1 Electronic Markets".
const chapterTitle = (title: string) => title.replace(/^(?:Chapter\s+)?(\d+)\.?\s+/i, "$1 ");

// The structure decides each record's heading path and matter.
type Structure = {
  onHeader(text: string, page: number): string; // returns the heading text, repaired if needed
  headingPath(page: number): string[];
  matterOf(page: number): Matter;
};

// --- Structure: chapters from the outline, numbered sections from Docling ------

async function numberedStructure(): Promise<Structure> {
  // Flattened to: front entries, each chapter, each "Exercises", back entries
  // (and each part, when parts have their own entry).
  const outlineEntries: { title: string; page: number }[] = [];
  for (const top of outline) {
    if (config.partEntries && top.items?.length) outlineEntries.push({ title: top.title, page: await pageOf(top.dest) });
    for (const item of top.items?.length ? top.items : [top]) {
      outlineEntries.push({ title: chapterTitle(item.title), page: await pageOf(item.dest) });
    }
  }
  outlineEntries.sort((a, b) => a.page - b.page);

  const firstChapterPage = outlineEntries.find((e) => HEADING_NUMBER.test(`${e.title} `))!.page;
  const entryAt = (page: number) => outlineEntries.findLast((e) => e.page <= page);

  function matterOf(page: number): Matter {
    if (page < outlineEntries[0].page) return "contents";
    const title = entryAt(page)?.title ?? "";
    if (config.contentsTitles.includes(title)) return "contents";
    if (page < firstChapterPage) return "front";
    if (config.backTitles.includes(title)) return "back";
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

  // The numbers a heading can carry next: a first subsection, or the next
  // section at any level ("1.2" → "1.2.1", "1.3").
  function expectedNumbers(chapterNumber: string): string[] {
    const current =
      sectionNumber?.split(".")[0] === chapterNumber ? sectionNumber.split(".").map(Number) : [Number(chapterNumber)];
    const next = [[...current, 1]];
    for (let level = current.length - 1; level >= 1; level--) {
      next.push([...current.slice(0, level), current[level] + 1]);
    }
    return next.map((n) => n.join("."));
  }

  // "L3 Trading in Electronic Markets" after 1.2 → "1.3 Trading in Electronic Markets".
  function repairNumber(text: string, page: number, chapterNumber: string | undefined): string {
    const [token, ...rest] = text.split(" ");
    if (!chapterNumber || !rest.length) return text;
    if (/^\d+(\.\d+)+$/.test(token) && token.split(".")[0] === chapterNumber) return text;
    const digits = [...token].map((c) => DIGIT_LOOKALIKES[c] ?? c).join("").replace(/\./g, "");
    if (!/^\d+$/.test(digits)) return text;
    const number = expectedNumbers(chapterNumber).find((n) => n.replace(/\./g, "") === digits);
    if (!number) return text;
    stats.sectionNumbersRepaired++;
    repairs.push(`p${page}: "${token}" → "${number}"`);
    return [number, ...rest].join(" ");
  }

  function onHeader(text: string, page: number): string {
    headingPath(page); // resets section state when the chapter changes
    const chapterNumber = chapterPathOf(page)[0]?.match(HEADING_NUMBER)?.[1];
    const heading = config.repairSectionNumbers ? repairNumber(text, page, chapterNumber) : text;
    const number = heading.match(HEADING_NUMBER)?.[1];
    if (number?.includes(".") && number.split(".")[0] === chapterNumber) {
      // A real section of this chapter ("2.1 ..."); stray numbers like "70" are ignored.
      sectionTitles.set(number, heading);
      sectionNumber = number;
      localHeading = null;
    } else if (!number) {
      localHeading = heading;
    }
    return heading;
  }

  return { onHeader, headingPath, matterOf };
}

// --- Structure: the whole hierarchy from the outline --------------------------

async function outlineStructure(): Promise<Structure> {
  type Node = { title: string; page: number; path: string[]; top: string; excluded: boolean };
  const nodes: Node[] = [];
  async function flatten(items: OutlineItem[], parent: Node | null) {
    for (const item of items) {
      const title = parent ? item.title : chapterTitle(item.title);
      const node: Node = {
        title,
        page: await pageOf(item.dest),
        path: parent ? [...parent.path, title] : [title],
        top: parent?.top ?? item.title,
        excluded: (parent?.excluded ?? false) || config.excludedTitles.includes(item.title),
      };
      nodes.push(node);
      if (item.items?.length) await flatten(item.items, node);
    }
  }
  await flatten(outline, null);

  const firstBodyIndex = nodes.findIndex((n) => n.path.length === 1 && /^(?:Part\b|\d+\s)/.test(n.title));
  // Headings compared without numbers, "Chapter"/"Part" prefixes, case or punctuation.
  const normalize = (title: string) =>
    title
      .toLowerCase()
      .replace(/^(?:chapter|part)\s+[\divxlc]+\.?\s+/, "")
      .replace(/^\d+\s+/, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  let current = -1;
  let localHeading: string | null = null;
  // A node whose heading wasn't found still starts at the latest on the next page.
  function advanceTo(page: number) {
    while (current + 1 < nodes.length && nodes[current + 1].page < page) {
      current++;
      localHeading = null;
    }
  }

  function onHeader(text: string, page: number): string {
    advanceTo(page);
    const key = normalize(text);
    if (current >= 0 && normalize(nodes[current].title) === key) return text;
    for (let j = current + 1; j < Math.min(nodes.length, current + 8); j++) {
      if (nodes[j].page <= page + 1 && normalize(nodes[j].title) === key) {
        current = j;
        localHeading = null;
        stats.outlineHeadingsMatched++;
        return text;
      }
    }
    localHeading = text;
    stats.localHeadings++;
    return text;
  }

  function headingPath(page: number): string[] {
    advanceTo(page);
    if (current < 0) return [];
    return [...nodes[current].path, ...(localHeading ? [localHeading] : [])];
  }

  function matterOf(page: number): Matter {
    advanceTo(page);
    const node = nodes[current];
    if (!node || node.excluded || config.contentsTitles.includes(node.top)) return "contents";
    if (config.backTitles.includes(node.top)) return "back";
    return current < firstBodyIndex ? "front" : "body";
  }

  return { onHeader, headingPath, matterOf };
}

const structure = config.structure === "outline" ? await outlineStructure() : await numberedStructure();

// --- Walk the body in reading order ------------------------------------------

const texts: TextRecord[] = [];
const figures: FigureRecord[] = [];

const tableText = (node: DoclingNode) =>
  (node.data?.grid ?? []).map((row) => row.map((cell) => (cell.text ?? "").trim()).join(" | ")).join("\n");

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
      matter: structure.matterOf(prov.page_no),
      headingPath: structure.headingPath(prov.page_no),
      caption: node.captions?.map((c) => resolve(c).text ?? "").join(" ") || undefined,
      // Labels inside a figure (axes, diagram words) are its children, not body text.
      innerText: (node.children ?? []).map((c) => resolve(c).text ?? "").filter(Boolean),
      table: config.tableText && node.label === "table" ? tableText(node) : undefined,
    });
    return;
  }

  if (node.label === "list" || node.label === "key_value_area") {
    node.children?.forEach(walk);
    return;
  }

  let text = (node.text ?? "").trim();
  const prov = node.prov?.[0];
  if (!prov || !text || node.content_layer === "furniture") return; // empty formulas included

  if (node.label === "section_header") text = structure.onHeader(text, prov.page_no);

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
    matter: structure.matterOf(prov.page_no),
    headingPath: structure.headingPath(prov.page_no),
    keywords: [],
    notes: [],
  };

  // --- 2. Equation numbers ---------------------------------------------------
  if (node.label === "formula") {
    const numbers: string[] = [];
    const pattern = config.equationNumberSuffixes ? ROW_END_EQUATION_NUMBER_WITH_SUFFIX : ROW_END_EQUATION_NUMBER;
    const latex = text.replace(pattern, (_, major: string, minor: string, ...rest: unknown[]) => {
      // Only the suffix pattern has letter groups; otherwise rest starts with the match offset.
      const letter = config.equationNumberSuffixes ? ((rest[0] ?? rest[1] ?? "") as string) : "";
      numbers.push(`${major.replace(/\s/g, "")}.${minor.replace(/\s/g, "")}${letter}`);
      return "";
    });
    if (numbers.length) {
      stats.formulasWithNumbers++;
      record.text = config.equationNumberSuffixes
        ? latex.trimEnd().replace(/(?:\s*(?:&|\\quad|,))+\s*$/, "")
        : latex.trimEnd().replace(/(?:\s*&)+\s*$/, "");
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
  if (!config.marginNotes || paragraphs.length < 2) {
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
      item.type === "caption" || config.figureCaption.test(item.text)
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
const flowCaptions = kept.filter(
  (r) =>
    r.type === "caption" &&
    !claimed.has(r.text) &&
    (!config.linkOnlyFigureCaptions || config.figureCaption.test(r.text))
);

for (const caption of [...pageCaptions, ...flowCaptions]) {
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
  const groups = figure.caption?.match(config.figureCaption)?.groups;
  if (groups) figure.figureNumber = `${groups.major}${config.figureNumberSeparator}${groups.minor}`;
}

// --- 5. Footnotes -------------------------------------------------------------

// "ii. A term borrowed from …" or "2 Colliard & Foucault …": the marker, then the note.
const FOOTNOTE_MARKER = /^([ivxlc]+|\d+)[.)]?\s+/i;

if (config.footnotes) {
  for (const footnote of kept.filter((r) => r.type === "footnote")) {
    const marker = footnote.text.match(FOOTNOTE_MARKER)?.[1];
    const note = marker ? footnote.text.replace(FOOTNOTE_MARKER, "") : footnote.text;
    const paragraphs = kept.filter((r) => r.page === footnote.page && r.type === "text");
    // The citing paragraph carries the marker right after a word or punctuation: "load.ii".
    const citing = marker
      ? paragraphs.findLast((r) => new RegExp(`[A-Za-z.,;:)"”’']${marker}(?=[\\s.,;:)]|$)`).test(r.text))
      : undefined;
    const target = citing ?? paragraphs.findLast((r) => texts.indexOf(r) < texts.indexOf(footnote));
    if (!target) {
      stats.footnotesUnattached++;
      continue;
    }
    target.notes.push(note);
    kept.splice(kept.indexOf(footnote), 1);
    if (citing) stats.footnotesAttachedToCitingParagraph++;
    else stats.footnotesAttachedByPosition++;
  }
}

const linkedCaptions = new Set(figures.map((f) => f.caption));
const finalTexts = kept
  .filter((r) => !(r.type === "caption" && linkedCaptions.has(r.text)))
  .sort((a, b) => texts.indexOf(a) - texts.indexOf(b)); // back to reading order

await writeFile(config.clean, JSON.stringify({ texts: finalTexts, figures }, null, 2));

console.log({
  document: config.id,
  ...stats,
  textRecords: finalTexts.length,
  figures: figures.length,
  figuresWithCaption: figures.filter((f) => f.caption).length,
  figuresWithNumber: figures.filter((f) => f.figureNumber).length,
});
if (repairs.length) console.log("section numbers repaired:", repairs);

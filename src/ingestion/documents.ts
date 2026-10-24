// One entry per ingested document: its files and the cleaning rules that fit its
// layout. The ingestion scripts take a document id (default: maths-for-ml).
//
// Structure comes from one of two sources:
// - "chapters-and-numbered-sections": chapters from the PDF outline (one level
//   under each part), sections from Docling's numbered headings ("2.1 ...").
// - "outline": the whole hierarchy (chapter › section › subsection) from the
//   PDF outline, for books whose headings carry no numbers.

export type DocumentConfig = {
  id: string;
  title: string;
  pdf: string;
  docling: string; // Docling output
  pictures?: string; // separate figure-description run; otherwise descriptions are in `docling`
  clean: string;
  chunks: string;
  structure: "chapters-and-numbered-sections" | "outline";
  // Outline titles by role. Contents and back matter are left out of the index.
  contentsTitles: string[];
  backTitles: string[];
  excludedTitles: string[]; // outline sections left out wherever they sit
  partEntries: boolean; // parts get their own entry, so part intro pages aren't filed under the previous chapter
  figureCaption: RegExp; // groups: major, minor
  figureNumberSeparator: string;
  linkOnlyFigureCaptions: boolean; // other captions ("Example 2-1") stay in the text flow
  marginNotes: boolean;
  footnotes: boolean; // attach footnotes to the paragraph that cites them
  repairSectionNumbers: boolean; // OCR-damaged numbers ("L3" → "1.3"), fixed from the sequence
  equationNumberSuffixes: boolean; // "(5.5b)", "( 5 . 5 \text{a} )"
  tableText: boolean; // table cells go into the table's chunk
  codeBlocks: boolean; // code stays whole, fenced, with the text before it
};

const MML: DocumentConfig = {
  id: "maths-for-ml",
  title: "Mathematics for Machine Learning",
  pdf: "data/maths_for_ML.pdf",
  docling: "out/book.json",
  pictures: "out/book.pictures.json",
  clean: "out/book.clean.json",
  chunks: "out/chunks.json",
  structure: "chapters-and-numbered-sections",
  contentsTitles: [],
  backTitles: ["References", "Index"],
  excludedTitles: [],
  partEntries: false,
  figureCaption: /^(?:Figure|Fig\.)\s*(?<major>\d+)\s*\.\s*(?<minor>\d+)/,
  figureNumberSeparator: ".",
  linkOnlyFigureCaptions: false,
  marginNotes: true,
  footnotes: false,
  repairSectionNumbers: false,
  equationNumberSuffixes: false,
  tableText: false,
  codeBlocks: false, // its one "code" block is a calculation Docling mislabelled
};

export const DOCUMENTS: DocumentConfig[] = [
  MML,
  {
    id: "ddia",
    title: "Designing Data-Intensive Applications (early release)",
    pdf: "data/data_intensive_apps_book.pdf",
    docling: "out/ddia.json",
    clean: "out/ddia.clean.json",
    chunks: "out/ddia.chunks.json",
    structure: "outline",
    contentsTitles: ["Cover", "Copyright", "Table of Contents"],
    backTitles: [],
    excludedTitles: ["Early Release Status and Feedback"],
    partEntries: true,
    figureCaption: /^Figure\s*(?<major>\d+)\s*-\s*(?<minor>\d+)/,
    figureNumberSeparator: "-",
    linkOnlyFigureCaptions: true,
    marginNotes: false,
    footnotes: true,
    repairSectionNumbers: false,
    equationNumberSuffixes: false,
    tableText: true,
    codeBlocks: true,
  },
  {
    id: "algo-trading",
    title: "Algorithmic and High-Frequency Trading",
    pdf: "data/algo_trading_book.pdf",
    docling: "out/algo-trading.json",
    clean: "out/algo-trading.clean.json",
    chunks: "out/algo-trading.chunks.json",
    structure: "chapters-and-numbered-sections",
    contentsTitles: ["Cover", "Contents"],
    backTitles: ["Bibliography", "Subject index"], // the glossary is kept
    excludedTitles: [],
    partEntries: true,
    figureCaption: /^(?:Figure|Fig\.|Table)\s*(?<major>\d+)\s*\.\s*(?<minor>\d+)/,
    figureNumberSeparator: ".",
    linkOnlyFigureCaptions: true,
    marginNotes: false,
    footnotes: true,
    repairSectionNumbers: true,
    equationNumberSuffixes: true,
    tableText: true,
    codeBlocks: false,
  },
];

export function documentFromArgs(): DocumentConfig {
  const id = process.argv[2] ?? MML.id;
  const config = DOCUMENTS.find((d) => d.id === id);
  if (!config) throw new Error(`unknown document "${id}"; known: ${DOCUMENTS.map((d) => d.id).join(", ")}`);
  return config;
}

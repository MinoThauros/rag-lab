import { readFile } from "node:fs/promises";
import { getDocumentProxy } from "unpdf";

const buffer = await readFile(new URL("../../data/maths_for_ML.pdf", import.meta.url));
const pdf = await getDocumentProxy(new Uint8Array(buffer));

const page = await pdf.getPage(25);
const { width, height } = page.getViewport({ scale: 1 });
const content = await page.getTextContent();

const rows = content.items.flatMap((item) =>
  "str" in item && item.str.trim()
    ? [{
        y: Math.round(item.transform[5]),
        x: Math.round(item.transform[4]),
        size: Math.round(item.height * 10) / 10,
        font: item.fontName,
        text: item.str.slice(0, 40),
      }]
    : []
);

// Top of the page first, then left to right.
rows.sort((a, b) => b.y - a.y || a.x - b.x);

console.log({ width, height });
console.table(rows);
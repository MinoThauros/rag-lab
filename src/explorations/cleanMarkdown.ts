import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { visit, SKIP } from "unist-util-visit";
import { toString } from "mdast-util-to-string";
import type { Parent, Root } from "mdast";

export type DocumentMetadata = {
  title: string;
  version?: string;
  effectiveDate?: string;
  owner?: string;
};

const BOILERPLATE_LINES = [
  "Harbourline Logistics is a fictional company. This document is sample material for testing.",
];
const VERSION_LINE = /^Version (\S+), effective (.+?)\. Owner: (.+?)\.$/;

export function cleanMarkdown(raw: string) {
  const tree = unified().use(remarkParse).parse(raw) as Root;
  const metadata: DocumentMetadata = { title: "" };

  tree.children = tree.children.filter((node) => {
    if (node.type === "heading" && node.depth === 1 && !metadata.title) {
      metadata.title = toString(node);
      return false;
    }
    if (node.type !== "paragraph") return true;

    // Consecutive lines form one paragraph, so check each line.
    const lines = toString(node).split("\n");
    const isHeaderBlock = lines.every((line) => {
      const version = line.match(VERSION_LINE);
      if (version) {
        [, metadata.version, metadata.effectiveDate, metadata.owner] = version;
        return true;
      }
      return BOILERPLATE_LINES.includes(line);
    });
    return !isHeaderBlock;
  });

  // Replace each bold/italic node with its children (keep the words, drop the markers).
  visit(tree, (node, index, parent) => {
    if ((node.type === "strong" || node.type === "emphasis") && parent && index !== undefined) {
      (parent as Parent).children.splice(index, 1, ...(node as Parent).children);
      return [SKIP, index];
    }
  });

  const body = unified().use(remarkStringify, { bullet: "-" }).stringify(tree).trim();
  return { metadata, body };
}
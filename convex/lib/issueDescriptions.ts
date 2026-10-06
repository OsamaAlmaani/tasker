import { v } from "convex/values";

export type DescriptionNode = {
  type: string;
  text?: string;
  attrs?: Record<string, string | number | boolean | null>;
  marks?: { type: string; attrs?: Record<string, string | number | boolean | null> }[];
  content?: DescriptionNode[];
};
export type DescriptionDoc = { type: "doc"; content: DescriptionNode[] };
export type DescriptionValue = { description: string; descriptionDoc?: DescriptionDoc };

export const descriptionDocValidator = v.object({ type: v.literal("doc"), content: v.array(v.any()) });

export function isDescriptionLink(href: string) {
  try {
    return ["http:", "https:", "mailto:", "tel:"].includes(new URL(href).protocol);
  } catch {
    return false;
  }
}

const childrenByType: Record<string, string[]> = {
  doc: ["paragraph", "heading", "blockquote", "bulletList", "orderedList", "codeBlock", "horizontalRule"],
  paragraph: ["text", "hardBreak"],
  heading: ["text", "hardBreak"],
  blockquote: ["paragraph", "heading", "blockquote", "bulletList", "orderedList", "codeBlock", "horizontalRule"],
  bulletList: ["listItem"],
  orderedList: ["listItem"],
  listItem: ["paragraph", "heading", "blockquote", "bulletList", "orderedList", "codeBlock", "horizontalRule"],
  codeBlock: ["text"],
  text: [],
  hardBreak: [],
  horizontalRule: [],
};

export function normalizeDescriptionDoc(value: unknown): DescriptionDoc {
  if (JSON.stringify(value)?.length > 100_000) throw new Error("Description is too long.");
  let nodes = 0;
  function parse(input: unknown, depth: number): DescriptionNode {
    if (++nodes > 5_000 || depth > 32) throw new Error("Description is too complex.");
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid description content.");
    const node = input as Record<string, unknown>;
    const type = node.type;
    if (typeof type !== "string" || !Object.prototype.hasOwnProperty.call(childrenByType, type)) throw new Error("Unsupported description content.");
    const result: DescriptionNode = { type };
    const attrs = node.attrs as Record<string, unknown> | undefined;
    if (type === "text") {
      if (typeof node.text !== "string" || !node.text.length) throw new Error("Invalid description text.");
      result.text = node.text;
    } else if (node.text !== undefined) {
      throw new Error("Invalid description text.");
    }
    if (type === "heading") {
      const level = attrs?.level;
      if (typeof level !== "number" || ![1, 2, 3].includes(level)) throw new Error("Invalid heading level.");
      result.attrs = { level };
    }
    if (type === "orderedList") {
      const start = attrs?.start ?? 1;
      if (typeof start !== "number" || !Number.isSafeInteger(start) || start < 1) throw new Error("Invalid list start.");
      result.attrs = { start };
    }
    if (type === "codeBlock" && typeof attrs?.language === "string") {
      result.attrs = { language: attrs.language.slice(0, 80) };
    }
    if (node.marks !== undefined) {
      if (!["text", "hardBreak"].includes(type) || !Array.isArray(node.marks)) throw new Error("Invalid description formatting.");
      result.marks = node.marks.map((inputMark: unknown) => {
        if (!inputMark || typeof inputMark !== "object") throw new Error("Invalid description formatting.");
        const mark = inputMark as Record<string, unknown>;
        if (mark.type === "link") {
          const href = (mark.attrs as Record<string, unknown> | undefined)?.href;
          if (typeof href !== "string" || !isDescriptionLink(href)) throw new Error("Use an http, https, mailto, or tel link.");
          return { type: "link", attrs: { href } };
        }
        if (typeof mark.type !== "string" || !["bold", "italic", "strike", "underline", "code"].includes(mark.type)) {
          throw new Error("Unsupported description formatting.");
        }
        return { type: mark.type };
      });
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content) || !childrenByType[type].length) throw new Error("Invalid description structure.");
      result.content = node.content.map((child) => parse(child, depth + 1));
      if (result.content.some((child) => !childrenByType[type].includes(child.type))) throw new Error("Invalid description structure.");
    }
    if (["doc", "blockquote", "bulletList", "orderedList", "listItem"].includes(type) && !result.content?.length) {
      throw new Error("Invalid description structure.");
    }
    if (type === "listItem" && result.content?.[0]?.type !== "paragraph") throw new Error("Invalid list item.");
    return result;
  }
  const document = parse(value, 0);
  if (document.type !== "doc") throw new Error("Invalid description document.");
  return { type: "doc", content: document.content ?? [] };
}

export function descriptionText(node: DescriptionNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  const separator = ["paragraph", "heading", "codeBlock"].includes(node.type) ? "" : "\n";
  return (node.content ?? []).map(descriptionText).join(separator);
}

export function plainDescriptionDoc(text: string): DescriptionDoc {
  return {
    type: "doc",
    content: text.replace(/\r\n?/g, "\n").split("\n").map((line) => ({
      type: "paragraph",
      ...(line ? { content: [{ type: "text", text: line }] } : {}),
    })),
  };
}

export function buildDescriptionFields(description?: string, descriptionDoc?: unknown) {
  if (descriptionDoc == null) return { description: description?.trim(), descriptionDoc: undefined };
  const doc = normalizeDescriptionDoc(descriptionDoc);
  return { description: descriptionText(doc).trim(), descriptionDoc: doc };
}

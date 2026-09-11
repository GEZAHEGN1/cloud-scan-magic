import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

/** Reads the text out of a scanned page using Lovable AI vision. */
export const recognizeText = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ imageDataUrl: z.string().startsWith("data:image/") }).parse(input),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured for this project.");

    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.7-flash",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Transcribe all text in this scanned document page. Preserve line breaks, paragraphs and reading order. Return only the text, no commentary.",
              },
              { type: "image_url", image_url: { url: data.imageDataUrl } },
            ],
          },
        ],
      }),
    });

    const body = await res.text();
    if (!res.ok) {
      if (res.status === 429) throw new Error("Too many requests right now. Try again in a moment.");
      if (res.status === 402) throw new Error("AI credits are used up. Add credits to keep scanning text.");
      throw new Error(`Text recognition failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const json = JSON.parse(body) as {
      choices?: { message?: { content?: string } }[];
    };
    return { text: json.choices?.[0]?.message?.content?.trim() ?? "" };
  });

const blockSchema = z.object({
  blocks: z.array(
    z.object({
      type: z.enum(["heading", "paragraph", "list", "quote", "toc", "pagebreak"]),
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      text: z.string().default(""),
      page: z.string().optional(),
      align: z.enum(["left", "center", "right"]).optional(),
      bold: z.boolean().optional(),
      sizeScale: z.number().min(0.5).max(3).optional(),
      indent: z.boolean().optional(),
      spaceBefore: z.number().min(0).max(4).optional(),
    }),
  ),
});

const BLOCK_PROPERTIES = {
  type: { type: "string", enum: ["heading", "paragraph", "list", "quote", "toc", "pagebreak"] },
  level: { type: "number", enum: [1, 2, 3] },
  text: { type: "string" },
  page: { type: "string" },
  align: { type: "string", enum: ["left", "center", "right"] },
  bold: { type: "boolean" },
  sizeScale: { type: "number" },
  indent: { type: "boolean" },
  spaceBefore: { type: "number" },
} as const;

const layoutTool = {
  type: "function",
  function: {
    name: "emit_layout",
    description: "Return the structured document blocks in reading order.",
    parameters: {
      type: "object",
      properties: {
        blocks: {
          type: "array",
          items: {
            type: "object",
            properties: BLOCK_PROPERTIES,
            required: ["type", "text"],
            additionalProperties: false,
          },
        },
      },
      required: ["blocks"],
      additionalProperties: false,
    },
  },
} as const;

const LAYOUT_RULES =
  "You restructure a scanned book page for typesetting, reproducing the ORIGINAL page layout as closely as possible. Keep the wording exactly as given — never summarise, translate or rewrite. Classify each block: chapter/section titles as heading (level 1 for chapter openers, 2 for sections, 3 for sub-sections), body text as paragraph, bulleted or numbered items as list (one block per item, without the bullet marker), indented or attributed excerpts as quote. A contents/index line that ends in a page number is type 'toc': put the entry label in text, the page number in page, and level 1 for main entries, 2 for sub-entries. Preserve emphasis: wrap bold words or phrases in **double asterisks**, including bold words inside a paragraph, and set bold:true when a whole block is bold. Preserve alignment with align: 'center' for centred lines, 'right' for right-aligned lines, otherwise 'left'. Set sizeScale to the block's height relative to the body text (1 = body text, e.g. 1.6 for a large title, 0.85 for small print). Set indent:true when the paragraph's first line is indented. Set spaceBefore to the blank space above the block measured in body lines (0, 0.5, 1, 2…). Merge lines broken mid-sentence and repair hyphenated line breaks. Drop running headers, footers and printed folio numbers that are not part of a contents entry.";

function parseLayoutResponse(body: string) {
  const json = JSON.parse(body) as {
    choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[];
  };
  const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) return { blocks: [] };
  const parsed = blockSchema.safeParse(JSON.parse(args));
  return { blocks: parsed.success ? parsed.data.blocks : [] };
}

function layoutError(status: number, body: string): Error {
  if (status === 429) return new Error("Too many requests right now. Try again in a moment.");
  if (status === 402) return new Error("AI credits are used up. Add credits to keep reconstructing.");
  return new Error(`Layout analysis failed (${status}): ${body.slice(0, 200)}`);
}

/**
 * Looks at the photographed page itself (not just its text) and returns the
 * structure of that page — headings, bold runs, alignment, indents and the
 * spacing between blocks — so the rebuilt page matches the original.
 */
export const analyzePageLayout = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        imageUrl: z.string().min(1).max(20_000_000),
        text: z.string().max(120000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured for this project.");

    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.7-flash",
        messages: [
          { role: "system", content: LAYOUT_RULES },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: data.text
                  ? `Look at this page image and return its layout. The transcription below is a reference for the wording only — trust the image for weight, size, alignment, indentation and spacing.\n\n${data.text}`
                  : "Look at this page image and return its layout, transcribing all of its text.",
              },
              { type: "image_url", image_url: { url: data.imageUrl } },
            ],
          },
        ],
        tools: [layoutTool],
        tool_choice: { type: "function", function: { name: "emit_layout" } },
      }),
    });

    const body = await res.text();
    if (!res.ok) throw layoutError(res.status, body);
    return parseLayoutResponse(body);
  });

/**
 * Reads the recognised text of a document and returns its structure
 * (headings, paragraphs, lists, quotes, page breaks) so it can be
 * reconstructed and reflowed at a new trim size.
 */
export const analyzeLayout = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ text: z.string().min(1).max(120000) }).parse(input),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured for this project.");

    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.7-flash",
        messages: [
          { role: "system", content: LAYOUT_RULES },
          { role: "user", content: data.text },
        ],
        tools: [layoutTool],
        tool_choice: { type: "function", function: { name: "emit_layout" } },
      }),
    });

    const body = await res.text();
    if (!res.ok) throw layoutError(res.status, body);
    return parseLayoutResponse(body);
  });

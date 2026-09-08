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
      type: z.enum(["heading", "paragraph", "list", "quote", "pagebreak"]),
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      text: z.string().default(""),
    }),
  ),
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
          {
            role: "system",
            content:
              "You restructure transcribed book pages for typesetting. Keep the wording exactly as given — never summarise, translate or rewrite. Classify each block: chapter/section titles as heading (level 1 for chapter openers, 2 for sections, 3 for sub-sections), body text as paragraph, bulleted or numbered items as list (one block per item, without the bullet marker), indented or attributed excerpts as quote. Insert a pagebreak block with empty text before each chapter opener. Merge lines broken mid-sentence and repair hyphenated line breaks. Drop running headers, footers and page numbers.",
          },
          { role: "user", content: data.text },
        ],
        tools: [
          {
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
                      properties: {
                        type: {
                          type: "string",
                          enum: ["heading", "paragraph", "list", "quote", "pagebreak"],
                        },
                        level: { type: "number", enum: [1, 2, 3] },
                        text: { type: "string" },
                      },
                      required: ["type", "text"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["blocks"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "emit_layout" } },
      }),
    });

    const body = await res.text();
    if (!res.ok) {
      if (res.status === 429) throw new Error("Too many requests right now. Try again in a moment.");
      if (res.status === 402) throw new Error("AI credits are used up. Add credits to keep reconstructing.");
      throw new Error(`Layout analysis failed (${res.status}): ${body.slice(0, 200)}`);
    }

    const json = JSON.parse(body) as {
      choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[];
    };
    const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return { blocks: [] };
    const parsed = blockSchema.safeParse(JSON.parse(args));
    return { blocks: parsed.success ? parsed.data.blocks : [] };
  });

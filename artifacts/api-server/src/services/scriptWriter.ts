import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "../lib/logger";
import type { ScrapedProduct } from "./productScraper";

export interface UgcScene {
  index: number;
  caption: string;
  visualPrompt: string;
}

export interface UgcScript {
  productTitle: string;
  productSummary: string;
  hook: string;
  voiceover: string;
  scenes: UgcScene[];
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    productTitle: { type: "string" },
    productSummary: { type: "string" },
    hook: { type: "string" },
    voiceover: { type: "string" },
    scenes: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          caption: { type: "string" },
          visualPrompt: { type: "string" },
        },
        required: ["caption", "visualPrompt"],
      },
    },
  },
  required: ["productTitle", "productSummary", "hook", "voiceover", "scenes"],
};

export async function writeUgcScript(
  product: ScrapedProduct
): Promise<UgcScript> {
  const prompt = `You are a viral TikTok UGC creator who makes authentic, casual product review videos that feel like a friend telling you about something they love. Your speaking style is conversational, slightly imperfect, with personal touches like "okay so", "you guys", "I have to tell you", etc. NO marketing speak. NO hashtags. NO emojis.

Write a 4-scene short-form vertical video script (about 18-22 seconds total when spoken aloud) about the product below.

PRODUCT URL: ${product.url}
PRODUCT TITLE: ${product.title ?? "(unknown)"}
PRODUCT DESCRIPTION: ${product.description ?? "(unknown)"}
PRODUCT PAGE EXCERPT (first 6000 chars):
${product.rawText.slice(0, 6000)}

Return JSON matching the schema with these fields:
- productTitle: short product name (max 60 chars)
- productSummary: one-sentence factual summary of what it actually is
- hook: an attention-grabbing opening line (max 15 words)
- voiceover: the FULL spoken narration as a single paragraph of natural speech (about 55-70 words). It MUST start with the hook. Use casual cadence. Mention the product by name once. No emojis, no markdown, no list formatting.
- scenes: exactly 4 scene objects. Each has:
    - caption: a punchy 2-6 word on-screen caption (no emojis)
    - visualPrompt: a vivid description (1-2 sentences) of a 9:16 vertical phone-shot lifestyle scene that prominently features THE EXACT product from the reference images (composition, setting, lighting, props, mood). Scene 1 should be a close-up reveal, scene 2 in-use, scene 3 a benefit/result moment, scene 4 a "must-have" closing shot. Each visualPrompt must be self-contained and explicitly say "the product from the reference images".`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.85,
    },
  });

  const text =
    response.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("") ?? "";

  let parsed: UgcScript;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    logger.error({ err, text }, "Failed to parse UGC script JSON");
    throw new Error("Gemini returned invalid script JSON");
  }

  if (!parsed.scenes || parsed.scenes.length !== 4) {
    throw new Error("Script must contain exactly 4 scenes");
  }

  parsed.scenes = parsed.scenes.map((s, i) => ({
    index: i,
    caption: s.caption.trim(),
    visualPrompt: s.visualPrompt.trim(),
  }));

  return parsed;
}

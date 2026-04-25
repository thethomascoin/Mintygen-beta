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

const SCENE_COUNT = 6;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    productTitle: { type: "string" },
    productSummary: { type: "string" },
    hook: { type: "string" },
    voiceover: { type: "string" },
    scenes: {
      type: "array",
      minItems: SCENE_COUNT,
      maxItems: SCENE_COUNT,
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
  const prompt = `You are a real person filming a casual TikTok about something you bought. The vibe is messy, fast, conversational — like you grabbed your phone and started talking to your camera while showing the product. You sound excited, a little rushed, like you're recording in your bedroom or kitchen. NOT polished. NOT scripted. NO marketing speak. NO hashtags. NO emojis. NO "click the link below". Just talk like a person telling a friend.

Write a SHORT, FAST vertical video script (about 12-14 seconds total when spoken aloud) for the product below. The video will be ${SCENE_COUNT} quick cuts (~2 seconds each), so the script needs to MOVE.

PRODUCT URL: ${product.url}
PRODUCT TITLE: ${product.title ?? "(unknown)"}
PRODUCT DESCRIPTION: ${product.description ?? "(unknown)"}
PRODUCT PAGE EXCERPT (first 6000 chars):
${product.rawText.slice(0, 6000)}

Return JSON matching the schema with these fields:
- productTitle: short product name (max 60 chars)
- productSummary: one-sentence factual summary of what it actually is
- hook: an attention-grabbing opening line, 6-12 words. Casual phrasings like "okay so I just got…", "you guys this is wild…", "wait look at this…", "I cannot believe…". NO product name in the hook.
- voiceover: the FULL spoken narration, ONE paragraph of natural speech, about 38-50 words. MUST start with the hook word-for-word. Casual rhythm with at most one filler ("like", "literally", "okay", "honestly"). Mention the product by name once. End with one personal-feeling line ("I'm obsessed", "ten out of ten", "go get it", "trust me"). No emojis, no markdown, no list formatting, no quotation marks around words.
- scenes: exactly ${SCENE_COUNT} scene objects describing 6 quick consecutive shots in a hand-held phone video. Order: (1) selfie-POV reveal — hand holding the product up close to the phone, "look what I got" energy; (2) extreme close-up showing a key detail of the product (texture, label, mechanism); (3) hand using or interacting with the product in a real domestic setting (counter, desk, bathroom, car); (4) before/result moment showing the product working or its effect; (5) wider shot of the product in its natural environment (on a shelf, in a bag, on a nightstand); (6) selfie-POV "okay you have to get this" closing shot, hand presenting the product toward camera again. Each scene has:
    - caption: a punchy 2-5 word on-screen caption (no emojis). Will be used internally only.
    - visualPrompt: 1-2 sentences describing the shot. EVERY scene MUST say "shot on iPhone, 9:16 vertical, handheld" and reference "the exact product from the reference images". Emphasize realistic phone perspective (often POV with a hand in frame), natural lighting, real domestic environment, slight motion blur or imperfect framing. NO captions, NO text, NO watermarks, NO logos other than the product's own. NEVER show a person's face.`;

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

  if (!parsed.scenes || parsed.scenes.length !== SCENE_COUNT) {
    throw new Error(`Script must contain exactly ${SCENE_COUNT} scenes`);
  }

  parsed.scenes = parsed.scenes.map((s, i) => ({
    index: i,
    caption: s.caption.trim(),
    visualPrompt: s.visualPrompt.trim(),
  }));

  return parsed;
}

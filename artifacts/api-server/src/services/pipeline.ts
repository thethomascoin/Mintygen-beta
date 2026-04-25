import fs from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { videoJobsTable } from "@workspace/db/schema";
import { generateImage as geminiGenerateImage } from "@workspace/integrations-gemini-ai/image";
import { textToSpeech } from "@workspace/integrations-openai-ai-server/audio";
import { logger } from "../lib/logger";
import {
  jobDir,
  jobFilePath,
  newAssetFilename,
  relativeFilename,
} from "../lib/storage";
import { scrapeProductPage } from "./productScraper";
import { writeUgcScript } from "./scriptWriter";
import { composeUgcVideo } from "./videoComposer";

async function setProgress(
  jobId: number,
  patch: Partial<typeof videoJobsTable.$inferInsert>
): Promise<void> {
  await db
    .update(videoJobsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(videoJobsTable.id, jobId));
}

function loadReferenceImagesAsParts(
  jobId: number,
  filenames: string[]
): { data: string; mimeType: string }[] {
  const result: { data: string; mimeType: string }[] = [];
  for (const fn of filenames) {
    const fullPath = jobFilePath(jobId, fn.split("/").pop()!);
    if (!fs.existsSync(fullPath)) continue;
    const buf = fs.readFileSync(fullPath);
    let mimeType = "image/png";
    if (fn.endsWith(".jpg") || fn.endsWith(".jpeg")) mimeType = "image/jpeg";
    else if (fn.endsWith(".webp")) mimeType = "image/webp";
    else if (fn.endsWith(".gif")) mimeType = "image/gif";
    result.push({ data: buf.toString("base64"), mimeType });
  }
  return result;
}

export async function runUgcPipeline(jobId: number): Promise<void> {
  logger.info({ jobId }, "UGC pipeline started");
  try {
    const [job] = await db
      .select()
      .from(videoJobsTable)
      .where(eq(videoJobsTable.id, jobId));
    if (!job) throw new Error(`Job ${jobId} not found`);

    await setProgress(jobId, {
      status: "processing",
      progress: "Reading product page",
    });

    const product = await scrapeProductPage(job.productUrl);

    await setProgress(jobId, {
      progress: "Writing script",
      productTitle: product.title,
      productSummary: product.description,
    });

    const script = await writeUgcScript(product);

    await setProgress(jobId, {
      progress: "Generating scenes",
      productTitle: script.productTitle,
      productSummary: script.productSummary,
      script: JSON.stringify(script, null, 2),
      voiceover: script.voiceover,
    });

    const refParts = loadReferenceImagesAsParts(
      jobId,
      job.referenceImageFilenames as string[]
    );

    if (refParts.length === 0) {
      throw new Error("No reference images available on disk");
    }

    const sceneFilenames: string[] = [];
    for (let i = 0; i < script.scenes.length; i++) {
      const scene = script.scenes[i]!;
      await setProgress(jobId, {
        progress: `Generating scene ${i + 1} of ${script.scenes.length}`,
      });

      const fullPrompt = `Authentic UGC TikTok still, vertical 9:16, shot on iPhone front or rear camera by a regular person — NOT a studio photo, NOT a product page render. Scene ${i + 1} of ${script.scenes.length}.

${scene.visualPrompt}

CRITICAL VISUAL RULES:
- The EXACT product from the attached reference images must be the clear subject. Preserve its real shape, color, branding, packaging, and proportions. Do NOT invent a different product or change its design.
- Camera perspective is a real human holding a phone. Most shots are POV with a human hand or arm visible in the frame holding or interacting with the product. Hand should look natural (any skin tone, casual, no manicure unless reference suggests it).
- NEVER show a person's face. Never show full body. Hands, arms, partial torso only.
- Real domestic environment in the background (kitchen counter, bathroom sink, bedroom, car interior, sidewalk, desk). NOT a studio, NOT a white background, NOT a marketing setup.
- Natural lighting (window light, indoor lamp, daylight). Slight digital grain, slightly imperfect framing, soft motion blur acceptable. Looks like it was shot in 5 seconds without thinking.
- ABSOLUTELY NO text overlays, NO captions, NO watermarks, NO logos other than the product's own packaging.`;

      const result = await geminiGenerateImage(fullPrompt, refParts);
      const ext =
        result.mimeType.includes("jpeg") || result.mimeType.includes("jpg")
          ? "jpg"
          : "png";
      const filename = newAssetFilename(`scene-${i + 1}`, ext);
      const fullPath = jobFilePath(jobId, filename);
      fs.writeFileSync(fullPath, Buffer.from(result.b64_json, "base64"));
      sceneFilenames.push(filename);

      await setProgress(jobId, {
        sceneImageFilenames: [
          ...sceneFilenames.map((f) => relativeFilename(jobId, f)),
        ],
      });
    }

    await setProgress(jobId, { progress: "Recording voiceover" });

    const audioBuffer = await textToSpeech(script.voiceover, "nova", "wav");
    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error("Voiceover audio buffer is empty");
    }
    const audioFilename = newAssetFilename("voice", "wav");
    const audioPath = jobFilePath(jobId, audioFilename);
    fs.writeFileSync(audioPath, audioBuffer);

    await setProgress(jobId, { progress: "Stitching video" });

    const videoFilename = newAssetFilename("video", "mp4");
    const thumbnailFilename = newAssetFilename("thumb", "jpg");
    const videoPath = jobFilePath(jobId, videoFilename);
    const thumbPath = jobFilePath(jobId, thumbnailFilename);

    const sceneAbsPaths = sceneFilenames.map((f) => jobFilePath(jobId, f));

    const composeResult = await composeUgcVideo({
      sceneImagePaths: sceneAbsPaths,
      audioPath,
      outputPath: videoPath,
      thumbnailPath: thumbPath,
      // Captions intentionally empty — the reference UGC style we're matching
      // has no on-screen text overlays; the voiceover carries the narrative.
      captions: script.scenes.map(() => ""),
    });

    await setProgress(jobId, {
      status: "completed",
      progress: "Done",
      videoFilename: relativeFilename(jobId, videoFilename),
      thumbnailFilename: relativeFilename(jobId, thumbnailFilename),
      durationSeconds: composeResult.durationSeconds,
    });

    logger.info({ jobId }, "UGC pipeline completed");
  } catch (err) {
    logger.error({ err, jobId }, "UGC pipeline failed");
    const message = err instanceof Error ? err.message : String(err);
    await setProgress(jobId, {
      status: "failed",
      progress: "Failed",
      errorMessage: message,
    });
  }
}

export function startUgcPipeline(jobId: number): void {
  // ensure job dir exists
  jobDir(jobId);
  // fire-and-forget
  runUgcPipeline(jobId).catch((err) => {
    logger.error({ err, jobId }, "UGC pipeline crashed");
  });
}

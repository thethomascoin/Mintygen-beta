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

      const fullPrompt = `Vertical 9:16 phone-shot photograph for a TikTok UGC video, scene ${i + 1} of 4.
${scene.visualPrompt}
Use the EXACT product shown in the attached reference images — preserve its real shape, color, branding, and packaging. Do NOT invent a different product.
Style: natural lighting, shot on iPhone, slight grain, candid composition, no text overlays, no watermarks. The product must be clearly visible and recognizable.`;

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
      captions: script.scenes.map((s) => s.caption),
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

import fs from "node:fs";
import path from "node:path";
import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { videoJobsTable, type VideoJob } from "@workspace/db/schema";
import { CreateUgcJobBody } from "@workspace/api-zod";
import {
  decodeImageInput,
  fileUrl,
  jobDir,
  jobFilePath,
  newAssetFilename,
  relativeFilename,
  safeJoin,
} from "../lib/storage";
import { startUgcPipeline } from "../services/pipeline";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function serializeJob(job: VideoJob) {
  return {
    id: job.id,
    productUrl: job.productUrl,
    status: job.status as "pending" | "processing" | "completed" | "failed",
    progress: job.progress,
    productTitle: job.productTitle,
    productSummary: job.productSummary,
    script: job.script,
    voiceover: job.voiceover,
    videoUrl: fileUrl(job.videoFilename),
    thumbnailUrl: fileUrl(job.thumbnailFilename),
    referenceImageUrls: ((job.referenceImageFilenames as string[]) ?? []).map(
      (f) => fileUrl(f)!
    ),
    sceneImageUrls: ((job.sceneImageFilenames as string[]) ?? []).map(
      (f) => fileUrl(f)!
    ),
    durationSeconds: job.durationSeconds,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

router.post("/jobs", async (req, res) => {
  const parsed = await CreateUgcJobBody.safeParseAsync(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues
        .map((issue: { message: string }) => issue.message)
        .join("; "),
    });
  }
  const { productUrl, referenceImages } = parsed.data;

  try {
    new URL(productUrl);
  } catch {
    return res.status(400).json({ error: "productUrl must be a valid URL" });
  }
  if (referenceImages.length === 0) {
    return res
      .status(400)
      .json({ error: "At least one reference image is required" });
  }
  if (referenceImages.length > 6) {
    return res
      .status(400)
      .json({ error: "Maximum 6 reference images allowed" });
  }

  // Create the job row first so we get its id
  const [created] = await db
    .insert(videoJobsTable)
    .values({
      productUrl,
      status: "pending",
      progress: "Queued",
      referenceImageFilenames: [],
      sceneImageFilenames: [],
    })
    .returning();

  if (!created) {
    return res.status(500).json({ error: "Failed to create job" });
  }

  // Persist reference images to disk
  jobDir(created.id);
  const refFilenames: string[] = [];
  for (let i = 0; i < referenceImages.length; i++) {
    try {
      const decoded = decodeImageInput(referenceImages[i]!);
      if (decoded.buffer.length === 0) continue;
      if (decoded.buffer.length > 8 * 1024 * 1024) {
        logger.warn(
          { jobId: created.id, idx: i, size: decoded.buffer.length },
          "Skipping oversize ref image"
        );
        continue;
      }
      const fn = newAssetFilename(`ref-${i + 1}`, decoded.ext);
      fs.writeFileSync(jobFilePath(created.id, fn), decoded.buffer);
      refFilenames.push(relativeFilename(created.id, fn));
    } catch (err) {
      logger.warn({ err, jobId: created.id, idx: i }, "Failed to decode ref image");
    }
  }

  if (refFilenames.length === 0) {
    await db
      .update(videoJobsTable)
      .set({
        status: "failed",
        progress: "Failed",
        errorMessage: "Reference images could not be decoded",
        updatedAt: new Date(),
      })
      .where(eq(videoJobsTable.id, created.id));
    const [bad] = await db
      .select()
      .from(videoJobsTable)
      .where(eq(videoJobsTable.id, created.id));
    return res.status(400).json(serializeJob(bad!));
  }

  await db
    .update(videoJobsTable)
    .set({
      referenceImageFilenames: refFilenames,
      updatedAt: new Date(),
    })
    .where(eq(videoJobsTable.id, created.id));

  const [withRefs] = await db
    .select()
    .from(videoJobsTable)
    .where(eq(videoJobsTable.id, created.id));

  startUgcPipeline(created.id);

  return res.status(201).json(serializeJob(withRefs!));
});

router.get("/jobs", async (_req, res) => {
  const rows = await db
    .select()
    .from(videoJobsTable)
    .orderBy(desc(videoJobsTable.createdAt))
    .limit(100);
  res.json(rows.map(serializeJob));
});

router.get("/jobs/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid id" });
  }
  const [row] = await db
    .select()
    .from(videoJobsTable)
    .where(eq(videoJobsTable.id, id));
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(serializeJob(row));
});

router.delete("/jobs/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid id" });
  }
  const [row] = await db
    .select()
    .from(videoJobsTable)
    .where(eq(videoJobsTable.id, id));
  if (!row) return res.status(404).json({ error: "Not found" });

  await db.delete(videoJobsTable).where(eq(videoJobsTable.id, id));
  const dir = jobDir(id);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    logger.warn({ err, jobId: id }, "Failed to remove job dir");
  }
  return res.status(204).send();
});

router.get("/files/:job/:name", (req, res) => {
  const rel = `${req.params.job}/${req.params.name}`;
  const abs = safeJoin(rel);
  if (!abs || !fs.existsSync(abs)) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  const ext = path.extname(abs).toLowerCase();
  const mime =
    ext === ".mp4"
      ? "video/mp4"
      : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".png"
          ? "image/png"
          : ext === ".wav"
            ? "audio/wav"
            : ext === ".webp"
              ? "image/webp"
              : "application/octet-stream";
  res.setHeader("Content-Type", mime);
  res.setHeader("Cache-Control", "public, max-age=300");
  fs.createReadStream(abs).pipe(res);
});

export default router;

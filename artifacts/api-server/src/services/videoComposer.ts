import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../lib/logger";

export interface ComposeVideoOptions {
  sceneImagePaths: string[];
  audioPath: string;
  outputPath: string;
  thumbnailPath: string;
  captions: string[];
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        logger.error({ code, stderr: stderr.slice(-2000) }, "ffmpeg failed");
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
}

function ffprobeDuration(audioPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      audioPath,
    ]);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe failed: ${err}`));
      const value = parseFloat(out.trim());
      if (Number.isNaN(value)) return reject(new Error("Invalid duration"));
      resolve(value);
    });
  });
}

function escapeForDrawText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%");
}

export async function composeUgcVideo(
  opts: ComposeVideoOptions
): Promise<{ durationSeconds: number }> {
  const { sceneImagePaths, audioPath, outputPath, thumbnailPath, captions } =
    opts;

  if (sceneImagePaths.length === 0) {
    throw new Error("At least one scene image is required");
  }

  const totalDuration = await ffprobeDuration(audioPath);
  const safeDuration = Math.max(6, Math.min(30, totalDuration));
  const perScene = safeDuration / sceneImagePaths.length;
  const fps = 30;
  const framesPerScene = Math.round(perScene * fps);

  const inputArgs: string[] = [];
  for (const img of sceneImagePaths) {
    inputArgs.push("-loop", "1", "-t", perScene.toFixed(3), "-i", img);
  }
  inputArgs.push("-i", audioPath);

  const filterParts: string[] = [];
  const labels: string[] = [];

  sceneImagePaths.forEach((_img, i) => {
    const caption = captions[i] ?? "";
    const inLabel = `${i}:v`;
    const outLabel = `v${i}`;
    const drawTextFilter = caption
      ? `,drawtext=text='${escapeForDrawText(
          caption.toUpperCase()
        )}':fontcolor=white:fontsize=72:borderw=4:bordercolor=black@0.85:x=(w-text_w)/2:y=h-h/4`
      : "";
    filterParts.push(
      // Crop+scale to 1080x1920, slow Ken-burns zoom in, optional caption
      `[${inLabel}]scale=1620:2880:force_original_aspect_ratio=increase,crop=1620:2880,zoompan=z='min(zoom+0.0009,1.18)':d=${framesPerScene}:s=1080x1920:fps=${fps}${drawTextFilter}[${outLabel}]`
    );
    labels.push(`[${outLabel}]`);
  });

  filterParts.push(
    `${labels.join("")}concat=n=${sceneImagePaths.length}:v=1:a=0[vout]`
  );

  const filterComplex = filterParts.join(";");

  const audioInputIndex = sceneImagePaths.length;

  await runFfmpeg([
    "-y",
    ...inputArgs,
    "-filter_complex",
    filterComplex,
    "-map",
    "[vout]",
    "-map",
    `${audioInputIndex}:a`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
    "-r",
    `${fps}`,
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-shortest",
    "-movflags",
    "+faststart",
    outputPath,
  ]);

  // Thumbnail = first scene image, scaled to 1080x1920
  await runFfmpeg([
    "-y",
    "-i",
    sceneImagePaths[0]!,
    "-vf",
    "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
    "-frames:v",
    "1",
    thumbnailPath,
  ]);

  const stats = fs.statSync(outputPath);
  logger.info(
    { outputPath, sizeBytes: stats.size, sceneCount: sceneImagePaths.length },
    "Composed UGC video"
  );

  return { durationSeconds: Math.round(safeDuration) };
}

export function ensureDir(p: string): void {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

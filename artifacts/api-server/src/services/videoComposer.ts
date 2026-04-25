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
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

// Soft-wrap a caption into up to 2 lines so it fits within the 1080px frame
// at our chosen font size. Splits at the space closest to the middle.
function wrapCaption(text: string, maxCharsPerLine = 16): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxCharsPerLine) return trimmed;
  const words = trimmed.split(/\s+/);
  if (words.length === 1) return trimmed;
  const mid = trimmed.length / 2;
  let bestSplit = -1;
  let bestDist = Infinity;
  let acc = 0;
  for (let i = 0; i < words.length - 1; i++) {
    acc += words[i]!.length + (i > 0 ? 1 : 0);
    const dist = Math.abs(acc - mid);
    if (dist < bestDist) {
      bestDist = dist;
      bestSplit = i;
    }
  }
  if (bestSplit < 0) return trimmed;
  const line1 = words.slice(0, bestSplit + 1).join(" ");
  const line2 = words.slice(bestSplit + 1).join(" ");
  return `${line1}\n${line2}`;
}

// Motion presets for per-scene movement. Aggressive and varied so the output
// reads as authentic handheld UGC, not a slideshow. Inside filter_complex,
// commas inside expressions must be backslash-escaped (`\\,` in JS becomes
// `\,` in the filter string).
const MOTION_PRESETS = [
  "push_in",
  "pull_out",
  "pan_left",
  "pan_right",
  "tilt_up",
  "orbit",
  "handheld_push",
] as const;

type Motion = (typeof MOTION_PRESETS)[number];

interface MotionExpr {
  z: string;
  x: string;
  y: string;
}

function buildMotion(preset: Motion, framesPerScene: number): MotionExpr {
  const N = framesPerScene;
  const ZMAX = "1.40";
  // Per-frame zoom step so we hit ZMAX over the scene.
  const K = ((1.4 - 1.0) / N).toFixed(6);
  const KH = ((1.35 - 1.05) / N).toFixed(6);
  // Handheld micro-jitter in source pixels (~8-14 source px ≈ 5-9 output px).
  const jx = "+12*sin(on/2.7)";
  const jy = "+10*sin(on/3.3+0.8)";
  const xCenter = `iw/2-(iw/zoom/2)${jx}`;
  const yCenter = `ih/2-(ih/zoom/2)${jy}`;
  const zPushIn = `min(1.0+on*${K}\\,${ZMAX})`;
  const zPullOut = `max(${ZMAX}-on*${K}\\,1.0)`;

  switch (preset) {
    case "push_in":
      return { z: zPushIn, x: xCenter, y: yCenter };
    case "pull_out":
      return { z: zPullOut, x: xCenter, y: yCenter };
    case "pan_left":
      return {
        z: "1.22",
        x: `(iw-iw/zoom)*(1-on/${N})${jx}`,
        y: yCenter,
      };
    case "pan_right":
      return {
        z: "1.22",
        x: `(iw-iw/zoom)*(on/${N})${jx}`,
        y: yCenter,
      };
    case "tilt_up":
      return {
        z: "1.22",
        x: xCenter,
        y: `(ih-ih/zoom)*(1-on/${N})${jy}`,
      };
    case "orbit":
      return {
        z: zPushIn,
        x: `iw/2-(iw/zoom/2)+28*sin(on/12)`,
        y: `ih/2-(ih/zoom/2)+22*cos(on/12)`,
      };
    case "handheld_push":
      return {
        z: `min(1.05+on*${KH}\\,1.35)`,
        x: `iw/2-(iw/zoom/2)+18*sin(on/2.1)`,
        y: `ih/2-(ih/zoom/2)+14*sin(on/2.6+1.5)`,
      };
  }
}

function pickMotion(i: number): Motion {
  // Rotate through presets but offset so even short videos see variety.
  // Avoid two consecutive scenes with same direction by interleaving.
  const order: Motion[] = [
    "push_in",
    "pan_right",
    "pull_out",
    "tilt_up",
    "handheld_push",
    "pan_left",
    "orbit",
  ];
  return order[i % order.length]!;
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
    // -framerate must be set on the input so zoompan receives the correct
    // number of frames; -loop+-t combined with -framerate gives us exactly
    // perScene*fps frames per scene image.
    inputArgs.push(
      "-loop",
      "1",
      "-framerate",
      String(fps),
      "-t",
      perScene.toFixed(3),
      "-i",
      img
    );
  }
  inputArgs.push("-i", audioPath);

  const filterParts: string[] = [];
  const labels: string[] = [];

  sceneImagePaths.forEach((_img, i) => {
    const caption = captions[i] ?? "";
    const inLabel = `${i}:v`;
    const outLabel = `v${i}`;
    const motion = buildMotion(pickMotion(i), framesPerScene);

    // Caption: large white text, thick black outline, fade-in over first 0.18s,
    // sits in the lower third like TikTok creator captions. Long captions are
    // wrapped onto a second line so they never bleed past the frame.
    const wrapped = wrapCaption(caption.toUpperCase());
    const drawTextFilter = caption
      ? `,drawtext=text='${escapeForDrawText(
          wrapped
        )}':fontcolor=white:fontsize=78:borderw=6:bordercolor=black:line_spacing=10:x=(w-text_w)/2:y=h-h/3-text_h/2:alpha='if(lt(t\\,0.18)\\,t/0.18\\,1)'`
      : "";

    // Source is upscaled to 1944x3456 (1.8x of 1080x1920 output) to give the
    // motion enough headroom for zoom + pan + handheld jitter without crawling
    // past frame edges. zoompan with d=1 emits exactly 1 output frame per
    // input frame, which is critical: with d=N you get N frames per input
    // frame, which makes the first scene's stream balloon to N*N frames and
    // -shortest cuts the audio off before later scenes ever play.
    filterParts.push(
      `[${inLabel}]fps=${fps},scale=1944:3456:force_original_aspect_ratio=increase,crop=1944:3456,` +
        `zoompan=z='${motion.z}':x='${motion.x}':y='${motion.y}':` +
        `d=1:s=1080x1920:fps=${fps}${drawTextFilter}[${outLabel}]`
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

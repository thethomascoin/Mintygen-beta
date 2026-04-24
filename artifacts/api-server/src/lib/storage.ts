import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const MEDIA_ROOT =
  process.env.UGC_MEDIA_ROOT ?? path.resolve(process.cwd(), "media");

if (!fs.existsSync(MEDIA_ROOT)) {
  fs.mkdirSync(MEDIA_ROOT, { recursive: true });
}

export function getMediaRoot(): string {
  return MEDIA_ROOT;
}

export function jobDir(jobId: number): string {
  const dir = path.join(MEDIA_ROOT, `job-${jobId}`);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function jobFilePath(jobId: number, filename: string): string {
  return path.join(jobDir(jobId), filename);
}

export function relativeFilename(jobId: number, filename: string): string {
  return `job-${jobId}/${filename}`;
}

export function fileUrl(filename: string | null | undefined): string | null {
  if (!filename) return null;
  return `/api/ugc/files/${filename}`;
}

export function decodeImageInput(
  input: string
): { buffer: Buffer; mimeType: string; ext: string } {
  let mimeType = "image/png";
  let base64 = input;
  const match = /^data:([^;]+);base64,(.*)$/i.exec(input);
  if (match) {
    mimeType = match[1] ?? "image/png";
    base64 = match[2] ?? "";
  }
  const buffer = Buffer.from(base64, "base64");
  let ext = "png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) ext = "jpg";
  else if (mimeType.includes("webp")) ext = "webp";
  else if (mimeType.includes("gif")) ext = "gif";
  return { buffer, mimeType, ext };
}

export function newAssetFilename(prefix: string, ext: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}.${ext}`;
}

export function safeJoin(filename: string): string | null {
  const resolved = path.resolve(MEDIA_ROOT, filename);
  if (!resolved.startsWith(MEDIA_ROOT + path.sep)) return null;
  return resolved;
}

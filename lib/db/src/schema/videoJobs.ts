import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const videoJobsTable = pgTable("video_jobs", {
  id: serial("id").primaryKey(),
  productUrl: text("product_url").notNull(),
  status: text("status").notNull().default("pending"),
  progress: text("progress").notNull().default("Queued"),
  productTitle: text("product_title"),
  productSummary: text("product_summary"),
  script: text("script"),
  voiceover: text("voiceover"),
  videoFilename: text("video_filename"),
  thumbnailFilename: text("thumbnail_filename"),
  referenceImageFilenames: jsonb("reference_image_filenames").$type<string[]>().notNull().default([]),
  sceneImageFilenames: jsonb("scene_image_filenames").$type<string[]>().notNull().default([]),
  durationSeconds: integer("duration_seconds"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVideoJobSchema = createInsertSchema(videoJobsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertVideoJob = z.infer<typeof insertVideoJobSchema>;
export type VideoJob = typeof videoJobsTable.$inferSelect;

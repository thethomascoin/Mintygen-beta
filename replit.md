# UGC Pilot

A mobile app that turns a product URL plus a few reference photos into an authentic
TikTok-style 9:16 UGC video with a generated voiceover.

## Architecture

Three artifacts in this monorepo:

- **`artifacts/api-server`** — Express + PostgreSQL backend. Runs the full
  generation pipeline:
  1. `productScraper.ts` — fetches the product page (cheerio) and pulls
     title, description, hero copy.
  2. `scriptWriter.ts` — Gemini 2.5-flash with a JSON schema. Returns a
     hook + **6-scene** story + a single conversational voiceover
     paragraph (~38-50 words, ~12-14s when spoken). Tone is "real person
     talking to camera" (filler words allowed, no marketing speak).
  3. `pipeline.ts` `geminiGenerateImage` step — Gemini 2.5-flash-image.
     Each scene prompt enforces "EXACT product from reference images",
     selfie-POV with hand-in-frame, real domestic environment, no faces,
     no text overlays, no UI/play-button artifacts.
  4. `tts.ts` — OpenAI TTS (`nova` voice, wav).
  5. `videoComposer.ts` — ffmpeg `zoompan` (with `d=1`!) over each scene
     image at 1080x1920, 7 rotating motion presets with heavy handheld
     sin-jitter so it feels phone-shot. Captions are intentionally OFF
     to match the no-text TikTok UGC reference style. Concatenated and
     muxed with voiceover audio. Thumbnail grabbed from scene 1.
  - Endpoints: `POST/GET /api/ugc/jobs`, `GET /api/ugc/jobs/:id`,
    `DELETE /api/ugc/jobs/:id`, `GET /api/ugc/files/:job/:name`.
  - Files live under the api-server cwd at `media/job-{id}/` and are
    served by the file route with public cache headers.

- **`artifacts/ugc-pilot`** — Expo mobile app (single screen).
  - `app/index.tsx` — form (URL input + image picker for up to 4 refs)
    + history list of jobs with live progress polling.
  - `components/VideoPlayerModal.tsx` — full-screen `expo-video` player
    showing the result, voiceover transcript, and product info.
  - Hooks in `hooks/useUgcJobs.ts` (react-query) auto-refetch every
    2.5s while any job is `pending`/`processing`.
  - API base URL comes from `EXPO_PUBLIC_DOMAIN` (set automatically in
    the dev script).

- **`artifacts/mockup-sandbox`** — design canvas (unused for this build).

## Database

A single `videoJobsTable` (Drizzle) with columns: `productUrl`,
`status`, `progress`, `productTitle`, `productSummary`, `script`,
`voiceover`, `videoFilename`, `thumbnailFilename`,
`referenceImageFilenames[]`, `sceneImageFilenames[]`, `durationSeconds`,
`errorMessage`, timestamps.

Migrations live in `lib/db`; schema is `lib/db/src/schema.ts`. The shared
db client is the singleton from `@workspace/db`.

## Integrations

Replit-managed AI integrations (no user-supplied keys):

- `lib/integrations-gemini-ai-server` — `generateText` (with JSON schema)
  and `generateImage` (accepts reference images for visual context).
- `lib/integrations-openai-ai-server` — `textToSpeech`.

## API contract

`lib/api-spec/openapi.yaml` defines the routes. `pnpm codegen` regenerates
the Zod schemas (`@workspace/api-spec`) and the React Query hooks
(`@workspace/api-client-react`). The request body name is `UgcJobInput`
(renamed to avoid an orval naming collision).

## Build notes

- The api-server is bundled with esbuild. `@google/genai` must NOT be
  externalized (the `@google/*` glob has been removed from `external`)
  or Node can't resolve it at runtime due to pnpm hoisting.
- Express JSON limit is raised to 60mb because reference images are
  uploaded as base64 data URLs in the JSON body (no multipart).
- ffmpeg is on PATH from the Replit Nix env.

## User preferences

- No mock data, no simulations. Every step in the pipeline must hit a
  real model / tool.
- No emojis in any UI; use `@expo/vector-icons` (Feather) instead.

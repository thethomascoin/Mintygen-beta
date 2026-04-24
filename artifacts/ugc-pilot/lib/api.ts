export interface UgcJob {
  id: number;
  productUrl: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: string;
  productTitle: string | null;
  productSummary: string | null;
  script: string | null;
  voiceover: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  referenceImageUrls: string[];
  sceneImageUrls: string[];
  durationSeconds: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

function getBaseUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) {
    throw new Error("EXPO_PUBLIC_DOMAIN is not set");
  }
  return `https://${domain}`;
}

export function absoluteUrl(serverPath: string | null | undefined): string | null {
  if (!serverPath) return null;
  if (serverPath.startsWith("http")) return serverPath;
  return `${getBaseUrl()}${serverPath}`;
}

export async function fetchJobs(): Promise<UgcJob[]> {
  const res = await fetch(`${getBaseUrl()}/api/ugc/jobs`);
  if (!res.ok) throw new Error(`Failed to load jobs (${res.status})`);
  return (await res.json()) as UgcJob[];
}

export async function fetchJob(id: number): Promise<UgcJob> {
  const res = await fetch(`${getBaseUrl()}/api/ugc/jobs/${id}`);
  if (!res.ok) throw new Error(`Failed to load job (${res.status})`);
  return (await res.json()) as UgcJob;
}

export async function createJob(input: {
  productUrl: string;
  referenceImages: string[];
}): Promise<UgcJob> {
  const res = await fetch(`${getBaseUrl()}/api/ugc/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Server error (${res.status})`);
  }
  if (!res.ok) {
    const err = (payload as { error?: string }).error ?? `Failed (${res.status})`;
    throw new Error(err);
  }
  return payload as UgcJob;
}

export async function deleteJob(id: number): Promise<void> {
  const res = await fetch(`${getBaseUrl()}/api/ugc/jobs/${id}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete (${res.status})`);
  }
}

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { createJob, deleteJob, fetchJob, fetchJobs, type UgcJob } from "@/lib/api";

const ACTIVE_STATUSES = new Set(["pending", "processing"]);

export function useUgcJobs() {
  return useQuery<UgcJob[]>({
    queryKey: ["ugcJobs"],
    queryFn: fetchJobs,
    refetchInterval: (query) => {
      const data = query.state.data as UgcJob[] | undefined;
      if (data && data.some((j) => ACTIVE_STATUSES.has(j.status))) {
        return 2500;
      }
      return false;
    },
  });
}

export function useUgcJob(id: number | null) {
  return useQuery<UgcJob>({
    queryKey: ["ugcJob", id],
    queryFn: () => fetchJob(id as number),
    enabled: id !== null,
    refetchInterval: (query) => {
      const data = query.state.data as UgcJob | undefined;
      if (data && ACTIVE_STATUSES.has(data.status)) return 2500;
      return false;
    },
  });
}

export function useCreateUgcJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ugcJobs"] });
    },
  });
}

export function useDeleteUgcJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ugcJobs"] });
    },
  });
}

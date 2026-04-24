import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CreateJobForm } from "@/components/CreateJobForm";
import { JobCard } from "@/components/JobCard";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { useColors } from "@/hooks/useColors";
import { useDeleteUgcJob, useUgcJobs } from "@/hooks/useUgcJobs";
import type { UgcJob } from "@/lib/api";

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const jobsQuery = useUgcJobs();
  const deleteMutation = useDeleteUgcJob();
  const [openJobId, setOpenJobId] = useState<number | null>(null);

  const jobs = jobsQuery.data ?? [];
  const openJob = jobs.find((j) => j.id === openJobId) ?? null;

  const onRefresh = useCallback(() => {
    jobsQuery.refetch();
  }, [jobsQuery]);

  function openJobIfReady(j: UgcJob) {
    if (j.status === "completed" && j.videoUrl) {
      setOpenJobId(j.id);
    } else if (j.status === "failed") {
      Alert.alert("Generation failed", j.errorMessage ?? "Unknown error");
    }
  }

  function confirmDelete(jobId: number) {
    Alert.alert("Delete video", "This will permanently delete this video.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setOpenJobId(null);
          try {
            await deleteMutation.mutateAsync(jobId);
          } catch (err) {
            Alert.alert(
              "Could not delete",
              err instanceof Error ? err.message : "Try again"
            );
          }
        },
      },
    ]);
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={jobsQuery.isFetching && !jobsQuery.isLoading}
            onRefresh={onRefresh}
            tintColor={colors.mutedForeground}
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <LinearGradient
              colors={[colors.primary, colors.accent]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.logoChip}
            >
              <Feather name="play" size={14} color="#ffffff" />
            </LinearGradient>
            <Text style={[styles.brand, { color: colors.foreground }]}>
              UGC Pilot
            </Text>
          </View>
          <Text style={[styles.headline, { color: colors.foreground }]}>
            Real product videos in one tap.
          </Text>
          <Text style={[styles.subhead, { color: colors.mutedForeground }]}>
            Drop a product link and a few photos. Get back an authentic 9:16 video with voiceover.
          </Text>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <CreateJobForm />
        </View>

        <View style={styles.historyHeader}>
          <Text style={[styles.historyLabel, { color: colors.mutedForeground }]}>
            YOUR VIDEOS
          </Text>
          {jobsQuery.isFetching && !jobsQuery.isLoading ? (
            <ActivityIndicator size="small" color={colors.mutedForeground} />
          ) : null}
        </View>

        {jobsQuery.isLoading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color={colors.mutedForeground} />
          </View>
        ) : jobs.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="film" size={32} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Nothing here yet.{"\n"}Submit your first product above.
            </Text>
          </View>
        ) : (
          <View style={styles.jobList}>
            {jobs.map((j) => (
              <JobCard key={j.id} job={j} onPress={() => openJobIfReady(j)} />
            ))}
          </View>
        )}
      </ScrollView>

      <VideoPlayerModal
        job={openJob}
        onClose={() => setOpenJobId(null)}
        onDelete={() => openJob && confirmDelete(openJob.id)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    paddingHorizontal: 18,
    gap: 22,
  },
  header: {
    gap: 8,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 6,
  },
  logoChip: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 2,
  },
  brand: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    letterSpacing: 0.2,
  },
  headline: {
    fontFamily: "Inter_700Bold",
    fontSize: 28,
    lineHeight: 34,
  },
  subhead: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
  },
  historyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  historyLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 1.5,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    gap: 14,
  },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  jobList: {
    gap: 12,
  },
});

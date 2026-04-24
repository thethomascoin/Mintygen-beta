import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { absoluteUrl, type UgcJob } from "@/lib/api";

interface Props {
  job: UgcJob;
  onPress: () => void;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export function JobCard({ job, onPress }: Props) {
  const colors = useColors();
  const thumb = absoluteUrl(job.thumbnailUrl) ?? absoluteUrl(job.referenceImageUrls[0] ?? null);
  const isActive = job.status === "pending" || job.status === "processing";
  const isReady = job.status === "completed" && job.videoUrl;
  const isFailed = job.status === "failed";

  return (
    <Pressable
      onPress={onPress}
      disabled={!isReady && !isFailed}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={[styles.thumbWrap, { backgroundColor: colors.muted }]}>
        {thumb ? (
          <Image
            source={{ uri: thumb }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <Feather name="video" size={28} color={colors.mutedForeground} />
        )}
        {isReady ? (
          <View style={styles.playOverlay}>
            <View style={styles.playCircle}>
              <Feather name="play" size={20} color="#0a0a0f" />
            </View>
          </View>
        ) : null}
      </View>
      <View style={styles.body}>
        <Text
          numberOfLines={1}
          style={[styles.title, { color: colors.foreground }]}
        >
          {job.productTitle ?? job.productUrl}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.url, { color: colors.mutedForeground }]}
        >
          {job.productUrl.replace(/^https?:\/\//, "")}
        </Text>
        <View style={styles.metaRow}>
          {isActive ? (
            <>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.metaText, { color: colors.primary }]}>
                {job.progress}
              </Text>
            </>
          ) : isFailed ? (
            <>
              <Feather name="alert-circle" size={14} color={colors.destructive} />
              <Text
                numberOfLines={1}
                style={[styles.metaText, { color: colors.destructive }]}
              >
                {job.errorMessage ?? "Failed"}
              </Text>
            </>
          ) : (
            <>
              <Feather name="check-circle" size={14} color={colors.accent} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                {job.durationSeconds ? `${job.durationSeconds}s · ` : ""}
                {timeAgo(job.createdAt)}
              </Text>
            </>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
    gap: 14,
    alignItems: "center",
  },
  thumbWrap: {
    width: 72,
    height: 96,
    borderRadius: 12,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  playCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.95)",
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 3,
  },
  body: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
  },
  url: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  metaText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    flexShrink: 1,
  },
});

import { Feather } from "@expo/vector-icons";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { absoluteUrl, type UgcJob } from "@/lib/api";

interface Props {
  job: UgcJob | null;
  onClose: () => void;
  onDelete: () => void;
}

export function VideoPlayerModal({ job, onClose, onDelete }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const videoUri = absoluteUrl(job?.videoUrl ?? null);

  const player = useVideoPlayer(videoUri ?? "", (p) => {
    p.loop = true;
    if (videoUri) p.play();
  });

  useEffect(() => {
    if (videoUri) {
      player.replace(videoUri);
      player.play();
    } else {
      player.pause();
    }
  }, [videoUri, player]);

  const playing = useEvent(player, "playingChange", { isPlaying: player.playing });

  if (!job) return null;

  return (
    <Modal
      visible={!!job}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent={false}
    >
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View
          style={[styles.topBar, { paddingTop: insets.top + 8, paddingBottom: 8 }]}
        >
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.iconBtn,
              { backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 },
            ]}
            hitSlop={10}
          >
            <Feather name="chevron-down" size={22} color={colors.foreground} />
          </Pressable>
          <Text
            numberOfLines={1}
            style={[styles.topTitle, { color: colors.foreground }]}
          >
            {job.productTitle ?? "Generated video"}
          </Text>
          <Pressable
            onPress={onDelete}
            style={({ pressed }) => [
              styles.iconBtn,
              { backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 },
            ]}
            hitSlop={10}
          >
            <Feather name="trash-2" size={18} color={colors.destructive} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + 24 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.videoWrap}>
            {videoUri ? (
              <Pressable
                onPress={() => {
                  if (player.playing) player.pause();
                  else player.play();
                }}
                style={styles.videoPress}
              >
                <VideoView
                  player={player}
                  style={styles.video}
                  contentFit="cover"
                  nativeControls={false}
                  allowsPictureInPicture={false}
                />
                {!playing.isPlaying ? (
                  <View style={styles.playOverlay}>
                    <View style={styles.playCircle}>
                      <Feather name="play" size={28} color="#0a0a0f" />
                    </View>
                  </View>
                ) : null}
              </Pressable>
            ) : (
              <View
                style={[
                  styles.video,
                  { backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" },
                ]}
              >
                <Text style={{ color: colors.mutedForeground }}>
                  No video available
                </Text>
              </View>
            )}
          </View>

          {job.voiceover ? (
            <View style={[styles.section, { borderTopColor: colors.border }]}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                Voiceover
              </Text>
              <Text style={[styles.bodyText, { color: colors.foreground }]}>
                {job.voiceover}
              </Text>
            </View>
          ) : null}

          {job.productSummary ? (
            <View style={[styles.section, { borderTopColor: colors.border }]}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                About this product
              </Text>
              <Text style={[styles.bodyText, { color: colors.foreground }]}>
                {job.productSummary}
              </Text>
            </View>
          ) : null}

          <View style={[styles.section, { borderTopColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              Source
            </Text>
            <Text
              numberOfLines={2}
              style={[styles.linkText, { color: colors.accent }]}
            >
              {job.productUrl}
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 12,
  },
  topTitle: {
    flex: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    textAlign: "center",
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    paddingHorizontal: 16,
    gap: 16,
  },
  videoWrap: {
    width: "100%",
    aspectRatio: 9 / 16,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  videoPress: { flex: 1 },
  video: { flex: 1, width: "100%", height: "100%" },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  playCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.95)",
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 4,
  },
  section: {
    paddingTop: 16,
    borderTopWidth: 1,
    gap: 6,
  },
  sectionLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  bodyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    lineHeight: 22,
  },
  linkText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
});

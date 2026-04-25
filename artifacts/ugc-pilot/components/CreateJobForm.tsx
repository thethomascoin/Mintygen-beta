import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { useCreateUgcJob } from "@/hooks/useUgcJobs";

interface PickedImage {
  uri: string;
  base64: string;
  mimeType: string;
}

const MAX_IMAGES = 4;

function safeHaptic(fn: () => Promise<unknown> | unknown) {
  if (Platform.OS === "web") return;
  try {
    const r = fn();
    if (r && typeof (r as Promise<unknown>).catch === "function") {
      (r as Promise<unknown>).catch(() => {});
    }
  } catch {
    // ignore
  }
}

export function CreateJobForm() {
  const colors = useColors();
  const [productUrl, setProductUrl] = useState("");
  const [images, setImages] = useState<PickedImage[]>([]);
  const createMutation = useCreateUgcJob();

  const canSubmit =
    productUrl.trim().length > 5 &&
    images.length > 0 &&
    !createMutation.isPending;

  async function readAsBase64(uri: string): Promise<string | null> {
    try {
      const res = await fetch(uri);
      const blob = await res.blob();
      return await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result;
          if (typeof result !== "string") return resolve(null);
          const i = result.indexOf("base64,");
          resolve(i >= 0 ? result.slice(i + "base64,".length) : null);
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

  async function pickImage() {
    if (images.length >= MAX_IMAGES) {
      Alert.alert("Limit reached", `You can attach up to ${MAX_IMAGES} reference images.`);
      return;
    }

    if (Platform.OS !== "web") {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Permission required",
          "Photo library access is needed to add reference images."
        );
        return;
      }
    }

    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.7,
        base64: true,
        selectionLimit: MAX_IMAGES - images.length,
        allowsMultipleSelection: true,
      });
    } catch (err) {
      Alert.alert(
        "Could not open photo library",
        err instanceof Error ? err.message : "Try again"
      );
      return;
    }

    if (result.canceled) return;

    const next: PickedImage[] = [];
    for (const asset of result.assets) {
      const mimeType = asset.mimeType ?? "image/jpeg";
      let base64 = asset.base64 ?? null;
      if (!base64 && asset.uri) {
        base64 = await readAsBase64(asset.uri);
      }
      if (!base64) continue;
      next.push({
        uri: asset.uri,
        base64,
        mimeType,
      });
    }

    if (next.length === 0) {
      Alert.alert(
        "Could not read image",
        "We couldn't read the selected file. Try a different photo."
      );
      return;
    }

    setImages((prev) => [...prev, ...next].slice(0, MAX_IMAGES));
  }

  function removeImage(idx: number) {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit() {
    if (!canSubmit) return;
    safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
    const trimmed = productUrl.trim();
    const url = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;

    try {
      new URL(url);
    } catch {
      Alert.alert("Invalid URL", "Please enter a valid product URL.");
      return;
    }

    try {
      await createMutation.mutateAsync({
        productUrl: url,
        referenceImages: images.map((i) => `data:${i.mimeType};base64,${i.base64}`),
      });
      safeHaptic(() =>
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      );
      setProductUrl("");
      setImages([]);
    } catch (err) {
      safeHaptic(() =>
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      );
      Alert.alert(
        "Could not start job",
        err instanceof Error ? err.message : "Something went wrong"
      );
    }
  }

  return (
    <View style={styles.root}>
      <View style={[styles.field, { borderColor: colors.border, backgroundColor: colors.input }]}>
        <Feather name="link-2" size={16} color={colors.mutedForeground} />
        <TextInput
          value={productUrl}
          onChangeText={setProductUrl}
          placeholder="Paste a product URL"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          style={[
            styles.input,
            { color: colors.foreground, fontFamily: "Inter_400Regular" },
          ]}
        />
      </View>

      <View style={styles.imageRow}>
        {images.map((img, idx) => (
          <View key={idx} style={[styles.imageTile, { borderColor: colors.border }]}>
            <Image source={{ uri: img.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            <Pressable
              onPress={() => removeImage(idx)}
              hitSlop={8}
              style={styles.removeBtn}
            >
              <Feather name="x" size={12} color="#ffffff" />
            </Pressable>
          </View>
        ))}
        {images.length < MAX_IMAGES ? (
          <Pressable
            onPress={pickImage}
            style={({ pressed }) => [
              styles.addTile,
              {
                borderColor: colors.border,
                backgroundColor: colors.card,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
          >
            <Feather name="plus" size={20} color={colors.mutedForeground} />
            <Text style={[styles.addTileText, { color: colors.mutedForeground }]}>
              {images.length === 0 ? "Add product photos" : "Add more"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <Pressable
        disabled={!canSubmit}
        onPress={submit}
        style={({ pressed }) => [
          styles.submit,
          {
            backgroundColor: canSubmit ? colors.primary : colors.muted,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        {createMutation.isPending ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <>
            <Feather
              name="zap"
              size={16}
              color={canSubmit ? colors.primaryForeground : colors.mutedForeground}
            />
            <Text
              style={[
                styles.submitText,
                {
                  color: canSubmit ? colors.primaryForeground : colors.mutedForeground,
                },
              ]}
            >
              Generate UGC video
            </Text>
          </>
        )}
      </Pressable>

      <Text style={[styles.helper, { color: colors.mutedForeground }]}>
        We generate scene images, write a script and add a voiceover, then deliver a 9:16 MP4.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 14,
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  imageRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  imageTile: {
    width: 76,
    height: 76,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
  },
  removeBtn: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
  },
  addTile: {
    width: 76,
    height: 76,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    gap: 4,
  },
  addTileText: {
    fontFamily: "Inter_500Medium",
    fontSize: 10,
    textAlign: "center",
  },
  submit: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 54,
    borderRadius: 14,
    marginTop: 4,
  },
  submitText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
  },
  helper: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
  },
});

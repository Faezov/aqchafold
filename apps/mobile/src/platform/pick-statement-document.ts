import { getDocumentAsync } from "expo-document-picker";

export type SelectedDocument = {
  uri: string;
  name?: string;
  mimeType?: string;
  size?: number;
};

export async function pickStatementDocument(): Promise<SelectedDocument | null> {
  const result = await getDocumentAsync({
    type: "application/pdf",
    multiple: false,
    // Keep the provider URI opaque; selection does not need document bytes.
    copyToCacheDirectory: false,
  });
  if (result.canceled) return null;
  if (result.assets.length !== 1) {
    throw new Error("Expected one selected document.");
  }

  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType,
    size: asset.size,
  };
}

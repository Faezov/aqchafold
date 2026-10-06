import { File } from "expo-file-system";

/** Read the provider's exact bytes without copying or rewriting the document. */
export async function readDocumentBytes(uri: string): Promise<Uint8Array> {
  return await new File(uri).bytes();
}

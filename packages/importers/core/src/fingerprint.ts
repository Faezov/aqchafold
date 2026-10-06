import type { ImportFingerprint } from "@aqchafold/domain";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { DocumentInput } from "./types";

/** Exact original artifact bytes, independent of bank, filename, and parser. */
export function fingerprintDocumentInput(
  input: DocumentInput,
): ImportFingerprint {
  return Object.freeze({
    method: "sha256",
    value: bytesToHex(sha256(input.bytes)),
  });
}

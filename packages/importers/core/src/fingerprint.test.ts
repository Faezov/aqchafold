import { describe, expect, it, vi } from "vitest";
import { fingerprintDocumentInput } from "./fingerprint";

describe("fingerprintDocumentInput", () => {
  it("uses the SHA-256 known answer for the exact bytes of abc", () => {
    expect(
      fingerprintDocumentInput({ bytes: Uint8Array.of(97, 98, 99) }),
    ).toEqual({
      method: "sha256",
      value: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
  });

  it("is deterministic and leaves the input unchanged", () => {
    const bytes = Uint8Array.of(0, 255, 128, 42);
    const before = bytes.slice();
    expect(fingerprintDocumentInput({ bytes })).toEqual(
      fingerprintDocumentInput({ bytes: bytes.slice() }),
    );
    expect(bytes).toEqual(before);
  });

  it("changes when one source byte changes", () => {
    expect(
      fingerprintDocumentInput({ bytes: Uint8Array.of(0, 255) }),
    ).not.toEqual(fingerprintDocumentInput({ bytes: Uint8Array.of(0, 254) }));
  });

  it("ignores filename and display metadata attached by callers", () => {
    const bytes = Uint8Array.of(1, 2, 3);
    const first = {
      bytes,
      originalFilename: "first.pdf",
      displayLabel: "First",
    };
    const second = {
      bytes,
      originalFilename: "other.pdf",
      displayLabel: "Other",
    };
    expect(fingerprintDocumentInput(first)).toEqual(
      fingerprintDocumentInput(second),
    );
  });

  it("hashes only the supplied view, including its byte offset and length", () => {
    const bytes = Uint8Array.of(0, 97, 98, 99, 255);
    expect(fingerprintDocumentInput({ bytes: bytes.subarray(1, 4) })).toEqual(
      fingerprintDocumentInput({ bytes: Uint8Array.of(97, 98, 99) }),
    );
  });

  it("preserves the SHA-256 empty-artifact result", () => {
    expect(fingerprintDocumentInput({ bytes: new Uint8Array() }).value).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("executes without a platform crypto global", () => {
    vi.stubGlobal("crypto", undefined);
    try {
      expect(
        fingerprintDocumentInput({ bytes: Uint8Array.of(97, 98, 99) }).value,
      ).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

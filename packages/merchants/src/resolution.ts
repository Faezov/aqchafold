/** State of one resolution outcome, independent of Merchant identity and source priority. */
export type MerchantResolution =
  | {
      readonly status: "confirmed";
      readonly merchantId: string;
    }
  | {
      readonly status: "suggested";
      readonly merchantId: string;
    }
  | {
      readonly status: "unknown";
      // Reject structurally assigned unknown outcomes carrying an identity.
      readonly merchantId?: never;
    };

/** Represent authoritative confirmation already established by the caller. */
export function confirmedMerchant(
  merchantId: string,
): Extract<MerchantResolution, { status: "confirmed" }> {
  assertMerchantId(merchantId);
  return Object.freeze({ status: "confirmed", merchantId });
}

/** Represent a candidate that still requires user or other authoritative confirmation. */
export function suggestedMerchant(
  merchantId: string,
): Extract<MerchantResolution, { status: "suggested" }> {
  assertMerchantId(merchantId);
  return Object.freeze({ status: "suggested", merchantId });
}

/** Represent the absence of an established Merchant candidate, with no identity field. */
export function unknownMerchant(): Extract<
  MerchantResolution,
  { status: "unknown" }
> {
  return Object.freeze({ status: "unknown" });
}

function assertMerchantId(merchantId: string): void {
  if (typeof merchantId !== "string" || merchantId.trim().length === 0) {
    throw new TypeError("Merchant resolution ID must be a nonblank string.");
  }
}

export { resolveMerchantAlias } from "./aliases";
export type { MerchantAlias } from "./aliases";
export type {
  MerchantDescriptionNormalizer,
  MerchantNormalizationResult,
} from "./normalization";
export { normalizePaymentProcessorPrefix } from "./payment-processor-prefix";
export {
  confirmedMerchant,
  resolveMerchantIdentity,
  suggestedMerchant,
  unknownMerchant,
} from "./resolution";
export type { MerchantResolution } from "./resolution";
export { aggregateUnknownMerchantObservations } from "./unknown-aggregation";
export type {
  UnknownMerchantGroup,
  UnknownMerchantObservation,
} from "./unknown-aggregation";

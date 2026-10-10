export { resolveMerchantAlias } from "./aliases";
export type { MerchantAlias } from "./aliases";
export { applyCategoryRules } from "./apply-category-rules";
export type { CategoryRuleApplicationOptions } from "./apply-category-rules";
export type {
  MerchantDescriptionNormalizer,
  MerchantNormalizationResult,
} from "./normalization";
export { normalizeMerchantDescription } from "./normalization";
export { normalizePaymentProcessorPrefix } from "./payment-processor-prefix";
export { normalizeStatementMetadataSuffix } from "./statement-metadata-suffix";
export {
  confirmedMerchant,
  resolveMerchantIdentity,
  suggestedMerchant,
  unknownMerchant,
} from "./resolution";
export type { MerchantResolution } from "./resolution";
export { rankUnknownMerchantReviewQueues } from "./review-ranking";
export type {
  RankedUnknownMerchantGroup,
  UnknownMerchantFinancialObservation,
  UnknownMerchantReviewQueue,
} from "./review-ranking";
export { aggregateUnknownMerchantObservations } from "./unknown-aggregation";
export type {
  UnknownMerchantGroup,
  UnknownMerchantObservation,
} from "./unknown-aggregation";

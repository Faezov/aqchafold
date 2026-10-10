import type {
  AccountRepository,
  MerchantRepository,
  MerchantRuleRepository,
  TransactionRepository,
} from "@aqchafold/database";
import {
  buildMerchantReviewQueues,
  type MerchantReviewGroup,
  type MerchantReviewQueue,
} from "./merchant-review-data";

export type SuggestedMerchantReviewAction = {
  readonly householdId: string;
  readonly group: Extract<MerchantReviewGroup, { status: "suggested" }>;
};

export const MERCHANT_CONFIRMATION_FAILURE_MESSAGE =
  "The suggestion could not be confirmed. Please try again.";

export type MerchantReviewState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly confirmationError?: string }
  | {
      readonly status: "ready";
      readonly queues: readonly MerchantReviewQueue[];
      readonly submitting: boolean;
      readonly confirmationError?: string;
    };

type ReviewRepositories = {
  readonly accountRepository: Pick<AccountRepository, "list">;
  readonly transactionRepository: Pick<TransactionRepository, "list">;
  readonly merchantRepository: Pick<MerchantRepository, "getById">;
  readonly merchantRuleRepository: Pick<
    MerchantRuleRepository,
    "get" | "create"
  >;
};

/** Presentation orchestration: explicit confirmation writes only a MerchantRule. */
export function createMerchantReviewController(
  repositories: ReviewRepositories,
  onChange: (state: MerchantReviewState) => void,
) {
  let state: MerchantReviewState = { status: "loading" };
  let submitting = false;

  function publish(next: MerchantReviewState) {
    state = next;
    onChange(next);
  }

  function reload(confirmationError?: string) {
    try {
      const queues = buildMerchantReviewQueues({
        transactions: repositories.transactionRepository.list(),
        accounts: repositories.accountRepository.list(),
        findConfirmedMerchantId: (householdId, normalizedDescription) =>
          repositories.merchantRuleRepository.get(
            householdId,
            normalizedDescription,
          )?.merchantId,
        findMerchantById: (merchantId) =>
          repositories.merchantRepository.getById(merchantId),
      });
      publish({
        status: "ready",
        queues,
        submitting: false,
        confirmationError,
      });
    } catch {
      publish({ status: "error", confirmationError });
    }
  }

  return {
    load() {
      if (submitting) return;
      publish({ status: "loading" });
      reload();
    },
    confirm(action: SuggestedMerchantReviewAction) {
      if (submitting || state.status !== "ready") return;
      if (!isSuggestedAction(action)) {
        reload(MERCHANT_CONFIRMATION_FAILURE_MESSAGE);
        return;
      }
      // Require the actual current item. Queued taps on old renders cannot write again.
      if (
        !state.queues.some(
          (queue) =>
            queue.householdId === action.householdId &&
            queue.groups.includes(action.group),
        )
      )
        return;

      submitting = true;
      publish({ ...state, submitting: true, confirmationError: undefined });
      let confirmationError: string | undefined;
      try {
        const { group, householdId } = action;
        const merchant = repositories.merchantRepository.getById(
          group.merchantId,
        );
        if (merchant === undefined || merchant.id !== group.merchantId) {
          throw new Error("Suggested Merchant is unavailable.");
        }
        repositories.merchantRuleRepository.create({
          householdId,
          normalizedDescription: group.normalizedDescription,
          merchantId: group.merchantId,
        });
      } catch {
        confirmationError = MERCHANT_CONFIRMATION_FAILURE_MESSAGE;
      } finally {
        // Rebuild from SQLite after either outcome; never remove a group optimistically.
        reload(confirmationError);
        submitting = false;
      }
    },
  };
}

function isSuggestedAction(action: SuggestedMerchantReviewAction): boolean {
  return (
    typeof action === "object" &&
    action !== null &&
    typeof action.group === "object" &&
    action.group !== null &&
    action.group.status === "suggested" &&
    [
      action.householdId,
      action.group.normalizedDescription,
      action.group.merchantId,
    ].every((value) => typeof value === "string" && value.trim().length > 0)
  );
}

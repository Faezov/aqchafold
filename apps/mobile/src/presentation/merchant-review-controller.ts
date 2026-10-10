import type {
  AccountRepository,
  CategoryRepository,
  MerchantRepository,
  MerchantRuleRepository,
  RememberedTransactionCategoryAssignment,
  TransactionRepository,
} from "@aqchafold/database";
import type { Category } from "@aqchafold/domain";
import {
  addReviewCategoryState,
  type CategorizedMerchantReviewGroup,
  type CategorizedMerchantReviewQueue,
} from "./merchant-review-categories";
import { buildMerchantReviewQueues } from "./merchant-review-data";

export type SuggestedMerchantReviewAction = {
  readonly householdId: string;
  readonly group: Extract<
    CategorizedMerchantReviewGroup,
    { status: "suggested" }
  >;
};

export type MerchantReviewCategoryAction = {
  readonly householdId: string;
  readonly group: CategorizedMerchantReviewGroup;
  readonly categoryId: string;
  readonly rememberForFuture?: boolean;
};

export const MERCHANT_CONFIRMATION_FAILURE_MESSAGE =
  "The suggestion could not be confirmed. Please try again.";
export const CATEGORY_ASSIGNMENT_FAILURE_MESSAGE =
  "The category could not be changed. Please try again.";

type ReviewActionErrors = {
  readonly confirmationError?: string;
  readonly categoryError?: string;
};

export type MerchantReviewState =
  | { readonly status: "loading" }
  | ({ readonly status: "error" } & ReviewActionErrors)
  | ({
      readonly status: "ready";
      readonly queues: readonly CategorizedMerchantReviewQueue[];
      readonly activeCategories: readonly Category[];
      readonly submitting: boolean;
    } & ReviewActionErrors);

type ReviewRepositories = {
  readonly assignCategoryAndRemember: (
    input: RememberedTransactionCategoryAssignment,
  ) => void;
  readonly accountRepository: Pick<AccountRepository, "list">;
  readonly categoryRepository: Pick<CategoryRepository, "getById" | "list">;
  readonly transactionRepository: Pick<
    TransactionRepository,
    "list" | "assignCategory"
  >;
  readonly merchantRepository: Pick<MerchantRepository, "getById">;
  readonly merchantRuleRepository: Pick<
    MerchantRuleRepository,
    "get" | "create"
  >;
};

/** Independent explicit actions: confirm identity or assign current group categories. */
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

  function reload(errors: ReviewActionErrors = {}) {
    try {
      const transactions = repositories.transactionRepository.list();
      const categories = repositories.categoryRepository.list();
      const queues = buildMerchantReviewQueues({
        transactions,
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
        queues: addReviewCategoryState({ queues, transactions, categories }),
        activeCategories: Object.freeze(
          categories.filter((category) => category.status === "active"),
        ),
        submitting: false,
        ...errors,
      });
    } catch {
      publish({ status: "error", ...errors });
    }
  }

  function isCurrentGroup(action: {
    householdId: string;
    group: CategorizedMerchantReviewGroup;
  }) {
    return (
      state.status === "ready" &&
      state.queues.some(
        (queue) =>
          queue.householdId === action.householdId &&
          queue.groups.includes(action.group),
      )
    );
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
        reload({ confirmationError: MERCHANT_CONFIRMATION_FAILURE_MESSAGE });
        return;
      }
      // Require the actual current item. Queued taps on old renders cannot write again.
      if (!isCurrentGroup(action)) return;

      submitting = true;
      publish({
        ...state,
        submitting: true,
        confirmationError: undefined,
        categoryError: undefined,
      });
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
        reload({ confirmationError });
        submitting = false;
      }
    },
    applyCategory(action: MerchantReviewCategoryAction) {
      if (submitting || state.status !== "ready") return;
      if (!isCategoryAction(action)) {
        reload({ categoryError: CATEGORY_ASSIGNMENT_FAILURE_MESSAGE });
        return;
      }
      if (!isCurrentGroup(action)) return;

      submitting = true;
      publish({
        ...state,
        submitting: true,
        confirmationError: undefined,
        categoryError: undefined,
      });
      let categoryError: string | undefined;
      try {
        const category = repositories.categoryRepository.getById(
          action.categoryId,
        );
        if (
          category === undefined ||
          category.id !== action.categoryId ||
          category.status !== "active"
        ) {
          throw new Error("Assignable Category is unavailable.");
        }
        const assignment = {
          householdId: action.householdId,
          transactionIds: action.group.transactionIds,
          categoryId: category.id,
        };
        if (action.rememberForFuture === true) {
          repositories.assignCategoryAndRemember({
            ...assignment,
            normalizedDescription: action.group.normalizedDescription,
          });
        } else {
          repositories.transactionRepository.assignCategory(assignment);
        }
      } catch {
        categoryError = CATEGORY_ASSIGNMENT_FAILURE_MESSAGE;
      } finally {
        reload({ categoryError });
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

function isCategoryAction(action: MerchantReviewCategoryAction): boolean {
  return (
    typeof action === "object" &&
    action !== null &&
    typeof action.group === "object" &&
    action.group !== null &&
    (action.group.status === "unknown" ||
      action.group.status === "suggested") &&
    (action.rememberForFuture === undefined ||
      typeof action.rememberForFuture === "boolean") &&
    [
      action.householdId,
      action.group.normalizedDescription,
      action.categoryId,
    ].every((value) => typeof value === "string" && value.trim().length > 0)
  );
}

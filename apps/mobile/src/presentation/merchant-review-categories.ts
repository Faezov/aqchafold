import type { Category, Transaction } from "@aqchafold/domain";
import type {
  MerchantReviewGroup,
  MerchantReviewQueue,
} from "./merchant-review-data";

export type MerchantReviewCategoryState =
  | { readonly kind: "uncategorized" }
  | { readonly kind: "categorized"; readonly category: Category }
  | { readonly kind: "mixed" };

export type CategorizedMerchantReviewGroup = MerchantReviewGroup & {
  readonly categoryState: MerchantReviewCategoryState;
};

export type CategorizedMerchantReviewQueue = Omit<
  MerchantReviewQueue,
  "groups"
> & {
  readonly groups: readonly CategorizedMerchantReviewGroup[];
};

const INVALID_SOURCE_MESSAGE =
  "Merchant review requires valid category source data.";

/** Add presentation state using only each existing group's exact Transaction IDs. */
export function addReviewCategoryState(input: {
  readonly queues: readonly MerchantReviewQueue[];
  readonly transactions: readonly Transaction[];
  readonly categories: readonly Category[];
}): readonly CategorizedMerchantReviewQueue[] {
  const transactionById = new Map<string, Transaction>();
  for (const transaction of input.transactions) {
    if (transactionById.has(transaction.id))
      throw new Error(INVALID_SOURCE_MESSAGE);
    transactionById.set(transaction.id, transaction);
  }
  const categoryById = new Map<string, Category>();
  for (const category of input.categories) {
    if (categoryById.has(category.id)) throw new Error(INVALID_SOURCE_MESSAGE);
    categoryById.set(category.id, category);
  }

  return Object.freeze(
    input.queues.map((queue) =>
      Object.freeze({
        ...queue,
        groups: Object.freeze(
          queue.groups.map((group) => {
            const categoryIds = new Set<string | undefined>();
            if (
              group.transactionIds.length === 0 ||
              new Set(group.transactionIds).size !== group.transactionIds.length
            )
              throw new Error(INVALID_SOURCE_MESSAGE);
            for (const id of group.transactionIds) {
              const transaction = transactionById.get(id);
              if (
                transaction === undefined ||
                (transaction.categoryId !== undefined &&
                  !categoryById.has(transaction.categoryId))
              )
                throw new Error(INVALID_SOURCE_MESSAGE);
              categoryIds.add(transaction.categoryId);
            }
            const categoryId = categoryIds.values().next().value;
            const categoryState: MerchantReviewCategoryState =
              categoryIds.size > 1
                ? { kind: "mixed" }
                : categoryId === undefined
                  ? { kind: "uncategorized" }
                  : {
                      kind: "categorized",
                      category: categoryById.get(categoryId)!,
                    };
            return Object.freeze({
              ...group,
              categoryState: Object.freeze(categoryState),
            });
          }),
        ),
      }),
    ),
  );
}

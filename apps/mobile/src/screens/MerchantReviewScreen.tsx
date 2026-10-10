import type {
  AccountRepository,
  CategoryRepository,
  MerchantRepository,
  MerchantRuleRepository,
  RememberedTransactionCategoryAssignment,
  TransactionRepository,
} from "@aqchafold/database";
import type { Category } from "@aqchafold/domain";
import { useEffect, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  SectionList,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { formatTransactionAmount } from "../presentation/format-transaction-amount";
import type { CategorizedMerchantReviewGroup } from "../presentation/merchant-review-categories";
import {
  createMerchantReviewController,
  type MerchantReviewState,
} from "../presentation/merchant-review-controller";

type MerchantReviewScreenProps = {
  accountRepository: AccountRepository;
  categoryRepository: CategoryRepository;
  assignCategoryAndRemember: (
    input: RememberedTransactionCategoryAssignment,
  ) => void;
  transactionRepository: TransactionRepository;
  merchantRepository: MerchantRepository;
  merchantRuleRepository: MerchantRuleRepository;
  onBack: () => void;
};

export default function MerchantReviewScreen({
  accountRepository,
  categoryRepository,
  assignCategoryAndRemember,
  transactionRepository,
  merchantRepository,
  merchantRuleRepository,
  onBack,
}: MerchantReviewScreenProps) {
  const [state, setState] = useState<MerchantReviewState>({
    status: "loading",
  });
  const controller = useMemo(
    () =>
      createMerchantReviewController(
        {
          accountRepository,
          categoryRepository,
          assignCategoryAndRemember,
          transactionRepository,
          merchantRepository,
          merchantRuleRepository,
        },
        setState,
      ),
    [
      accountRepository,
      categoryRepository,
      assignCategoryAndRemember,
      transactionRepository,
      merchantRepository,
      merchantRuleRepository,
    ],
  );

  useEffect(() => {
    const pendingRead = setTimeout(controller.load, 0);
    return () => clearTimeout(pendingRead);
  }, [controller]);

  return (
    <View style={styles.screen}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back to Home"
        style={styles.back}
      >
        <Text style={styles.text}>Back</Text>
      </Pressable>
      <Text accessibilityRole="header" style={styles.title}>
        Merchant review
      </Text>
      {state.status !== "loading" && state.confirmationError && (
        <Text accessibilityRole="alert" style={styles.text}>
          {state.confirmationError}
        </Text>
      )}
      {state.status !== "loading" && state.categoryError && (
        <Text accessibilityRole="alert" style={styles.text}>
          {state.categoryError}
        </Text>
      )}
      {state.status === "loading" ? (
        <Text style={styles.text}>Loading merchant review…</Text>
      ) : state.status === "error" ? (
        <Text accessibilityRole="alert" style={styles.text}>
          Merchant review could not be loaded. Return Home and try again.
        </Text>
      ) : (
        <SectionList
          sections={state.queues.map(({ householdId, currency, groups }) => ({
            key: JSON.stringify([householdId, currency]),
            householdId,
            currency,
            data: groups,
          }))}
          keyExtractor={(group) => group.normalizedDescription}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          ListEmptyComponent={
            <Text style={styles.text}>No unknown merchants to review.</Text>
          }
          renderSectionHeader={({ section }) => (
            <Text accessibilityRole="header" style={styles.currency}>
              {section.currency}
            </Text>
          )}
          renderItem={({ item: group, section }) => (
            <View style={styles.group}>
              <Text style={styles.text}>{group.normalizedDescription}</Text>
              <Text style={styles.text}>
                Transactions: {group.transactionCount}
              </Text>
              <Text style={styles.text}>
                Outgoing value:{" "}
                {formatTransactionAmount(group.spendingMinor, section.currency)}
              </Text>
              <Text style={styles.text}>
                Category:{" "}
                {group.categoryState.kind === "uncategorized"
                  ? "Uncategorized"
                  : group.categoryState.kind === "mixed"
                    ? "Mixed categories"
                    : group.categoryState.category.name}
              </Text>
              {Platform.OS === "android" && (
                <CategoryAssignment
                  group={group}
                  categories={state.activeCategories}
                  submitting={state.submitting}
                  onApply={(categoryId, rememberForFuture) =>
                    controller.applyCategory({
                      householdId: section.householdId,
                      group,
                      categoryId,
                      rememberForFuture,
                    })
                  }
                />
              )}
              {group.status === "suggested" && (
                <>
                  <Text style={styles.text}>
                    Suggested: {group.displayName}
                  </Text>
                  {Platform.OS === "android" && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Confirm suggested Merchant"
                      accessibilityState={{ disabled: state.submitting }}
                      disabled={state.submitting}
                      onPress={() =>
                        controller.confirm({
                          householdId: section.householdId,
                          group,
                        })
                      }
                      style={styles.confirm}
                    >
                      <Text style={styles.text}>Confirm</Text>
                    </Pressable>
                  )}
                </>
              )}
            </View>
          )}
        />
      )}
    </View>
  );
}

function CategoryAssignment({
  group,
  categories,
  submitting,
  onApply,
}: {
  group: CategorizedMerchantReviewGroup;
  categories: readonly Category[];
  submitting: boolean;
  onApply: (categoryId: string, rememberForFuture: boolean) => void;
}) {
  const [selection, setSelection] = useState<{
    group: CategorizedMerchantReviewGroup;
    categoryId?: string;
    rememberForFuture: boolean;
  }>();
  // Reloaded groups invalidate a selection, including after either action fails.
  const selected =
    selection?.group === group
      ? categories.find((category) => category.id === selection.categoryId)
      : undefined;
  const rememberForFuture =
    selection?.group === group && selection.rememberForFuture;
  return (
    <View style={styles.categoryControls}>
      <Text style={styles.text}>
        {categories.length === 0
          ? "No categories available"
          : "Choose category"}
      </Text>
      <View style={styles.categoryOptions}>
        {categories.map((category) => (
          <Pressable
            key={category.id}
            accessibilityRole="radio"
            accessibilityState={{
              checked: selected === category,
              disabled: submitting,
            }}
            disabled={submitting}
            onPress={() =>
              setSelection({
                group,
                categoryId: category.id,
                rememberForFuture,
              })
            }
            style={[
              styles.confirm,
              selected === category && styles.selectedCategory,
            ]}
          >
            <Text style={styles.text}>{category.name}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{
          checked: rememberForFuture,
          disabled: submitting || categories.length === 0,
        }}
        disabled={submitting || categories.length === 0}
        onPress={() =>
          setSelection({
            group,
            categoryId: selected?.id,
            rememberForFuture: !rememberForFuture,
          })
        }
        style={[
          styles.confirm,
          rememberForFuture && styles.selectedCategory,
          (submitting || categories.length === 0) && styles.disabled,
        ]}
      >
        <Text style={styles.text}>
          Remember for future transactions with this description
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Apply category to this review group"
        accessibilityState={{ disabled: submitting || selected === undefined }}
        disabled={submitting || selected === undefined}
        onPress={() => {
          if (selected) onApply(selected.id, rememberForFuture);
        }}
        style={[
          styles.confirm,
          (submitting || selected === undefined) && styles.disabled,
        ]}
      >
        <Text style={styles.text}>Apply</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#fff",
    paddingHorizontal: 24,
    paddingTop: (StatusBar.currentHeight ?? 0) + 24,
    gap: 16,
  },
  back: {
    alignSelf: "flex-start",
    padding: 12,
    borderWidth: 1,
    borderColor: "#888",
  },
  title: { fontSize: 28, fontWeight: "600", color: "#111" },
  currency: { fontSize: 18, fontWeight: "600", color: "#111" },
  list: { gap: 16, paddingBottom: 48 },
  group: { borderWidth: 1, borderColor: "#ccc", padding: 16, gap: 4 },
  categoryControls: { gap: 8, marginVertical: 8 },
  categoryOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  selectedCategory: { backgroundColor: "#e4edf7", borderColor: "#245b91" },
  disabled: { opacity: 0.5 },
  confirm: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#888",
    padding: 12,
  },
  text: { fontSize: 16, color: "#333" },
});

import type {
  AccountRepository,
  MerchantRepository,
  MerchantRuleRepository,
  TransactionRepository,
} from "@aqchafold/database";
import { useEffect, useState } from "react";
import {
  Pressable,
  SectionList,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { formatTransactionAmount } from "../presentation/format-transaction-amount";
import {
  buildMerchantReviewQueues,
  type MerchantReviewQueue,
} from "../presentation/merchant-review-data";

type MerchantReviewScreenProps = {
  accountRepository: AccountRepository;
  transactionRepository: TransactionRepository;
  merchantRepository: MerchantRepository;
  merchantRuleRepository: MerchantRuleRepository;
  onBack: () => void;
};

type ReadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; queues: readonly MerchantReviewQueue[] };

export default function MerchantReviewScreen({
  accountRepository,
  transactionRepository,
  merchantRepository,
  merchantRuleRepository,
  onBack,
}: MerchantReviewScreenProps) {
  const [state, setState] = useState<ReadState>({ status: "loading" });

  useEffect(() => {
    const pendingRead = setTimeout(() => {
      try {
        const queues = buildMerchantReviewQueues({
          transactions: transactionRepository.list(),
          accounts: accountRepository.list(),
          findConfirmedMerchantId: (householdId, normalizedDescription) =>
            merchantRuleRepository.get(householdId, normalizedDescription)
              ?.merchantId,
          findMerchantById: (merchantId) =>
            merchantRepository.getById(merchantId),
        });
        setState({ status: "ready", queues });
      } catch {
        setState({ status: "error" });
      }
    }, 0);
    return () => clearTimeout(pendingRead);
  }, [
    accountRepository,
    transactionRepository,
    merchantRepository,
    merchantRuleRepository,
  ]);

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
              {group.status === "suggested" && (
                <Text style={styles.text}>
                  Suggested Merchant: {group.displayName}
                </Text>
              )}
              <Text style={styles.text}>
                Transactions: {group.transactionCount}
              </Text>
              <Text style={styles.text}>
                Outgoing value:{" "}
                {formatTransactionAmount(group.spendingMinor, section.currency)}
              </Text>
            </View>
          )}
        />
      )}
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
  text: { fontSize: 16, color: "#333" },
});

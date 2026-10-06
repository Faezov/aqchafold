import type { TransactionRepository } from "@aqchafold/database";
import { useEffect, useState } from "react";
import {
  FlatList,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { formatTransactionAmount } from "../presentation/format-transaction-amount";

type TransactionsScreenProps = {
  repository: TransactionRepository;
  onBack: () => void;
};

type ReadState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      transactions: ReturnType<TransactionRepository["list"]>;
    };

export default function TransactionsScreen({
  repository,
  onBack,
}: TransactionsScreenProps) {
  const [state, setState] = useState<ReadState>({ status: "loading" });

  useEffect(() => {
    const pendingRead = setTimeout(() => {
      try {
        setState({ status: "ready", transactions: repository.list() });
      } catch {
        setState({ status: "error" });
      }
    }, 0);
    return () => clearTimeout(pendingRead);
  }, [repository]);

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
        Transactions
      </Text>

      {state.status === "loading" ? (
        <Text style={styles.text}>Loading transactions…</Text>
      ) : state.status === "error" ? (
        <Text style={styles.text}>
          Transactions could not be loaded. Return Home and try again.
        </Text>
      ) : (
        <FlatList
          data={state.transactions}
          keyExtractor={(transaction) => transaction.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.text}>No transactions yet.</Text>
          }
          renderItem={({ item: transaction }) => (
            <View style={styles.transaction}>
              <Text style={styles.text}>
                Posting date: {transaction.postingDate}
              </Text>
              <Text style={styles.text}>
                Description: {transaction.rawDescription ?? "Not provided"}
              </Text>
              <Text style={styles.text}>
                Amount:{" "}
                {formatTransactionAmount(
                  transaction.amount.amountMinor,
                  transaction.amount.currency,
                )}
              </Text>
              <Text style={styles.text}>Account: {transaction.accountId}</Text>
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
  title: {
    fontSize: 28,
    fontWeight: "600",
    color: "#111",
  },
  list: {
    gap: 16,
    paddingBottom: 48,
  },
  transaction: {
    borderWidth: 1,
    borderColor: "#ccc",
    padding: 16,
    gap: 4,
  },
  text: {
    fontSize: 16,
    color: "#333",
  },
});

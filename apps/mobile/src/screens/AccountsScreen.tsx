import type { AccountRepository } from "@aqchafold/database";
import { useEffect, useState } from "react";
import {
  FlatList,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";

type AccountsScreenProps = {
  repository: AccountRepository;
  onBack: () => void;
};

type ReadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; accounts: ReturnType<AccountRepository["list"]> };

const typeLabels = {
  transaction: "Transaction",
  savings: "Savings",
  "credit-card": "Credit card",
  cash: "Cash",
  other: "Other",
};

const ownershipLabels = {
  individual: "Individual",
  shared: "Shared",
  "household-level": "Household-level",
  unknown: "Unknown",
};

export default function AccountsScreen({
  repository,
  onBack,
}: AccountsScreenProps) {
  const [state, setState] = useState<ReadState>({ status: "loading" });

  useEffect(() => {
    const pendingRead = setTimeout(() => {
      try {
        setState({ status: "ready", accounts: repository.list() });
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
        Accounts
      </Text>

      {state.status === "loading" ? (
        <Text style={styles.text}>Loading accounts…</Text>
      ) : state.status === "error" ? (
        <Text style={styles.text}>
          Accounts could not be loaded. Return Home and try again.
        </Text>
      ) : (
        <FlatList
          data={state.accounts}
          keyExtractor={(account) => account.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.text}>
              No accounts yet. Account creation is not available yet.
            </Text>
          }
          renderItem={({ item: account }) => (
            <View style={styles.account}>
              <Text style={styles.label}>{account.label}</Text>
              <Text style={styles.text}>Type: {typeLabels[account.type]}</Text>
              <Text style={styles.text}>Status: {account.status}</Text>
              <Text style={styles.text}>
                Primary currency: {account.primaryCurrency}
              </Text>
              <Text style={styles.text}>
                Ownership: {ownershipLabels[account.ownership.kind]}
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
  title: {
    fontSize: 28,
    fontWeight: "600",
    color: "#111",
  },
  list: {
    gap: 16,
    paddingBottom: 48,
  },
  account: {
    borderWidth: 1,
    borderColor: "#ccc",
    padding: 16,
    gap: 4,
  },
  label: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111",
  },
  text: {
    fontSize: 16,
    color: "#333",
  },
});

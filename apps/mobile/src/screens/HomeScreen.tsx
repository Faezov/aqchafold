import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { SelectedDocument } from "../platform/pick-statement-document";

type HomeScreenProps = {
  onOpenAccounts: () => void;
  onOpenTransactions: () => void;
  onPickStatement: () => void;
  selectedDocument: SelectedDocument | null;
  isPicking: boolean;
  pickerFailed: boolean;
};

export default function HomeScreen({
  onOpenAccounts,
  onOpenTransactions,
  onPickStatement,
  selectedDocument,
  isPicking,
  pickerFailed,
}: HomeScreenProps) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>
        Ledgerase
      </Text>
      <Text style={styles.description}>
        Your finances stay on this device. No account required.
      </Text>

      <Pressable
        onPress={onOpenAccounts}
        accessibilityRole="button"
        accessibilityLabel="Accounts"
        style={[styles.destination, styles.available]}
      >
        <Text style={styles.destinationTitle}>Accounts</Text>
        <Text style={styles.description}>View saved accounts</Text>
      </Pressable>

      <Pressable
        onPress={onOpenTransactions}
        accessibilityRole="button"
        accessibilityLabel="Transactions"
        style={[styles.destination, styles.available]}
      >
        <Text style={styles.destinationTitle}>Transactions</Text>
        <Text style={styles.description}>View saved transactions</Text>
      </Pressable>

      <Pressable
        onPress={onPickStatement}
        disabled={isPicking}
        accessibilityRole="button"
        accessibilityLabel="Import statement, choose a PDF"
        accessibilityState={{ disabled: isPicking, busy: isPicking }}
        style={[styles.destination, !isPicking && styles.available]}
      >
        <Text style={styles.destinationTitle}>Import statement</Text>
        <Text style={styles.description}>
          {isPicking ? "Opening document picker…" : "Choose one PDF document"}
        </Text>
      </Pressable>

      {pickerFailed && (
        <Text accessibilityRole="alert" style={styles.description}>
          The document could not be selected. Please try again.
        </Text>
      )}
      {selectedDocument && (
        <View accessibilityLiveRegion="polite">
          <Text style={styles.description}>
            Selected: {selectedDocument.name || "PDF document"}
          </Text>
          <Text style={styles.description}>
            Ready to import. This document has not been imported yet.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#fff",
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: (StatusBar.currentHeight ?? 0) + 24,
    paddingBottom: 48,
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "600",
    color: "#111",
  },
  description: {
    fontSize: 16,
    color: "#333",
    marginBottom: 8,
  },
  destination: {
    padding: 16,
    gap: 4,
    borderWidth: 1,
    borderColor: "#ccc",
    backgroundColor: "#f3f3f3",
  },
  destinationTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#444",
  },
  available: {
    backgroundColor: "#fff",
    borderColor: "#888",
  },
});

import type { Account } from "@aqchafold/domain";
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { ImportStatementStatus } from "../import/import-statement";
import type { SelectedDocument } from "../platform/pick-statement-document";

type HomeScreenProps = {
  onOpenAccounts: () => void;
  onOpenTransactions: () => void;
  onPickStatement: () => void;
  selectedDocument: SelectedDocument | null;
  isPicking: boolean;
  pickerFailed: boolean;
  accounts: readonly Account[] | null;
  accountsFailed: boolean;
  selectedAccountId: string | null;
  onSelectAccount: (id: string) => void;
  currencyConfirmed: boolean;
  onConfirmCurrency: () => void;
  onImportStatement: () => void;
  importStatus: "ready" | "importing" | ImportStatementStatus;
};

const importMessages = {
  ready: "Ready to import",
  importing: "Importing…",
  imported: "Imported",
  "already-imported": "This statement has already been imported.",
  unsupported: "This statement format is not supported.",
  failed: "Import failed. Please try again.",
};

export default function HomeScreen({
  onOpenAccounts,
  onOpenTransactions,
  onPickStatement,
  selectedDocument,
  isPicking,
  pickerFailed,
  accounts,
  accountsFailed,
  selectedAccountId,
  onSelectAccount,
  currencyConfirmed,
  onConfirmCurrency,
  onImportStatement,
  importStatus,
}: HomeScreenProps) {
  const isImporting = importStatus === "importing";
  const isBusy = isPicking || isImporting;
  const selectedAccount = accounts?.find(
    (account) => account.id === selectedAccountId,
  );
  const importDisabled = isBusy || !selectedAccount || !currencyConfirmed;

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
        disabled={isImporting}
        accessibilityRole="button"
        accessibilityLabel="Accounts"
        accessibilityState={{ disabled: isImporting }}
        style={[styles.destination, !isImporting && styles.available]}
      >
        <Text style={styles.destinationTitle}>Accounts</Text>
        <Text style={styles.description}>View saved accounts</Text>
      </Pressable>

      <Pressable
        onPress={onOpenTransactions}
        disabled={isImporting}
        accessibilityRole="button"
        accessibilityLabel="Transactions"
        accessibilityState={{ disabled: isImporting }}
        style={[styles.destination, !isImporting && styles.available]}
      >
        <Text style={styles.destinationTitle}>Transactions</Text>
        <Text style={styles.description}>View saved transactions</Text>
      </Pressable>

      <Pressable
        onPress={onPickStatement}
        disabled={isBusy}
        accessibilityRole="button"
        accessibilityLabel="Choose statement PDF"
        accessibilityState={{ disabled: isBusy, busy: isPicking }}
        style={[styles.destination, !isBusy && styles.available]}
      >
        <Text style={styles.destinationTitle}>Choose statement PDF</Text>
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
        <View style={styles.selection}>
          <Text style={styles.description}>
            Selected: {selectedDocument.name || "PDF document"}
          </Text>
          {accountsFailed ? (
            <Text accessibilityRole="alert" style={styles.description}>
              Accounts could not be loaded. Open Accounts and return Home to try
              again.
            </Text>
          ) : accounts === null ? (
            <Text style={styles.description}>Loading accounts…</Text>
          ) : accounts.length === 0 ? (
            <Text accessibilityLiveRegion="polite" style={styles.description}>
              Create an account before importing a statement.
            </Text>
          ) : (
            <View style={styles.selection}>
              <Text style={styles.description}>Import into:</Text>
              {accounts.map((account) => (
                <Pressable
                  key={account.id}
                  onPress={() => onSelectAccount(account.id)}
                  disabled={isBusy}
                  accessibilityRole="radio"
                  accessibilityLabel={`Select account ${account.label}, ${account.primaryCurrency}`}
                  accessibilityState={{
                    checked: account.id === selectedAccountId,
                    disabled: isBusy,
                  }}
                  style={[styles.destination, !isBusy && styles.available]}
                >
                  <Text style={styles.destinationTitle}>{account.label}</Text>
                  <Text style={styles.description}>
                    Currency: {account.primaryCurrency}
                    {account.id === selectedAccountId ? " · Selected" : ""}
                  </Text>
                </Pressable>
              ))}
              {selectedAccount && (
                <Pressable
                  onPress={onConfirmCurrency}
                  disabled={isBusy}
                  accessibilityRole="checkbox"
                  accessibilityLabel={`Confirm statement currency ${selectedAccount.primaryCurrency} with two decimal places`}
                  accessibilityState={{
                    checked: currencyConfirmed,
                    disabled: isBusy,
                  }}
                  style={[styles.destination, !isBusy && styles.available]}
                >
                  <Text style={styles.description}>
                    I confirm this statement uses{" "}
                    {selectedAccount.primaryCurrency} with two decimal places.
                  </Text>
                  <Text style={styles.description}>
                    {currencyConfirmed ? "Confirmed" : "Tap to confirm"}
                  </Text>
                </Pressable>
              )}
            </View>
          )}
          <Pressable
            onPress={onImportStatement}
            disabled={importDisabled}
            accessibilityRole="button"
            accessibilityLabel="Import statement"
            accessibilityState={{ disabled: importDisabled, busy: isImporting }}
            style={[styles.destination, !importDisabled && styles.available]}
          >
            <Text style={styles.destinationTitle}>Import statement</Text>
          </Pressable>
          {!accountsFailed && accounts && accounts.length > 0 && (
            <Text accessibilityLiveRegion="polite" style={styles.description}>
              {importMessages[importStatus]}
            </Text>
          )}
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
  selection: {
    gap: 16,
  },
});

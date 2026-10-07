import type { Account } from "@aqchafold/domain";
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { ImportState } from "../presentation/import-state";

type HomeScreenProps = {
  onOpenAccounts: () => void;
  onOpenTransactions: () => void;
  onOpenMerchantReview: () => void;
  onPickStatement: () => void;
  isPicking: boolean;
  pickerFailed: boolean;
  accounts: readonly Account[] | null;
  accountsFailed: boolean;
  selectedAccountId: string | null;
  onSelectAccount: (id: string) => void;
  currencyConfirmed: boolean;
  onConfirmCurrency: () => void;
  onImportStatement: () => void;
  importState: ImportState;
};

export default function HomeScreen({
  onOpenAccounts,
  onOpenTransactions,
  onOpenMerchantReview,
  onPickStatement,
  isPicking,
  pickerFailed,
  accounts,
  accountsFailed,
  selectedAccountId,
  onSelectAccount,
  currencyConfirmed,
  onConfirmCurrency,
  onImportStatement,
  importState,
}: HomeScreenProps) {
  const selectedDocument = importState.document;
  const isImporting = importState.status === "importing";
  const result = importState.status === "finished" ? importState.result : null;
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
        onPress={onOpenMerchantReview}
        disabled={isImporting}
        accessibilityRole="button"
        accessibilityLabel="Merchant review"
        accessibilityState={{ disabled: isImporting }}
        style={[styles.destination, !isImporting && styles.available]}
      >
        <Text style={styles.destinationTitle}>Merchant review</Text>
        <Text style={styles.description}>View unknown merchant groups</Text>
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
          {!accountsFailed && accounts && accounts.length > 0 && !result && (
            <Text accessibilityLiveRegion="polite" style={styles.description}>
              {isImporting ? "Importing…" : "Ready to import"}
            </Text>
          )}
        </View>
      )}
      {result && (
        <View accessibilityLiveRegion="polite" style={styles.selection}>
          <Text accessibilityRole="header" style={styles.destinationTitle}>
            {result.status === "imported"
              ? "Import complete"
              : result.status === "already-imported"
                ? "Already imported"
                : result.status === "unsupported"
                  ? "Unsupported statement"
                  : result.status === "reconciliation-failed"
                    ? "Reconciliation could not be verified"
                    : "Import failed"}
          </Text>
          {result.status === "imported" ? (
            <>
              <Text style={styles.description}>
                {result.transactionCount} transactions imported
              </Text>
              <Text style={styles.description}>
                Account: {result.accountLabel}
              </Text>
              {result.filename && (
                <Text style={styles.description}>File: {result.filename}</Text>
              )}
              <Text style={styles.description}>
                Reconciliation:{" "}
                {result.reconciliation.verifiedRows ===
                  result.reconciliation.totalRows &&
                result.reconciliation.closingBalance === "verified"
                  ? "Verified"
                  : "Could not be verified"}
              </Text>
              <Text style={styles.description}>
                {result.reconciliation.verifiedRows} of{" "}
                {result.reconciliation.totalRows} transaction rows verified
              </Text>
              <Text style={styles.description}>
                {result.reconciliation.closingBalance === "verified"
                  ? "Closing balance verified"
                  : "Closing balance could not be verified"}
              </Text>
              <Pressable
                onPress={onOpenTransactions}
                accessibilityRole="button"
                accessibilityLabel="View transactions"
                style={[styles.destination, styles.available]}
              >
                <Text style={styles.destinationTitle}>View transactions</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.description}>
              {result.status === "already-imported"
                ? "This exact statement was already imported. No transactions were added."
                : result.status === "unsupported"
                  ? "Ledgerase could not recognize this PDF as the supported CommBank Transaction Summary format."
                  : result.status === "reconciliation-failed"
                    ? "No transactions were imported"
                    : "The statement could not be imported. Please try again."}
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

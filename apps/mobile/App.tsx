import {
  AccountRepository,
  assignCategoryAndRemember,
  CategoryRepository,
  CategoryRuleRepository,
  createLocalAccount,
  HouseholdRepository,
  ImportRepository,
  MerchantRepository,
  MerchantRuleRepository,
  migrateLedgeraseDatabase,
  openLedgeraseDatabase,
  TransactionRepository,
  type RememberedTransactionCategoryAssignment,
} from "@aqchafold/database";
import { randomUUID } from "expo-crypto";
import { useEffect, useReducer, useRef, useState } from "react";
import { BackHandler, StyleSheet, Text, View } from "react-native";

import { importStatement } from "./src/import/import-statement";
import { pickStatementDocument } from "./src/platform/pick-statement-document";
import { readDocumentBytes } from "./src/platform/read-document-bytes";
import { importStateReducer } from "./src/presentation/import-state";
import AccountsScreen from "./src/screens/AccountsScreen";
import HomeScreen from "./src/screens/HomeScreen";
import MerchantReviewScreen from "./src/screens/MerchantReviewScreen";
import TransactionsScreen from "./src/screens/TransactionsScreen";

type AppState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      database: ReturnType<typeof openLedgeraseDatabase>;
      accountRepository: AccountRepository;
      categoryRepository: CategoryRepository;
      categoryRuleRepository: CategoryRuleRepository;
      assignCategoryAndRemember: (
        input: RememberedTransactionCategoryAssignment,
      ) => void;
      householdRepository: HouseholdRepository;
      importRepository: ImportRepository;
      transactionRepository: TransactionRepository;
      merchantRepository: MerchantRepository;
      merchantRuleRepository: MerchantRuleRepository;
    };

type AccountReadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; accounts: ReturnType<AccountRepository["list"]> };

export default function App() {
  const [state, setState] = useState<AppState>({ status: "loading" });
  const [screen, setScreen] = useState<
    "home" | "accounts" | "transactions" | "merchant-review"
  >("home");
  const [importState, dispatchImport] = useReducer(importStateReducer, {
    status: "ready",
    document: null,
  });
  const selectedDocument = importState.document;
  const [pickerStatus, setPickerStatus] = useState<
    "idle" | "picking" | "error"
  >("idle");
  const pickerInProgress = useRef(false);
  const [accountState, setAccountState] = useState<AccountReadState>({
    status: "loading",
  });
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null,
  );
  const [currencyConfirmed, setCurrencyConfirmed] = useState(false);
  const importInProgress = useRef<AbortController | null>(null);

  async function selectStatement() {
    if (pickerInProgress.current || importInProgress.current) return;
    pickerInProgress.current = true;
    setPickerStatus("picking");
    try {
      const document = await pickStatementDocument();
      dispatchImport({ type: "document-picked", document });
      if (document) {
        setAccountState({ status: "loading" });
        setSelectedAccountId(null);
        setCurrencyConfirmed(false);
      }
      setPickerStatus("idle");
    } catch {
      setPickerStatus("error");
    } finally {
      pickerInProgress.current = false;
    }
  }

  async function importSelectedStatement() {
    if (
      importInProgress.current ||
      pickerInProgress.current ||
      state.status !== "ready" ||
      !selectedDocument ||
      accountState.status !== "ready" ||
      !currencyConfirmed
    )
      return;
    const account = accountState.accounts.find(
      (candidate) => candidate.id === selectedAccountId,
    );
    if (!account) return;
    const controller = new AbortController();
    importInProgress.current = controller;
    dispatchImport({ type: "started" });
    try {
      const result = await importStatement({
        document: selectedDocument,
        accountId: account.id,
        confirmedCurrency: account.primaryCurrency,
        currencyDecimalPlaces: 2,
        accountRepository: state.accountRepository,
        categoryRepository: state.categoryRepository,
        categoryRuleRepository: state.categoryRuleRepository,
        importRepository: state.importRepository,
        readDocumentBytes,
        createImportId: randomUUID,
        signal: controller.signal,
      });
      if (!controller.signal.aborted)
        dispatchImport({
          type: "finished",
          result,
          accountLabel: account.label,
        });
    } catch {
      if (!controller.signal.aborted)
        dispatchImport({
          type: "finished",
          result: { status: "failed" },
          accountLabel: account.label,
        });
    } finally {
      if (importInProgress.current === controller)
        importInProgress.current = null;
    }
  }

  function returnHome() {
    setAccountState({ status: "loading" });
    setCurrencyConfirmed(false);
    setScreen("home");
  }

  function selectAccount(id: string) {
    if (importInProgress.current || pickerInProgress.current) return;
    setSelectedAccountId(id);
    setCurrencyConfirmed(false);
  }

  useEffect(() => {
    let active = true;
    let retainedDatabase: ReturnType<typeof openLedgeraseDatabase> | undefined;

    async function initialize() {
      try {
        const database = openLedgeraseDatabase();
        let retained = false;
        try {
          await migrateLedgeraseDatabase(database);
          if (active) {
            const accountRepository = new AccountRepository(database);
            const categoryRepository = new CategoryRepository(database);
            const categoryRuleRepository = new CategoryRuleRepository(database);
            const householdRepository = new HouseholdRepository(database);
            const importRepository = new ImportRepository(database);
            const transactionRepository = new TransactionRepository(database);
            const merchantRepository = new MerchantRepository(database);
            const merchantRuleRepository = new MerchantRuleRepository(database);
            retained = true;
            retainedDatabase = database;
            setState({
              status: "ready",
              database,
              accountRepository,
              categoryRepository,
              categoryRuleRepository,
              assignCategoryAndRemember: (input) =>
                assignCategoryAndRemember(database, input),
              householdRepository,
              importRepository,
              transactionRepository,
              merchantRepository,
              merchantRuleRepository,
            });
          }
        } finally {
          if (!retained) database.$client.closeSync();
        }
      } catch {
        if (active) setState({ status: "error" });
      }
    }

    void initialize();
    return () => {
      active = false;
      importInProgress.current?.abort();
      retainedDatabase?.$client.closeSync();
      retainedDatabase = undefined;
    };
  }, []);

  useEffect(() => {
    if (state.status !== "ready" || screen !== "home" || !selectedDocument)
      return;
    const pendingRead = setTimeout(() => {
      try {
        setAccountState({
          status: "ready",
          accounts: state.accountRepository.list(),
        });
      } catch {
        setAccountState({ status: "error" });
      }
    }, 0);
    return () => clearTimeout(pendingRead);
  }, [state, screen, selectedDocument]);

  useEffect(() => {
    if (screen === "home") return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        setAccountState({ status: "loading" });
        setCurrencyConfirmed(false);
        setScreen("home");
        return true;
      },
    );
    return () => subscription.remove();
  }, [screen]);

  if (state.status === "ready") {
    if (screen === "accounts") {
      return (
        <AccountsScreen
          repository={state.accountRepository}
          householdRepository={state.householdRepository}
          onCreateAccount={(account, newHousehold) =>
            createLocalAccount(state.database, { account, newHousehold })
          }
          onBack={returnHome}
        />
      );
    }
    if (screen === "transactions") {
      return (
        <TransactionsScreen
          repository={state.transactionRepository}
          onBack={returnHome}
        />
      );
    }
    if (screen === "merchant-review") {
      return (
        <MerchantReviewScreen
          accountRepository={state.accountRepository}
          categoryRepository={state.categoryRepository}
          assignCategoryAndRemember={state.assignCategoryAndRemember}
          transactionRepository={state.transactionRepository}
          merchantRepository={state.merchantRepository}
          merchantRuleRepository={state.merchantRuleRepository}
          onBack={returnHome}
        />
      );
    }
    return (
      <HomeScreen
        onOpenAccounts={() => {
          if (!importInProgress.current) setScreen("accounts");
        }}
        onOpenTransactions={() => {
          if (!importInProgress.current) setScreen("transactions");
        }}
        onOpenMerchantReview={() => {
          if (!importInProgress.current) setScreen("merchant-review");
        }}
        onPickStatement={() => void selectStatement()}
        isPicking={pickerStatus === "picking"}
        pickerFailed={pickerStatus === "error"}
        accounts={
          accountState.status === "ready" ? accountState.accounts : null
        }
        accountsFailed={accountState.status === "error"}
        selectedAccountId={selectedAccountId}
        onSelectAccount={selectAccount}
        currencyConfirmed={currencyConfirmed}
        onConfirmCurrency={() => {
          if (!importInProgress.current && !pickerInProgress.current)
            setCurrencyConfirmed((confirmed) => !confirmed);
        }}
        onImportStatement={() => void importSelectedStatement()}
        importState={importState}
      />
    );
  }

  return (
    <View style={styles.container}>
      <Text>Ledgerase</Text>
      <Text>
        {state.status === "loading"
          ? "Preparing local storage…"
          : "Ledgerase could not initialize local storage. Please restart the app."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
});

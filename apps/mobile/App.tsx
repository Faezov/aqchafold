import {
  AccountRepository,
  migrateLedgeraseDatabase,
  openLedgeraseDatabase,
  TransactionRepository,
} from "@aqchafold/database";
import { useEffect, useRef, useState } from "react";
import { BackHandler, StyleSheet, Text, View } from "react-native";

import {
  pickStatementDocument,
  type SelectedDocument,
} from "./src/platform/pick-statement-document";
import AccountsScreen from "./src/screens/AccountsScreen";
import HomeScreen from "./src/screens/HomeScreen";
import TransactionsScreen from "./src/screens/TransactionsScreen";

type AppState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      database: ReturnType<typeof openLedgeraseDatabase>;
      accountRepository: AccountRepository;
      transactionRepository: TransactionRepository;
    };

export default function App() {
  const [state, setState] = useState<AppState>({ status: "loading" });
  const [screen, setScreen] = useState<"home" | "accounts" | "transactions">(
    "home",
  );
  const [selectedDocument, setSelectedDocument] =
    useState<SelectedDocument | null>(null);
  const [pickerStatus, setPickerStatus] = useState<
    "idle" | "picking" | "error"
  >("idle");
  const pickerInProgress = useRef(false);

  async function selectStatement() {
    if (pickerInProgress.current) return;
    pickerInProgress.current = true;
    setPickerStatus("picking");
    try {
      const document = await pickStatementDocument();
      if (document) setSelectedDocument(document);
      setPickerStatus("idle");
    } catch {
      setPickerStatus("error");
    } finally {
      pickerInProgress.current = false;
    }
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
            const transactionRepository = new TransactionRepository(database);
            retained = true;
            retainedDatabase = database;
            setState({
              status: "ready",
              database,
              accountRepository,
              transactionRepository,
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
      retainedDatabase?.$client.closeSync();
      retainedDatabase = undefined;
    };
  }, []);

  useEffect(() => {
    if (screen === "home") return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
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
          onBack={() => setScreen("home")}
        />
      );
    }
    if (screen === "transactions") {
      return (
        <TransactionsScreen
          repository={state.transactionRepository}
          onBack={() => setScreen("home")}
        />
      );
    }
    return (
      <HomeScreen
        onOpenAccounts={() => setScreen("accounts")}
        onOpenTransactions={() => setScreen("transactions")}
        onPickStatement={() => void selectStatement()}
        selectedDocument={selectedDocument}
        isPicking={pickerStatus === "picking"}
        pickerFailed={pickerStatus === "error"}
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

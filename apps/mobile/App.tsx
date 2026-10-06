import {
  AccountRepository,
  migrateLedgeraseDatabase,
  openLedgeraseDatabase,
} from "@aqchafold/database";
import { useEffect, useState } from "react";
import { BackHandler, StyleSheet, Text, View } from "react-native";

import AccountsScreen from "./src/screens/AccountsScreen";
import HomeScreen from "./src/screens/HomeScreen";

type AppState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      database: ReturnType<typeof openLedgeraseDatabase>;
      accountRepository: AccountRepository;
    };

export default function App() {
  const [state, setState] = useState<AppState>({ status: "loading" });
  const [screen, setScreen] = useState<"home" | "accounts">("home");

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
            retained = true;
            retainedDatabase = database;
            setState({ status: "ready", database, accountRepository });
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
    if (screen !== "accounts") return;
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
    return screen === "accounts" ? (
      <AccountsScreen
        repository={state.accountRepository}
        onBack={() => setScreen("home")}
      />
    ) : (
      <HomeScreen onOpenAccounts={() => setScreen("accounts")} />
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

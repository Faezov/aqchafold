import {
  migrateLedgeraseDatabase,
  openLedgeraseDatabase,
} from "@aqchafold/database";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import HomeScreen from "./src/screens/HomeScreen";

export default function App() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const database = openLedgeraseDatabase();
        try {
          await migrateLedgeraseDatabase(database);
        } finally {
          database.$client.closeSync();
        }
        if (active) setStatus("ready");
      } catch {
        if (active) setStatus("error");
      }
    }

    void initialize();
    return () => {
      active = false;
    };
  }, []);

  if (status === "ready") return <HomeScreen />;

  return (
    <View style={styles.container}>
      <Text>Ledgerase</Text>
      <Text>
        {status === "loading"
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

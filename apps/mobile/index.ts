import { registerRootComponent } from "expo";
import { Platform } from "react-native";

import App from "./App";

registerRootComponent(App);

if (__DEV__ && process.env.EXPO_PUBLIC_LEDGERASE_COMMBANK_SMOKE === "1") {
  void import("./development/commbank-smoke")
    .then(({ runCommBankSmokeCheck }) => runCommBankSmokeCheck())
    .then(() => {
      console.info(`[Ledgerase CommBank smoke] PASS (${Platform.OS})`);
    })
    .catch((error: unknown) => {
      const reason =
        error instanceof Error ? `${error.name}: ${error.message}` : "unknown";
      console.error(
        `[Ledgerase CommBank smoke] FAIL (${Platform.OS}): ${reason}`,
      );
    });
}

if (__DEV__ && process.env.EXPO_PUBLIC_LEDGERASE_DATABASE_SMOKE === "1") {
  void import("@aqchafold/database/development")
    .then(({ runPersistenceSmokeCheck }) => runPersistenceSmokeCheck())
    .then(() => {
      console.info(`[Ledgerase database smoke] PASS (${Platform.OS})`);
    })
    .catch(() => {
      console.error(`[Ledgerase database smoke] FAIL (${Platform.OS})`);
    });
}

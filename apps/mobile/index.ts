import { registerRootComponent } from "expo";
import { Platform } from "react-native";

import App from "./App";

registerRootComponent(App);

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

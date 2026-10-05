import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const fixture = readFileSync(
  new URL(
    "../../../fixtures/bank-statements/commbank/browser-summary-01.pdf",
    import.meta.url,
  ),
);
const title = Buffer.from("Transaction Summary");
const offset = fixture.indexOf(title);
if (offset < 0) throw new Error("Synthetic fixture title was not found.");
const unrelated = Buffer.from(fixture);
// Equal-length substitution preserves this uncompressed fixture's PDF offsets.
Buffer.from("Unrelated Document ").copy(unrelated, offset);

const require = createRequire(new URL("../package.json", import.meta.url));
const child = spawn(
  process.execPath,
  [
    require.resolve("expo/bin/cli"),
    "start",
    "--clear",
    ...process.argv.slice(2),
  ],
  {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    stdio: "inherit",
    env: {
      ...process.env,
      EXPO_PUBLIC_LEDGERASE_COMMBANK_SMOKE: "1",
      EXPO_PUBLIC_LEDGERASE_COMMBANK_SMOKE_PDF: fixture.toString("base64"),
      EXPO_PUBLIC_LEDGERASE_COMMBANK_SMOKE_UNRELATED:
        unrelated.toString("base64"),
    },
  },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});

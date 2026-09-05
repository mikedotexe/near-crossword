import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const arch = { x64: "amd64", arm64: "arm64" }[process.arch];
if (!arch || !["darwin", "linux", "win32"].includes(process.platform)) {
  throw new Error("Unsupported Foundry platform");
}
const executable = process.platform === "win32" ? "forge.exe" : "forge";
const binary = require.resolve(`@foundry-rs/forge-${process.platform}-${arch}/bin/${executable}`);
// The pinned npm launcher's child exit code is not forwarded. Invoke its binary directly.
const result = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

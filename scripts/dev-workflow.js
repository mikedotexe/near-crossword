#!/usr/bin/env node

const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

const repoRoot = path.join(__dirname, "..");
const neardevDir = path.join(repoRoot, "neardev");
const devAccountEnvFile = path.join(neardevDir, "dev-account.env");

const yarnCommand =
  process.env.npm_execpath && process.env.npm_execpath.includes("yarn")
    ? {
        command: process.execPath,
        argsPrefix: [process.env.npm_execpath],
      }
    : {
        command: process.platform === "win32" ? "yarn.cmd" : "yarn",
        argsPrefix: [],
      };

const runYarnScript = (scriptName) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      yarnCommand.command,
      [...yarnCommand.argsPrefix, "run", scriptName],
      {
        cwd: repoRoot,
        env: process.env,
        stdio: "inherit",
      }
    );

    child.on("error", (error) => {
      reject(error);
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`yarn run ${scriptName} exited with code ${code}`));
    });
  });

const main = async () => {
  fs.rmSync(neardevDir, { recursive: true, force: true });
  await runYarnScript("dev:deploy");
  if (!fs.existsSync(devAccountEnvFile)) {
    throw new Error(
      "dev:deploy finished without creating neardev/dev-account.env. Verify your global near CLI workflow and account creation command."
    );
  }
  await runYarnScript("dev:app");
};

main().catch((error) => {
  console.error("Dev workflow failed.", error);
  process.exit(1);
});

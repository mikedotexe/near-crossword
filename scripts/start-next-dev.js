#!/usr/bin/env node

const { spawn } = require("node:child_process");

if (!process.env.NEXT_PUBLIC_CONTRACT_NAME && process.env.CONTRACT_NAME) {
  process.env.NEXT_PUBLIC_CONTRACT_NAME = process.env.CONTRACT_NAME;
}

const nextBin = require.resolve("next/dist/bin/next");
const args = [nextBin, "dev", ...process.argv.slice(2)];

const child = spawn(process.execPath, args, {
  env: process.env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error("Failed to start Next dev server.", error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

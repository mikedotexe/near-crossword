#!/usr/bin/env node

const path = require("node:path");
const { spawn } = require("node:child_process");

const contractDir = path.join(__dirname, "..", "contract");

const child = spawn(
  "cargo",
  ["build", "--target", "wasm32-unknown-unknown", "--release"],
  {
    cwd: contractDir,
    env: process.env,
    stdio: "inherit",
  }
);

child.on("error", (error) => {
  console.error("Failed to build contract.", error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

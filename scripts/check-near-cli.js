#!/usr/bin/env node

const { spawnSync } = require("child_process");

const result = spawnSync("near", ["--version"], {
  encoding: "utf8",
  stdio: "pipe",
});

if (result.error || result.status !== 0) {
  console.error("NEAR CLI is required globally for this command.");
  console.error("Install it with: npm install -g near-cli");
  process.exit(1);
}

process.stdout.write(result.stdout || "NEAR CLI detected.\n");

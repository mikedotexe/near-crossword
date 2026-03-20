module.exports = {
  // API route body size limits are configured per-route via
  // `export const config` in each route file (e.g. pages/api/generate-clues.js).

  // Ensure mppx and viem ESM packages are transpiled for Pages Router
  transpilePackages: ["mppx"],
};

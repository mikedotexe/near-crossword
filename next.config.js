const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin-allow-popups",
  },
];

module.exports = {
  poweredByHeader: false,
  reactStrictMode: true,
  webpack(config, { webpack }) {
    config.plugins.push(
      new webpack.IgnorePlugin({ resourceRegExp: /^x402-fetch$/ }),
    );
    return config;
  },
  outputFileTracingIncludes: {
    "/*": ["./node_modules/crossword-layout-generator/package.json", "./node_modules/crossword-layout-generator/src/layout_generator.js"],
  },
  serverExternalPackages: [
    "crossword-layout-generator",
    "pg",
    "@fastnear/intents",
    "@x402/core",
    "@x402/extensions",
    "@x402/near",
    "@defuse-protocol/nearintents-mpp-sdk",
    "mppx",
  ],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        source: "/api/(.*)",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

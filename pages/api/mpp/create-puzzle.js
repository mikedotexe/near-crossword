/**
 * Legacy endpoint intentionally disabled.
 *
 * The former implementation charged a fixed $1 MPP service fee and then used
 * the operator's NEAR account to fund an arbitrary creator-selected reward.
 * That conflated a service payment with prize principal and exposed the
 * operator treasury to unbounded subsidy requests.
 *
 * Campaign funding now goes through /api/v2/campaigns/:id/funding-quotes,
 * where the full USDC prize and all fees are quoted and settled before a
 * campaign can be activated.
 */
export default function handler(req, res) {
  res.setHeader("Allow", "POST");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  return res.status(410).json({
    error: "Legacy subsidized puzzle creation has been retired.",
    code: "LEGACY_FUNDING_RETIRED",
    replacement: "/api/v2/campaigns",
  });
}

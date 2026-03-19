#!/bin/bash
# test-mpp-flow.sh — Demonstrates the Tempo MPP payment flow end-to-end.
#
# Prerequisites:
#   - yarn dev running on localhost:3000
#   - MPP_RECIPIENT and MPP_SECRET_KEY set in .env
#
# This script shows:
#   1. The MPP status endpoint
#   2. A 402 Payment Required challenge
#   3. The challenge structure (method, intent, amount, currency)
#   4. Rust SDK verification of the challenge (if mpp-verify is built)
#
# For a full end-to-end test with actual payment, use the browser UI
# which handles the 402 → sign → retry flow automatically via mppx client.

set -e

BASE_URL="${1:-http://localhost:3000}"
VERIFY_BIN="tools/mpp-verify/target/release/mpp-verify"

echo "======================================"
echo "  Tempo MPP Payment Flow Demo"
echo "  TypeScript (mppx) + Rust (mpp-rs)"
echo "======================================"
echo ""

echo "1. Check MPP Status"
echo "   GET $BASE_URL/api/mpp/status"
echo "   ---"
STATUS=$(curl -s "$BASE_URL/api/mpp/status")
echo "   $STATUS" | python3 -m json.tool 2>/dev/null || echo "   $STATUS"
echo ""

ENABLED=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('enabled',False))" 2>/dev/null)
if [ "$ENABLED" != "True" ]; then
  echo "   Warning: MPP is not enabled. Set MPP_RECIPIENT in .env"
  echo ""
fi

echo "2. Request puzzle creation (no payment -> 402 challenge)"
echo "   POST $BASE_URL/api/mpp/create-puzzle"
echo "   ---"

RESPONSE=$(curl -s -D /tmp/mpp-headers.txt -X POST "$BASE_URL/api/mpp/create-puzzle" \
  -H "Content-Type: application/json" \
  -d '{
    "clueAnswers": [
      {"clue": "Tempo payment protocol", "answer": "MPP"},
      {"clue": "HTTP status for payment required", "answer": "402"},
      {"clue": "Blockchain for smart contracts", "answer": "NEAR"}
    ],
    "rewardNear": "5"
  }')

HTTP_CODE=$(grep "HTTP/" /tmp/mpp-headers.txt | tail -1 | awk '{print $2}')
echo "   HTTP Status: $HTTP_CODE"

if [ "$HTTP_CODE" = "402" ]; then
  echo "   Got 402 Payment Required (correct!)"
  echo ""

  echo "3. Parse the WWW-Authenticate challenge"
  echo "   ---"
  WWW_AUTH=$(grep -i "www-authenticate" /tmp/mpp-headers.txt)
  echo "   $WWW_AUTH"
  echo ""

  # Extract and decode the request parameter
  REQUEST_B64=$(echo "$WWW_AUTH" | sed -n 's/.*request="\([^"]*\)".*/\1/p')
  if [ -n "$REQUEST_B64" ]; then
    echo "4. Decoded challenge request (base64url -> JSON)"
    echo "   ---"
    # Add padding and decode
    PADDED=$(echo "$REQUEST_B64" | tr '_-' '/+')
    PAD=$((4 - ${#PADDED} % 4))
    [ $PAD -lt 4 ] && PADDED="${PADDED}$(printf '=%.0s' $(seq 1 $PAD))"
    echo "$PADDED" | base64 -d 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "   (decode failed)"
    echo ""
  fi

  echo "5. Response body (application/problem+json)"
  echo "   ---"
  echo "   $RESPONSE" | python3 -m json.tool 2>/dev/null || echo "   $RESPONSE"
  echo ""

  # Step 6: Use the Rust mpp-rs SDK to verify the challenge
  CHALLENGE_PARAMS=$(echo "$WWW_AUTH" | sed 's/^.*Payment //')
  if [ -x "$VERIFY_BIN" ]; then
    echo "6. Rust SDK (mpp-rs) challenge verification"
    echo "   ---"
    $VERIFY_BIN challenge "$CHALLENGE_PARAMS"
    echo ""
  else
    echo "6. Rust SDK verification (skipped — build with:"
    echo "   cargo build --release --manifest-path tools/mpp-verify/Cargo.toml)"
    echo ""
  fi

else
  echo "   Response: $RESPONSE"
fi

echo "======================================"
echo "  Flow Summary"
echo "  ---"
echo "  Server:  mppx (TypeScript) issues 402 challenges"
echo "  Client:  mppx auto-handles 402 -> sign -> retry"
echo "  Verify:  mpp-rs (Rust) validates HMAC-bound IDs"
echo ""
echo "  Browser demo: $BASE_URL/create"
echo "  (Click 'Pay with Tempo' to test full payment)"
echo "======================================"

rm -f /tmp/mpp-headers.txt

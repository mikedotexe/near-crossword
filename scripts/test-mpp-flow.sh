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
#
# For a full end-to-end test with actual payment, use the browser UI
# which handles the 402 → sign → retry flow automatically via mppx client.

set -e

BASE_URL="${1:-http://localhost:3000}"

echo "======================================"
echo "  Tempo MPP Payment Flow Demo"
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
  echo "   ⚠ MPP is not enabled. Set MPP_RECIPIENT in .env"
  echo ""
fi

echo "2. Request puzzle creation (no payment → 402 challenge)"
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
  echo "   ✓ Got 402 Payment Required (correct!)"
  echo ""

  echo "3. Parse the WWW-Authenticate challenge"
  echo "   ---"
  WWW_AUTH=$(grep -i "www-authenticate" /tmp/mpp-headers.txt)
  echo "   $WWW_AUTH"
  echo ""

  # Extract and decode the request parameter
  REQUEST_B64=$(echo "$WWW_AUTH" | sed -n 's/.*request="\([^"]*\)".*/\1/p')
  if [ -n "$REQUEST_B64" ]; then
    echo "4. Decoded challenge request (base64url → JSON)"
    echo "   ---"
    # Add padding and decode
    PADDED=$(echo "$REQUEST_B64" | tr '_-' '/+')
    PAD=$((4 - ${#PADDED} % 4))
    [ $PAD -lt 4 ] && PADDED="${PADDED}$(printf '=%.0s' $(seq 1 $PAD))"
    echo "$PADDED" | base64 -d 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "   (decode failed)"
    echo ""
  fi

  echo "5. Response body"
  echo "   ---"
  echo "   $RESPONSE" | python3 -m json.tool 2>/dev/null || echo "   $RESPONSE"
else
  echo "   Response: $RESPONSE"
fi

echo ""
echo "======================================"
echo "  Flow complete!"
echo ""
echo "  To test full payment flow with actual"
echo "  Tempo tokens, use the browser UI at:"
echo "  $BASE_URL/create"
echo ""
echo "  The mppx client auto-handles the 402"
echo "  challenge → sign → retry cycle."
echo "======================================"

rm -f /tmp/mpp-headers.txt

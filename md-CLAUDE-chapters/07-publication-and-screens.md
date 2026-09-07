# Publication and screens

Local implementation checkpoint, 2026-09-04. Nothing here implies a deployment,
enabled reward signer, or approved spending. Start with chapters 03, 04 and 06.

## The publication boundary

`src/server/base/layout.ts` uses pinned `crossword-layout-generator@0.1.1` for
placement. That library logs answers; it runs in an isolated Node VM context
with its own no-op console and a one-second execution limit. Never replace the
process-wide console. The VM is an isolation/CPU control for a trusted dependency,
not a claimed security sandbox for arbitrary code. Next externalizes/traces the
package for production server reads.

We independently require all 3-12 answers to be placed, a connected grid no
larger than 24 by 24, matching crossings, no parallel overlap or incidental
adjacent words, complete clue coverage and row-major numbering. Unplaceable
drafts fail for editorial revision; no disconnected fallback is published.
Original draft index, not clue number, determines participant answer order.

Migration 012 adds immutable revision-scoped layout approvals and one publication
commitment per funded campaign. The layout contains only coordinates, lengths,
directions and clue indexes. Saved layouts are revalidated, not regenerated.
The `learning-publication:v1` commitment binds campaign, revision, existing terms
hash and layout hash. **It is off-chain and separate from the existing v1 funded
terms.** We do not silently change old terms or claim that the grid hash was
previously committed by the contract.

Owner-only `/api/base/reviews/:id/publication` supports preview and explicit
`approve-layout`, `bind`, `publish`, `withdraw` actions. Requests require the
reviewed revision and both public hashes, real session, ownership and same-origin
JSON. Layout reads are rate limited. Binding verifies already-existing untouched
finalized funding and the expected approved layout; it does not fund a contract.
Publication requires matching, fresh reconciled funding, available slots and an
open/upcoming completion window. Races recheck under the review-parent lock.

`/api/base/lessons` lists up to 50 published lessons. Catalog amounts are reviewed
terms, not availability promises. Detail verifies commitments and finalized chain
state, explicitly selects public fields, and reports unallocated slots separately
from confirmed payouts. Private source text, evidence quotes, review hashes,
answers, emails and signatures never form part of the public response.

Withdrawal hides catalog/detail and blocks new completions/allocations in the
production participant composition. Existing allocations can still recover via
the private APIs. Re-publication uses the same immutable record. Withdrawal is
not a contract pause, refund, or cancellation of previously issued signatures.

## Screens

- `/learn`: public catalog. `/learn/:id`: lesson, crossword, completion and reward.
- `/learn/studio`: owner campaigns. `/learn/studio/new` and `/learn/studio/:id`:
  bounded manual source/lesson/entry editor, reward terms, approval, grid review,
  existing-funding link, publication and withdrawal. Funded material is read-only.
- `/learn/preview` and `/learn/studio/preview`: synthetic practice/editor surfaces
  only when `BASE_UI_PREVIEW_ENABLED=true` and `NODE_ENV != production`. No reward
  or database impersonation. Browser API fixtures belong only to Playwright tests.

Guesses persist in local storage under campaign/revision/layout hash. No wallet
proof, reward signature, private source or email is stored there. Login accepts
only a validated local `/learn/...` callback. Solving may precede sign-in;
completion still requires a real session and rewards require verified email.
Contact consent stays separate, opt-in and withdrawable.

Player states distinguish saved completion, allocated/authorized reward, wallet
submission and finalized paid receipt. A withdrawn/unavailable public detail still
offers private recovery. Its authenticated response includes the committed reward
terms needed for wallet verification/redemption, independent of public visibility.

## Still open

The studio links existing funding; it does not yet create/fund, pause, rotate or
refund through a sponsor wallet. There is no sponsor participant/export dashboard.
AI generation is not yet connected to this editor through the new paid workflow.
Production flags default off. See chapter 08 for wallet/provider boundaries and
the work order for launch gates. Automated UI fixtures are not staging evidence.

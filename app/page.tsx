import Link from "next/link";
import { PixelMark } from "./components/PixelMark";
import { PuzzleDiagram } from "./components/PuzzleDiagram";
import { SectionHeading } from "./components/SectionHeading";
import { demoCampaigns } from "./lib/demo-data";

const escrowAddress = "0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304";
const acceptanceTransaction =
  "0x35860a8044d025b6086acbacc02a3f173520b88410fc9338c6267117dc6f1255";

export default function HomePage() {
  return (
    <>
      <section className="hero hero--learning">
        <div className="shell hero__grid">
          <div className="hero__copy">
            <p className="eyebrow eyebrow--blue">
              Sponsor-funded learning / Base
            </p>
            <h1>Crossword</h1>
            <p className="hero__statement">
              Turn learning into a reward people can verify.
            </p>
            <p className="hero__lede">
              Sponsors publish a short, source-grounded lesson and fund a pool
              of small USDC rewards. Learners read, solve, and receive their
              full advertised reward through an account that feels like email.
              On Base, they never need ETH for gas.
            </p>
            <div className="hero__actions">
              <Link className="button button--blue" href="/learn/practice">
                Try a lesson
              </Link>
              <Link className="button button--quiet" href="/learn/sponsor-demo">
                See the sponsor workflow
              </Link>
            </div>
            <dl className="hero__proof">
              <div>
                <dt>USDC</dt>
                <dd>rewards on Base</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>instead of a seed phrase</dd>
              </div>
              <div>
                <dt>Onchain</dt>
                <dd>campaign accounting</dd>
              </div>
            </dl>
          </div>

          <div className="hero-ticket-wrap hero-ticket-wrap--learning">
            <span className="hero-ticket-wrap__scribble">A two-minute lesson</span>
            <article className="hero-ticket">
              <div className="hero-ticket__top">
                <span className="sponsor-mark sponsor-mark--large">CW</span>
                <span className="demo-label">Base Sepolia pilot</span>
              </div>
              <PuzzleDiagram
                puzzle={demoCampaigns[0].puzzle}
                compact
                maxCellSizeRem={1.25}
              />
              <div className="hero-ticket__body">
                <p className="eyebrow">Practice lesson</p>
                <h2>Understanding digital payments</h2>
                <div className="hero-ticket__prize">
                  <span>Finalized acceptance reward</span>
                  <strong>1 USDC</strong>
                </div>
                <Link
                  className="button button--ink button--wide"
                  href="/learn/practice"
                >
                  Open the lesson
                </Link>
              </div>
              <div className="ticket-notch ticket-notch--left" />
              <div className="ticket-notch ticket-notch--right" />
            </article>
          </div>
        </div>
      </section>

      <section className="rail-strip" aria-label="How a reward moves">
        <div className="shell rail-strip__inner">
          <span>Sponsor funds</span>
          <strong>USDC on Base</strong>
          <i aria-hidden="true">→</i>
          <span>Learner completes</span>
          <strong>Lesson + crossword</strong>
          <i aria-hidden="true">→</i>
          <span>Escrow pays</span>
          <strong>With sponsored gas</strong>
        </div>
      </section>

      <section className="section section--paper" id="sponsors">
        <div className="shell">
          <SectionHeading
            eyebrow="For sponsors"
            title="One campaign budget. Many small, accountable rewards."
            action={
              <Link className="text-link" href="/learn/sponsor-demo">
                Open the sponsor demo <span aria-hidden="true">→</span>
              </Link>
            }
          >
            <p>
              Fund a campaign once, set exact reward terms, and let Crossword
              handle distribution. The Base ledger shows where the campaign
              funds went; optional contact consent stays private and separate.
            </p>
          </SectionHeading>

          <div className="sponsor-value-grid">
            <article>
              <span>01</span>
              <h3>Teach one useful thing</h3>
              <p>
                Build a brief lesson from supplied sources, then review every
                fact, clue, answer, and reward term before publication.
              </p>
            </article>
            <article>
              <span>02</span>
              <h3>Keep every reward whole</h3>
              <p>
                On Base, learners receive the full advertised USDC amount.
                Sponsored gas and Crossword fees stay outside the prefunded
                reward pool.
              </p>
            </article>
            <article>
              <span>03</span>
              <h3>Reconcile the promise</h3>
              <p>
                Funded terms, payouts, unused funds, and the final campaign
                balance can be checked against escrow instead of a private report.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="section section--ink">
        <div className="shell">
          <SectionHeading eyebrow="The workflow" title="A campaign in four steps.">
            <p>
              The sponsor keeps editorial and budget control. The learner gets a
              short experience with no wallet ceremony.
            </p>
          </SectionHeading>
          <ol className="how-it-works">
            <li>
              <span>01</span>
              <h3>Add sources</h3>
              <p>Start from material the sponsor is prepared to stand behind.</p>
            </li>
            <li>
              <span>02</span>
              <h3>Review the lesson</h3>
              <p>Approve the copy, crossword layout, and immutable reward terms.</p>
            </li>
            <li>
              <span>03</span>
              <h3>Fund Base escrow</h3>
              <p>Reserve the complete USDC reward pool before learners arrive.</p>
            </li>
            <li>
              <span>04</span>
              <h3>Share and settle</h3>
              <p>Qualified completions receive sponsored, auditable payouts.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="section section--proof" id="proof">
        <div className="shell">
          <SectionHeading
            eyebrow="Working proof"
            title="The hard payment path is already real."
          >
            <p>
              The public experience is an early pilot. Its Base Sepolia escrow
              and sponsored payout have completed independently verifiable tests.
            </p>
          </SectionHeading>
          <div className="proof-ledger">
            <article>
              <div>
                <span className="proof-ledger__state">Deployed</span>
                <h3>USDC campaign escrow</h3>
              </div>
              <p>
                Campaign funds are reserved against fixed per-person rewards and
                claim limits.
              </p>
              <a
                className="text-link"
                href={`https://base-sepolia.blockscout.com/address/${escrowAddress}`}
                target="_blank"
                rel="noreferrer"
              >
                View contract <span aria-hidden="true">↗</span>
              </a>
            </article>
            <article>
              <div>
                <span className="proof-ledger__state">Finalized</span>
                <h3>Sponsored smart-account payout</h3>
              </div>
              <p>
                A fresh, zero-ETH smart account received 1 test USDC through the
                claim-only paymaster path.
              </p>
              <a
                className="text-link"
                href={`https://base-sepolia.blockscout.com/tx/${acceptanceTransaction}`}
                target="_blank"
                rel="noreferrer"
              >
                View transaction <span aria-hidden="true">↗</span>
              </a>
            </article>
            <article>
              <div>
                <span className="proof-ledger__state">Accepted locally</span>
                <h3>Email-first reward account</h3>
              </div>
              <p>
                Coinbase Developer Platform creates the participant smart account
                behind email verification, with no seed phrase or ETH required.
              </p>
              <Link className="text-link" href="/learn/practice">
                Try the product <span aria-hidden="true">→</span>
              </Link>
            </article>
          </div>
        </div>
      </section>

      <section className="section section--workflows">
        <div className="shell">
          <SectionHeading
            eyebrow="Made for the open internet"
            title="Base is the product rail. Other networks would be integrations."
          />
          <div className="workflow-grid">
            <article>
              <span className="workflow-grid__number">A</span>
              <div>
                <p className="eyebrow">Base-first economics</p>
                <h3>The best experience belongs on Base.</h3>
                <p>
                  Base campaigns have no network integration fee. Learners
                  receive the full USDC reward, while a narrowly scoped CDP
                  paymaster sponsors only valid claims.
                </p>
                <div className="mini-route">
                  <span>Email</span>
                  <i>→</i>
                  <span>Smart account</span>
                  <i>→</i>
                  <span>Base USDC</span>
                </div>
              </div>
            </article>
            <article>
              <span className="workflow-grid__number">B</span>
              <div>
                <p className="eyebrow">Metered intelligence</p>
                <h3>Pay for creation, not from the reward pool.</h3>
                <p>
                  NEAR AI can draft source-grounded material, while x402 meters
                  the generation request. Sponsor funds remain separate and fully
                  reserved for learners.
                </p>
                <div className="mini-route">
                  <span>Sources</span>
                  <i>→</i>
                  <span>x402 request</span>
                  <i>→</i>
                  <span>Reviewed lesson</span>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="final-cta">
        <div className="shell final-cta__inner">
          <PixelMark inverse />
          <div>
            <p className="eyebrow">The next generation of learn and earn</p>
            <h2>Make every reward easy to receive and easy to account for.</h2>
          </div>
          <Link className="button button--paper" href="/learn/sponsor-demo">
            Explore the pilot
          </Link>
        </div>
      </section>
    </>
  );
}

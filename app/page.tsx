import Link from "next/link";
import { CampaignCard } from "./components/CampaignCard";
import { PixelMark } from "./components/PixelMark";
import { PuzzleDiagram } from "./components/PuzzleDiagram";
import { SectionHeading } from "./components/SectionHeading";
import { StatusBadge } from "./components/StatusBadge";
import { listCampaigns } from "./lib/api";

export default async function HomePage() {
  const campaigns = await listCampaigns();
  const featured = campaigns.slice(0, 2);
  const heroCampaign = campaigns[0];

  return (
    <>
      <section className="hero">
        <div className="shell hero__grid">
          <div className="hero__copy">
            <p className="eyebrow eyebrow--blue">Crosswords with real stakes</p>
            <h1>
              A good clue
              <br />
              deserves a <em>great prize.</em>
            </h1>
            <p className="hero__lede">
              Create a crossword for your community, fund it with a supported
              asset, and let the first solver take the prize wherever they want
              it.
            </p>
            <div className="hero__actions">
              <Link className="button button--blue" href="/create">
                Create a campaign
              </Link>
              <Link className="button button--quiet" href="/explore">
                Find a puzzle <span aria-hidden="true">→</span>
              </Link>
            </div>
            <dl className="hero__proof">
              <div>
                <dt>Free</dt>
                <dd>to solve</dd>
              </div>
              <div>
                <dt>Locked</dt>
                <dd>before launch</dd>
              </div>
              <div>
                <dt>Flexible</dt>
                <dd>winner payout</dd>
              </div>
            </dl>
          </div>

          {heroCampaign ? (
            <div className="hero-ticket-wrap">
              <span className="hero-ticket-wrap__scribble">Today&apos;s prize</span>
              <article className="hero-ticket">
                <div className="hero-ticket__top">
                  <span className="sponsor-mark sponsor-mark--large">
                    {heroCampaign.sponsorMark}
                  </span>
                  <StatusBadge state={heroCampaign.state} compact />
                </div>
                <PuzzleDiagram puzzle={heroCampaign.puzzle} compact />
                <div className="hero-ticket__body">
                  <p className="eyebrow">
                    Presented by {heroCampaign.sponsorName}
                  </p>
                  <h2>{heroCampaign.title}</h2>
                  <div className="hero-ticket__prize">
                    <span>First correct solve</span>
                    <strong>
                      {heroCampaign.reward.type === "token"
                        ? `${heroCampaign.reward.amount} ${heroCampaign.reward.symbol}`
                        : heroCampaign.reward.title}
                    </strong>
                  </div>
                  <Link
                    className="button button--ink button--wide"
                    href={`/campaigns/${heroCampaign.slug}/play`}
                  >
                    Open the puzzle
                  </Link>
                </div>
                <div className="ticket-notch ticket-notch--left" />
                <div className="ticket-notch ticket-notch--right" />
              </article>
              {heroCampaign.isDemo ? (
                <span className="demo-stamp">Illustrative campaign</span>
              ) : null}
            </div>
          ) : (
            <PixelMark />
          )}
        </div>
      </section>

      <section className="rail-strip" aria-label="How prize routing works">
        <div className="shell rail-strip__inner">
          <span>Fund with</span>
          <strong>ETH · USDC · SOL · more</strong>
          <i aria-hidden="true">→</i>
          <span>Prize locked as</span>
          <strong>USDC on NEAR</strong>
          <i aria-hidden="true">→</i>
          <span>Winner chooses</span>
          <strong>Asset + destination</strong>
        </div>
      </section>

      <section className="section section--paper">
        <div className="shell">
          <SectionHeading
            eyebrow="Open now"
            title="Puzzles with something on the line."
            action={
              <Link className="text-link" href="/explore">
                Explore all campaigns <span aria-hidden="true">→</span>
              </Link>
            }
          >
            <p>
              Free to enter. Transparent prize. One satisfying final square.
            </p>
          </SectionHeading>

          {featured.every((campaign) => campaign.isDemo) ? (
            <p className="catalog-demo-note">
              Preview catalog — campaign data below is illustrative until the v2
              contract is deployed and funded.
            </p>
          ) : null}

          <div className="campaign-grid">
            {featured.map((campaign) => (
              <CampaignCard campaign={campaign} key={campaign.id} />
            ))}
          </div>
        </div>
      </section>

      <section className="section section--ink">
        <div className="shell">
          <SectionHeading eyebrow="For creators" title="One idea. Four honest steps.">
            <p>
              The experience keeps puzzle making playful and prize movement
              explicit.
            </p>
          </SectionHeading>
          <ol className="how-it-works">
            <li>
              <span>01</span>
              <h3>Write the puzzle</h3>
              <p>
                Build clues yourself or buy a single AI-assisted draft through
                x402.
              </p>
            </li>
            <li>
              <span>02</span>
              <h3>Set the promise</h3>
              <p>
                Choose the sponsor story, campaign window, and exact USDC prize.
              </p>
            </li>
            <li>
              <span>03</span>
              <h3>Fund from anywhere</h3>
              <p>
                A live Intents quote routes a supported asset into escrow.
              </p>
            </li>
            <li>
              <span>04</span>
              <h3>Share the link</h3>
              <p>
                Solvers play for free. The first valid proof unlocks the payout.
              </p>
            </li>
          </ol>
        </div>
      </section>

      <section className="section section--workflows">
        <div className="shell">
          <SectionHeading
            eyebrow="Two new workflows"
            title="A puzzle is the fun part. The rails disappear."
          />
          <div className="workflow-grid">
            <article>
              <span className="workflow-grid__number">A</span>
              <div>
                <p className="eyebrow">Cross-chain jackpot</p>
                <h3>Fund on one chain. Reward on another.</h3>
                <p>
                  A sponsor can send a supported asset into locked NEAR USDC.
                  The winner can route the result to a supported destination
                  without needing a NEAR wallet to solve.
                </p>
                <div className="mini-route">
                  <span>Base ETH</span>
                  <i>→</i>
                  <span>Locked USDC</span>
                  <i>→</i>
                  <span>Solana USDC</span>
                </div>
              </div>
            </article>
            <article>
              <span className="workflow-grid__number">B</span>
              <div>
                <p className="eyebrow">x402 campaign</p>
                <h3>Pay the tool, not the player pool.</h3>
                <p>
                  AI generation is a discrete x402 service with its own receipt.
                  The creator funds the complete prize separately, keeping the
                  economics visible and solvent.
                </p>
                <div className="mini-route">
                  <span>Prompt</span>
                  <i>→</i>
                  <span>x402 receipt</span>
                  <i>→</i>
                  <span>Editable puzzle</span>
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
            <p className="eyebrow">Your community knows the answers</p>
            <h2>Give them a reason to fill the grid.</h2>
          </div>
          <Link className="button button--paper" href="/create">
            Start a campaign
          </Link>
        </div>
      </section>
    </>
  );
}

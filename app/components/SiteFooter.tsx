import Link from "next/link";
import { PixelMark } from "./PixelMark";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell site-footer__grid">
        <div>
          <Link className="wordmark wordmark--footer" href="/">
            <PixelMark compact inverse />
            <span>
              Crossword
              <small>Campaigns</small>
            </span>
          </Link>
          <p className="site-footer__line">
            Fund with anything. Win anywhere.
          </p>
        </div>

        <div className="site-footer__links">
          <div>
            <p className="eyebrow">Play</p>
            <Link href="/explore">Explore campaigns</Link>
            <Link href="/legacy">Legacy crossword</Link>
          </div>
          <div>
            <p className="eyebrow">Create</p>
            <Link href="/create">Launch a puzzle</Link>
            <Link href="/dashboard">Creator dashboard</Link>
          </div>
        </div>
      </div>
      <div className="shell site-footer__legal">
        <span>Built on NEAR. Prizes route through NEAR Intents.</span>
        <span>Free to solve. Terms vary by campaign.</span>
      </div>
    </footer>
  );
}

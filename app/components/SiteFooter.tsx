"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PixelMark } from "./PixelMark";

export function SiteFooter() {
  const pathname = usePathname();
  if (pathname?.startsWith("/learn")) return (
    <footer className="learn-footer"><div className="shell">
      <span>Crossword on Base</span>
      <nav aria-label="Footer"><Link href="/learn/practice">Practice</Link><Link href="/learn/sponsor-demo">Sponsor demo</Link><Link href="/">Home</Link></nav>
      <small>Practice carries no reward. Campaign terms vary.</small>
    </div></footer>
  );
  return (
    <footer className="site-footer">
      <div className="shell site-footer__grid">
        <div>
          <Link className="wordmark wordmark--footer" href="/">
            <PixelMark compact inverse />
            <span>
              Crossword
              <small>Base rewards</small>
            </span>
          </Link>
          <p className="site-footer__line">
            Sponsor-funded learning rewards on Base.
          </p>
        </div>

        <div className="site-footer__links">
          <div>
            <p className="eyebrow">Learn</p>
            <Link href="/learn/practice">Try a lesson</Link>
            <Link href="/#proof">See onchain proof</Link>
          </div>
          <div>
            <p className="eyebrow">Sponsor</p>
            <Link href="/learn/sponsor-demo">Open the workflow</Link>
            <Link href="/legacy">Legacy campaigns</Link>
          </div>
        </div>
      </div>
      <div className="shell site-footer__legal">
        <span>Base is the default reward and accounting network.</span>
        <span>Practice is free. Reward terms vary by campaign.</span>
      </div>
    </footer>
  );
}

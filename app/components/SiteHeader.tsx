"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { PixelMark } from "./PixelMark";

const navigation = [
  { href: "/learn/practice", label: "Try a lesson" },
  { href: "/#sponsors", label: "For sponsors" },
  { href: "/#proof", label: "Proof" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const learning = pathname?.startsWith("/learn");
  const links = learning
    ? [
        { href: "/learn/practice", label: "Practice" },
        { href: "/learn/sponsor-demo", label: "Sponsor demo" },
        { href: "/#proof", label: "Onchain proof" },
      ]
    : navigation;

  return (
    <header className="site-header">
      <div className="shell site-header__inner">
        <Link
          className="wordmark"
          href="/"
          aria-label="Crossword home"
          onClick={() => setMenuOpen(false)}
        >
          <PixelMark compact />
          <span>
            Crossword
            <small>{learning ? "Learn" : "Base rewards"}</small>
          </span>
        </Link>

        <button
          className="menu-button"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="site-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span />
          <span />
          <span />
          <span className="sr-only">Toggle navigation</span>
        </button>

        <nav
          id="site-navigation"
          aria-label="Main navigation"
          className={`site-navigation${menuOpen ? " is-open" : ""}`}
        >
          {links.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/learn" && pathname?.startsWith(`${item.href}/`) === true);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </Link>
            );
          })}
          <Link
            className="button button--ink button--small"
            href="/learn/sponsor-demo"
            onClick={() => setMenuOpen(false)}
          >
            Sponsor a campaign
          </Link>
        </nav>
      </div>
    </header>
  );
}

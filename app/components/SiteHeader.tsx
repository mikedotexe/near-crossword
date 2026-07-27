"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { PixelMark } from "./PixelMark";

const navigation = [
  { href: "/explore", label: "Explore" },
  { href: "/create", label: "Create" },
  { href: "/dashboard", label: "Dashboard" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="site-header">
      <div className="shell site-header__inner">
        <Link
          className="wordmark"
          href="/"
          aria-label="Crossword Campaigns home"
          onClick={() => setMenuOpen(false)}
        >
          <PixelMark compact />
          <span>
            Crossword
            <small>Campaigns</small>
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
          {navigation.map((item) => {
            const active =
              pathname === item.href ||
              pathname?.startsWith(`${item.href}/`) === true;
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
            href="/create"
            onClick={() => setMenuOpen(false)}
          >
            Start a campaign
          </Link>
        </nav>
      </div>
    </header>
  );
}

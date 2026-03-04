import React from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/router";

import logo from "../../img/logo_v2.png";
import ThemeToggle from "../ThemeToggle";

const links = [
  { href: "/", label: "Home", exact: true },
  { href: "/play", label: "Play" },
  { href: "/create", label: "Create" },
  { href: "/ai-studio", label: "AI Studio" },
];

const TopNav = ({ hasActivePuzzle }) => {
  const router = useRouter();

  const isActive = (href, exact) => {
    if (exact) {
      return router.pathname === href;
    }
    return router.pathname === href || router.pathname.startsWith(`${href}/`);
  };

  return (
    <header className="top-nav-wrap">
      <nav className="top-nav app-container" aria-label="Primary">
        <Link href="/" className="brand" aria-label="NEAR Crossword home">
          <Image src={logo} alt="NEAR Crossword" priority />
        </Link>

        <div className="top-nav-links">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`top-nav-link ${
                isActive(link.href, link.exact) ? "is-active" : ""
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="top-nav-status">
          <span className={`status-pill ${hasActivePuzzle ? "live" : "idle"}`}>
            {hasActivePuzzle ? "Puzzle Live" : "No Active Puzzle"}
          </span>
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
};

export default TopNav;

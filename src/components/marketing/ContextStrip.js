import React from "react";
import Link from "next/link";

const ContextStrip = ({ message, ctaHref, ctaLabel }) => {
  if (!message) {
    return null;
  }

  return (
    <section className="context-strip app-container">
      <p>{message}</p>
      {ctaHref && ctaLabel ? (
        <Link className="button button-secondary" href={ctaHref}>
          {ctaLabel}
        </Link>
      ) : null}
    </section>
  );
};

export default ContextStrip;

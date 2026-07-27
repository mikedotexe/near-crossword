import Link from "next/link";
import { PixelMark } from "./components/PixelMark";

export default function NotFound() {
  return (
    <section className="state-page">
      <div className="shell state-card">
        <PixelMark />
        <p className="eyebrow">No puzzle here</p>
        <h1>This campaign could not be found.</h1>
        <p>
          The link may be incomplete, private to another creator, or no longer
          available.
        </p>
        <Link className="button button--ink" href="/explore">
          Explore campaigns
        </Link>
      </div>
    </section>
  );
}

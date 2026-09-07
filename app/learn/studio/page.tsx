import { notFound } from "next/navigation";
import { SponsorList } from "./SponsorList";
export const dynamic = "force-dynamic";
export default function StudioPage() {
  if (process.env.BASE_REVIEW_ENABLED !== "true") notFound();
  return <SponsorList />;
}

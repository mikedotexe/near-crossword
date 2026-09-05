import { notFound } from "next/navigation";
import { SponsorEditor } from "../SponsorEditor";
export const dynamic = "force-dynamic";
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (process.env.BASE_REVIEW_ENABLED !== "true") notFound();
  const { id } = await params;
  if (id !== "new" && !/^[a-f0-9-]{36}$/i.test(id)) notFound();
  return <SponsorEditor id={id} />;
}

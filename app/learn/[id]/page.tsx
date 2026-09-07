import { notFound } from "next/navigation";
import { walletConfiguration } from "../../../src/server/base/wallet-configuration";
import { LessonPlayer } from "../LessonPlayer";
export const dynamic = "force-dynamic";
export default async function LessonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (process.env.BASE_PUBLICATION_ENABLED !== "true") notFound();
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) notFound();
  return <LessonPlayer id={id} wallet={walletConfiguration()} />;
}

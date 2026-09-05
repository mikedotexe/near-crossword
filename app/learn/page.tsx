import { notFound } from "next/navigation";
import { LessonCatalog } from "./LessonCatalog";
export const dynamic = "force-dynamic";
export default function LearnPage() {
  if (process.env.BASE_PUBLICATION_ENABLED !== "true") notFound();
  return <LessonCatalog />;
}

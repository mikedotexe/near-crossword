import type { Metadata } from "next";
import { CreateCampaignForm } from "../../components/CreateCampaignForm";

export const metadata: Metadata = {
  title: "Create a campaign",
  description:
    "Build a crossword, fund a transparent prize, and share it with your community.",
};

export default function CreatePage() {
  return (
    <section className="creator-page">
      <div className="shell">
        <CreateCampaignForm />
      </div>
    </section>
  );
}

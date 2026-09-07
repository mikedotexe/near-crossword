// Synthetic, public test material. This fixture contains no sponsor or participant data.
export const learningSourceFixture = {
  topic: "Payment basics",
  tone: "plain factual",
  count: 3,
  sources: [{
    id: "payment-basics",
    title: "Payment basics test material",
    text: "A wallet is software that helps a person manage digital assets and authorize transactions. " +
      "A ledger records transactions so that transfers can be inspected later. " +
      "A transfer moves an asset from a sender to a recipient. " +
      "A recipient is the address designated to receive the asset in a transfer. " +
      "A receipt records a completed transaction; it does not prove that a person learned a lesson.",
  }],
};

export const learningDraftFixture = {
  title: "Understanding digital payments",
  paragraphs: [
    {
      text: "A wallet helps people manage digital assets and authorize transactions.",
      evidence: [{ sourceId: "payment-basics", quote: "A wallet is software that helps a person manage digital assets and authorize transactions." }],
    },
    {
      text: "Transfers move assets between addresses, while a ledger records transactions for later inspection.",
      evidence: [{ sourceId: "payment-basics", quote: "A ledger records transactions so that transfers can be inspected later. A transfer moves an asset from a sender to a recipient." }],
    },
  ],
  entries: [
    {
      clue: "Software used to manage digital assets",
      answer: "WALLET",
      evidence: [{ sourceId: "payment-basics", quote: "A wallet is software that helps a person manage digital assets and authorize transactions." }],
    },
    {
      clue: "A record of transactions for later inspection",
      answer: "LEDGER",
      evidence: [{ sourceId: "payment-basics", quote: "A ledger records transactions so that transfers can be inspected later." }],
    },
    {
      clue: "Movement of an asset from sender to recipient",
      answer: "TRANSFER",
      evidence: [{ sourceId: "payment-basics", quote: "A transfer moves an asset from a sender to a recipient." }],
    },
  ],
};

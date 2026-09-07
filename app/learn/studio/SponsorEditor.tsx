"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Eye,
  LockKeyhole,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { baseNativeUsdc } from "../../../src/lib/base/escrow-abi";
import {
  entryCells,
  usdcAmount,
  type LearningLayout,
} from "../../../src/lib/base/learning";
import type { ReviewSubmission } from "../../../src/server/base/review";
import type { PrivateReview } from "../../../src/server/base/review-repository";
import { learningApi, LearningApiError, loginLink } from "../api";
import { CrosswordBoard } from "../CrosswordBoard";

type LayoutReview = {
  revision: number;
  termsHash: string;
  layoutHash: string;
  publicationHash: string;
  layout: LearningLayout;
  approved: boolean;
  published: boolean;
};
type Evidence = ReviewSubmission["draft"]["entries"][number]["evidence"];
const blankEvidence = () => [{ sourceId: "source-1", quote: "" }];
function blank(): ReviewSubmission {
  return {
    source: {
      topic: "",
      tone: "plain factual",
      count: 3,
      sources: [{ id: "source-1", title: "", text: "" }],
    },
    draft: {
      title: "",
      paragraphs: Array.from({ length: 2 }, () => ({
        text: "",
        evidence: blankEvidence(),
      })),
      entries: Array.from({ length: 3 }, () => ({
        clue: "",
        answer: "",
        evidence: blankEvidence(),
      })),
    },
    terms: {
      chainId: 84532,
      escrow: "",
      token: baseNativeUsdc[84532],
      sponsor: "",
      initialSigner: "",
      rewardAtomic: "100000",
      maxClaims: 100,
      startsAt: 0,
      endsAt: 0,
      claimDeadline: 0,
    },
  };
}
function localDate(seconds: number) {
  if (!seconds) return "";
  const date = new Date(seconds * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

function EvidenceEditor({
  value,
  sources,
  onChange,
}: {
  value: Evidence;
  sources: ReviewSubmission["source"]["sources"];
  onChange: (value: Evidence) => void;
}) {
  return (
    <div className="learn-evidence">
      {value.map((reference, index) => (
        <div key={index} className="learn-evidence-row">
          <label>
            Source
            <select
              value={reference.sourceId}
              onChange={(e) =>
                onChange(
                  value.map((r, i) =>
                    i === index ? { ...r, sourceId: e.target.value } : r,
                  ),
                )
              }
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title || s.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Supporting quote
            <textarea
              rows={2}
              maxLength={400}
              value={reference.quote}
              onChange={(e) =>
                onChange(
                  value.map((r, i) =>
                    i === index ? { ...r, quote: e.target.value } : r,
                  ),
                )
              }
            />
          </label>
          <button
            type="button"
            className="learn-icon"
            disabled={value.length === 1}
            title="Remove quote"
            aria-label="Remove quote"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      {value.length < 3 && (
        <button
          className="learn-icon"
          title="Add supporting quote"
          aria-label="Add supporting quote"
          type="button"
          onClick={() =>
            onChange([
              ...value,
              { sourceId: sources[0]?.id || "source-1", quote: "" },
            ])
          }
        >
          <Plus size={17} />
        </button>
      )}
    </div>
  );
}

export function SponsorEditor({
  id,
  initial,
  preview = false,
}: {
  id: string;
  initial?: ReviewSubmission;
  preview?: boolean;
}) {
  const [submission, setSubmission] = useState(initial || blank);
  const [review, setReview] = useState<PrivateReview | null>(null);
  const [layout, setLayout] = useState<LayoutReview | null>(null);
  const [tab, setTab] = useState("lesson");
  const [reward, setReward] = useState(
    usdcAmount(submission.terms.rewardAtomic),
  );
  const [fundedId, setFundedId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(id === "new");
  const creationKey = useRef("");
  const currentId = review?.id || id;
  const dirty =
    !review || JSON.stringify(review.submission) !== JSON.stringify(submission);
  const immutable = Boolean(review?.fundingBound);
  function edit(run: (next: ReviewSubmission) => void) {
    setSubmission((current) => {
      const next = structuredClone(current);
      run(next);
      return next;
    });
  }
  const load = useCallback(async () => {
    if (currentId === "new") return;
    const result = await learningApi<PrivateReview>(
      `/api/base/reviews/${currentId}`,
    );
    setReview(result);
    setSubmission(result.submission);
    setReward(usdcAmount(result.submission.terms.rewardAtomic));
    setLoaded(true);
    setLayout(null);
  }, [currentId]);
  async function act(run: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    setAnonymous(false);
    try {
      await run();
    } catch (e) {
      if (e instanceof LearningApiError && e.status === 401) setAnonymous(true);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load().catch((e) => {
      if (e instanceof LearningApiError && e.status === 401) setAnonymous(true);
      else setError((e as Error).message);
    });
  }, [load]);
  async function save() {
    if (preview) return;
    creationKey.current ||= crypto.randomUUID();
    const result = review
      ? await learningApi<PrivateReview>(
          `/api/base/reviews/${review.id}`,
          { expectedRevision: review.revision, submission },
          "PUT",
        )
      : await learningApi<PrivateReview>(
          "/api/base/reviews",
          submission,
          "POST",
          { "idempotency-key": creationKey.current },
        );
    setReview(result);
    setSubmission(result.submission);
    setLayout(null);
    setNotice("Private revision saved.");
    // Replace only after the server returns the durable campaign identifier.
    if (!review)
      window.history.replaceState(null, "", `/learn/studio/${result.id}`);
  }
  async function publication(
    action: "approve-layout" | "bind" | "publish" | "withdraw",
  ) {
    if (!layout || !review || dirty || preview) return;
    await learningApi(`/api/base/reviews/${review.id}/publication`, {
      action,
      expected: {
        revision: layout.revision,
        termsHash: layout.termsHash,
        layoutHash: layout.layoutHash,
      },
      ...(action === "bind" ? { onChainId: fundedId } : {}),
    });
    await load();
    setLayout(
      await learningApi<LayoutReview>(
        `/api/base/reviews/${review.id}/publication`,
      ),
    );
    setNotice(
      action === "withdraw"
        ? "Listing withdrawn. Existing reward recovery remains available."
        : action === "bind"
          ? "Finalized funding linked. No transaction was sent."
          : action === "publish"
            ? "Lesson published."
            : "Layout approved.",
    );
  }
  const answerLetters = layout
    ? (Array(layout.layout.rows * layout.layout.columns).fill("") as string[])
    : [];
  if (layout)
    for (const entry of layout.layout.entries)
      entryCells(entry, layout.layout.columns).forEach((cell, offset) => {
        answerLetters[cell] =
          review!.submission.draft.entries[entry.index].answer[offset];
      });
  return (
    <>
      <Link className="learn-back" href={preview ? "/#sponsors" : "/learn/studio"}>
        <ArrowLeft size={16} /> {preview ? "For sponsors" : "Campaign studio"}
      </Link>
      <div className="learn-heading">
        <div>
          <p className="learn-kicker">
            <LockKeyhole size={14} />
            {preview
              ? "Sponsor workflow demo / Saving disabled"
              : `Private workspace${review ? ` / Revision ${review.revision}` : ""}`}
          </p>
          <h1>{review?.publicContent.title || "New learning campaign"}</h1>
        </div>
        <div className="learn-actions">
          <button
            className="learn-icon"
            title="Reload saved revision"
            aria-label="Reload saved revision"
            disabled={busy || !review}
            onClick={() => {
              if (
                !dirty ||
                window.confirm(
                  "Discard unsaved edits and reload the saved revision?",
                )
              )
                void act(load);
            }}
          >
            <RefreshCw size={18} />
          </button>
          <button
            className="learn-button"
            disabled={busy || immutable || preview || !dirty || !loaded}
            onClick={() => void act(save)}
          >
            <Save size={17} /> Save draft
          </button>
        </div>
      </div>
      {anonymous ? (
        <Link
          className="learn-button"
          href={loginLink(`/learn/studio/${currentId}`)}
        >
          Sign in to your private workspace
        </Link>
      ) : !loaded ? (
        <p role="status">Loading private draft...</p>
      ) : (
        <>
          <div
            className="learn-tabs"
            role="tablist"
            aria-label="Campaign sections"
          >
            {[
              ["lesson", "Lesson & sources"],
              ["rewards", "Reward terms"],
              ["review", "Review & publish"],
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                role="tab"
                aria-selected={tab === value}
                aria-controls={`studio-${value}`}
                id={`tab-${value}`}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "lesson" && (
            <div
              id="studio-lesson"
              role="tabpanel"
              aria-labelledby="tab-lesson"
            >
              <fieldset disabled={busy || immutable} className="learn-editor">
                <div className="learn-form-pair">
                  <label>
                    Lesson title
                    <input
                      maxLength={100}
                      value={submission.draft.title}
                      onChange={(e) =>
                        edit((s) => {
                          s.draft.title = e.target.value;
                        })
                      }
                    />
                  </label>
                  <label>
                    Topic
                    <input
                      maxLength={500}
                      value={submission.source.topic}
                      onChange={(e) =>
                        edit((s) => {
                          s.source.topic = e.target.value;
                        })
                      }
                    />
                  </label>
                </div>
                <section className="learn-form-section">
                  <div className="learn-section-heading">
                    <h2>Source material</h2>
                    <button
                      className="learn-icon"
                      title="Add source"
                      aria-label="Add source"
                      disabled={submission.source.sources.length >= 5}
                      onClick={() =>
                        edit((s) => {
                          s.source.sources.push({
                            id: `source-${crypto.randomUUID().slice(0, 8)}`,
                            title: "",
                            text: "",
                          });
                        })
                      }
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                  {submission.source.sources.map((source, index) => (
                    <div className="learn-editor-row" key={source.id}>
                      <div className="learn-form-pair">
                        <label>
                          Source title
                          <input
                            maxLength={120}
                            value={source.title}
                            onChange={(e) =>
                              edit((s) => {
                                s.source.sources[index].title = e.target.value;
                              })
                            }
                          />
                        </label>
                        <label>
                          Source URL (optional)
                          <input
                            type="url"
                            value={source.url || ""}
                            onChange={(e) =>
                              edit((s) => {
                                if (e.target.value)
                                  s.source.sources[index].url = e.target.value;
                                else delete s.source.sources[index].url;
                              })
                            }
                          />
                        </label>
                      </div>
                      <label>
                        Source text
                        <textarea
                          rows={5}
                          maxLength={12000}
                          value={source.text}
                          onChange={(e) =>
                            edit((s) => {
                              s.source.sources[index].text = e.target.value;
                            })
                          }
                        />
                      </label>
                      <button
                        className="learn-icon"
                        title="Remove source"
                        aria-label="Remove source"
                        disabled={submission.source.sources.length <= 1}
                        onClick={() =>
                          edit((s) => {
                            s.source.sources.splice(index, 1);
                          })
                        }
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  ))}
                </section>
                <section className="learn-form-section">
                  <div className="learn-section-heading">
                    <h2>The lesson</h2>
                    <button
                      className="learn-icon"
                      title="Add paragraph"
                      aria-label="Add paragraph"
                      disabled={submission.draft.paragraphs.length >= 4}
                      onClick={() =>
                        edit((s) => {
                          s.draft.paragraphs.push({
                            text: "",
                            evidence: [
                              { sourceId: s.source.sources[0].id, quote: "" },
                            ],
                          });
                        })
                      }
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                  {submission.draft.paragraphs.map((paragraph, index) => (
                    <div className="learn-editor-row" key={index}>
                      <label>
                        Paragraph {index + 1}
                        <textarea
                          rows={3}
                          value={paragraph.text}
                          maxLength={800}
                          onChange={(e) =>
                            edit((s) => {
                              s.draft.paragraphs[index].text = e.target.value;
                            })
                          }
                        />
                      </label>
                      <EvidenceEditor
                        value={paragraph.evidence}
                        sources={submission.source.sources}
                        onChange={(evidence) =>
                          edit((s) => {
                            s.draft.paragraphs[index].evidence = evidence;
                          })
                        }
                      />
                      <button
                        className="learn-icon"
                        title="Remove paragraph"
                        aria-label="Remove paragraph"
                        disabled={submission.draft.paragraphs.length <= 2}
                        onClick={() =>
                          edit((s) => {
                            s.draft.paragraphs.splice(index, 1);
                          })
                        }
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  ))}
                </section>
                <section className="learn-form-section">
                  <div className="learn-section-heading">
                    <h2>Crossword entries</h2>
                    <button
                      className="learn-icon"
                      title="Add entry"
                      aria-label="Add entry"
                      disabled={submission.draft.entries.length >= 12}
                      onClick={() =>
                        edit((s) => {
                          s.draft.entries.push({
                            clue: "",
                            answer: "",
                            evidence: [
                              { sourceId: s.source.sources[0].id, quote: "" },
                            ],
                          });
                          s.source.count = s.draft.entries.length;
                        })
                      }
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                  {submission.draft.entries.map((entry, index) => (
                    <div className="learn-editor-row" key={index}>
                      <div className="learn-form-pair">
                        <label>
                          Clue {index + 1}
                          <input
                            value={entry.clue}
                            maxLength={300}
                            onChange={(e) =>
                              edit((s) => {
                                s.draft.entries[index].clue = e.target.value;
                              })
                            }
                          />
                        </label>
                        <label>
                          Answer {index + 1}
                          <input
                            value={entry.answer}
                            maxLength={24}
                            autoCapitalize="characters"
                            onChange={(e) =>
                              edit((s) => {
                                s.draft.entries[index].answer = e.target.value
                                  .toUpperCase()
                                  .replace(/[^A-Z]/g, "");
                              })
                            }
                          />
                        </label>
                      </div>
                      <EvidenceEditor
                        value={entry.evidence}
                        sources={submission.source.sources}
                        onChange={(evidence) =>
                          edit((s) => {
                            s.draft.entries[index].evidence = evidence;
                          })
                        }
                      />
                      <button
                        className="learn-icon"
                        title="Remove entry"
                        aria-label="Remove entry"
                        disabled={submission.draft.entries.length <= 3}
                        onClick={() =>
                          edit((s) => {
                            s.draft.entries.splice(index, 1);
                            s.source.count = s.draft.entries.length;
                          })
                        }
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  ))}
                </section>
              </fieldset>
            </div>
          )}
          {tab === "rewards" && (
            <div
              id="studio-rewards"
              role="tabpanel"
              aria-labelledby="tab-rewards"
            >
              <fieldset className="learn-editor" disabled={busy || immutable}>
                <div className="learn-form-pair">
                  <label>
                    Network
                    <select
                      value={submission.terms.chainId}
                      onChange={(e) =>
                        edit((s) => {
                          const chainId = Number(e.target.value) as
                            | 8453
                            | 84532;
                          s.terms.chainId = chainId;
                          s.terms.token = baseNativeUsdc[chainId];
                        })
                      }
                    >
                      <option value={84532}>Base Sepolia (test USDC)</option>
                      <option value={8453}>Base (USDC)</option>
                    </select>
                  </label>
                  <label>
                    Reward per player (USDC)
                    <input
                      inputMode="decimal"
                      value={reward}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (!/^\d*(\.\d{0,6})?$/.test(value)) return;
                        setReward(value);
                        edit((s) => {
                          const [whole, fraction = ""] = value.split(".");
                          s.terms.rewardAtomic = (
                            BigInt(whole || "0") * 1000000n +
                            BigInt(fraction.padEnd(6, "0"))
                          ).toString();
                        });
                      }}
                    />
                  </label>
                  <label>
                    Reward cap
                    <input
                      type="number"
                      min={1}
                      max={4294967295}
                      step={1}
                      value={submission.terms.maxClaims}
                      onChange={(e) =>
                        edit((s) => {
                          s.terms.maxClaims = Number(e.target.value);
                        })
                      }
                    />
                  </label>
                  <div className="learn-total">
                    <span>Total campaign funding</span>
                    <strong>
                      {usdcAmount(
                        (
                          BigInt(submission.terms.rewardAtomic) *
                          BigInt(
                            Number.isSafeInteger(submission.terms.maxClaims) &&
                              submission.terms.maxClaims > 0
                              ? submission.terms.maxClaims
                              : 0,
                          )
                        ).toString(),
                      )}{" "}
                      USDC
                    </strong>
                  </div>
                </div>
                <div className="learn-form-pair">
                  {(
                    [
                      ["escrow", "Rewards contract"],
                      ["sponsor", "Sponsor wallet"],
                      ["initialSigner", "Eligibility signer"],
                    ] as const
                  ).map(([field, label]) => (
                    <label key={field}>
                      {label}
                      <input
                        value={submission.terms[field]}
                        onChange={(e) =>
                          edit((s) => {
                            s.terms[field] = e.target.value;
                          })
                        }
                      />
                    </label>
                  ))}
                  <label>
                    Native USDC
                    <input value={submission.terms.token} readOnly />
                  </label>
                </div>
                <div className="learn-form-pair">
                  {(
                    [
                      ["startsAt", "Starts"],
                      ["endsAt", "Completion closes"],
                      ["claimDeadline", "Claim deadline"],
                    ] as const
                  ).map(([field, label]) => (
                    <label key={field}>
                      {label}
                      <input
                        type="datetime-local"
                        value={localDate(submission.terms[field])}
                        onChange={(e) =>
                          edit((s) => {
                            s.terms[field] = e.target.value
                              ? Math.floor(
                                  new Date(e.target.value).getTime() / 1000,
                                )
                              : 0;
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          )}
          {tab === "review" && (
            <div
              id="studio-review"
              role="tabpanel"
              aria-labelledby="tab-review"
              className="learn-review"
            >
              <section>
                <h2>Publication checklist</h2>
                <ol className="learn-steps">
                  <li className={!dirty ? "done" : ""}>
                    <Check size={16} /> Saved private revision
                  </li>
                  <li className={review?.approval ? "done" : ""}>
                    <Check size={16} /> Lesson and reward terms approved
                  </li>
                  <li className={layout?.approved ? "done" : ""}>
                    <Check size={16} /> Crossword layout approved
                  </li>
                  <li className={immutable ? "done" : ""}>
                    <Check size={16} /> Finalized funding linked
                  </li>
                  <li className={layout?.published ? "done" : ""}>
                    <Check size={16} /> Public lesson
                  </li>
                </ol>
                {dirty && (
                  <p className="learn-notice">
                    Save this revision before reviewing it.
                  </p>
                )}
                <div className="learn-review-actions">
                  <button
                    className="learn-button secondary"
                    disabled={busy || dirty || preview}
                    onClick={() =>
                      void act(async () => {
                        if (!review) return;
                        setReview(
                          await learningApi<PrivateReview>(
                            `/api/base/reviews/${review.id}/approve`,
                            {
                              revision: review.revision,
                              reviewHash: review.reviewHash,
                              termsHash: review.termsHash,
                            },
                          ),
                        );
                        setNotice("Lesson and reward terms approved.");
                      })
                    }
                  >
                    <Check size={17} /> Approve lesson and terms
                  </button>
                  <button
                    className="learn-button secondary"
                    disabled={busy || dirty || preview}
                    onClick={() =>
                      void act(async () => {
                        setLayout(
                          await learningApi<LayoutReview>(
                            `/api/base/reviews/${currentId}/publication`,
                          ),
                        );
                      })
                    }
                  >
                    <Eye size={17} /> Review crossword layout
                  </button>
                  {layout && (
                    <button
                      className="learn-button secondary"
                      disabled={
                        busy || dirty || !review?.approval || layout.approved
                      }
                      onClick={() =>
                        void act(() => publication("approve-layout"))
                      }
                    >
                      <Check size={17} /> Approve this layout
                    </button>
                  )}
                </div>
                {review && (
                  <details className="learn-audit">
                    <summary>Review commitments</summary>
                    <p>{review.termsHash}</p>
                    <p>{review.reviewHash}</p>
                  </details>
                )}
                {layout?.approved && (
                  <section className="learn-form-section">
                    <h3>Link existing funding</h3>
                    <label>
                      On-chain campaign number
                      <input
                        inputMode="numeric"
                        value={fundedId}
                        onChange={(e) =>
                          setFundedId(e.target.value.replace(/[^0-9]/g, ""))
                        }
                        disabled={immutable || busy}
                      />
                    </label>
                    <button
                      className="learn-button secondary"
                      disabled={busy || dirty || immutable || !fundedId}
                      onClick={() => void act(() => publication("bind"))}
                    >
                      Verify and link funding
                    </button>
                    <p className="learn-footnote">
                      This checks an already-funded contract. It does not send a
                      transaction.
                    </p>
                  </section>
                )}
                {immutable && layout?.approved && (
                  <section className="learn-form-section">
                    <h3>
                      {layout.published ? "Published" : "Ready to publish"}
                    </h3>
                    <button
                      className="learn-button"
                      disabled={busy || dirty}
                      onClick={() =>
                        void act(() =>
                          publication(
                            layout.published ? "withdraw" : "publish",
                          ),
                        )
                      }
                    >
                      {layout.published
                        ? "Withdraw listing"
                        : "Publish this lesson"}
                    </button>
                    {layout.published && (
                      <Link
                        className="learn-text-link"
                        href={`/learn/${currentId}`}
                      >
                        View public lesson
                      </Link>
                    )}
                    <p className="learn-footnote">
                      Withdrawing a listing does not pause the contract or
                      cancel allocated rewards.
                    </p>
                  </section>
                )}
              </section>
              {layout && (
                <section>
                  <h2>Approved revision {layout.revision}</h2>
                  <CrosswordBoard
                    layout={layout.layout}
                    clues={review!.publicContent.clues}
                    letters={answerLetters}
                    onChange={() => {}}
                    readOnly
                  />
                </section>
              )}
            </div>
          )}
        </>
      )}
      {busy && <p role="status">Saving or checking the current state...</p>}
      {notice && (
        <p className="learn-success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="learn-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

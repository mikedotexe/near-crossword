"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, RefreshCw } from "lucide-react";
import {
  entryCells,
  usdcAmount,
  type PublicLesson,
} from "../../src/lib/base/learning";
import type { WalletConfiguration } from "../../src/lib/base/account";
import { learningApi, LearningApiError, loginLink } from "./api";
import { CrosswordBoard } from "./CrosswordBoard";
import { useParticipantAccount } from "./ParticipantAccount";
import { RewardPanel } from "./RewardPanel";

export function LessonPlayer({
  id,
  wallet,
  initial,
  practice = false,
  practiceAnswers,
}: {
  id: string;
  wallet: WalletConfiguration;
  initial?: PublicLesson;
  practice?: boolean;
  practiceAnswers?: string[];
}) {
  const account = useParticipantAccount();
  const [lesson, setLesson] = useState<PublicLesson | null>(initial || null);
  const [error, setError] = useState("");
  const [letters, setLetters] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [signIn, setSignIn] = useState(false);
  const [completionVersion, setCompletionVersion] = useState(0);
  const load = useCallback(async () => {
    if (initial) return;
    setError("");
    try {
      setLesson(await learningApi<PublicLesson>(`/api/base/lessons/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, initial]);
  useEffect(() => {
    void load();
  }, [load]);
  const key = lesson
    ? `crossword:guesses:${id}:${lesson.revision}:${lesson.layoutHash}`
    : "";
  useEffect(() => {
    if (!lesson) return;
    const count = lesson.layout.rows * lesson.layout.columns;
    let saved: unknown;
    try {
      saved = JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      /* Storage is optional. */
    }
    setLetters(
      Array.from({ length: count }, (_, i) =>
        Array.isArray(saved) &&
        typeof saved[i] === "string" &&
        /^[A-Z]$/.test(saved[i])
          ? saved[i]
          : "",
      ),
    );
    setReady(true);
  }, [key, lesson]);
  function update(next: string[]) {
    setLetters(next);
    setMessage("");
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Solving still works with storage disabled. */
    }
  }
  async function complete() {
    if (!lesson || busy) return;
    setBusy(true);
    setMessage("");
    setSignIn(false);
    if (practice) {
      const answers = lesson.layout.entries.map((entry) =>
        entryCells(entry, lesson.layout.columns)
          .map((cell) => letters[cell] || "")
          .join(""),
      );
      const passed =
        practiceAnswers?.length === answers.length &&
        answers.every((answer, index) => answer === practiceAnswers[index]);
      setMessage(
        passed
          ? "Correct. You completed the practice lesson."
          : "Not quite. Revisit the lesson and check each clue.",
      );
      setBusy(false);
      return;
    }
    try {
      await learningApi(`/api/base/participants/${id}/completion`, {
        revision: lesson.revision,
        answers: lesson.layout.entries.map((entry) =>
          entryCells(entry, lesson.layout.columns)
            .map((cell) => letters[cell] || "")
            .join(""),
        ),
      });
      setMessage(
        "Puzzle complete. Your completion is saved; a reward is reserved only after wallet verification.",
      );
      setCompletionVersion((v) => v + 1);
    } catch (e) {
      if (e instanceof LearningApiError && e.status === 401) setSignIn(true);
      else setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!lesson)
    return (
      <>
        <Link className="learn-back" href={practice ? "/" : "/learn"}>
          <ArrowLeft size={16} /> {practice ? "Crossword home" : "All lessons"}
        </Link>
        {error ? (
          <div className="learn-notice" role="alert">
            {error}
            <button
              className="learn-icon"
              title="Retry lesson"
              aria-label="Retry lesson"
              onClick={() => void load()}
            >
              <RefreshCw size={18} />
            </button>
          </div>
        ) : (
          <p role="status">Loading lesson...</p>
        )}
        {error && <RewardPanel id={id} wallet={wallet} />}
      </>
    );
  const filled = new Set(
    lesson.layout.entries.flatMap((entry) =>
      entryCells(entry, lesson.layout.columns),
    ),
  );
  const completeCount = [...filled].filter((cell) => letters[cell]).length;
  return (
    <>
      <Link className="learn-back" href={practice ? "/" : "/learn"}>
        <ArrowLeft size={16} /> {practice ? "Crossword home" : "All lessons"}
      </Link>
      <div className="learn-heading">
        <div>
          <p className="learn-kicker">
            {practice
              ? "Practice / No reward"
              : lesson.terms.chainId === 8453
                ? "Learn / Base"
                : "Learn / Base Sepolia test campaign"}
          </p>
          <h1>{lesson.title}</h1>
        </div>
        {!practice && (
          <div className="learn-prize">
            <strong>
              {usdcAmount(lesson.terms.rewardAtomic)} <span>USDC</span>
            </strong>
            <small>
              {lesson.availability === "OPEN"
                ? `${lesson.remainingSlots} unallocated rewards`
                : lesson.availability.replaceAll("_", " ").toLowerCase()}
            </small>
          </div>
        )}
      </div>
      <div className="learn-player-grid">
        <article className="learn-lesson">
          <p className="learn-kicker">01 / The lesson</p>
          {lesson.paragraphs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
          {!practice && (
            <dl className="learn-facts">
              <div>
                <dt>Sponsor</dt>
                <dd className="learn-address">{lesson.terms.sponsor}</dd>
              </div>
              <div>
                <dt>Completion closes</dt>
                <dd>{new Date(lesson.terms.endsAt * 1000).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Claim deadline</dt>
                <dd>
                  {new Date(lesson.terms.claimDeadline * 1000).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt>Confirmed payouts</dt>
                <dd>
                  {lesson.paidCount} / {lesson.terms.maxClaims}
                </dd>
              </div>
            </dl>
          )}
        </article>
        <section className="learn-solving">
          <div className="learn-section-heading">
            <p className="learn-kicker">02 / The crossword</p>
            <span className="learn-muted">
              {completeCount} / {filled.size}
            </span>
          </div>
          {ready && (
            <CrosswordBoard
              layout={lesson.layout}
              clues={lesson.clues}
              letters={letters}
              onChange={update}
            />
          )}
          <button
            className="learn-button learn-submit"
            disabled={
              busy ||
              completeCount !== filled.size ||
              (!practice && lesson.availability !== "OPEN")
            }
            onClick={() => void complete()}
          >
            {busy ? "Checking..." : "Check crossword"}
            <ArrowRight size={17} />
          </button>
          {!practice && (
            <>
              {signIn && (
                <div className="learn-notice">
                  {account.enabled ? (
                    <a href="#reward-title">
                      Sign in below to save your completion
                    </a>
                  ) : (
                    <Link href={loginLink(`/learn/${id}`)}>
                      Sign in to save your completion
                    </Link>
                  )}
                  <p>Your letters stay in this browser.</p>
                </div>
              )}
            </>
          )}
          {message && <p role="status">{message}</p>}
        </section>
        {!practice && (
          <div className="learn-reward-slot">
            <RewardPanel
              id={id}
              lesson={lesson}
              wallet={wallet}
              completionVersion={completionVersion}
            />
          </div>
        )}
      </div>
      {!practice && (
        <details className="learn-audit">
          <summary>Campaign record</summary>
          <dl className="learn-facts">
            <div>
              <dt>Terms commitment</dt>
              <dd>{lesson.termsHash}</dd>
            </div>
            <div>
              <dt>Publication commitment</dt>
              <dd>{lesson.publicationHash}</dd>
            </div>
            <div>
              <dt>Finalized block</dt>
              <dd>{lesson.asOf.blockNumber}</dd>
            </div>
          </dl>
          <p>
            Payments are on-chain. Email and eligibility evidence remain
            private. The publication commitment is a separate off-chain record
            tied to the funded terms.
          </p>
        </details>
      )}
    </>
  );
}

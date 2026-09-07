"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { usdcAmount } from "../../src/lib/base/learning";
import { learningApi } from "./api";

export function LessonCatalog() {
  const [lessons, setLessons] = useState<Array<{
    id: string;
    title: string;
    rewardAtomic: string;
    chainId: number;
  }> | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      setLessons(
        (
          await learningApi<{ lessons: NonNullable<typeof lessons> }>(
            "/api/base/lessons",
          )
        ).lessons,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      <div className="learn-heading">
        <div>
          <p className="learn-kicker">Crossword / Learn</p>
          <h1>Lessons worth solving.</h1>
        </div>
        <Link className="learn-button secondary" href="/learn/studio">
          Sponsor studio <ArrowRight size={17} />
        </Link>
      </div>
      {error ? (
        <div className="learn-notice" role="alert">
          {error}{" "}
          <button
            className="learn-icon"
            title="Retry lessons"
            aria-label="Retry lessons"
            onClick={() => void load()}
          >
            <RefreshCw size={18} />
          </button>
        </div>
      ) : !lessons ? (
        <p role="status">Loading lessons...</p>
      ) : lessons.length ? (
        <div className="learn-catalog">
          {lessons.map((lesson) => (
            <Link key={lesson.id} href={`/learn/${lesson.id}`}>
              <div>
                <span className="learn-kicker">
                  {lesson.chainId === 8453
                    ? "Base"
                    : "Base Sepolia / Test rewards"}
                </span>
                <h2>{lesson.title}</h2>
              </div>
              <span>
                {usdcAmount(lesson.rewardAtomic)} USDC <ArrowRight size={20} />
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <section className="learn-empty">
          <h2>No lessons published yet.</h2>
          <p>
            The next lesson will appear here once its review and funding are
            ready.
          </p>
        </section>
      )}
      <p className="learn-footnote">
        Rewards depend on availability and eligibility. A completed puzzle does
        not reserve a reward.
      </p>
    </>
  );
}

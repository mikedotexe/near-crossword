import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import Link from "next/link";
import TopNav from "../src/components/layout/TopNav";

export default function MyJobsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(router.query.highlight || null);

  const fetchJobs = useCallback(async () => {
    const res = await fetch("/api/puzzle-jobs");
    if (res.ok) {
      const data = await res.json();
      setJobs(data.jobs);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    if (status === "authenticated") {
      fetchJobs();
    }
  }, [status, router, fetchJobs]);

  // Poll while any jobs are pending/processing
  useEffect(() => {
    const hasPending = jobs.some((j) => j.status === "pending" || j.status === "processing");
    if (!hasPending) return;
    const interval = setInterval(fetchJobs, 15000);
    return () => clearInterval(interval);
  }, [jobs, fetchJobs]);

  const handleUseVariation = (variation) => {
    localStorage.setItem("aiGeneratedClues", JSON.stringify(variation.pairs));
    router.push("/create");
  };

  const handleRetry = async (job) => {
    const body = {
      inputMode: job.input_mode,
      youtubeUrl: job.input_mode === "youtube" ? job.youtube_url : undefined,
      pastedText: job.input_mode === "text" ? job.pasted_text : undefined,
      tone: job.tone,
      objective: job.objective,
    };
    const res = await fetch("/api/puzzle-jobs/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      fetchJobs();
    }
  };

  if (status === "loading" || loading) {
    return (
      <div className="app-shell">
        <TopNav />
        <main className="app-main app-container">
          <p>Loading...</p>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <TopNav />
      <main className="app-main app-container">
        <section className="card" style={{ maxWidth: 980, margin: "0 auto" }}>
          <div className="section-header">
            <p className="eyebrow">Background Jobs</p>
            <h2>My Jobs</h2>
          </div>

          {jobs.length === 0 ? (
            <div>
              <p>No jobs yet.</p>
              <Link href="/ai-studio" className="button button-primary" style={{ marginTop: "0.75rem", display: "inline-flex" }}>
                Go to AI Studio
              </Link>
            </div>
          ) : (
            <div className="job-list">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="job-card"
                  style={job.id === router.query.highlight ? { borderColor: "var(--primary)" } : undefined}
                >
                  <div className="job-card-header">
                    <span style={{ fontSize: "0.85rem", color: "var(--secondary)" }}>
                      {job.input_mode.toUpperCase()} &middot; {job.tone}
                    </span>
                    <span className={`job-status ${job.status}`}>{job.status}</span>
                  </div>

                  <p style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
                    {new Date(job.created_at).toLocaleString()}
                    {job.completed_at && ` — completed ${new Date(job.completed_at).toLocaleString()}`}
                  </p>

                  {job.status === "failed" && (
                    <div style={{ marginTop: "0.5rem" }}>
                      <p className="error-msg">{job.error_message || "Generation failed."}</p>
                      {job.input_mode !== "pdf" && (
                        <button
                          className="button button-secondary"
                          style={{ marginTop: "0.5rem" }}
                          onClick={() => handleRetry(job)}
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  )}

                  {job.status === "completed" && job.variations_json && (
                    <div style={{ marginTop: "0.75rem" }}>
                      {expanded === job.id ? (
                        <div>
                          <div className="variation-grid">
                            {job.variations_json.map((v) => (
                              <div className="variation-card" key={v.label}>
                                <h3>Variation {v.label}</h3>
                                <p>{v.description}</p>
                                <table className="variation-table">
                                  <thead>
                                    <tr><th>Clue</th><th>Answer</th></tr>
                                  </thead>
                                  <tbody>
                                    {v.pairs.map((pair, i) => (
                                      <tr key={i}><td>{pair.clue}</td><td>{pair.answer}</td></tr>
                                    ))}
                                  </tbody>
                                </table>
                                <button
                                  className="button button-primary"
                                  onClick={() => handleUseVariation(v)}
                                  style={{ marginTop: "0.75rem" }}
                                >
                                  Use This Variation
                                </button>
                              </div>
                            ))}
                          </div>
                          <button
                            className="button button-secondary"
                            style={{ marginTop: "0.75rem" }}
                            onClick={() => setExpanded(null)}
                          >
                            Collapse
                          </button>
                        </div>
                      ) : (
                        <button
                          className="button button-secondary"
                          onClick={() => setExpanded(job.id)}
                        >
                          View {job.variations_json.length} Variations
                        </button>
                      )}
                    </div>
                  )}

                  {(job.status === "pending" || job.status === "processing") && (
                    <p style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "var(--muted)" }}>
                      {job.status === "pending" ? "Waiting to be picked up..." : "Generating clues..."}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

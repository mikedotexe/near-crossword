const TRACKED_EVENTS = new Set([
  "landing_cta_create_click",
  "landing_cta_play_click",
  "hash_bridge_redirect",
  "create_connect_wallet_click",
  "wallet_connect_success",
  "wallet_connect_cancel_or_fail",
  "create_preview_generate",
  "create_commit_initiated",
  "create_commit_success",
  "create_commit_cancel_or_fail",
  "play_view_loaded",
  "claim_submit",
  "claim_success",
]);

let lastTrackedPath = null;

export const trackEvent = (name, params = {}) => {
  if (typeof window === "undefined") {
    return;
  }

  if (!TRACKED_EVENTS.has(name)) {
    return;
  }

  if (typeof window.gtag === "function") {
    window.gtag("event", name, params);
  }
};

export const trackPageView = (path) => {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedPath = path || `${window.location.pathname}${window.location.search}`;
  if (!normalizedPath) {
    return;
  }

  if (typeof window.gtag !== "function") {
    return;
  }

  if (normalizedPath === lastTrackedPath) {
    return;
  }

  window.gtag("event", "page_view", {
    page_path: normalizedPath,
    page_location: window.location.href,
  });
  lastTrackedPath = normalizedPath;
};

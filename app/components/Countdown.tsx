"use client";

import { useEffect, useState } from "react";

function formatRemaining(target: string) {
  const distance = new Date(target).getTime() - Date.now();
  if (distance <= 0) return "Ended";

  const days = Math.floor(distance / 86_400_000);
  const hours = Math.floor((distance % 86_400_000) / 3_600_000);
  const minutes = Math.floor((distance % 3_600_000) / 60_000);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

export function Countdown({
  target,
  prefix = "Closes in",
}: {
  target: string;
  prefix?: string;
}) {
  const [remaining, setRemaining] = useState(() => formatRemaining(target));

  useEffect(() => {
    const tick = () => setRemaining(formatRemaining(target));
    tick();
    const interval = window.setInterval(tick, 30_000);
    return () => window.clearInterval(interval);
  }, [target]);

  return (
    <span className="countdown">
      <span className="countdown__dot" aria-hidden="true" />
      {prefix} <strong>{remaining}</strong>
    </span>
  );
}

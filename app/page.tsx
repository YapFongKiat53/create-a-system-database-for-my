"use client";

import { useEffect, useState } from "react";
import SystemApp from "./SystemApp";

export default function Home() {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth", { cache: "no-store" })
      .then((response) => response.json() as Promise<{
        user?: { roleKey: string } | null;
      }>)
      .then((result) => {
        if (cancelled) return;
        if (!result.user) window.location.replace("/login");
        else if (result.user.roleKey === "tenant")
          window.location.replace("/student");
        else setAllowed(true);
      })
      .catch(() => !cancelled && window.location.replace("/login"));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!allowed)
    return (
      <div className="login-shell">
        <div className="login-card">
          <p className="login-checking">Checking your session...</p>
        </div>
      </div>
    );
  return <SystemApp />;
}

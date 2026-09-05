"use client";

import { useEffect } from "react";
import { BASE_PATH } from "./basePath";

export default function Home() {
  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE_PATH}/api/auth`, { cache: "no-store" })
      .then((response) => response.json() as Promise<{
        user?: { roleKey: string } | null;
      }>)
      .then((result) => {
        if (cancelled) return;
        if (!result.user) window.location.replace(`${BASE_PATH}/login`);
        else if (result.user.roleKey === "tenant")
          window.location.replace(`${BASE_PATH}/student`);
        else window.location.replace(`${BASE_PATH}/dashboard`);
      })
      .catch(() => !cancelled && window.location.replace(`${BASE_PATH}/login`));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="login-shell">
      <div className="login-card">
        <p className="login-checking">Checking your session...</p>
      </div>
    </div>
  );
}

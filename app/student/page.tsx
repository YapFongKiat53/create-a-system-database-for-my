"use client";

import { useEffect, useState } from "react";

type Me = {
  displayName: string;
  email: string;
  roleKey: string;
  roleName: string;
};

export default function StudentPortalPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ user?: Me | null }>)
      .then((result) => {
        if (cancelled) return;
        if (!result.user) {
          window.location.replace("/login");
          return;
        }
        setMe(result.user);
        setLoading(false);
      })
      .catch(() => !cancelled && window.location.replace("/login"));
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = async () => {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    window.location.replace("/login");
  };

  if (loading)
    return (
      <div className="login-shell">
        <div className="login-card">
          <p className="login-checking">Loading your portal...</p>
        </div>
      </div>
    );

  return (
    <div className="portal-shell">
      <header className="portal-bar">
        <div className="login-brand">
          <span className="brand-mark">HO</span>
          <div>
            <strong>Student Portal</strong>
            <small>Hostel Operations</small>
          </div>
        </div>
        <button className="secondary compact" onClick={signOut}>
          Sign out
        </button>
      </header>
      <main className="portal-body">
        <section className="portal-card">
          <span className="section-kicker">SIGNED IN</span>
          <h1>Hello, {me?.displayName}</h1>
          <p>
            You are signed in as a resident ({me?.email}). The student portal is
            still being built — your room details, bills and maintenance requests
            will appear here soon.
          </p>
          <div className="portal-note">
            <strong>Coming soon</strong>
            <ul>
              <li>Your room and tenancy details</li>
              <li>Monthly bills and payment history</li>
              <li>Submit and track maintenance tickets</li>
              <li>Hostel announcements</li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}

"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { BASE_PATH } from "../../basePath";

export default function StudentLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);

  // Already signed in? Go straight to the right side of the system.
  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE_PATH}/api/auth`, { cache: "no-store" })
      .then((response) => response.json() as Promise<{
        user?: unknown;
        landing?: string;
      }>)
      .then((result) => {
        if (cancelled) return;
        if (result.user && result.landing)
          window.location.replace(result.landing);
        else setChecking(false);
      })
      .catch(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${BASE_PATH}/api/auth`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "login", email, password }),
      });
      const result = (await response.json()) as {
        error?: string;
        landing?: string;
      };
      if (!response.ok) throw new Error(result.error || "Unable to sign in");
      window.location.replace(result.landing || `${BASE_PATH}/`);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Unable to sign in",
      );
      setBusy(false);
    }
  };

  if (checking)
    return (
      <div className="login-shell">
        <div className="login-card">
          <p className="login-checking">Checking your session...</p>
        </div>
      </div>
    );

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <span className="brand-mark">HO</span>
          <div>
            <strong>Hostel Operations</strong>
            <small>Resident portal</small>
          </div>
        </div>
        <h1>Sign in</h1>
        <p className="login-intro">
          Sign in to view your bills, submit maintenance requests and read
          announcements.
        </p>
        {error && <div className="login-error">{error}</div>}
        <form onSubmit={submit}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
              autoFocus
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="login-foot">
          Haven&apos;t set your password yet? Use the link in your setup email.
          Forgot it? Ask the hostel office to send a new one.
        </p>
        <p className="login-foot">
          <Link href="/login">Staff sign in</Link>
        </p>
      </div>
    </div>
  );
}

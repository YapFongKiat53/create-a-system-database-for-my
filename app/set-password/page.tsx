"use client";

import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BASE_PATH } from "../basePath";

const MIN_LENGTH = 8;

function SetPasswordForm() {
  const token = useSearchParams().get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [linkProblem, setLinkProblem] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (password.length < MIN_LENGTH) {
      setError(`Password must be at least ${MIN_LENGTH} characters`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${BASE_PATH}/api/auth`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "set-password-with-token",
          token,
          password,
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        landing?: string;
      };
      if (!response.ok) {
        setLinkProblem(response.status === 400 && password.length >= MIN_LENGTH);
        throw new Error(result.error || "Unable to set your password");
      }
      window.location.replace(result.landing || `${BASE_PATH}/`);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to set your password",
      );
      setBusy(false);
    }
  };

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
        <h1>Set your password</h1>
        {!token ? (
          <>
            <div className="login-error">
              This page needs the link from your setup email. The link you
              opened is missing its token.
            </div>
            <p className="login-foot">
              Open the link in your setup email again, or ask the hostel office
              to send you a new setup email.
            </p>
          </>
        ) : (
          <>
            <p className="login-intro">
              Choose a password of at least {MIN_LENGTH} characters. You will
              be signed in once it is saved.
            </p>
            {error && (
              <div className="login-error">
                {error}
                {linkProblem && (
                  <>
                    <br />
                    Ask the hostel office to send you a new setup email.
                  </>
                )}
              </div>
            )}
            <form onSubmit={submit}>
              <label>
                New password
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                  autoFocus
                />
              </label>
              <label>
                Confirm password
                <input
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
              <button className="primary" disabled={busy}>
                {busy ? "Saving..." : "Set password and sign in"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="login-shell">
          <div className="login-card">
            <p className="login-checking">Loading...</p>
          </div>
        </div>
      }
    >
      <SetPasswordForm />
    </Suspense>
  );
}

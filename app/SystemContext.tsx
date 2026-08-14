"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Data } from "./modules/shared";

type SaveResult = { ok: boolean; id?: number } | null;

type SystemContextValue = {
  data: Data | null;
  busy: boolean;
  error: string;
  notice: string;
  load: (modules?: string[]) => Promise<void>;
  save: (payload: Record<string, unknown>, success?: string) => Promise<SaveResult>;
};

const SystemContext = createContext<SystemContextValue | null>(null);

// Which GET /api/system?modules=... scope(s) a save action's changes land
// in, so save() can ask for just those instead of the full ~30-query load.
// Mirrors moduleForAction() in app/api/system/route.ts, but deliberately
// narrower — see loadScopedModules() there for exactly which actions are
// safe to scope this way and why the rest (units/students/finance/
// reservations/hostel-rates/meter-readings) always fall back to a full
// reload via the null return below.
function scopedModulesForAction(action: string): string[] | null {
  if (/^parking-/.test(action)) return ["parking"];
  if (/^(ticket-|general-cost)/.test(action)) return ["maintenance-tickets"];
  if (/^announcement/.test(action)) return ["announcements"];
  if (/^(role-|user-|reminder-)/.test(action)) return ["users"];
  if (/^(school-|course-)/.test(action)) return ["schools-courses"];
  return null;
}

// Fetches /api/system once and keeps it alive across route navigations —
// the layout that renders this provider doesn't remount when switching
// between module pages, so every page shares the same already-loaded data
// instead of each page re-running the full (expensive) query set.
export function SystemProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async (modules?: string[]) => {
    setError("");
    try {
      const url = modules?.length
        ? `/api/system?modules=${modules.join(",")}`
        : "/api/system";
      const response = await fetch(url, { cache: "no-store" });
      const result = (await response.json()) as {
        error?: string;
      } & Partial<Data>;
      if (!response.ok)
        throw new Error(result.error || "Unable to load records");
      // A scoped response only carries the keys for the requested modules —
      // merge them in rather than replacing everything else already loaded.
      if (modules?.length)
        setData((prev) => (prev ? { ...prev, ...result } : (result as Data)));
      else setData(result as Data);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Unable to load records",
      );
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const save = async (payload: Record<string, unknown>, success = "Saved") => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/system", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        error?: string;
        ok?: boolean;
        id?: number;
      };
      if (!response.ok)
        throw new Error(result.error || "Unable to save record");
      const action =
        typeof payload.action === "string" ? payload.action : "";
      await load(scopedModulesForAction(action) ?? undefined);
      setNotice(success);
      window.setTimeout(() => setNotice(""), 3000);
      return result as { ok: boolean; id?: number };
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Unable to save record",
      );
      return null;
    } finally {
      setBusy(false);
    }
  };

  return (
    <SystemContext.Provider value={{ data, busy, error, notice, load, save }}>
      {children}
    </SystemContext.Provider>
  );
}

export function useSystem() {
  const ctx = useContext(SystemContext);
  if (!ctx) throw new Error("useSystem must be used within a SystemProvider");
  return ctx;
}

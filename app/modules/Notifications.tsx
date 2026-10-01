"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BASE_PATH } from "../basePath";
import { Empty } from "./shared";

type NotificationItem = {
  id: number;
  type: string;
  title: string;
  body: string;
  link: string;
  readAt: string | null;
  createdAt: string;
};

const HISTORY_LIMIT = 200;

// Postgres hands back "2026-09-30 08:26:33.42885+00", which not every browser
// parses as a date until it is written in ISO form.
const stamp = (value: string) => {
  const date = new Date(
    String(value)
      .replace(" ", "T")
      .replace(/([+-]\d\d)$/, "$1:00"),
  );
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kuala_Lumpur",
      }).format(date);
};

export function NotificationsModule() {
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `${BASE_PATH}/api/system?modules=notifications-all`,
        { cache: "no-store" },
      );
      const result = (await response.json()) as {
        error?: string;
        notificationHistory?: NotificationItem[];
      };
      if (!response.ok)
        throw new Error(result.error || "Unable to load notifications");
      setItems(result.notificationHistory || []);
      setError("");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to load notifications",
      );
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // The header bell keeps its own copy of the unread count, so tell it to
  // refresh instead of leaving the badge stale until its next 60s poll.
  const send = async (body: Record<string, unknown>) => {
    await fetch(`${BASE_PATH}/api/system`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    window.dispatchEvent(new Event("notifications-changed"));
    load();
  };

  const unread = (items || []).filter((item) => !item.readAt);
  const shown = filter === "unread" ? unread : items || [];

  return (
    <section className="notif-page">
      <div className="notif-page-head">
        <div className="notif-page-tabs">
          <button
            type="button"
            className={filter === "all" ? "active" : ""}
            onClick={() => setFilter("all")}
          >
            All{items ? ` (${items.length})` : ""}
          </button>
          <button
            type="button"
            className={filter === "unread" ? "active" : ""}
            onClick={() => setFilter("unread")}
          >
            Unread{items ? ` (${unread.length})` : ""}
          </button>
        </div>
        {unread.length > 0 && (
          <button
            type="button"
            className="link-button"
            onClick={() => send({ action: "notification-mark-all-read" })}
          >
            Mark all as read
          </button>
        )}
      </div>

      {error && <p className="notif-empty">{error}</p>}
      {!error && items === null && <p className="notif-empty">Loading...</p>}
      {!error && items && !shown.length && (
        <Empty
          title={filter === "unread" ? "You're all caught up" : "Nothing yet"}
          text={
            filter === "unread"
              ? "No unread notifications."
              : "Notifications about tickets, payments and bookings will appear here."
          }
        />
      )}

      {shown.map((item) => {
        const inner = (
          <>
            <strong>{item.title}</strong>
            {item.body && <small>{item.body}</small>}
            <time>{stamp(item.createdAt)}</time>
          </>
        );
        const className = `notif-item${item.readAt ? "" : " is-unread"}`;
        const markRead = () => {
          if (!item.readAt)
            send({ action: "notification-mark-read", notificationId: item.id });
        };
        return item.link ? (
          <Link
            key={item.id}
            href={item.link}
            className={className}
            onClick={markRead}
          >
            {inner}
          </Link>
        ) : (
          <div key={item.id} className={className} onClick={markRead}>
            {inner}
          </div>
        );
      })}

      {items && items.length >= HISTORY_LIMIT && (
        <p className="notif-empty">
          Showing your latest {HISTORY_LIMIT} notifications.
        </p>
      )}
    </section>
  );
}

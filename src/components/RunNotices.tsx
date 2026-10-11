import { X } from "lucide-react";
import { useRunNotices } from "../hooks/useRunActivity";
import { dismissRunNotice, openRun } from "../lib/runActivity";

/**
 * Notices for collection runs that just finished, wherever the developer is.
 * They're announced but never take focus. One for a run that passed goes away
 * by itself; one for a run that failed stays until it's dismissed or opened.
 */
export function RunNotices() {
  const notices = useRunNotices();
  return (
    <div className="run-notices" role="status" aria-live="polite">
      {notices.map((notice) => (
        <div key={notice.runId} className={`run-notice${notice.passed ? "" : " failed"}`}>
          <span className="run-notice-text">
            <strong>{notice.name}</strong> {notice.text}
            {notice.startedBy ? ` · started by ${notice.startedBy}` : ""}
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => {
              dismissRunNotice(notice.runId);
              openRun(notice.collectionId, notice.runId);
            }}
          >
            View run
          </button>
          <button
            type="button"
            className="icon-btn tight"
            aria-label={`Dismiss the notice for ${notice.name}`}
            onClick={() => dismissRunNotice(notice.runId)}
          >
            <X size={12} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

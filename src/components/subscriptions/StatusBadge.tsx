import React from "react";
import { AlertTriangle, Clock, PauseCircle } from "lucide-react";

export function StatusBadge({
  status,
  isPaused,
  isQuotationExpired,
}: {
  status: "DRAFT" | "QUOTATION" | "CONFIRMED" | "ACTIVE" | "CLOSED";
  isPaused?: boolean;
  isQuotationExpired?: boolean;
}) {
  const styles: Record<string, string> = {
    DRAFT: "bg-slate-100 text-slate-700 border-slate-200",
    QUOTATION: "bg-amber-50 text-amber-800 border-amber-200",
    CONFIRMED: "bg-blue-50 text-blue-700 border-blue-200",
    ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200",
    CLOSED: "bg-rose-50 text-rose-700 border-rose-200",
  };

  return (
    <div className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
          styles[status] || styles.DRAFT
        }`}
      >
        {status}
      </span>

      {isPaused && (
        <span className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-xs font-semibold text-orange-700">
          <PauseCircle className="h-3.5 w-3.5" />
          PAUSED
        </span>
      )}

      {isQuotationExpired && status === "QUOTATION" && (
        <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">
          <AlertTriangle className="h-3.5 w-3.5" />
          EXPIRED
        </span>
      )}
    </div>
  );
}

export function StatusTimeline({
  history,
}: {
  history: Array<{
    id: number;
    fromStatus: string | null;
    toStatus: string;
    changedById: number | null;
    note: string | null;
    changedAt: string;
  }>;
}) {
  if (!history || history.length === 0) {
    return <p className="text-sm text-slate-500">No history recorded yet.</p>;
  }

  return (
    <ol className="relative ml-3 border-l border-slate-200 space-y-5">
      {history.map((item) => {
        const isActionEvent = item.note?.startsWith("ACTION:");
        return (
          <li key={item.id} className="ml-6">
            <span
              className={`absolute -left-2.5 flex h-5 w-5 items-center justify-center rounded-full ring-4 ring-white ${
                isActionEvent ? "bg-amber-500 text-white" : "bg-indigo-600 text-white"
              }`}
            >
              <Clock className="h-3 w-3" />
            </span>
            <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                  {item.fromStatus ? (
                    <>
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-slate-700">
                        {item.fromStatus}
                      </span>
                      <span className="text-slate-400">→</span>
                      <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-indigo-800">
                        {item.toStatus}
                      </span>
                    </>
                  ) : (
                    <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-indigo-800">
                      Created ({item.toStatus})
                    </span>
                  )}
                </div>
                <time className="text-xs text-slate-500">
                  {new Date(item.changedAt).toLocaleString()}
                </time>
              </div>
              {item.note && (
                <p className="mt-1.5 text-sm text-slate-700 font-medium">{item.note}</p>
              )}
              <p className="mt-1 text-xs text-slate-400">
                {item.changedById ? `Actor User ID #${item.changedById}` : "System / Automated"}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}


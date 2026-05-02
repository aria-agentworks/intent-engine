import type { Lead } from "@workspace/api-client-react/src/generated/api.schemas";

function escapeCell(value: string | number | null | undefined): string {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function downloadLeadsCsv(leads: Lead[], filename: string, includedStatus = false): void {
  const headers = [
    "Source",
    "Author",
    "Subreddit",
    "Score",
    "Intent",
    "Text",
    "URL",
    "Date",
    ...(includedStatus ? ["Status"] : []),
  ];

  const rows = leads.map((l) => [
    escapeCell(l.source),
    escapeCell(l.author),
    escapeCell(l.subreddit),
    escapeCell(l.intent_score),
    escapeCell(l.intent_label),
    escapeCell(l.text),
    escapeCell(l.url),
    escapeCell(new Date(l.created_at).toLocaleString()),
    ...(includedStatus ? [escapeCell((l as Lead & { status?: string }).status ?? "new")] : []),
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

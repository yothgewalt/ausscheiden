// RFC 4180 CSV, ~20 lines instead of a dependency. The booking list is already
// in memory on the dashboard, so the export never touches the server.

export type Cell = string | number | null | undefined;

/**
 * Quote a field only when it has to be: a field containing a comma, a double
 * quote or a newline is wrapped in quotes with its own quotes doubled.
 */
function escapeCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Header row + data rows joined with CRLF, as the spec requires. */
export function toCsv(headers: string[], rows: Cell[][]): string {
  return [headers, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n');
}

/**
 * Hand the CSV to the browser as a download.
 *
 * The leading BOM is not optional: without it Excel reads the file as the local
 * ANSI codepage and every Thai name comes out as mojibake.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── self-check: bun src/components/backoffice/csv.ts ───────────────────────
function _demo() {
  const eq = (got: string, want: string, what: string) => {
    if (got !== want) throw new Error(`${what}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  };

  eq(toCsv(['a'], [['plain']]), 'a\r\nplain', 'plain field is not quoted');
  eq(toCsv(['a'], [['x,y']]), 'a\r\n"x,y"', 'comma forces quoting');
  eq(toCsv(['a'], [['say "hi"']]), 'a\r\n"say ""hi"""', 'embedded quotes are doubled');
  eq(toCsv(['a'], [['line1\nline2']]), 'a\r\n"line1\nline2"', 'newline forces quoting');
  eq(toCsv(['a', 'b'], [[null, undefined]]), 'a,b\r\n,', 'null and undefined render empty');
  eq(toCsv(['a'], [[5999]]), 'a\r\n5999', 'numbers pass through unquoted');
  // Thai needs no quoting — it has no delimiter characters — and must not be mangled.
  eq(toCsv(['ชื่อ'], [['สมชาย ใจดี']]), 'ชื่อ\r\nสมชาย ใจดี', 'thai survives untouched');
  // A name with a comma is the realistic break case: "ดร. สมชาย, Ph.D."
  eq(toCsv(['ชื่อ'], [['ดร. สมชาย, Ph.D.']]), 'ชื่อ\r\n"ดร. สมชาย, Ph.D."', 'thai + comma quoted');
  eq(toCsv(['a', 'b'], [['1', '2'], ['3', '4']]), 'a,b\r\n1,2\r\n3,4', 'multiple rows');

  console.log('csv self-check passed');
}

if (import.meta.main) _demo();

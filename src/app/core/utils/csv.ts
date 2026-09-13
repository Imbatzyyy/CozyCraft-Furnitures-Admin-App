/** Protect spreadsheet users from formulas embedded in customer-controlled text. */
export function csvCell(value: string | number | boolean | null | undefined): string {
  let text = String(value ?? '');
  if (typeof value === 'string' && /^[\s\uFEFF]*[=+@-]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

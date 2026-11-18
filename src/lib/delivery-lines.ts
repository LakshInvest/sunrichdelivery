export type PricedLine = { qty: number; line_total?: number | null; value?: number; is_free?: boolean };

/** Preserve the order's discounts/tax rounding; never reconstruct a unit rate. */
export function deliveredLineTotal(line: PricedLine, delivered: number): number {
  if (line.is_free || line.qty <= 0) return 0;
  return Number(line.line_total ?? line.value ?? 0) * Math.max(0, Math.min(line.qty, delivered)) / line.qty;
}

export function schemeName(info: unknown): string {
  if (typeof info === 'string') return info;
  if (Array.isArray(info)) return info.map(schemeName).filter(Boolean).join(', ');
  if (!info || typeof info !== 'object') return '';
  const row = info as Record<string, unknown>;
  for (const key of ['scheme_name', 'name', 'label', 'description']) {
    if (typeof row[key] === 'string') return row[key];
  }
  return '';
}

export function freeLineLabel(info: unknown, lang: string): string {
  const name = schemeName(info);
  if (/free replacement/i.test(name)) return lang === 'hi' ? 'मुफ़्त बदली' : lang === 'mr' ? 'मोफत बदली' : 'Free replacement';
  return name ? `FREE · ${name}` : 'FREE';
}
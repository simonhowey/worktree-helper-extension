import { applyEdits, modify, parse, ParseError } from 'jsonc-parser';

const FORMATTING = { insertSpaces: true, tabSize: 2, eol: '\n' };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Template wins per key. Plain objects merge recursively (local-only keys survive);
 * arrays and scalars are replaced wholesale. `null` in the template deletes the key.
 */
export function mergeTemplateValue(existing: unknown, template: unknown): unknown {
  if (!isPlainObject(template) || !isPlainObject(existing)) {
    return template;
  }
  const out: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(template)) {
    if (v === null) {
      delete out[k];
    } else {
      out[k] = mergeTemplateValue(out[k], v);
    }
  }
  return out;
}

export function parseJsoncStrict(text: string): Record<string, unknown> | undefined {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0 || !isPlainObject(value)) {
    return undefined;
  }
  return value;
}

/**
 * Merge the template's top-level keys into the settings text, editing only keys
 * whose merged value differs — comments and formatting elsewhere are preserved.
 * Keys the template doesn't define (e.g. titlebar colors) are never touched.
 * Returns the new text, or undefined when nothing changed.
 */
export function mergeSettingsText(settingsText: string, template: Record<string, unknown>): string | undefined {
  const existing = parseJsoncStrict(settingsText.trim() === '' ? '{}' : settingsText) ?? {};
  let text = settingsText.trim() === '' ? '{}\n' : settingsText;
  let changed = false;
  for (const [key, tmplValue] of Object.entries(template)) {
    const desired = tmplValue === null ? undefined : mergeTemplateValue(existing[key], tmplValue);
    if (JSON.stringify(existing[key]) === JSON.stringify(desired)) {
      continue;
    }
    text = applyEdits(text, modify(text, [key], desired, { formattingOptions: FORMATTING }));
    changed = true;
  }
  return changed ? text : undefined;
}

/**
 * SHA256 of JSON matching Python json.dumps(obj, sort_keys=True, separators=(', ', ': '))
 */
import { createHash } from 'node:crypto';

function pyStringify(obj: unknown): string {
  if (obj === null) {
    return 'null';
  }
  const t = typeof obj;
  if (t === 'boolean') {
    return obj ? 'true' : 'false';
  }
  if (t === 'number') {
    if (!Number.isFinite(obj as number)) {
      throw new Error('non-finite number');
    }
    return JSON.stringify(obj);
  }
  if (t === 'string') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    const inner = obj.map(x => pyStringify(x)).join(', ');
    return `[${inner}]`;
  }
  if (t === 'object') {
    const keys = Object.keys(obj as object).sort();
    const parts = keys.map(
      k => `${JSON.stringify(k)}: ${pyStringify((obj as Record<string, unknown>)[k])}`
    );
    return `{${parts.join(', ')}}`;
  }
  throw new Error(`unsupported type ${t}`);
}

export function computePluginHashFromObject(obj: Record<string, unknown>): string {
  const s = pyStringify(obj);
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

#!/usr/bin/env node
/**
 * SHA256 of JSON matching Python json.dumps(obj, sort_keys=True, separators=(', ', ': '))
 */
'use strict';

const crypto = require('crypto');

function pyStringify(obj) {
  if (obj === null) return 'null';
  const t = typeof obj;
  if (t === 'boolean') return obj ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isFinite(obj)) throw new Error('non-finite number');
    return JSON.stringify(obj);
  }
  if (t === 'string') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    const inner = obj.map((x) => pyStringify(x)).join(', ');
    return `[${inner}]`;
  }
  if (t === 'object') {
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}: ${pyStringify(obj[k])}`);
    return `{${parts.join(', ')}}`;
  }
  throw new Error(`unsupported type ${t}`);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  const obj = JSON.parse(input);
  const s = pyStringify(obj);
  const h = crypto.createHash('sha256').update(s, 'utf8').digest('hex');
  process.stdout.write(h);
});

#!/usr/bin/env node
/**
 * Merges pluginConfig fragment into global config (same rules as the installer's merge()).
 */
'use strict';

function merge(source, destination, prefix = '') {
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const node = destination[key] !== undefined ? destination[key] : (destination[key] = {});
      merge(value, node, `${prefix}${key}.`);
    } else {
      if (key in destination && destination[key] !== value) {
        throw new Error(`Config key '${prefix + key}' defined differently for 2 dynamic plugins`);
      }
      destination[key] = value;
    }
  }
  return destination;
}

const globalJson = JSON.parse(process.argv[2] || '{}');
const fragJson = JSON.parse(process.argv[3] || '{}');
merge(fragJson, globalJson);
console.log(JSON.stringify(globalJson));

#!/usr/bin/env node
//
// Copyright Red Hat, Inc.
// This program and the accompanying materials are made
// available under the terms of the Eclipse Public License 2.0
// which is available at https://www.eclipse.org/legal/epl-2.0/
//
// SPDX-License-Identifier: EPL-2.0
//
// Format shell scripts with shfmt (mvdan/sh compiled to WASM).
//
// Usage: node scripts/format-sh.mjs [--check|--write] [files...]
//
// Options are read from .editorconfig, the same source the shfmt CLI and
// editor integrations use, so `shfmt .` and this script agree.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { format } from '@wasm-fmt/shfmt';
import { parse } from 'editorconfig';

const args = process.argv.slice(2);
const check = args.includes('--check');
const files = args.filter(arg => !arg.startsWith('--'));

const trackedShellFiles = () =>
  execFileSync('git', ['ls-files', '-z', '--', '*.sh'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);

// Defaults mirror the shfmt CLI, so an unset key means "leave it unset".
const toShfmtOptions = config => ({
  indent: config.indent_style === 'tab' ? 0 : (config.indent_size ?? 0),
  binaryNextLine: config.binary_next_line ?? false,
  switchCaseIndent: config.switch_case_indent ?? false,
  spaceRedirects: config.space_redirects ?? false,
  funcNextLine: config.function_next_line ?? false,
});

const targets = files.length > 0 ? files : trackedShellFiles();
const unformatted = [];
let failed = false;

for (const file of targets) {
  const source = readFileSync(file, 'utf8');
  let output;
  try {
    output = format(source, file, toShfmtOptions(await parse(file)));
  } catch (error) {
    console.error(error.message);
    failed = true;
    continue;
  }
  if (output !== source) {
    if (check) {
      unformatted.push(file);
    } else {
      writeFileSync(file, output);
      console.log(`formatted ${file}`);
    }
  }
}

if (failed) process.exit(2);

if (check && unformatted.length > 0) {
  console.error('Unformatted shell scripts:');
  for (const file of unformatted) console.error(`  ${file}`);
  console.error('Run: yarn --cwd .ci fmt');
  process.exit(1);
}

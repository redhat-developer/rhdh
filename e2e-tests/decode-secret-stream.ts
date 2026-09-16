#!/usr/bin/env node
import {
  chmodSync,
  closeSync,
  fchmodSync,
  mkdirSync,
  openSync,
  readSync,
  writeSync,
} from "node:fs";
import { constants } from "node:fs";
import { resolve, join } from "node:path";

type SecretEntry = { name: string; value: string };

const HEADER: Buffer = Buffer.from("RHDHSEC1");
const FOOTER: Buffer = Buffer.from("RHDHEND1");
const MAX_ENTRIES = 65535;
const MAX_FIELD_BYTES = 8 * 1024 * 1024;
const MAX_STREAM_BYTES = 64 * 1024 * 1024;
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const CERTIFICATE_FILES = new Map<string, string>([
  ["rds_db_certificates_pem", "rds-db-certificates.pem"],
  ["rds_db_certificates__dot__pem", "rds-db-certificates--dot--pem"],
  ["azure_db_certificates_pem", "azure-db-certificates.pem"],
  ["azure_db_certificates__dot__pem", "azure-db-certificates--dot--pem"],
]);

function fail(message: string): never {
  throw new Error(message);
}

function sameBytes(input: Buffer, offset: number, expected: Buffer): boolean {
  return input.subarray(offset, offset + expected.length).equals(expected);
}

function readUint32(input: Buffer, offset: number): number {
  if (offset + 4 > input.length) fail("Secret stream is truncated");
  return input.readUInt32BE(offset);
}

function decodeUtf8(input: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    return fail("Secret stream contains invalid UTF-8");
  }
}

function decode(input: Buffer): SecretEntry[] {
  if (input.length > MAX_STREAM_BYTES) fail("Secret stream is too large");
  if (input.length < HEADER.length + 4) fail("Secret stream header is truncated");
  if (!sameBytes(input, 0, HEADER)) fail("Invalid secret stream header");

  let offset = HEADER.length;
  const count = readUint32(input, offset);
  offset += 4;
  if (count > MAX_ENTRIES) fail("Secret stream contains too many entries");

  const entries: SecretEntry[] = [];
  const names = new Set<string>();
  for (let index = 0; index < count; index++) {
    const nameLength = readUint32(input, offset);
    const valueLength = readUint32(input, offset + 4);
    offset += 8;
    if (nameLength > MAX_FIELD_BYTES || valueLength > MAX_FIELD_BYTES) {
      fail("Secret stream field is too large");
    }
    if (offset + nameLength + valueLength > input.length) {
      fail("Secret stream entry is truncated");
    }

    const name = decodeUtf8(input.subarray(offset, offset + nameLength));
    offset += nameLength;
    const value = decodeUtf8(input.subarray(offset, offset + valueLength));
    offset += valueLength;
    if (!ENVIRONMENT_NAME.test(name) || name.includes("\0") || value.includes("\0")) {
      fail("Secret stream contains an invalid entry");
    }
    if (names.has(name)) fail("Secret stream contains duplicate entries");
    names.add(name);
    entries.push({ name, value });
  }

  if (offset + FOOTER.length > input.length) {
    fail("Secret stream footer is truncated");
  }
  if (!sameBytes(input, offset, FOOTER)) fail("Invalid secret stream footer");
  offset += FOOTER.length;
  if (offset !== input.length) fail("Secret stream contains trailing data");
  return entries;
}

function readStreamInput(): Buffer {
  const input = Buffer.allocUnsafe(MAX_STREAM_BYTES + 1);
  let offset = 0;
  while (offset < input.length) {
    const bytesRead = readSync(0, input, offset, input.length - offset, null);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset === input.length) fail("Secret stream is too large");
  return input.subarray(0, offset);
}

function writeSecret(directory: string, name: string, value: string): void {
  const filename = CERTIFICATE_FILES.get(name) ?? name;
  const path = join(directory, filename);
  const flags =
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0);
  let fileDescriptor;
  try {
    fileDescriptor = openSync(path, flags, 0o600);
    const bytes = Buffer.from(value);
    let offset = 0;
    while (offset < bytes.length) {
      offset += writeSync(fileDescriptor, bytes, offset);
    }
    fchmodSync(fileDescriptor, 0o600);
  } finally {
    if (fileDescriptor !== undefined) closeSync(fileDescriptor);
  }
}

function main(): void {
  const directory = process.argv[2];
  if (!directory) fail("Secret output directory is required");
  const resolvedDirectory = resolve(directory);
  mkdirSync(resolvedDirectory, { recursive: true, mode: 0o700 });
  chmodSync(resolvedDirectory, 0o700);
  for (const entry of decode(readStreamInput())) {
    writeSecret(resolvedDirectory, entry.name, entry.value);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  process.stderr.write(`Secret stream decode failed: ${message}\n`);
  process.exitCode = 1;
}

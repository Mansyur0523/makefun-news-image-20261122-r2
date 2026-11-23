// makefun-news-image-20261122-r2 — PNG copy + validator (Node stdlib only).
// Reads entry.png next to this file, validates the PNG structure, copies it
// byte-identical to $MAKEFUN_OUTPUT_DIR/entry.png (default /output),
// then re-verifies the output sha256. Never writes into the repo.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_DIR = dirname(fileURLToPath(import.meta.url));
const SRC = join(REPO_DIR, "entry.png");
const OUT_DIR = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? "/output");
const OUT = join(OUT_DIR, "entry.png");

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// CRC-32 (IEEE 802.3) table, built once.
const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function fail(msg: string): never {
  console.error("ERROR: " + msg);
  process.exit(1);
}

function validatePng(buf: Buffer): void {
  if (buf.length < 8 + 25) fail("file too small to be a PNG");
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(magic)) fail("bad PNG magic");
  if (buf.length > 1024 * 1024) fail("PNG exceeds 1 MiB: " + buf.length + " bytes");
  let off = 8;
  let first = true;
  let sawIdat = false;
  let sawIend = false;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    if (off + 12 + len > buf.length) fail("truncated chunk " + type);
    const data = buf.subarray(off + 8, off + 8 + len);
    const storedCrc = buf.readUInt32BE(off + 8 + len);
    const expect = crc32(Buffer.concat([Buffer.from(type, "latin1"), data]));
    if (storedCrc !== expect) fail("CRC mismatch in chunk " + type);
    if (first) {
      if (type !== "IHDR") fail("first chunk is not IHDR");
      const w = data.readUInt32BE(0);
      const h = data.readUInt32BE(4);
      if (w > 1024 || h > 1024) fail(`dimensions ${w}x${h} exceed 1024`);
      if (w !== 1024 || h !== 1024) fail(`expected 1024x1024, got ${w}x${h}`);
      const bitDepth = data[8];
      const colorType = data[9];
      if (bitDepth !== 8 || colorType !== 2) {
        fail(`expected 8-bit RGB (depth 8, type 2), got depth ${bitDepth}, type ${colorType}`);
      }
      first = false;
    }
    if (type === "IDAT") sawIdat = true;
    if (type === "IEND") {
      sawIend = true;
      if (off + 12 + len !== buf.length) fail("trailing data after IEND");
      break;
    }
    off += 12 + len;
  }
  if (!sawIdat) fail("no IDAT chunk");
  if (!sawIend) fail("no IEND chunk at end");
}

function main(): void {
  // Guard: never write into the repo (or cwd).
  const repoRoot = resolve(REPO_DIR) + sep;
  const cwdRoot = resolve(process.cwd()) + sep;
  if ((OUT_DIR + sep).startsWith(repoRoot) || OUT.startsWith(repoRoot)) {
    fail("refusing to write output inside the repo: " + OUT);
  }
  if ((OUT_DIR + sep).startsWith(cwdRoot) || OUT.startsWith(cwdRoot)) {
    fail("refusing to write output inside the working directory: " + OUT);
  }
  if (!existsSync(SRC)) fail("entry.png not found next to main.ts");
  const src = readFileSync(SRC);
  validatePng(src);
  const srcHash = sha256(src);
  mkdirSync(OUT_DIR, { recursive: true });
  copyFileSync(SRC, OUT);
  const out = readFileSync(OUT);
  const outHash = sha256(out);
  if (outHash !== srcHash) fail(`output sha256 mismatch: ${outHash} != ${srcHash}`);
  console.log(`OK entry.png 1024x1024 RGB ${src.length} bytes sha256 ${srcHash} -> ${OUT}`);
}

main();

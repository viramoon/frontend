import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeSync } from 'node:fs';
import { posix } from 'node:path';
import process from 'node:process';
import { promisify, TextDecoder } from 'node:util';
import {
  actionReferences,
  checkActionReferences,
  isActionDefinition,
} from './data-guard-actions.mjs';

const maxBlobSize = 256 * 1024;
const objectId = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const zeroId = /^0+$/;
const textDecoder = new TextDecoder('utf-8', { fatal: true });
const execute = promisify(execFile);
const allowlistPath = 'scripts/data-guard-allowlist.json';

const restrictedPath =
  /(?:^|\/)(?:screenshots?|screen[-_]?(?:shots?|recordings?|captures?)|captures?|recordings?|traces?|snapshots?|__snapshots__|(?:visual|playwright|test|blob)[-_](?:reports?|results?|artifacts?|output)|artifacts?|data|data-paper|datasets?|exports?|dumps?|backups?|logs?)(?:\/|$)/i;
const restrictedFormat =
  /\.(?:png|jpe?g|gif|webp|avif|apng|bmp|tiff?|ico|heic|heif|svgz?|xpm|xbm|pbm|pgm|ppm|pnm|pam|pdf|psd|mp[34]|m4v|mov|mkv|avi|webm|ogg|wav|flac|har|snap|log|dmp|dump|sql|db|sqlite[3]?|parquet|arrow|feather|orc|avro|csv|tsv|jsonl|ndjson|zip|gz|tgz|tar|xz|bz2|zst|7z|rar)(?:$|[.\s])/i;
const textExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.sh',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);
const textPaths = new Set([
  '.githooks/pre-commit',
  '.githooks/pre-push',
  '.gitignore',
  '.node-version',
  '.prettierignore',
  'openapi/web.commit',
]);
const fixturePath = /fixture|(?:^|\/)(?:replays?|samples?)(?:[./_-]|$)/i;
const fixtureSources = new Map([
  [
    'src/features/market/marketFixture.ts',
    '// Deterministic synthetic offsets and volumes, without vendor or historical data.',
  ],
]);

async function git(args, { input, optional = false, binary = false } = {}) {
  const result = execute('git', ['--no-replace-objects', ...args], {
    encoding: binary ? 'buffer' : 'utf8',
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
    maxBuffer: 16 * 1024 * 1024,
  });
  result.child.stdin?.end(input);
  try {
    return (await result).stdout;
  } catch (error) {
    if (optional && error.code === 1) return undefined;
    throw new Error(`Git ${args[0]} failed`);
  }
}

function parseEntries(rows) {
  return rows
    .split('\0')
    .filter(Boolean)
    .map((row) => {
      const separator = row.indexOf('\t');
      const [mode, second, third] = row.slice(0, separator).split(' ');
      const oid = objectId.test(second) ? second : third;
      if (separator < 0 || !objectId.test(oid))
        throw new Error('Invalid Git entry');
      return { mode, oid, path: row.slice(separator + 1) };
    });
}

async function commitId(ref, optional = false) {
  const result = await git(
    ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`],
    {
      optional,
    },
  );
  return result?.trim();
}

async function range(base, tip) {
  const head = await commitId(tip);
  const revisions = [head];
  // A new ref or an unavailable remote tip has no local exclusion boundary.
  const previous = base && !zeroId.test(base) && (await commitId(base, true));
  if (previous) revisions.push(`^${previous}`);
  return [
    head,
    ...(await git(['rev-list', ...revisions]))
      .trim()
      .split('\n')
      .filter(Boolean),
  ];
}

async function pushedCommits() {
  const updates = readFileSync(0, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((row) => {
      const fields = row.split(' ');
      const [, local, , remote] = fields;
      if (
        fields.length !== 4 ||
        !objectId.test(local) ||
        !objectId.test(remote)
      ) {
        throw new Error('Invalid pre-push ref update');
      }
      return { local, remote };
    });
  const commits = new Set();
  for (const { local, remote } of updates) {
    if (zeroId.test(local)) continue;
    for (const commit of await range(remote, local)) commits.add(commit);
  }
  return commits;
}

async function* snapshots(args) {
  if (args.length === 1 && args[0] === '--staged') {
    yield parseEntries(await git(['ls-files', '--stage', '-z']));
    return;
  }
  if (args.length === 1 && args[0] === '--push') {
    for (const commit of await pushedCommits()) {
      yield parseEntries(await git(['ls-tree', '-rz', commit]));
    }
    return;
  }
  if (args.length === 3 && args[0] === '--range') {
    for (const commit of new Set(await range(args[1], args[2]))) {
      yield parseEntries(await git(['ls-tree', '-rz', commit]));
    }
    return;
  }
  throw new Error('Expected --staged, --push or --range BASE HEAD');
}

function isRegular({ mode }) {
  return mode === '100644' || mode === '100755';
}

function pathRule(entry, digest) {
  const { path } = entry;
  if (!isRegular(entry)) return 'non-regular-file';
  if (restrictedPath.test(path)) return 'restricted-path';
  if (!digest && restrictedFormat.test(path)) return 'restricted-format';
  if (fixturePath.test(path) && !fixtureSources.has(path))
    return 'fixture-provenance';
}

async function readAllowlist(entries, report) {
  const entry = entries.get(allowlistPath);
  if (!entry) return new Map();

  try {
    if (
      !isRegular(entry) ||
      Number(await git(['cat-file', '-s', entry.oid])) > maxBlobSize
    ) {
      throw new Error('Invalid allowlist blob');
    }
    const bytes = await git(['cat-file', 'blob', entry.oid], { binary: true });
    const records = JSON.parse(textDecoder.decode(bytes));
    if (!Array.isArray(records)) throw new Error('Expected allowlist entries');

    const allowlist = new Map();
    for (const { path, sha256, source } of records) {
      if (
        typeof path !== 'string' ||
        path === allowlistPath ||
        !entries.has(path) ||
        allowlist.has(path) ||
        isActionDefinition(path) ||
        fixturePath.test(path) ||
        typeof sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(sha256) ||
        typeof source !== 'string' ||
        !source.trim()
      ) {
        throw new Error('Invalid allowlist entry');
      }
      allowlist.set(path, sha256);
    }
    return allowlist;
  } catch {
    report(allowlistPath, 'allowlist-invalid');
    return new Map();
  }
}

function marketFields(fields) {
  const keys = new Set(fields.map((field) => field.trim().toLowerCase()));
  return (
    ['timestamp', 'time', 'ts', 'date', 'event_time', 'as_of'].some((key) =>
      keys.has(key),
    ) &&
    [
      'open',
      'high',
      'low',
      'close',
      'bid',
      'ask',
      'price',
      'volume',
      'qty',
      'size',
    ].filter((key) => keys.has(key)).length >= 2
  );
}

function isMarketExport(content) {
  const firstLine = content.trimStart().split(/\r?\n/, 1)[0];
  if (marketFields(firstLine.replaceAll('"', '').split(/[,\t;|]/))) return true;
  if (!firstLine.startsWith('[') && !firstLine.startsWith('{')) return false;

  try {
    const data = JSON.parse(content);
    const isRecord = (value) =>
      value && typeof value === 'object' && marketFields(Object.keys(value));
    if (Array.isArray(data)) return data.some(isRecord);
    return (
      isRecord(data) ||
      Object.values(data).some(
        (value) => Array.isArray(value) && value.some(isRecord),
      )
    );
  } catch {
    return false;
  }
}

function isTextMedia(content) {
  const start = content.trimStart();
  if (
    /^(?:GIF8[79]a|%PDF-|%!PS|OggS|fLaC|#!AMR\b|RIFF[\s\S]{4}(?:WEBP|WAVE|AVI ))/.test(
      start,
    ) ||
    /^P[1-7](?=[ \t\r\n#])/.test(start) ||
    /^(?:\/\*\s*XPM\s*\*\/|!\s*XPM2(?=\s|$))/.test(start) ||
    (/^#define[ \t]+\w+_width[ \t]+\d+/m.test(start) &&
      /^#define[ \t]+\w+_height[ \t]+\d+/m.test(start))
  ) {
    return true;
  }

  // Consume complete XML processing instructions and comments before the root.
  const prologueToken = /(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->)\s*/y;
  let rootOffset = 0;
  while (prologueToken.test(start)) rootOffset = prologueToken.lastIndex;
  return /^<(?:!DOCTYPE\s+)?(?:[\w.-]+:)?svg(?=\s|[/>]|\[)/i.test(
    start.slice(rootOffset),
  );
}

function contentRule(path, bytes, digest) {
  if (digest && createHash('sha256').update(bytes).digest('hex') !== digest) {
    return 'allowlist-digest';
  }
  let content;
  try {
    content = textDecoder.decode(bytes);
  } catch {
    return digest ? undefined : 'binary-content';
  }
  if (
    bytes.some(
      (byte) =>
        byte === 127 || (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13),
    )
  ) {
    return digest ? undefined : 'binary-content';
  }
  if (/^\s*version https:\/\/git-lfs\.github\.com\/spec\/v1\b/.test(content))
    return 'lfs-pointer';
  if (!digest) {
    if (isTextMedia(content)) return 'media-content';
    if (/data:(?:image|video|audio)\/[^\s,;]+[;,]/i.test(content))
      return 'embedded-media';
    if (/(?:iVBORw0KGgo|R0lGOD[lh]|\/9j\/)[a-z0-9+/]{24,}/i.test(content))
      return 'embedded-media';
    if (
      /\.md$/i.test(path) &&
      /!\[|<(?:img|video|picture|svg|audio)\b/i.test(content)
    )
      return 'embedded-media';
  }
  if (isMarketExport(content)) return 'market-export';
  const source = fixtureSources.get(path);
  if (source && !content.split(/\r?\n/).includes(source))
    return 'fixture-provenance';
  if (
    !digest &&
    !textPaths.has(path) &&
    !textExtensions.has(posix.extname(path).toLowerCase()) &&
    !/^(?:LICENSE|NOTICE)$/.test(posix.basename(path))
  ) {
    return 'unclassified-text';
  }
}

async function blobSizes(entries) {
  const ids = [...new Set(entries.map(({ oid }) => oid))];
  const metadata = await git(['cat-file', '--batch-check'], {
    input: `${ids.join('\n')}\n`,
  });
  return new Map(
    metadata
      .trimEnd()
      .split('\n')
      .map((row) => {
        const [oid, type, size] = row.split(' ');
        if (type !== 'blob' || !/^\d+$/.test(size))
          throw new Error('Missing Git blob');
        return [oid, Number(size)];
      }),
  );
}

async function inspectBlob({ path, oid, digest }, size) {
  if (size > maxBlobSize) return { rule: 'blob-size' };
  const bytes = await git(['cat-file', 'blob', oid], { binary: true });
  const rule = contentRule(path, bytes, digest);
  if (rule || !isActionDefinition(path)) return { rule };
  try {
    return { definition: actionReferences(path, textDecoder.decode(bytes)) };
  } catch {
    return { rule: 'action-yaml' };
  }
}

async function checkSnapshot(entries, inspected, report) {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  if (byPath.size !== entries.length)
    throw new Error('Ambiguous Git snapshot paths');
  const allowlist = await readAllowlist(byPath, report);
  const candidates = [];
  const records = [];
  for (const entry of entries) {
    const digest = allowlist.get(entry.path);
    const key = JSON.stringify([entry.path, entry.mode, entry.oid, digest]);
    const record = { ...entry, digest, key };
    records.push(record);
    if (inspected.has(key)) continue;
    const rule = pathRule(entry, digest);
    if (rule) inspected.set(key, { rule });
    else candidates.push(record);
  }
  if (candidates.length) {
    const sizes = await blobSizes(candidates);
    for (const record of candidates) {
      inspected.set(
        record.key,
        await inspectBlob(record, sizes.get(record.oid)),
      );
    }
  }

  const definitions = new Map();
  for (const { path, key } of records) {
    const { rule, definition } = inspected.get(key);
    if (rule) report(path, rule);
    if (definition) definitions.set(path, definition);
  }
  // References must resolve in each snapshot, even when the caller blob is unchanged.
  checkActionReferences(definitions, report);
}

async function check(args) {
  const inspected = new Map();
  const violations = new Set();
  function report(path, rule) {
    const message = `${rule} ${JSON.stringify(path)}`;
    if (violations.has(message)) return;
    violations.add(message);
    writeSync(2, `data-guard: ${message}\n`);
  }

  for await (const entries of snapshots(args)) {
    await checkSnapshot(entries, inspected, report);
  }
  if (violations.size) {
    writeSync(2, `data-guard: ${violations.size} violation(s)\n`);
    process.exitCode = 1;
  } else {
    writeSync(1, 'data-guard: passed\n');
  }
}

try {
  await check(process.argv.slice(2));
} catch (error) {
  writeSync(2, `data-guard: ${error.message}\n`);
  process.exitCode = 2;
}

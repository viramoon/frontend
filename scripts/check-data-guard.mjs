import { execFile } from 'node:child_process';
import { readFileSync, writeSync } from 'node:fs';
import process from 'node:process';
import { promisify, TextDecoder } from 'node:util';

const maxBlobSize = 256 * 1024;
const objectId = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const zeroId = /^0+$/;
const textDecoder = new TextDecoder('utf-8', { fatal: true });
const execute = promisify(execFile);

const restrictedPath =
  /(?:^|\/)(?:screenshots?|screen[-_]?(?:shots?|recordings?|captures?)|captures?|recordings?|traces?|snapshots?|__snapshots__|(?:visual|playwright|test|blob)[-_](?:reports?|results?|artifacts?|output)|artifacts?|data|data-paper|datasets?|exports?|dumps?|backups?|logs?)(?:\/|$)/i;
const restrictedFormat =
  /\.(?:png|jpe?g|gif|webp|avif|apng|bmp|tiff?|ico|heic|heif|svgz?|pbm|pgm|ppm|pnm|pam|pdf|psd|mp[34]|m4v|mov|mkv|avi|webm|ogg|wav|flac|har|snap|log|dmp|dump|sql|db|sqlite[3]?|parquet|arrow|feather|orc|avro|csv|tsv|jsonl|ndjson|zip|gz|tgz|tar|xz|bz2|zst|7z|rar)(?:$|[.\s])/i;
const githubActionPath = /^\.github\/(?:workflows|actions)\//;
const artifactUploadAction =
  /\bactions\/upload-(?:artifact|release-asset)(?![\w.-])/i;
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

function pathRule({ mode, path }) {
  if (mode !== '100644' && mode !== '100755') return 'non-regular-file';
  if (restrictedPath.test(path)) return 'restricted-path';
  if (restrictedFormat.test(path)) return 'restricted-format';
  if (fixturePath.test(path) && !fixtureSources.has(path))
    return 'fixture-provenance';
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
    /^(?:GIF8[79]a|%PDF-)/i.test(start) ||
    /^P[1-7](?=[ \t\r\n#])/.test(start)
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

function contentRule(path, bytes) {
  let content;
  try {
    content = textDecoder.decode(bytes);
  } catch {
    return 'binary-content';
  }
  if (
    bytes.some((byte) => byte < 32 && byte !== 9 && byte !== 10 && byte !== 13)
  ) {
    return 'binary-content';
  }
  if (/^\s*version https:\/\/git-lfs\.github\.com\/spec\/v1\b/.test(content))
    return 'lfs-pointer';
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
  // Check the action reference itself independently of YAML key syntax.
  if (githubActionPath.test(path) && artifactUploadAction.test(content)) {
    return 'artifact-upload';
  }
  if (isMarketExport(content)) return 'market-export';
  const source = fixtureSources.get(path);
  if (source && !content.split(/\r?\n/).includes(source))
    return 'fixture-provenance';
}

async function check(args) {
  const checked = new Set();
  let violations = 0;
  function report(path, rule) {
    violations += 1;
    writeSync(2, `data-guard: ${rule} ${JSON.stringify(path)}\n`);
  }

  for await (const entries of snapshots(args)) {
    const candidates = [];
    for (const entry of entries) {
      const key = `${entry.mode} ${entry.oid} ${entry.path}`;
      if (checked.has(key)) continue;
      checked.add(key);
      const rule = pathRule(entry);
      if (rule) report(entry.path, rule);
      else candidates.push(entry);
    }
    if (candidates.length === 0) continue;

    const ids = [...new Set(candidates.map(({ oid }) => oid))];
    const metadata = await git(['cat-file', '--batch-check'], {
      input: `${ids.join('\n')}\n`,
    });
    const sizes = new Map(
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

    for (const { oid, path } of candidates) {
      const rule =
        sizes.get(oid) > maxBlobSize
          ? 'blob-size'
          : contentRule(
              path,
              await git(['cat-file', 'blob', oid], { binary: true }),
            );
      if (rule) report(path, rule);
    }
  }
  if (violations) {
    writeSync(2, `data-guard: ${violations} violation(s)\n`);
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

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { promisify } from 'node:util';

const marker = 'SYNTHETIC_BODY_MUST_NOT_APPEAR_IN_DIAGNOSTICS';
const zeroId = '0'.repeat(40);
const source = 'src/features/market/marketFixture.ts';
const syntheticSource =
  '// Deterministic synthetic offsets and volumes, without vendor or historical data.\nexport const seed = 16n;\n';
const execute = promisify(execFile);

async function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'frontend-guard-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  async function run(command, args, input) {
    const result = execute(command, args, { cwd, encoding: 'utf8' });
    result.child.stdin?.end(input);
    try {
      return { status: 0, ...(await result) };
    } catch (error) {
      if (typeof error.code !== 'number') throw error;
      return { status: error.code, stdout: error.stdout, stderr: error.stderr };
    }
  }

  async function git(...args) {
    const result = await run('git', args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }

  function write(path, content) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }

  await git('init', '-q', '--object-format=sha1');
  await git('config', 'user.name', 'Synthetic Test');
  await git('config', 'user.email', 'synthetic@example.invalid');
  await git('config', 'commit.gpgsign', 'false');
  await git('config', 'core.hooksPath', '.githooks');
  for (const path of [
    'scripts/check-data-guard.mjs',
    '.githooks/pre-commit',
    '.githooks/pre-push',
  ]) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    copyFileSync(new URL(`../${path}`, import.meta.url), join(cwd, path));
  }

  write('README.md', 'Synthetic test repository\n');
  await git('add', 'README.md');
  await git('commit', '-qm', 'Add clean base');
  const base = await git('rev-parse', 'HEAD');
  return { cwd, git, write, run, base };
}

function checkRejected(result, rule) {
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, new RegExp(`data-guard: ${rule} `));
  assert.ok(!(result.stdout + result.stderr).includes(marker));
}

function proposedUpdate(local, remote, ref = 'refs/heads/test') {
  return `${ref} ${local} ${ref} ${remote}\n`;
}

test('pre-commit accepts the reviewed generator and checks index bytes, not the worktree', async (t) => {
  const { git, run, write } = await repository(t);
  write(source, syntheticSource);
  write('notes.txt', 'staged text\n');
  await git('add', source, 'notes.txt');
  write('notes.txt', Buffer.from([0, 1, 2]));
  await git('commit', '-qm', 'Commit staged clean input');

  write('notes.txt', Buffer.from(`\0${marker}`));
  await git('add', 'notes.txt');
  write('notes.txt', 'clean worktree\n');
  checkRejected(
    await run('git', ['commit', '-qm', 'Commit staged binary input']),
    'binary-content',
  );
});

test('staged policy blocks captures, exports, hidden blobs, LFS, and CI uploads without echoing bodies', async (t) => {
  const { cwd, git, write, run } = await repository(t);
  const rejected = [
    ['doc/notes.PnG.txt', marker, 'restricted-format'],
    ['test-results/result.txt', marker, 'restricted-path'],
    ['blob-report/result.txt', marker, 'restricted-path'],
    ['misc/terminal.WEBM', marker, 'restricted-format'],
    ['exports/table.txt', marker, 'restricted-path'],
    ['reports/bars.parquet', marker, 'restricted-format'],
    [
      'wrapped\nimage.txt',
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      'binary-content',
    ],
    ['plain-text.txt', `GIF89a${marker}`, 'media-content'],
    ['asset.txt', `PK\x03\x04${marker}`, 'binary-content'],
    ['slides.txt', `data:${'image'}/png;base64,${marker}`, 'embedded-media'],
    ['README.md.copy.md', `<${'img'} src="${marker}">`, 'embedded-media'],
    [
      'pointer.txt',
      `version https://${'git-lfs.github.com'}/spec/v1\noid sha256:${marker}`,
      'lfs-pointer',
    ],
    [
      'market.txt',
      `timestamp,symbol,bid,ask\n2026-01-01,DEMO,1,2\n${marker}\n`,
      'market-export',
    ],
    [
      'feed.txt',
      JSON.stringify({ bars: [{ time: marker, close: '1.50', volume: '2' }] }),
      'market-export',
    ],
    ['oversize.txt', marker.repeat(9000), 'blob-size'],
    ['src/testing/fixtures/market.ts', syntheticSource, 'fixture-provenance'],
    [source, `// ${marker}\n`, 'fixture-provenance'],
    [
      '.github/workflows/report.yml',
      `steps:\n  - uses: 'actions/upload-artifact@v4'\n    name: ${marker}\n`,
      'artifact-upload',
    ],
  ];
  for (const [path, content] of rejected) write(path, content);
  symlinkSync('README.md', join(cwd, 'linked.txt'));
  await git('add', '--all');

  const guard = await run(process.execPath, [
    'scripts/check-data-guard.mjs',
    '--staged',
  ]);
  for (const [path, , rule] of rejected) {
    checkRejected(guard, rule);
    assert.ok(guard.stderr.includes(`${rule} ${JSON.stringify(path)}`));
  }
  checkRejected(guard, 'non-regular-file');
  assert.match(guard.stderr, /19 violation\(s\)/);
});

test('pre-push and CI reject a renamed capture removed from an earlier outgoing commit', async (t) => {
  const { git, write, run, base } = await repository(t);
  write('notes.txt', Buffer.from(`\0${marker}`));
  await git('add', 'notes.txt');
  await git(
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '-qm',
    'Seed synthetic forbidden capture',
  );
  await git('rm', '-q', 'notes.txt');
  await git('commit', '-qm', 'Remove synthetic forbidden capture');
  const head = await git('rev-parse', 'HEAD');
  const cleanRef = proposedUpdate(base, zeroId, 'refs/heads/clean');

  for (const remote of [base, zeroId, 'a'.repeat(40)]) {
    checkRejected(
      await run(
        './.githooks/pre-push',
        [],
        cleanRef + proposedUpdate(head, remote),
      ),
      'binary-content',
    );
  }
  checkRejected(
    await run(process.execPath, [
      'scripts/check-data-guard.mjs',
      '--range',
      base,
      head,
    ]),
    'binary-content',
  );
  assert.equal(
    (await run('./.githooks/pre-push', [], proposedUpdate(zeroId, head)))
      .status,
    0,
  );
  assert.equal((await run('./.githooks/pre-push', [], cleanRef)).status, 0);
});

test('pre-push peels annotated tags and checks the same Git blobs', async (t) => {
  const { git, write, run, base } = await repository(t);
  write('docs/capture.png', marker);
  await git('add', 'docs/capture.png');
  await git(
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '-qm',
    'Seed synthetic forbidden capture',
  );
  const head = await git('rev-parse', 'HEAD');
  const tag = await run(
    'git',
    ['mktag'],
    `object ${head}\ntype commit\ntag synthetic\ntagger Synthetic Test <synthetic@example.invalid> 1700000000 +0000\n\nSynthetic tag object\n`,
  );
  assert.equal(tag.status, 0, tag.stderr);
  checkRejected(
    await run(
      './.githooks/pre-push',
      [],
      proposedUpdate(tag.stdout.trim(), base, 'refs/tags/synthetic'),
    ),
    'restricted-format',
  );
});

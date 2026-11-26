import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const marker = 'SYNTHETIC_BODY_MUST_NOT_APPEAR_IN_DIAGNOSTICS';
const zeroId = '0'.repeat(40);
const source = 'src/features/market/marketFixture.ts';
const syntheticSource =
  '// Deterministic synthetic offsets and volumes, without vendor or historical data.\nexport const seed = 16n;\n';
const allowlistPath = 'scripts/data-guard-allowlist.json';
// Pillow-generated 1 × 1 RGB PNG with color (43, 119, 166).
const syntheticPng = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.from(
    'AAAADUlIRFIAAAABAAAAAQgCAAAAkHdT3gAAAAxJREFUeJxj0C5fBgACGQFJ1f0e+gAAAABJRU5ErkJggg==',
    'base64',
  ),
]);
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
    'scripts/data-guard-actions.mjs',
    '.githooks/pre-commit',
    '.githooks/pre-push',
  ]) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    copyFileSync(new URL(`../${path}`, import.meta.url), join(cwd, path));
  }
  mkdirSync(join(cwd, 'node_modules'));
  write('.git/info/exclude', '/node_modules/\n');
  symlinkSync(
    fileURLToPath(new URL('../node_modules/js-yaml', import.meta.url)),
    join(cwd, 'node_modules/js-yaml'),
    'dir',
  );

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

test('staged policy blocks SVG with an XML prologue and plain Netpbm images', async (t) => {
  const { git, write, run } = await repository(t);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${marker} -->\n<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>`;
  const ppm = `P3\n# ${marker}\n1 1\n255\n0 0 0\n`;
  for (const [path, content, rule] of [
    ['drawing.txt', svg, 'media-content'],
    ['raster.ppm', ppm, 'restricted-format'],
    ['raster.txt', ppm, 'media-content'],
  ]) {
    await t.test(path, async () => {
      write(path, content);
      await git('add', path);
      const guard = await run(process.execPath, [
        'scripts/check-data-guard.mjs',
        '--staged',
      ]);
      checkRejected(guard, rule);
      assert.ok(guard.stderr.includes(`${rule} ${JSON.stringify(path)}`));
      await git('restore', '--staged', path);
    });
  }
});

test('staged policy blocks artifact uploads regardless of YAML uses key quoting', async (t) => {
  const { git, write, run } = await repository(t);
  const path = '.github/workflows/report.yml';
  for (const key of ["'uses'", '"uses"']) {
    await t.test(key, async () => {
      write(
        path,
        `name: ${marker}\non: workflow_dispatch\njobs:\n  report:\n    runs-on: ubuntu-latest\n    steps:\n      - ${key}: actions/upload-artifact@v4\n`,
      );
      await git('add', path);
      const guard = await run(process.execPath, [
        'scripts/check-data-guard.mjs',
        '--staged',
      ]);
      checkRejected(guard, 'artifact-upload');
      assert.ok(
        guard.stderr.includes(`artifact-upload ${JSON.stringify(path)}`),
      );
    });
  }
});

test('staged policy blocks named and renamed XPM images and unknown file types', async (t) => {
  const { git, write, run } = await repository(t);
  const xpm = `/* XPM */\n/* ${marker} */\nstatic char * image[] = {\n"2 1 2 1",\n". c #000000",\n"+ c #ffffff",\n".+"};\n`;
  const rejected = [
    ['picture.xpm', xpm, 'restricted-format'],
    ['picture.txt', xpm, 'media-content'],
    ['payload.unknown', marker, 'unclassified-text'],
  ];
  for (const [path, content] of rejected) write(path, content);
  await git('add', ...rejected.map(([path]) => path));
  const guard = await run(process.execPath, [
    'scripts/check-data-guard.mjs',
    '--staged',
  ]);
  for (const [path, , rule] of rejected) {
    await t.test(path, () => {
      checkRejected(guard, rule);
      assert.ok(guard.stderr.includes(`${rule} ${JSON.stringify(path)}`));
    });
  }
});

test('staged and range checks reject artifact uploads in a local action outside .github', async (t) => {
  const { git, write, run, base } = await repository(t);
  const workflow = '.github/workflows/report.yml';
  const action = 'tools/report/action.yaml';
  write(
    workflow,
    'jobs:\n  main:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./tools/report\n',
  );
  write(
    action,
    `name: ${marker}\nruns:\n  using: composite\n  steps:\n    - "uses": "actions/\\u0075pload-artifact@v4"\n`,
  );
  await git('add', workflow, action);
  await t.test('staged local action', async () => {
    const result = await run('./.githooks/pre-commit', []);
    checkRejected(result, 'artifact-upload');
    assert.ok(
      result.stderr.includes(`artifact-upload ${JSON.stringify(action)}`),
    );
  });
  await git(
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '-qm',
    'Add synthetic upload action',
  );
  await t.test('committed local action', async () => {
    const result = await run(process.execPath, [
      'scripts/check-data-guard.mjs',
      '--range',
      base,
      'HEAD',
    ]);
    checkRejected(result, 'artifact-upload');
    assert.ok(
      result.stderr.includes(`artifact-upload ${JSON.stringify(action)}`),
    );
  });
});

test('the allowlist approves only the registered path and staged SHA-256', async (t) => {
  const { git, write, run } = await repository(t);
  const icon = 'public/synthetic.png';
  const otherPath = 'public/copy.png';
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  write(
    allowlistPath,
    JSON.stringify([
      { path: icon, sha256, source: 'Synthetic bytes for a policy test' },
    ]),
  );
  await git('add', allowlistPath);
  await git('commit', '-qm', 'Approve exact synthetic icon separately');
  write(icon, bytes);
  await git('add', icon);

  write(icon, Buffer.from(marker));
  write(allowlistPath, '[]');
  const staged = await run('./.githooks/pre-commit', []);
  assert.equal(staged.status, 0, staged.stderr);

  await git('add', icon);
  const changed = await run('./.githooks/pre-commit', []);
  checkRejected(changed, 'allowlist-digest');
  assert.ok(
    changed.stderr.includes(`allowlist-digest ${JSON.stringify(icon)}`),
  );

  write(icon, bytes);
  write(otherPath, bytes);
  await git('add', icon, otherPath);
  const copied = await run('./.githooks/pre-commit', []);
  checkRejected(copied, 'restricted-format');
  assert.ok(
    copied.stderr.includes(`restricted-format ${JSON.stringify(otherPath)}`),
  );

  await git('restore', '--staged', otherPath, icon);
  await git('add', allowlistPath);
  await git('commit', '-qm', 'Revoke approval before staging a new icon');
  await git('add', icon);
  const removed = await run('./.githooks/pre-commit', []);
  checkRejected(removed, 'restricted-format');
  assert.ok(
    removed.stderr.includes(`restricted-format ${JSON.stringify(icon)}`),
  );
});

test('a matching allowlist entry cannot approve a capture in the same commit or PR', async (t) => {
  const { git, write, run, base } = await repository(t);
  const path = 'public/synthetic.png';
  const sha256 = createHash('sha256').update(syntheticPng).digest('hex');
  const manifestBody = JSON.stringify([{ path, sha256, source: marker }]);
  const scanRange = () =>
    run(process.execPath, [
      'scripts/check-data-guard.mjs',
      '--range',
      base,
      'HEAD',
    ]);
  function rejectsCapture(result) {
    checkRejected(result, 'allowlist-change');
    checkRejected(result, 'restricted-format');
    assert.ok(
      result.stderr.includes(`restricted-format ${JSON.stringify(path)}`),
    );
  }

  await git('update-ref', 'refs/remotes/origin/main', base);
  write(path, syntheticPng);
  write(allowlistPath, manifestBody);
  await git('add', path, allowlistPath);
  await t.test('same index', async () => {
    rejectsCapture(await run('./.githooks/pre-commit', []));
  });
  await git(
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '-qm',
    'Seed synthetic capture and manifest',
  );
  await t.test('same PR commit', async () => {
    rejectsCapture(await scanRange());
  });

  await git('checkout', '-qb', 'separate-approval', base);
  write(allowlistPath, manifestBody);
  await git('add', allowlistPath);
  await git('commit', '-qm', 'Seed a pending manifest review');
  const pending = await git('rev-parse', 'HEAD');
  write(path, syntheticPng);
  await git('add', path);
  await git('commit', '-qm', 'Add the proposed asset on the same PR');
  const tip = await git('rev-parse', 'HEAD');
  await t.test('same PR split over commits and pushes', async () => {
    rejectsCapture(await scanRange());
    rejectsCapture(
      await run(
        './.githooks/pre-push',
        ['origin'],
        proposedUpdate(tip, pending),
      ),
    );
  });
});

test('a manifest-only approval on the target enables the exact asset in a later PR', async (t) => {
  const { git, write, run, base } = await repository(t);
  const path = 'public/reviewed.png';
  const sha256 = createHash('sha256').update(syntheticPng).digest('hex');
  write(
    allowlistPath,
    JSON.stringify([
      { path, sha256, source: 'Generated solid-color icon for this test' },
    ]),
  );
  await git('add', allowlistPath);
  const pending = await run('./.githooks/pre-commit', []);
  assert.equal(pending.status, 0, pending.stderr);
  assert.ok(
    pending.stderr.includes(
      `allowlist-change ${JSON.stringify(allowlistPath)}`,
    ),
  );
  await git('commit', '-qm', 'Approve the exact synthetic icon on the target');
  const approved = await git('rev-parse', 'HEAD');
  const approvalCheck = await run(process.execPath, [
    'scripts/check-data-guard.mjs',
    '--range',
    base,
    approved,
  ]);
  assert.equal(approvalCheck.status, 0, approvalCheck.stderr);
  assert.ok(approvalCheck.stderr.includes('data-guard: allowlist-change '));

  await git('update-ref', 'refs/remotes/upstream/main', approved);
  await git('checkout', '-qb', 'approved-asset', approved);
  write(path, syntheticPng);
  await git('add', path);
  await git('commit', '-qm', 'Add the previously approved synthetic icon');
  const tip = await git('rev-parse', 'HEAD');

  const ci = await run(process.execPath, [
    'scripts/check-data-guard.mjs',
    '--range',
    approved,
    tip,
  ]);
  assert.equal(ci.status, 0, ci.stderr);
  const push = await run(
    './.githooks/pre-push',
    ['upstream'],
    proposedUpdate(tip, zeroId),
  );
  assert.equal(push.status, 0, push.stderr);
  checkRejected(
    await run(
      './.githooks/pre-push',
      ['unknown'],
      proposedUpdate(tip, approved),
    ),
    'restricted-format',
  );

  const replacement = Buffer.concat([syntheticPng, Buffer.from(marker)]);
  write(path, replacement);
  write(
    allowlistPath,
    JSON.stringify([
      {
        path,
        sha256: createHash('sha256').update(replacement).digest('hex'),
        source: 'Proposed replacement for the synthetic icon',
      },
    ]),
  );
  await git('add', path, allowlistPath);
  const changed = await run('./.githooks/pre-commit', []);
  checkRejected(changed, 'allowlist-change');
  checkRejected(changed, 'allowlist-digest');
});

test('local workflow and nested action references resolve against each Git snapshot', async (t) => {
  const { git, write, run } = await repository(t);
  const workflow = '.github/workflows/main.yml';
  const reusable = '.github/workflows/reuse.yaml';
  const wrapper = 'tools/report/action.yml';
  const leaf = 'tools/leaf/action.yaml';
  const leafBody = `name: ${marker}\nruns:\n  using: composite\n  steps:\n    # Replaced actions/upload-artifact@v4 with a local check.\n    - run: 'true'\n      shell: bash\n`;
  write(
    workflow,
    'on: push\njobs:\n  report:\n    uses: ./.github/workflows/reuse.yaml\n',
  );
  write(
    reusable,
    'on: workflow_call\njobs:\n  report:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./tools/report\n',
  );
  write(
    wrapper,
    'runs:\n  using: composite\n  steps:\n    - uses: ./tools/leaf\n',
  );
  write(leaf, leafBody);
  await git('add', workflow, reusable, wrapper);

  const unstaged = await run('./.githooks/pre-commit', []);
  checkRejected(unstaged, 'local-action-reference');
  assert.ok(
    unstaged.stderr.includes(
      `local-action-reference ${JSON.stringify(wrapper)}`,
    ),
  );
  await git('add', leaf);
  await git('commit', '-qm', 'Add clean local action graph');
  const clean = await git('rev-parse', 'HEAD');

  write(leaf, `runs: [${marker}\n`);
  await git('add', leaf);
  const invalid = await run('./.githooks/pre-commit', []);
  checkRejected(invalid, 'action-yaml');
  checkRejected(invalid, 'local-action-reference');
  await git(
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '-qm',
    'Break synthetic leaf YAML',
  );

  write(leaf, leafBody);
  await git('add', leaf);
  await git('commit', '-qm', 'Restore synthetic leaf YAML');
  checkRejected(
    await run(process.execPath, [
      'scripts/check-data-guard.mjs',
      '--range',
      clean,
      'HEAD',
    ]),
    'local-action-reference',
  );
  checkRejected(
    await run(
      './.githooks/pre-push',
      [],
      proposedUpdate(await git('rev-parse', 'HEAD'), clean),
    ),
    'action-yaml',
  );
});

test('local action references reject path escapes, recursion and chains over the depth limit', async (t) => {
  const { git, write, run } = await repository(t);
  const escaped = 'tools/outside/action.yml';
  const cycle = 'tools/loop/action.yml';
  const writeAction = (path, reference) =>
    write(
      path,
      `name: ${marker}\nruns:\n  using: composite\n  steps:\n    - uses: ${reference}\n`,
    );
  writeAction(escaped, './../../../outside');
  writeAction(cycle, './tools/loop');
  for (let i = 0; i < 9; i += 1) {
    writeAction(`tools/step-${i}/action.yml`, `./tools/step-${i + 1}`);
  }
  write('tools/step-9/action.yml', 'runs:\n  using: composite\n  steps: []\n');
  await git('add', 'tools');

  const rejected = await run('./.githooks/pre-commit', []);
  checkRejected(rejected, 'local-action-reference');
  checkRejected(rejected, 'local-action-depth');
  assert.ok(
    rejected.stderr.includes(
      `local-action-reference ${JSON.stringify(escaped)}`,
    ),
  );
  assert.ok(
    rejected.stderr.includes(`local-action-depth ${JSON.stringify(cycle)}`),
  );
  assert.ok(
    rejected.stderr.includes('local-action-depth "tools/step-0/action.yml"'),
  );
  assert.ok(
    !rejected.stderr.includes('local-action-depth "tools/step-1/action.yml"'),
  );
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

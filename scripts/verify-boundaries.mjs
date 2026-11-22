import assert from 'node:assert/strict';
import { ESLint } from 'eslint';

const eslint = new ESLint();
for (const [filePath, code, forbidden] of [
  ['src/features/trading/example.ts', "import '../blog/post';", true],
  [
    'src/features/trading/example.ts',
    "export * from '@/features/blog/post';",
    true,
  ],
  ['src/features/trading/example.ts', "void import('../blog/post');", true],
  ['src/features/trading/example.ts', "import './order';", false],
  ['src/app/routes/example.ts', "import '@/features/blog/post';", false],
]) {
  const [result] = await eslint.lintText(code, { filePath });
  const boundaryErrors = result.messages.filter(
    (message) => message.ruleId === 'architecture/feature-boundaries',
  );
  assert.equal(
    boundaryErrors.length,
    Number(forbidden),
    filePath + ': ' + code,
  );
}
console.log(
  'Feature imports verified: relative, alias, dynamic, local, and app composition',
);

import path from 'node:path';

// Detect both @/ imports and relative paths, including imports hidden in barrel files.
const feature = (filename) =>
  filename.split('/src/features/')[1]?.split('/')[0];
export const featureBoundaries = {
  meta: {
    type: 'problem',
    messages: {
      cross: 'Features {{from}} and {{to}} must be composed in src/app.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename.split(path.sep).join('/');
    const from = feature(filename);
    if (!from) return {};
    const root = filename.split('/src/features/')[0];
    function check(source) {
      const name = source?.value;
      if (typeof name !== 'string') return;
      let resolved;
      if (name.startsWith('@/'))
        resolved = path.posix.join(root, 'src', name.slice(2));
      else if (name.startsWith('.'))
        resolved = path.posix.resolve(path.posix.dirname(filename), name);
      else return;
      const to = feature(resolved);
      if (to && to !== from)
        context.report({
          node: source,
          messageId: 'cross',
          data: { from, to },
        });
    }
    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
    };
  },
};

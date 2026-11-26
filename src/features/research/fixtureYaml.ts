// U3 uses only the documented synthetic research inputs.
import { CORE_SCHEMA, load, YAMLException } from 'js-yaml';
import type { Diagnostic } from './adapter';

export const maxYamlBytes = 256 * 1024;

export class InvalidYaml extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.code);
  }
}

function location(content: string, offset: number) {
  const lines = content.slice(0, offset).split(/\r\n|\r|\n/);
  return { line: lines.length, column: [...(lines.at(-1) ?? '')].length + 1 };
}

export function readYaml(content: string) {
  if (new TextEncoder().encode(content).byteLength > maxYamlBytes) {
    throw new InvalidYaml({
      code: 'FILE_TOO_LARGE',
      message: 'YAML 上限为 256 KiB。',
    });
  }
  const offsets: number[] = [];
  const separation = /(?:[ \t\r\n]+|#[^\r\n]*)*/y;
  let visited = 0;

  try {
    return load(content, {
      schema: CORE_SCHEMA,
      maxDepth: 48,
      // Track locations at the pinned parser's node boundaries. The parser
      // handles mappings, scalar quoting and syntax diagnostics.
      listener(event, state) {
        if (event === 'open') {
          if (++visited > 8192) {
            throw new InvalidYaml({
              code: 'NODE_LIMIT',
              message: '组合 YAML 的节点过多。',
              location: location(content, state.position),
            });
          }
          offsets.push(state.position);
          return;
        }
        const offset = offsets.pop() ?? state.position;
        if (state.anchor === null && state.tag === null) return;
        separation.lastIndex = offset;
        separation.exec(content);
        const start = separation.lastIndex;
        if (state.anchor !== null || content[start] === '!') {
          throw new InvalidYaml({
            code: 'YAML_PROPERTY',
            message: '示例 YAML 禁用锚点、别名和显式标签。',
            location: location(content, start),
          });
        }
      },
    });
  } catch (error) {
    if (!(error instanceof YAMLException)) throw error;
    throw new InvalidYaml({
      code: 'INVALID_YAML',
      message: 'YAML 语法无效。请检查缩进、标点、重复键与文档数量。',
      location: error.mark && location(content, error.mark.position),
    });
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  if (
    typeof value === 'string' &&
    /^-?(0|[1-9]\d{0,9})(\.\d{1,18})?$/.test(value)
  ) {
    const decimal = value.includes('.')
      ? value.replace(/0+$/, '').replace(/\.$/, '')
      : value;
    return decimal === '-0' ? '0' : decimal;
  }
  return value;
}

// Compare YAML values only against the bundled examples. Finance owns schema
// validation, semantic compilation and the authoritative content hash.
export function fixtureFingerprint(value: unknown) {
  return JSON.stringify(canonical(value));
}

// U3 uses only the documented synthetic research inputs.
import {
  CORE_SCHEMA,
  load,
  Type,
  types,
  YAMLException,
} from 'js-yaml/mapping-loader';
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

// Number errors are collected at the scalar, then associated with a field
// once the parser has returned its enclosing mappings and sequences.
class InexactNumber {
  constructor(readonly offset: number) {}
}

function validateNodes(
  value: unknown,
  path: string,
  source: string,
  invalidKeys: WeakMap<object, number>,
) {
  if (value instanceof InexactNumber) {
    throw new InvalidYaml({
      code: 'INVALID_NUMBER',
      path,
      message:
        '示例中的数字字面量须能精确表示为安全整数，小数金额和权重使用带引号的十进制文本。',
      location: location(source, value.offset),
    });
  }
  if (!value || typeof value !== 'object') return;
  const offset = invalidKeys.get(value);
  if (offset !== undefined) {
    throw new InvalidYaml({
      code: 'NON_STRING_KEY',
      path,
      message: 'YAML 映射键必须为字符串。',
      location: location(source, offset),
    });
  }
  for (const [key, child] of Object.entries(value)) {
    const segment = key.replaceAll('~', '~0').replaceAll('/', '~1');
    validateNodes(child, path + '/' + segment, source, invalidKeys);
  }
}

// The examples use integer parameters and quoted decimal amounts. Keep
// js-yaml's scalar resolution, but inspect decimal digits before constructing
// a number so a fractional lexeme cannot round to an accepted integer.
const decimalNumber = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i;
const otherNumber =
  /^(?:[+-]?0(?:b[01]+|o[0-7]+|x[0-9a-fA-F]+)|[+-]?\.(?:inf|Inf|INF|nan|NaN|NAN))$/;

function decimalParts(input: string) {
  const parts = decimalNumber.exec(input);
  return parts && (parts[2] || parts[3]) ? parts : null;
}

function exactInteger(input: string) {
  const match = decimalParts(input);
  if (!match) return NaN;
  const [, sign, whole, fraction = '', exponent = '0'] = match;
  const digits = (whole + fraction).replace(/^0+/, '');
  if (!digits) return 0;
  const significant = digits.replace(/0+$/, '');
  const zeros =
    Number(exponent) - fraction.length + digits.length - significant.length;
  if (
    !Number.isSafeInteger(zeros) ||
    zeros < 0 ||
    significant.length + zeros > 16
  )
    return NaN;

  const integer = Number(sign + significant + '0'.repeat(zeros));
  return Number.isSafeInteger(integer) ? integer : NaN;
}

const fixtureSchema = CORE_SCHEMA.extend({
  implicit: [
    new Type(types.float.tag, {
      kind: 'scalar',
      // Keep over-range literals typed as numbers so they receive diagnostics
      // instead of falling through to strings after js-yaml's finite check.
      resolve: (input) =>
        input !== null &&
        (decimalParts(input) !== null || otherNumber.test(input)),
      construct: exactInteger,
    }),
  ],
});

export function readYaml(content: string, locateScalar?: string) {
  if (new TextEncoder().encode(content).byteLength > maxYamlBytes) {
    throw new InvalidYaml({
      code: 'FILE_TOO_LARGE',
      message: 'YAML 上限为 256 KiB。',
    });
  }
  const source = content.replace(/^\uFEFF/, '');
  const offsets: number[] = [];
  let scalarLocation: Diagnostic['location'];
  const separation = /(?:[ \t\r\n]+|#[^\r\n]*)*/y;
  let visited = 0;
  const invalidKeys = new WeakMap<object, number>();

  function nodeStart(offset: number) {
    separation.lastIndex = offset;
    separation.exec(source);
    return separation.lastIndex;
  }

  try {
    const value = load(source, {
      schema: fixtureSchema,
      maxDepth: 48,
      // The pinned loader calls this before converting mapping keys to strings.
      onMappingKey(mapping, key, offset) {
        if (typeof key === 'string') return true;
        if (!invalidKeys.has(mapping)) {
          const start = nodeStart(offset);
          // An empty explicit block key has no scalar. Mark the position
          // immediately after its question mark instead of the next node.
          const empty =
            key === null &&
            source[offset - 1] === '?' &&
            (start === source.length ||
              source[start] === ':' ||
              source[start] === '?');
          invalidKeys.set(mapping, empty ? offset : start);
        }
        return false;
      },
      // Track locations at the pinned parser's node boundaries. The parser
      // handles mappings, scalar quoting and syntax diagnostics.
      listener(event, state) {
        if (event === 'open') {
          if (++visited > 8192) {
            throw new InvalidYaml({
              code: 'NODE_LIMIT',
              message: '组合 YAML 的节点过多。',
              location: location(source, state.position),
            });
          }
          offsets.push(state.position);
          return;
        }
        const offset = offsets.pop() ?? state.position;
        const matches =
          locateScalar !== undefined &&
          state.kind === 'scalar' &&
          state.result === locateScalar;
        const invalidNumber =
          typeof state.result === 'number' &&
          !Number.isSafeInteger(state.result);
        if (
          !matches &&
          !invalidNumber &&
          state.anchor === null &&
          state.tag === null
        )
          return;
        const start = nodeStart(offset);
        if (state.anchor !== null || source[start] === '!') {
          throw new InvalidYaml({
            code: 'YAML_PROPERTY',
            message: '示例 YAML 禁用锚点、别名和显式标签。',
            location: location(source, start),
          });
        }
        if (invalidNumber) state.result = new InexactNumber(start);
        if (matches && start < state.position)
          scalarLocation ??= location(source, start);
      },
    });
    validateNodes(value, '', source, invalidKeys);
    return { value, scalarLocation };
  } catch (error) {
    if (!(error instanceof YAMLException)) throw error;
    throw new InvalidYaml({
      code: 'INVALID_YAML',
      message: 'YAML 语法无效。请检查缩进、标点、重复键与文档数量。',
      location: error.mark && location(source, error.mark.position),
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

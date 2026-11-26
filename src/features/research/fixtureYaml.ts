// U3 uses only the documented synthetic research inputs.
import { CORE_SCHEMA, load, Type, types, YAMLException } from 'js-yaml';
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

// The examples use integer parameters and quoted decimal amounts. Keep
// js-yaml's scalar resolution, but inspect decimal digits before constructing
// a number so a fractional lexeme cannot round to an accepted integer.
function exactInteger(input: string) {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(input);
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
      resolve: types.float.resolve,
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

  try {
    const value = load(source, {
      schema: fixtureSchema,
      maxDepth: 48,
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
        separation.lastIndex = offset;
        separation.exec(source);
        const start = separation.lastIndex;
        if (state.anchor !== null || source[start] === '!') {
          throw new InvalidYaml({
            code: 'YAML_PROPERTY',
            message: '示例 YAML 禁用锚点、别名和显式标签。',
            location: location(source, start),
          });
        }
        if (invalidNumber) {
          throw new InvalidYaml({
            code: 'INVALID_NUMBER',
            message:
              '示例中的数字字面量须能精确表示为安全整数，小数金额和权重使用带引号的十进制文本。',
            location: location(source, start),
          });
        }
        if (matches && start < state.position)
          scalarLocation ??= location(source, start);
      },
    });
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

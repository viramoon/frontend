declare module 'js-yaml' {
  export const CORE_SCHEMA: object;

  export class YAMLException extends Error {
    readonly mark?: { position: number };
  }

  export function load(
    input: string,
    options: {
      schema: object;
      maxDepth: number;
      listener?: (
        event: 'open' | 'close',
        state: { position: number; anchor: string | null; tag: string | null },
      ) => void;
    },
  ): unknown;
}

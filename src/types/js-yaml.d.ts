declare module 'js-yaml' {
  export class Type {
    readonly tag: string;
    readonly resolve: (input: string | null) => boolean;
    constructor(
      tag: string,
      options: {
        kind: 'scalar';
        resolve: (input: string | null) => boolean;
        construct: (input: string) => unknown;
      },
    );
  }

  export const types: { float: Type };

  export interface Schema {
    extend(options: { implicit: Type[] }): Schema;
  }

  export const CORE_SCHEMA: Schema;

  export class YAMLException extends Error {
    readonly mark?: { position: number };
  }

  export function load(
    input: string,
    options: {
      schema: Schema;
      maxDepth: number;
      listener?: (
        event: 'open' | 'close',
        state: {
          position: number;
          anchor: string | null;
          tag: string | null;
          kind: string | null;
          result: unknown;
        },
      ) => void;
    },
  ): unknown;
}

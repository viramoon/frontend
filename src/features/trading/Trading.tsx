import type { ReactNode } from 'react';

export function Trading({ children }: { children: ReactNode }) {
  return (
    <>
      <h1 className="terminal-title">交易</h1>
      {children}
    </>
  );
}

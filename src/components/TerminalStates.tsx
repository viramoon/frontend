import type { ReactNode } from 'react';
import './terminal-states.css';

const states = {
  loading: { title: '正在加载', symbol: '…' },
  stale: { title: '数据陈旧', symbol: '◷' },
  denied: { title: '无权查看', symbol: '⊘' },
  empty: { title: '暂无数据', symbol: '◇' },
};

type DataStateProps = {
  kind: keyof typeof states;
  title?: string;
  detail?: ReactNode;
  illustrated?: boolean;
};

function EmptyIllustration() {
  return (
    <svg
      aria-hidden="true"
      className="terminal-empty-illustration"
      viewBox="0 0 72 60"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m14 29 1-17 15 7a25 25 0 0 1 13 0l14-7 1 17c3 4 5 9 5 14 0 8-10 12-27 12S9 51 9 43c0-5 2-10 5-14Z" />
      <path d="M22 36v5m28-5v5m-18 2c1 3 3 3 4 1 1 2 3 2 4-1M17 45h5m28 0h5M5 9v8m-4-4h8M66 4v10m-5-5h10" />
    </svg>
  );
}

export function DataState({
  kind,
  title,
  detail,
  illustrated,
}: DataStateProps) {
  const state = states[kind];
  return (
    <div
      className={`terminal-data-state terminal-data-state-${kind}`}
      role={kind === 'loading' ? 'status' : undefined}
    >
      {illustrated && kind === 'empty' ? (
        <EmptyIllustration />
      ) : (
        <span className="terminal-data-state-symbol" aria-hidden="true">
          {state.symbol}
        </span>
      )}
      <div>
        <strong>{title ?? state.title}</strong>
        {detail && <div className="terminal-data-state-detail">{detail}</div>}
      </div>
    </div>
  );
}

type DataBadgeProps = { fixture?: boolean; replay?: boolean; delay?: string };

export function DataBadges({ fixture, replay, delay }: DataBadgeProps) {
  if (!fixture && !replay && !delay) return null;

  return (
    <ul className="terminal-data-badges" aria-label="数据标识">
      {fixture && (
        <li className="terminal-badge fixture">Fixture · 示例数据</li>
      )}
      {replay && <li className="terminal-badge replay">回放</li>}
      {delay && <li className="terminal-badge delay">延迟 {delay}</li>}
    </ul>
  );
}

const newYorkTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/New_York',
  dateStyle: 'short',
  timeStyle: 'medium',
});

export type DisplayTimeZone = 'UTC' | 'America/New_York';

export function displayDataTime(value: string, zone: DisplayTimeZone = 'UTC') {
  if (zone === 'UTC') return value.replace('T', ' ').replace(/Z$/, ' UTC');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const fraction = value.match(/T\d{2}:\d{2}:\d{2}(\.\d+)/)?.[1] ?? '';
  return `${newYorkTime.format(date)}${fraction} ${zone}`;
}

const freshnessLabels = {
  current: '已更新',
  stale: '数据陈旧',
  unknown: '未知',
};

type SourceDetailsProps = DataBadgeProps & {
  source: string;
  asOf: string;
  freshness: keyof typeof freshnessLabels;
  timeZone?: DisplayTimeZone;
};

export function SourceDetails({
  source,
  asOf,
  freshness,
  timeZone,
  ...badges
}: SourceDetailsProps) {
  return (
    <div className="terminal-source-details">
      <DataBadges {...badges} />
      <dl>
        <div>
          <dt>来源</dt>
          <dd>{source}</dd>
        </div>
        <div>
          <dt>数据时间</dt>
          <dd>
            <time dateTime={asOf}>{displayDataTime(asOf, timeZone)}</time>
          </dd>
        </div>
        <div>
          <dt>新鲜度</dt>
          <dd>
            <span className={`terminal-badge freshness-${freshness}`}>
              {freshnessLabels[freshness]}
            </span>
          </dd>
        </div>
      </dl>
    </div>
  );
}

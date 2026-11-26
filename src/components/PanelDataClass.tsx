import type { ReactNode } from 'react';
import { DataState } from './TerminalStates';

export type DetailDateRange = { start: string; end: string };

type DataClassProps =
  | { kind: 'price-volume' }
  | { kind: 'detail'; availableFrom?: string };

export function DataClassLabel(props: DataClassProps) {
  return (
    <p className="terminal-data-class">
      {props.kind === 'price-volume' ? (
        '数据类别 · 价量历史'
      ) : (
        <>
          <span>数据类别 · 订单簿细节</span>
          {props.availableFrom ? (
            <>
              （自{' '}
              <time dateTime={props.availableFrom}>{props.availableFrom}</time>{' '}
              起）
            </>
          ) : (
            '（可用起点未知）'
          )}
        </>
      )}
    </p>
  );
}

function isUtcDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.valueOf()) && date.toISOString().startsWith(value)
  );
}

// Dates and adapter timestamps are normalized to UTC before comparison.
export function includesDetailTime(
  { start, end }: DetailDateRange,
  time: string,
  availableFrom?: string,
) {
  const day = time.slice(0, 10);
  return (
    (!availableFrom || availableFrom <= day) &&
    (!start || start <= day) &&
    (!end || day < end)
  );
}

export function DetailPanelData({
  availableFrom,
  range: { start, end },
  children,
}: {
  availableFrom?: string;
  range: DetailDateRange;
  children: ReactNode;
}) {
  const invalid =
    (start && !isUtcDate(start)) ||
    (end && !isUtcDate(end)) ||
    (start && end && start >= end);
  const beforeCollection = availableFrom && end && end <= availableFrom;
  const partial = availableFrom && start && start < availableFrom;
  return (
    <>
      <DataClassLabel kind="detail" availableFrom={availableFrom} />
      {invalid ? (
        <DataState
          kind="empty"
          title="请输入有效的细节区间，结束日期须晚于起始日期"
        />
      ) : beforeCollection ? (
        <DataState kind="empty" title="采集开始前无细节数据" />
      ) : (
        <>
          {partial && (
            <DataState
              kind="empty"
              title="采集开始前无细节数据"
              detail="采集起点之后的日期仍按返回样本显示。"
            />
          )}
          {children}
        </>
      )}
    </>
  );
}

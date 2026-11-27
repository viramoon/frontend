import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { GapCause, GapRecovery } from '../../api/generated/types.gen';
import type {
  RecoveryAdapter,
  RecoveryCoverage,
  RecoveryGapsPage,
} from '../../api/recoveryWeb';
import {
  OperationsReadState,
  UtcTime,
} from '../../components/OperationsStates';
import { DriveWatermark } from './SystemDetails';

const causes: Record<GapCause, string> = {
  license_skip: '许可跳过',
  rotation: '订阅轮换',
  source_rate_limit: '源端限速',
  disconnected: '断连',
  source_gap: '源缺口',
  storage_unavailable: '存储不可用',
};

const outcomes: Record<GapRecovery, string> = {
  tick_backfilled: '逐笔已补齐',
  bar_backfilled: '仅 K 线补齐',
  book_restored_from_snapshot: '已从快照恢复当前盘口',
  history_unrecoverable: '历史缺口不可补',
};

function Watermarks({ item }: { item: RecoveryCoverage }) {
  const {
    source_latest: latest,
    local_durable,
    projected,
    remote_verified,
  } = item.watermarks ?? {};
  return (
    <section
      className="operations-card"
      aria-label={`${item.source} ${item.product} 水位`}
    >
      <h4>
        {item.source} · {item.product}
      </h4>
      <dl className="operations-fields">
        <dt>许可</dt>
        <dd>{item.license}</dd>
        <dt>源最新位置</dt>
        <dd>{latest ? `epoch ${latest.epoch} / seq ${latest.seq}` : '未知'}</dd>
        <dt>源接收时间（ns）</dt>
        <dd>{latest?.receive_ts ?? '未知'}</dd>
        <dt>本机持久位置</dt>
        <dd>{local_durable ?? '未知'}</dd>
        <dt>投影位置</dt>
        <dd>{projected ?? '未知'}</dd>
        <dt>远端已验证位置</dt>
        <dd>{remote_verified ?? '未知'}</dd>
      </dl>
    </section>
  );
}

function GapPage({ page }: { page: RecoveryGapsPage }) {
  if (page.state === 'unavailable') return <p>暂无采集质量观测。</p>;
  return (
    <>
      <p>
        快照观测 <UtcTime value={page.as_of ?? null} />
      </p>
      <div className="operations-grid">
        {page.coverage.map((item) => (
          <Watermarks item={item} key={`${item.source}/${item.product}`} />
        ))}
      </div>
      {page.items.length ? (
        <ul className="operations-list">
          {page.items.map((item, index) => (
            <li
              key={`${item.source}/${item.product}/${item.instrument_id}/${item.channel}/${item.from}/${index}`}
            >
              <strong>
                {item.source} · {item.product} · {item.instrument_id} ·{' '}
                {item.channel}
              </strong>
              <div>
                <UtcTime value={item.from} /> 至 <UtcTime value={item.to} />
              </div>
              <div>
                {causes[item.cause]} ·{' '}
                {item.outcome ? outcomes[item.outcome] : '待恢复'}
                {item.count != null && <> · 计数 {item.count}</>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p>该快照暂无缺口记录。</p>
      )}
    </>
  );
}

function Quality({ adapter }: { adapter: RecoveryAdapter }) {
  const [page, setPage] = useState<{ offset: number; asOf: string | null }>({
    offset: 0,
    asOf: null,
  });
  const query = useQuery({
    queryKey: ['u4', 'web', 'quality', page.offset],
    queryFn: ({ signal }) => adapter.gaps(page.offset, signal),
    refetchInterval: page.offset === 0 ? 30_000 : false,
    staleTime: 0,
  });
  const data = query.isSuccess ? query.data : undefined;
  const changed = data && page.offset > 0 && (data.as_of ?? null) !== page.asOf;

  return (
    <section className="operations-section" aria-labelledby="quality-heading">
      <h3 id="quality-heading">采集水位与缺口</h3>
      {!data ? (
        <OperationsReadState
          failed={query.isError}
          retry={() => void query.refetch()}
        />
      ) : (
        <>
          {changed ? (
            <p role="status">采集快照已更新，请从首屏重新读取。</p>
          ) : (
            <GapPage page={data} />
          )}
          <div className="operations-actions">
            {page.offset > 0 && (
              <button
                className="refresh"
                type="button"
                onClick={() => setPage({ offset: 0, asOf: null })}
              >
                返回首屏
              </button>
            )}
            {!changed &&
              data.next_offset != null &&
              data.next_offset > page.offset && (
                <button
                  className="refresh"
                  type="button"
                  disabled={query.isFetching}
                  onClick={() =>
                    setPage({
                      offset: data.next_offset!,
                      asOf: data.as_of ?? null,
                    })
                  }
                >
                  下一页
                </button>
              )}
          </div>
        </>
      )}
    </section>
  );
}

export function WebRecovery({ adapter }: { adapter: RecoveryAdapter }) {
  const backup = useQuery({
    queryKey: ['u4', 'web', 'backup'],
    queryFn: ({ signal }) => adapter.backup(signal),
    refetchInterval: 30_000,
    staleTime: 0,
  });

  return (
    <section className="operations-section" aria-labelledby="recovery-title">
      <h2 id="recovery-title">备份与采集质量</h2>
      {backup.isSuccess ? (
        <>
          <DriveWatermark backup={backup.data} />
          <button
            type="button"
            className="refresh"
            disabled={backup.isFetching}
            onClick={() => void backup.refetch()}
          >
            刷新备份状态
          </button>
        </>
      ) : (
        <OperationsReadState
          failed={backup.isError}
          retry={() => void backup.refetch()}
        />
      )}
      <Quality adapter={adapter} />
    </section>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import type { ReplayDigest, ReplayResponse } from '@shared/types';

import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';

interface ReplayFormValue {
  fromTick: string;
  toTick: string;
  step: boolean;
  speed: string;
  verify: boolean;
}

const DIGEST_FIELDS: Array<{ key: keyof ReplayDigest; label: string }> = [
  { key: 'tick', label: 'tick' },
  { key: 'players', label: '玩家数' },
  { key: 'alive_players', label: '存活玩家' },
  { key: 'buildings', label: '建筑数' },
  { key: 'units', label: '单位数' },
  { key: 'resources', label: '资源点' },
  { key: 'total_minerals', label: '总矿物' },
  { key: 'total_energy', label: '总能量' },
  { key: 'resource_remaining', label: '剩余储量' },
  { key: 'entity_counter', label: '实体计数' },
  { key: 'hash', label: '哈希' },
];

function createInitialFormValue(): ReplayFormValue {
  return {
    fromTick: '',
    toTick: '',
    step: false,
    speed: '0',
    verify: true,
  };
}

function parseInteger(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatValue(value: string, fallback: number) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatBool(value: boolean | undefined) {
  return value ? '是' : '否';
}

function buildStatusLabel(result: ReplayResponse) {
  if (!result.snapshot_digest) {
    return '未校验快照';
  }
  return result.drift_detected ? '检测到漂移' : '校验通过';
}

function digestFieldValue(digest: ReplayDigest | undefined, key: keyof ReplayDigest) {
  if (!digest) {
    return '-';
  }
  return String(digest[key] ?? '-');
}

function renderDigestPanel(title: string, digest: ReplayDigest | undefined, compareTarget?: ReplayDigest) {
  return (
    <section className="panel replay-digest-panel">
      <div className="section-title">{title}</div>
      {!digest ? <p className="subtle-text">当前结果没有对应 digest。</p> : null}
      {digest ? (
        <dl className="planet-kv-list replay-kv-list">
          {DIGEST_FIELDS.map((field) => {
            const mismatch = compareTarget && digest[field.key] !== compareTarget[field.key];
            return (
              <div className={mismatch ? 'replay-kv-list__row replay-kv-list__row--mismatch' : 'replay-kv-list__row'} key={field.key}>
                <dt>{field.label}</dt>
                <dd>{digestFieldValue(digest, field.key)}</dd>
              </div>
            );
          })}
        </dl>
      ) : null}
    </section>
  );
}

export function ReplayPage() {
  const client = useApiClient();
  const session = useSessionSnapshot();
  const [form, setForm] = useState<ReplayFormValue>(createInitialFormValue);
  const [validationMessage, setValidationMessage] = useState('');

  const summaryQuery = useQuery({
    queryKey: ['summary', session.serverUrl, session.playerId],
    queryFn: () => client.fetchSummary(),
  });

  const replayMutation = useMutation({
    mutationFn: (request: {
      from_tick: number;
      to_tick: number;
      step: boolean;
      speed: number;
      verify: boolean;
    }) => client.sendReplay(request),
  });

  useEffect(() => {
    if (!summaryQuery.data || form.toTick) {
      return;
    }
    const currentTick = summaryQuery.data.tick;
    setForm((current) => ({
      ...current,
      fromTick: String(Math.max(0, currentTick - 8)),
      toTick: String(currentTick),
    }));
  }, [form.toTick, summaryQuery.data]);

  function updateField<K extends keyof ReplayFormValue>(field: K, value: ReplayFormValue[K]) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fallbackTick = summaryQuery.data?.tick ?? 0;
    const fromTick = parseInteger(form.fromTick, fallbackTick);
    const toTick = form.step ? fromTick : parseInteger(form.toTick, fallbackTick);
    const speed = parseFloatValue(form.speed, 0);

    if (fromTick < 0 || toTick < 0) {
      setValidationMessage('tick 必须为非负整数。');
      return;
    }
    if (toTick < fromTick) {
      setValidationMessage('to_tick 必须大于等于 from_tick。');
      return;
    }
    if (speed < 0) {
      setValidationMessage('speed 不能为负数。');
      return;
    }

    setValidationMessage('');
    await replayMutation.mutateAsync({
      from_tick: fromTick,
      to_tick: toTick,
      step: form.step,
      speed,
      verify: form.verify,
    });
  }

  if (summaryQuery.isLoading) {
    return <div className="panel">正在加载回放调试页...</div>;
  }

  if (summaryQuery.error || !summaryQuery.data) {
    return (
      <div className="panel error-banner" role="alert">
        {summaryQuery.error instanceof Error ? summaryQuery.error.message : '回放调试页初始化失败'}
      </div>
    );
  }

  const summary = summaryQuery.data;
  const result = replayMutation.data;

  return (
    <div className="page-grid replay-page">
      <section className="panel page-hero">
        <div className="page-header">
          <p className="eyebrow">T013 回放调试页</p>
          <h1>Replay 调试台</h1>
          <p className="subtle-text">
            当前世界 tick {summary.tick}，活跃行星{' '}
            <Link to={`/planet/${summary.active_planet_id}`}>{summary.active_planet_id}</Link>
          </p>
        </div>
        <div className="hero-actions">
          <Link className="secondary-link" to={`/planet/${summary.active_planet_id}`}>返回地图</Link>
        </div>
      </section>

      <section className="replay-layout">
        <form className="panel replay-form-panel" onSubmit={handleSubmit}>
          <div className="section-title">回放参数</div>

          <label className="field">
            <span>from_tick</span>
            <input
              inputMode="numeric"
              name="fromTick"
              onChange={(event) => updateField('fromTick', event.target.value)}
              value={form.fromTick}
            />
          </label>

          <label className="field">
            <span>to_tick</span>
            <input
              disabled={form.step}
              inputMode="numeric"
              name="toTick"
              onChange={(event) => updateField('toTick', event.target.value)}
              value={form.toTick}
            />
          </label>

          <label className="field">
            <span>speed</span>
            <input
              inputMode="decimal"
              name="speed"
              onChange={(event) => updateField('speed', event.target.value)}
              value={form.speed}
            />
            <span className="field-hint">`0` 表示不做节流，`step=true` 时会自动只重放一个 tick。</span>
          </label>

          <label className="toggle-row">
            <input
              checked={form.step}
              name="step"
              onChange={(event) => updateField('step', event.target.checked)}
              type="checkbox"
            />
            <span>step 模式</span>
          </label>

          <label className="toggle-row">
            <input
              checked={form.verify}
              name="verify"
              onChange={(event) => updateField('verify', event.target.checked)}
              type="checkbox"
            />
            <span>校验 snapshot digest</span>
          </label>

          {validationMessage ? (
            <div className="error-banner" role="alert">
              {validationMessage}
            </div>
          ) : null}

          {replayMutation.error ? (
            <div className="error-banner" role="alert">
              {replayMutation.error instanceof Error ? replayMutation.error.message : '回放请求失败'}
            </div>
          ) : null}

          <button className="primary-button" disabled={replayMutation.isPending} type="submit">
            {replayMutation.isPending ? '执行回放中...' : '执行 replay'}
          </button>
        </form>

        <div className="replay-result-stack">
          <section className="panel replay-summary-panel">
            <div className="replay-summary-panel__header">
              <div className="section-title">结果摘要</div>
              {result ? (
                <span className={result.drift_detected ? 'badge replay-status replay-status--danger' : 'badge badge--ok replay-status'}>
                  {buildStatusLabel(result)}
                </span>
              ) : null}
            </div>

            {!result ? (
              <p className="subtle-text">
                运行一次 replay 后，这里会展示摘要指标、digest 对比和校验说明。
              </p>
            ) : (
              <div className="card-grid replay-stat-grid">
                <article className="panel stat-card replay-stat-card">
                  <span className="stat-card__label">快照起点</span>
                  <strong>{result.snapshot_tick}</strong>
                  <span>回放区间 {result.replay_from_tick} - {result.replay_to_tick}</span>
                </article>
                <article className="panel stat-card replay-stat-card">
                  <span className="stat-card__label">执行 ticks</span>
                  <strong>{result.applied_ticks}</strong>
                  <span>命令 {result.command_count}</span>
                </article>
                <article className="panel stat-card replay-stat-card">
                  <span className="stat-card__label">verify</span>
                  <strong>{formatBool(Boolean(result.snapshot_digest))}</strong>
                  <span>结果差异 {result.result_mismatch_count ?? 0}</span>
                </article>
                <article className="panel stat-card replay-stat-card">
                  <span className="stat-card__label">耗时</span>
                  <strong>{result.duration_ms} ms</strong>
                  <span>speed {result.speed}</span>
                </article>
              </div>
            )}
          </section>

          {result ? (
            <div className="replay-digest-grid">
              {renderDigestPanel('Replay Digest', result.digest, result.snapshot_digest)}
              {renderDigestPanel('Snapshot Digest', result.snapshot_digest, result.digest)}
            </div>
          ) : null}

          {result?.notes?.length ? (
            <section className="panel replay-notes-panel">
              <div className="section-title">校验备注</div>
              <ul className="timeline-list timeline-list--dense">
                {result.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </section>
    </div>
  );
}

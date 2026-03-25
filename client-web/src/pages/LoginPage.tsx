import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { useQueryClient } from '@tanstack/react-query';

import { createApiClient } from '@shared/api';
import { DEFAULT_PLAYERS } from '@shared/config';
import { normalizeServerUrl } from '@shared/utils';

import {
  createFixtureFetch,
  createFixtureServerUrl,
  isFixtureServerUrl,
  listFixtureScenarios,
  parseFixtureIdFromServerUrl,
} from '@/fixtures';
import { useSessionSnapshot } from '@/hooks/use-session';
import { createInitialSessionValue, useSessionStore } from '@/stores/session';

function createInitialFormValue() {
  const fallback = createInitialSessionValue();
  return {
    serverUrl: fallback.serverUrl,
    playerId: DEFAULT_PLAYERS[0]?.id ?? '',
    playerKey: DEFAULT_PLAYERS[0]?.key ?? '',
  };
}

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const storedSession = useSessionSnapshot();
  const setSession = useSessionStore((state) => state.setSession);

  const baseFormValue = createInitialFormValue();
  const availableFixtures = listFixtureScenarios();
  const initialFixtureId = parseFixtureIdFromServerUrl(storedSession.serverUrl) || availableFixtures[0]?.id || 'baseline';
  const [connectionMode, setConnectionMode] = useState<'server' | 'fixture'>(
    isFixtureServerUrl(storedSession.serverUrl) ? 'fixture' : 'server',
  );
  const [form, setForm] = useState(() => ({
    ...baseFormValue,
    ...storedSession,
    playerId: storedSession.playerId || baseFormValue.playerId,
    playerKey: storedSession.playerKey || baseFormValue.playerKey,
  }));
  const [fixtureId, setFixtureId] = useState(initialFixtureId);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function applyPreset(playerId: string, playerKey: string) {
    setForm((current) => ({ ...current, playerId, playerKey }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage('');

    const nextValue = {
      serverUrl: connectionMode === 'fixture'
        ? createFixtureServerUrl(fixtureId)
        : normalizeServerUrl(form.serverUrl),
      playerId: form.playerId.trim(),
      playerKey: form.playerKey.trim(),
    };

    try {
      const client = createApiClient({
        serverUrl: nextValue.serverUrl,
        fetchFn: connectionMode === 'fixture' ? createFixtureFetch(nextValue.serverUrl) : undefined,
        auth: {
          playerId: nextValue.playerId,
          playerKey: nextValue.playerKey,
        },
      });

      await client.fetchHealth();
      await client.fetchSummary();

      setSession(nextValue);
      queryClient.clear();
      navigate('/overview', { replace: true });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <section className="panel login-panel">
        <div className="page-header">
          <p className="eyebrow">T004 登录页与会话管理</p>
          <h1>连接 SiliconWorld 服务端</h1>
          <p className="subtle-text">
            在线模式走 Vite 代理，离线模式会直接载入本地 fixtures。
          </p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="segmented-control" role="radiogroup" aria-label="连接模式">
            <button
              aria-checked={connectionMode === 'server'}
              className={connectionMode === 'server' ? 'segmented-control__button segmented-control__button--active' : 'segmented-control__button'}
              onClick={() => setConnectionMode('server')}
              role="radio"
              type="button"
            >
              在线服务端
            </button>
            <button
              aria-checked={connectionMode === 'fixture'}
              className={connectionMode === 'fixture' ? 'segmented-control__button segmented-control__button--active' : 'segmented-control__button'}
              onClick={() => setConnectionMode('fixture')}
              role="radio"
              type="button"
            >
              离线样例
            </button>
          </div>

          {connectionMode === 'server' ? (
            <label className="field">
              <span>服务地址</span>
              <input
                name="serverUrl"
                value={form.serverUrl}
                onChange={(event) => updateField('serverUrl', event.target.value)}
                placeholder="http://localhost:5173"
              />
            </label>
          ) : (
            <label className="field">
              <span>样例场景</span>
              <select
                name="fixtureId"
                onChange={(event) => setFixtureId(event.target.value)}
                value={fixtureId}
              >
                {availableFixtures.map((fixture) => (
                  <option key={fixture.id} value={fixture.id}>
                    {fixture.label}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                {availableFixtures.find((fixture) => fixture.id === fixtureId)?.description ?? '离线模式可直接渲染主要页面与组件。'}
              </span>
            </label>
          )}

          <label className="field">
            <span>player_id</span>
            <input
              name="playerId"
              value={form.playerId}
              onChange={(event) => updateField('playerId', event.target.value)}
              placeholder="p1"
            />
          </label>

          <label className="field">
            <span>player_key</span>
            <input
              name="playerKey"
              value={form.playerKey}
              onChange={(event) => updateField('playerKey', event.target.value)}
              placeholder="key_player_1"
            />
          </label>

          <div className="preset-row">
            {DEFAULT_PLAYERS.map((player) => (
              <button
                key={player.id}
                className="secondary-button"
                type="button"
                onClick={() => applyPreset(player.id, player.key)}
              >
                使用 {player.id}
              </button>
            ))}
          </div>

          {errorMessage ? (
            <div className="error-banner" role="alert">
              {errorMessage}
            </div>
          ) : null}

          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? '连接中...' : connectionMode === 'fixture' ? '打开离线场景' : '连接并进入总览'}
          </button>
        </form>
      </section>
    </div>
  );
}

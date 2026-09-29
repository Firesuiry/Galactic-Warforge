import { Crown, Plus, Users } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

import {
  FIXTURE_GAME_UNAVAILABLE,
  gameStatusOf,
  translateBotDifficulty,
  translateEnemyDifficulty,
  translatePlayerRole,
  translateVictoryMode,
} from '@/features/lobby/current-game';
import { useCurrentGameQuery } from '@/features/lobby/use-current-game';
import { isFixtureServerUrl } from '@/fixtures';
import { useSessionSnapshot } from '@/hooks/use-session';

function formatStartedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || '-';
  }
  return date.toLocaleString('zh-CN', { hour12: false });
}

interface LobbyLocationState {
  notice?: string;
  playerId?: string;
}

/** C10 大厅/对局状态页：展示 GET /games/current 概要，10s 轮询保持新鲜。 */
export function LobbyPage() {
  const session = useSessionSnapshot();
  const fixtureMode = isFixtureServerUrl(session.serverUrl);
  const location = useLocation();
  const locationState = (location.state as LobbyLocationState | null) ?? null;

  const gameQuery = useCurrentGameQuery();

  if (fixtureMode) {
    return (
      <div className="panel lobby-page__fixture">
        {FIXTURE_GAME_UNAVAILABLE}
      </div>
    );
  }

  if (gameQuery.isLoading) {
    return <div className="panel">正在加载对局信息...</div>;
  }

  if (gameQuery.error || !gameQuery.data) {
    return (
      <div className="panel error-banner" role="alert">
        {gameQuery.error instanceof Error ? gameQuery.error.message : '对局信息加载失败'}
      </div>
    );
  }

  const game = gameQuery.data;
  const me = game.players.find((player) => player.player_id === session.playerId);
  const isAdmin = me?.role === 'admin';
  const aliveCount = game.players.filter((player) => player.is_alive).length;
  const finished = gameStatusOf(game) === 'finished';

  return (
    <div className="page-grid lobby-page">
      <section className="panel page-hero">
        <div className="page-header">
          <p className="eyebrow">Game Lobby</p>
          <h1>对局大厅</h1>
          <p className="subtle-text">
            当前对局 seed {game.map_seed} · tick {game.tick} · 每 10 秒自动刷新
          </p>
          {finished ? <p className="lobby-finished">对局已结束</p> : null}
        </div>
        <div className="hero-actions">
          {finished ? (
            <Link className="primary-link" to="/settlement">查看结算</Link>
          ) : null}
          {isAdmin ? (
            <Link className="primary-link" to="/lobby/new">
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              开新局
            </Link>
          ) : null}
          <Link className="secondary-link" to={`/planet/${game.active_planet_id}`}>
            返回战场
          </Link>
        </div>
      </section>

      {locationState?.notice === 'game-created' ? (
        <div className="panel lobby-notice" role="status">
          新局已开启（tick 0）{locationState.playerId ? `，你以 ${locationState.playerId} 身份进入` : ''}
          。其他玩家需使用新局的 key 重新登录。
        </div>
      ) : null}

      {game.victory.declared ? (
        <div className="panel lobby-victory" role="status">
          <Crown size={18} strokeWidth={2} aria-hidden="true" />
          <span>
            对局已宣判：胜者 {game.victory.winner_id || '-'}
            {game.victory.team_id ? `（队伍 ${game.victory.team_id}）` : ''}
            {game.victory.reason ? ` · ${game.victory.reason}` : ''}
          </span>
        </div>
      ) : null}

      <section className="card-grid lobby-summary">
        <article className="panel stat-card">
          <span className="stat-card__label">地图种子</span>
          <strong>{game.map_seed || '-'}</strong>
          <span>tick 速率 {game.max_tick_rate}/s</span>
        </article>
        <article className="panel stat-card">
          <span className="stat-card__label">黑雾难度</span>
          <strong>{translateEnemyDifficulty(game.enemy_difficulty)}</strong>
          <span>enemy_difficulty: {game.enemy_difficulty}</span>
        </article>
        <article className="panel stat-card">
          <span className="stat-card__label">胜利模式</span>
          <strong>{translateVictoryMode(game.victory_mode)}</strong>
          <span>victory_mode: {game.victory_mode}</span>
        </article>
        <article className="panel stat-card">
          <span className="stat-card__label">开始时间</span>
          <strong>{formatStartedAt(game.started_at)}</strong>
          <span>当前 tick {game.tick}</span>
        </article>
      </section>

      <section className="panel lobby-players-panel" aria-label="玩家列表">
        <div className="lobby-players-panel__head">
          <span className="section-title">玩家列表</span>
          <span className="badge badge--ok">{aliveCount}/{game.players.length} 存活</span>
        </div>
        <ul className="lobby-player-list">
          {game.players.map((player) => {
            const isSelf = player.player_id === session.playerId;
            return (
              <li
                className={`lobby-player${isSelf ? ' lobby-player--self' : ''}`}
                key={player.player_id}
              >
                <span className="lobby-player__id">
                  <Users size={14} strokeWidth={2} aria-hidden="true" />
                  {player.player_id}
                  {isSelf ? <span className="badge">我</span> : null}
                </span>
                <span className={`badge${player.role === 'admin' ? ' badge--ok' : ''}`}>
                  {translatePlayerRole(player.role)}
                </span>
                <span className="badge">队伍 {player.team_id || player.player_id}</span>
                {player.bot ? (
                  <span className="badge">bot·{translateBotDifficulty(player.bot)}</span>
                ) : null}
                <span className={`badge${player.is_alive ? ' badge--ok' : ' badge--danger'}`}>
                  {player.is_alive ? '存活' : '已淘汰'}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

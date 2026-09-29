import { Link } from 'react-router-dom';

import {
  didPlayerWin,
  FIXTURE_GAME_UNAVAILABLE,
  gameStatusOf,
  translateVictoryMode,
  translateVictoryReason,
} from '@/features/lobby/current-game';
import { useCurrentGameQuery } from '@/features/lobby/use-current-game';
import { isFixtureServerUrl } from '@/fixtures';
import { useSessionSnapshot } from '@/hooks/use-session';
import { translateTechId } from '@/i18n/translate';

/** F2 终局结算：读 GET /games/current，不编造进行中的战报。 */
export function SettlementPage() {
  const session = useSessionSnapshot();
  const fixtureMode = isFixtureServerUrl(session.serverUrl);
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
  const planetHref = game.active_planet_id
    ? `/planet/${encodeURIComponent(game.active_planet_id)}`
    : '';

  if (gameStatusOf(game) !== 'finished' || !game.settlement) {
    return (
      <div className="page-grid lobby-page settlement-page">
        <section className="panel page-hero">
          <div className="page-header">
            <p className="eyebrow">Settlement</p>
            <h1>{gameStatusOf(game) === 'finished' ? '对局已结束' : '对局尚未结束'}</h1>
            <p className="subtle-text">
              {gameStatusOf(game) === 'finished'
                ? '结算报告尚未到达，无法展示战损。'
                : '当前对局仍在进行，没有可展示的战报。'}
            </p>
          </div>
          <SettlementActions isAdmin={isAdmin && gameStatusOf(game) === 'finished'} planetHref={planetHref} />
        </section>
      </div>
    );
  }

  const report = game.settlement;
  const won = didPlayerWin(session.playerId, report);

  return (
    <div className="page-grid lobby-page settlement-page">
      <section className="panel page-hero">
        <div className="page-header">
          <p className="eyebrow">Settlement</p>
          <h1>{won ? '你获胜' : '你失败'}</h1>
          <p className="subtle-text">
            胜者 {report.winner_id || '-'}
            {report.team_id ? ` · 队伍 ${report.team_id}` : ''}
          </p>
        </div>
        <SettlementActions isAdmin={isAdmin} planetHref={planetHref} />
      </section>

      <section className="card-grid lobby-summary">
        <article className="panel stat-card">
          <span className="stat-card__label">原因</span>
          <strong>{translateVictoryReason(report.reason)}</strong>
          <span>reason: {report.reason || '-'}</span>
        </article>
        <article className="panel stat-card">
          <span className="stat-card__label">胜利规则</span>
          <strong>{translateVictoryMode(report.victory_rule)}</strong>
          <span>victory_rule: {report.victory_rule || '-'}</span>
        </article>
        <article className="panel stat-card">
          <span className="stat-card__label">时长</span>
          <strong>{report.duration_ticks} tick</strong>
          <span>第 {report.start_tick}–{report.declared_tick} tick</span>
        </article>
        {report.tech_id ? (
          <article className="panel stat-card">
            <span className="stat-card__label">关键科技</span>
            <strong>{translateTechId(report.tech_id)}</strong>
            <span>tech_id: {report.tech_id}</span>
          </article>
        ) : null}
      </section>

      <section className="panel" aria-label="玩家战损">
        <div className="lobby-players-panel__head">
          <span className="section-title">玩家战损</span>
          <span className="badge">宣判时冻结</span>
        </div>
        <div className="settlement-table-wrap">
          <table className="settlement-table">
            <thead>
              <tr>
                <th>玩家</th>
                <th>队伍</th>
                <th>状态</th>
                <th>击杀</th>
                <th>损失</th>
                <th>摧毁建筑</th>
                <th>损失建筑</th>
              </tr>
            </thead>
            <tbody>
              {report.players.map((player) => {
                const isSelf = player.player_id === session.playerId;
                return (
                  <tr
                    className={isSelf ? 'settlement-row--self' : undefined}
                    key={player.player_id}
                  >
                    <td>
                      {player.player_id}
                      {isSelf ? <span className="badge">我</span> : null}
                      {player.winner ? <span className="badge badge--ok">胜</span> : null}
                    </td>
                    <td>{player.team_id || '-'}</td>
                    <td>{player.is_alive ? '存活' : '已淘汰'}</td>
                    <td>{player.units_killed}</td>
                    <td>{player.units_lost}</td>
                    <td>{player.buildings_destroyed}</td>
                    <td>{player.buildings_lost}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SettlementActions({ isAdmin, planetHref }: { isAdmin: boolean; planetHref: string }) {
  return (
    <div className="hero-actions">
      <Link className="secondary-link" to="/lobby">返回大厅</Link>
      {planetHref ? (
        <Link className="secondary-link" to={planetHref}>查看战场</Link>
      ) : null}
      {isAdmin ? (
        <Link className="primary-link" to="/lobby/new">重开新局</Link>
      ) : null}
    </div>
  );
}

import { useState } from 'react';

import { Link, useLocation } from 'react-router-dom';

import { endgameBannerKind, gameIdentityOf } from '@/features/lobby/current-game';
import { useCurrentGameQuery } from '@/features/lobby/use-current-game';
import { useSessionSnapshot } from '@/hooks/use-session';

/**
 * 终局/出局横幅（全页面可见，挂在 AppShell）。
 *
 * 试玩 1012：被歼灭或对局结束只有右下角一条会自动消失的 toast，玩家看不出自己已经出局、
 * 更不知道有结算页可看。这里给一个显眼的胜负横幅（含「查看结算」入口）：
 * - 对局进行中且本人 is_alive=false → 战败（已出局）；
 * - status=finished → 按 settlement/victory 判定胜利或战败（平局不显示，交给终局提示条）。
 *
 * 关闭状态按「对局身份」（started_at::map_seed）记录：读档存档点/开新局后身份变化，
 * 横幅自动重新判定并复位，不会把上一局的关闭状态带进新局。
 */
export function EndgameBanner() {
  const session = useSessionSnapshot();
  const location = useLocation();
  const gameQuery = useCurrentGameQuery();
  const [dismissedIdentity, setDismissedIdentity] = useState('');

  const game = gameQuery.data;
  if (!game) {
    return null;
  }
  const kind = endgameBannerKind(game, session.playerId);
  if (!kind) {
    return null;
  }
  // 结算页本身就是胜负页面，不再叠一个横幅。
  if (location.pathname === '/settlement') {
    return null;
  }
  const identity = gameIdentityOf(game);
  if (dismissedIdentity === identity) {
    return null;
  }
  const finished = game.status === 'finished';
  const hint = kind === 'victory'
    ? '本局已结束，你是胜者。'
    : finished
      ? '本局已结束，你未能取胜。'
      : '你的基地已被全歼，本局已出局。';

  return (
    <div
      className={`endgame-banner endgame-banner--${kind}`}
      data-testid="endgame-banner"
      role="alert"
    >
      <div className="endgame-banner__body">
        <strong className="endgame-banner__title">{kind === 'victory' ? '胜利' : '战败'}</strong>
        <span className="endgame-banner__hint">{hint}</span>
      </div>
      <Link className="endgame-banner__action" to="/settlement">
        查看结算
      </Link>
      <button
        className="endgame-banner__dismiss"
        onClick={() => setDismissedIdentity(identity)}
        type="button"
      >
        关闭
      </button>
    </div>
  );
}

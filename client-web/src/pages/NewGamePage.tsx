import { useEffect, useRef, useState, type FormEvent } from 'react';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import { Button, Input, Select } from '@/common/controls';
import {
  BOT_DIFFICULTY_OPTIONS,
  ENEMY_DIFFICULTY_OPTIONS,
  PLAYER_ROLE_OPTIONS,
  VICTORY_MODE_OPTIONS,
  buildNewGameRequest,
  createEmptyPlayerRow,
  newGameAdminWarning,
  prefillNewGameForm,
  resolveAdoptedAuth,
  translateBotDifficulty,
  translateEnemyDifficulty,
  translatePlayerRole,
  translateVictoryMode,
  validateNewGameForm,
  type NewGameFormValue,
  type NewGamePlayerRow,
} from '@/features/lobby/current-game';
import { useCurrentGameQuery } from '@/features/lobby/use-current-game';
import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';
import { resetLobbyStore, useLobbyStore } from '@/stores/lobby';
import { useSessionStore } from '@/stores/session';

/** C10 新局设置表单（仅 admin）：POST /games/new，成功后本机切换到新局 key。 */
export function NewGamePage() {
  const client = useApiClient();
  const session = useSessionSnapshot();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setSession = useSessionStore((state) => state.setSession);
  const clearSession = useSessionStore((state) => state.clearSession);

  const gameQuery = useCurrentGameQuery();
  const [form, setForm] = useState<NewGameFormValue | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const prefilledRef = useRef(false);

  const game = gameQuery.data;
  const me = game?.players.find((player) => player.player_id === session.playerId);
  const isAdmin = me?.role === 'admin';

  // 首次拿到当前对局后预填：沿用当前玩家阵容，本人行回填当前 key（其余 key 服务端不可见，需重填）
  useEffect(() => {
    if (!game || prefilledRef.current) {
      return;
    }
    prefilledRef.current = true;
    setForm(prefillNewGameForm(game, session.playerId, session.playerKey));
  }, [game, session.playerId, session.playerKey]);

  const createMutation = useMutation({
    mutationFn: (formValue: NewGameFormValue) => client.createNewGame(buildNewGameRequest(formValue)),
    onSuccess: (_game, formValue) => {
      const request = buildNewGameRequest(formValue);
      const adopted = resolveAdoptedAuth(request, session.playerId);
      resetLobbyStore();
      queryClient.clear();
      if (adopted) {
        // 本机自动切换到新局 key（旧 key 已失效），再以新凭证全量重拉
        setSession({
          serverUrl: session.serverUrl,
          playerId: adopted.playerId,
          playerKey: adopted.playerKey,
        });
        navigate('/lobby', {
          replace: true,
          state: { notice: 'game-created', playerId: adopted.playerId },
        });
      } else {
        clearSession();
        useLobbyStore.getState().setLoginNotice('session-expired');
        navigate('/login', { replace: true });
      }
    },
  });

  function updateField<K extends keyof NewGameFormValue>(field: K, value: NewGameFormValue[K]) {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  }

  function updatePlayerRow(index: number, patch: Partial<NewGamePlayerRow>) {
    setForm((current) => {
      if (!current) {
        return current;
      }
      const players = current.players.map((row, rowIndex) => (
        rowIndex === index ? { ...row, ...patch } : row
      ));
      return { ...current, players };
    });
  }

  function addPlayerRow() {
    setForm((current) => (
      current ? { ...current, players: [...current.players, createEmptyPlayerRow()] } : current
    ));
  }

  function removePlayerRow(index: number) {
    setForm((current) => {
      if (!current || current.players.length <= 1) {
        return current;
      }
      return { ...current, players: current.players.filter((_, rowIndex) => rowIndex !== index) };
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) {
      return;
    }
    const validationErrors = validateNewGameForm(form);
    setErrors(validationErrors);
    if (validationErrors.length > 0) {
      return;
    }
    createMutation.mutate(form);
  }

  if (gameQuery.isLoading || (game && !form)) {
    return <div className="panel">正在加载新局设置...</div>;
  }

  if (gameQuery.error || !game) {
    return (
      <div className="panel error-banner" role="alert">
        {gameQuery.error instanceof Error ? gameQuery.error.message : '对局信息加载失败'}
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="panel error-banner" role="alert">
        仅管理员（role=admin）可以开新局。
        {' '}
        <Link to="/lobby">返回对局大厅</Link>
      </div>
    );
  }

  if (!form) {
    return <div className="panel">正在加载新局设置...</div>;
  }

  const adminWarning = newGameAdminWarning(form);

  return (
    <div className="page-grid newgame-page">
      <section className="panel page-hero">
        <div className="page-header">
          <p className="eyebrow">New Game</p>
          <h1>开新局</h1>
          <p className="subtle-text">
            热重置当前对局（seed {game.map_seed} · tick {game.tick}），无需重启服务端
          </p>
        </div>
        <div className="hero-actions">
          <Link className="secondary-link" to="/lobby">返回对局大厅</Link>
        </div>
      </section>

      <form className="panel newgame-form" onSubmit={handleSubmit}>
        <div className="error-banner newgame-form__warning" role="note">
          注意：提交后当前对局立即被丢弃，所有玩家的旧 key 失效，需使用新局的 key 重新登录。
        </div>

        <div className="section-title">对局参数</div>

        <label className="field">
          <span>map_seed</span>
          <Input
            aria-label="map_seed"
            name="map_seed"
            value={form.map_seed}
            onChange={(event) => updateField('map_seed', event.target.value)}
            placeholder="留空由服务端随机生成"
          />
          <span className="field-hint">地图拓扑沿用服务端启动时的 mapconfig，仅种子可变。</span>
        </label>

        <div className="newgame-form__row">
          <label className="field">
            <span>黑雾难度</span>
            <Select
              aria-label="黑雾难度"
              name="enemy_difficulty"
              value={form.enemy_difficulty}
              onChange={(event) => updateField('enemy_difficulty', event.target.value as NewGameFormValue['enemy_difficulty'])}
            >
              {ENEMY_DIFFICULTY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {translateEnemyDifficulty(option)}（{option}）
                </option>
              ))}
            </Select>
          </label>

          <label className="field">
            <span>胜利模式</span>
            <Select
              aria-label="胜利模式"
              name="victory_mode"
              value={form.victory_mode}
              onChange={(event) => updateField('victory_mode', event.target.value as NewGameFormValue['victory_mode'])}
            >
              {VICTORY_MODE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {translateVictoryMode(option)}（{option}）
                </option>
              ))}
            </Select>
          </label>
        </div>

        <div className="newgame-players__head">
          <span className="section-title">玩家（{form.players.length}）</span>
          <Button size="sm" variant="secondary" icon={Plus} onClick={addPlayerRow}>
            添加玩家
          </Button>
        </div>

        <ul className="newgame-player-list">
          {form.players.map((row, index) => (
            <li className="newgame-player" key={index}>
              <label className="field">
                <span>player_id</span>
                <Input
                  aria-label={`玩家 ${index + 1} player_id`}
                  value={row.player_id}
                  onChange={(event) => updatePlayerRow(index, { player_id: event.target.value })}
                  placeholder="p1"
                />
              </label>
              <label className="field">
                <span>key</span>
                <Input
                  aria-label={`玩家 ${index + 1} key`}
                  value={row.key}
                  onChange={(event) => updatePlayerRow(index, { key: event.target.value })}
                  placeholder="登录凭证"
                />
              </label>
              <label className="field">
                <span>角色</span>
                <Select
                  aria-label={`玩家 ${index + 1} 角色`}
                  value={row.role}
                  onChange={(event) => updatePlayerRow(index, { role: event.target.value as NewGamePlayerRow['role'] })}
                >
                  {PLAYER_ROLE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {translatePlayerRole(option)}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="field">
                <span>bot</span>
                <Select
                  aria-label={`玩家 ${index + 1} bot`}
                  value={row.bot}
                  onChange={(event) => updatePlayerRow(index, { bot: event.target.value as NewGamePlayerRow['bot'] })}
                >
                  <option value="">人类</option>
                  {BOT_DIFFICULTY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      bot·{translateBotDifficulty(option)}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="field">
                <span>team_id</span>
                <Input
                  aria-label={`玩家 ${index + 1} team_id`}
                  value={row.team_id}
                  onChange={(event) => updatePlayerRow(index, { team_id: event.target.value })}
                  placeholder={row.player_id.trim() || '默认 = player_id'}
                />
              </label>
              <button
                aria-label={`删除玩家 ${index + 1}`}
                className="newgame-player__remove"
                type="button"
                disabled={form.players.length <= 1}
                onClick={() => removePlayerRow(index)}
                title="删除该行"
              >
                <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>

        {adminWarning ? (
          <div className="error-banner" role="note">
            {adminWarning}
          </div>
        ) : null}

        {errors.length > 0 ? (
          <div className="error-banner" role="alert">
            <ul className="newgame-errors">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {createMutation.error ? (
          <div className="error-banner" role="alert">
            {createMutation.error instanceof Error ? createMutation.error.message : '开新局失败'}
          </div>
        ) : null}

        <Button variant="primary" type="submit" disabled={createMutation.isPending}>
          {createMutation.isPending ? '正在开新局...' : '确认开新局（丢弃当前对局）'}
        </Button>
      </form>
    </div>
  );
}

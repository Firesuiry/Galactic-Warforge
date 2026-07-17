import { useEffect, useRef, useState } from 'react';

import type {
  FleetRuntimeView,
  PlanetRef,
  SystemRuntimeView,
} from '@shared/types';

import { subscribeBattleEvents } from '@/engine/battle-events';
import { PixiStage } from '@/engine/PixiStage';
import { BattlefieldScene } from '@/features/war/battlefield/battlefield-scene';
import type { BattlefieldSelection } from '@/features/war/battlefield/battlefield-model';

interface BattlefieldMapProps {
  systemName: string;
  planets: PlanetRef[];
  runtime?: SystemRuntimeView;
  fleets: FleetRuntimeView[];
  playerId: string;
  onSelect?: (selection: BattlefieldSelection | null) => void;
}

/**
 * 星系级战场态势图（Pixi 渲染，布局语义见 battlefield-model），全屏地图即主界面。
 *
 * 把恒星、行星轨道、己方/敌方舰队接触、封锁圈、登陆行动收拢到一张图上，
 * 解决 WarPage 过去只有文字列表、玩家「看不懂战局」的问题。
 * 点击标记会选中并回传，供上层联动 FleetActionForm / TaskForceForm。
 * 场景订阅战斗事件总线，导弹齐射/点防拦截/战报到达时做一次性特效演出。
 * chrome 全部 HUD 化：顶部居中标题/制空权摘要、左下图例、底部居中选中回显。
 */
export function BattlefieldMap({
  systemName,
  planets,
  runtime,
  fleets,
  playerId,
  onSelect,
}: BattlefieldMapProps) {
  const sceneRef = useRef<BattlefieldScene | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [selection, setSelection] = useState<BattlefieldSelection | null>(null);
  // scene 就绪后递增，触发下面的数据/选中同步 effect（onReady 晚于首次渲染）
  const [sceneVersion, setSceneVersion] = useState(0);

  useEffect(() => {
    sceneRef.current?.setData({ planets, runtime, fleets, playerId });
  }, [planets, runtime, fleets, playerId, sceneVersion]);

  useEffect(() => {
    sceneRef.current?.setSelection(selection?.id ?? null);
  }, [selection, sceneVersion]);

  const superiority = runtime?.orbital_superiority;

  return (
    <div className="battlefield-stage">
      <PixiStage
        className="battlefield-canvas"
        onReady={(app) => {
          // 与星图 freeze 同一约定：?freeze=1 冻结脉冲/特效，供确定性截图
          const frozen = new URLSearchParams(window.location.search).has('freeze');
          const scene = new BattlefieldScene(app, {
            onSelect: (next) => {
              setSelection(next);
              onSelectRef.current?.(next);
            },
          }, { frozen });
          sceneRef.current = scene;
          setSceneVersion((version) => version + 1);
          // 战斗事件总线 → 场景特效；卸载时退订，防泄漏/StrictMode 重复演出
          const unsubscribe = subscribeBattleEvents((event) => scene.handleBattleEvent(event));
          return () => {
            unsubscribe();
            sceneRef.current = null;
            scene.destroy();
          };
        }}
      />
      <div className="battlefield-hud">
        <h3>战场态势 · {systemName}</h3>
        <p className="subtle-text">
          {superiority
            ? `制空权：${superiority.advantage_player_id ?? '争夺中'} · ${(superiority as { contest_intensity?: number }).contest_intensity ?? 0}`
            : '尚未形成制空权'}
          {' · '}
          接触 {(runtime?.contacts ?? []).length} · 舰队 {fleets.length} · 封锁 {(runtime?.planet_blockades ?? []).length} · 登陆 {(runtime?.landing_operations ?? []).length}
        </p>
      </div>
      <ul className="war-list battlefield-legend">
        <li><span style={{ color: '#38bdf8' }}>◆</span> 己方舰队</li>
        <li><span style={{ color: '#f87171' }}>▲</span> 敌方接触</li>
        <li><span style={{ color: '#94a3b8' }}>●</span> 行星（红圈虚线=被封锁）</li>
      </ul>
      {selection ? (
        <p className="battlefield-selection subtle-text">
          已选中：{selection.label}{selection.detail ? `（${selection.detail}）` : ''}
        </p>
      ) : null}
    </div>
  );
}

export type { BattlefieldSelection };

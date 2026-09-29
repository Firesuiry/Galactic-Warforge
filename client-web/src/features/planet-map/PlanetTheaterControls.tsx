/**
 * 战区划定控件（C4）：行星地图左下角工具条旁的「战区」按钮 + 浮层。
 *
 * 浮层内选战区 + 区域类型后进入 theater_zone 拖拽模式（地图上左键拖矩形）；
 * 无战区时内联创建（theater_create）。拖拽落点由 PlanetMapPixi 回调 PlanetPage 提交
 * theater_define_zone（planet_id + position + radius 由拖拽几何换算）。
 * 仅 2D 平面战术视图支持拖拽；3D 下提示切换。
 */

import { useEffect, useRef, useState } from 'react';

import { Landmark } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { WarTheaterView, WarTheaterZoneType } from '@shared/types';

import { Input, Select } from '@/common/controls';
import { sfx } from '@/engine/audio';
import { submitPlanetCommand } from '@/features/planet-commands/executor';
import { PLANET_COMMAND_RECOVERY_EVENT_TYPES } from '@/features/planet-commands/store';
import { theaterZoneTypeLabel } from '@/features/planet-map/squad-commands';
import { usePlanetViewStore } from '@/features/planet-map/store';
import { useApiClient } from '@/hooks/use-api-client';

const ZONE_TYPES: WarTheaterZoneType[] = [
  'primary',
  'secondary',
  'no_entry',
  'rally',
  'supply_priority',
];

interface PlanetTheaterControlsProps {
  planetId: string;
  theaters: WarTheaterView[];
  /** 3D 球面视图：拖拽划定只在 2D 平面战术视图可用（浮层给切换提示）。 */
  dimensional: boolean;
  onChanged?: () => void;
}

export function PlanetTheaterControls({
  planetId,
  theaters,
  dimensional,
  onChanged,
}: PlanetTheaterControlsProps) {
  const client = useApiClient();
  const { interactionMode, setInteractionMode } = usePlanetViewStore(
    useShallow((state) => ({
      interactionMode: state.interactionMode,
      setInteractionMode: state.setInteractionMode,
    })),
  );
  const [panelOpen, setPanelOpen] = useState(false);
  const [theaterId, setTheaterId] = useState('');
  const [zoneType, setZoneType] = useState<WarTheaterZoneType>('primary');
  const [createId, setCreateId] = useState('');
  const [createName, setCreateName] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);

  const theater = theaters.find((item) => item.id === theaterId) ?? theaters[0];
  const zoneModeActive = interactionMode.kind === 'theater_zone';

  useEffect(() => {
    if (!panelOpen) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setPanelOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [panelOpen]);

  function handleCreate() {
    const trimmedId = createId.trim();
    if (!trimmedId) {
      return;
    }
    void submitPlanetCommand({
      commandType: 'theater_create',
      planetId,
      execute: () => client.cmdTheaterCreate(trimmedId, {
        name: createName.trim() || undefined,
      }),
      fetchAuthoritativeSnapshot: () => client.fetchEventSnapshot({
        event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES],
        limit: 50,
      }),
    }).then(() => onChanged?.());
    setCreateId('');
    setCreateName('');
  }

  function handleStartZone() {
    if (!theater) {
      return;
    }
    sfx.uiClick();
    setInteractionMode({ kind: 'theater_zone', theaterId: theater.id, zoneType });
    setPanelOpen(false);
  }

  return (
    <div className="planet-theater-controls" ref={rootRef}>
      {panelOpen ? (
        <div className="panel planet-theater-controls__popover" data-testid="theater-controls-popover">
          <div className="section-title">战区划定</div>
          {theaters.length === 0 ? (
            <div className="planet-theater-controls__create">
              <p className="subtle-text">暂无战区：先创建一个，再在地图上拖出区域。</p>
              <label className="war-field">
                <span>战区 ID</span>
                <Input
                  value={createId}
                  onChange={(event) => setCreateId(event.target.value)}
                  placeholder="例如 theater-north"
                />
              </label>
              <label className="war-field">
                <span>名称（可选）</span>
                <Input
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                />
              </label>
              <button
                className="secondary-button"
                type="button"
                disabled={!createId.trim()}
                onClick={handleCreate}
              >
                创建战区
              </button>
            </div>
          ) : (
            <>
              <label className="war-field">
                <span>目标战区</span>
                <Select value={theater?.id ?? ''} onChange={(event) => setTheaterId(event.target.value)}>
                  {theaters.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name || item.id} ({item.id})
                    </option>
                  ))}
                </Select>
              </label>
              <label className="war-field">
                <span>区域类型</span>
                <Select value={zoneType} onChange={(event) => setZoneType(event.target.value as WarTheaterZoneType)}>
                  {ZONE_TYPES.map((value) => (
                    <option key={value} value={value}>{theaterZoneTypeLabel(value)}</option>
                  ))}
                </Select>
              </label>
              {dimensional ? (
                <p className="subtle-text">拖拽划定需切到「平面战术」视图（右上视图开关）。</p>
              ) : (
                <button className="secondary-button" type="button" onClick={handleStartZone}>
                  开始拖拽划定
                </button>
              )}
              <details className="planet-theater-controls__more">
                <summary>新建战区</summary>
                <div className="planet-theater-controls__create">
                  <label className="war-field">
                    <span>战区 ID</span>
                    <Input
                      value={createId}
                      onChange={(event) => setCreateId(event.target.value)}
                      placeholder="例如 theater-north"
                    />
                  </label>
                  <label className="war-field">
                    <span>名称（可选）</span>
                    <Input
                      value={createName}
                      onChange={(event) => setCreateName(event.target.value)}
                    />
                  </label>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!createId.trim()}
                    onClick={handleCreate}
                  >
                    创建战区
                  </button>
                </div>
              </details>
            </>
          )}
        </div>
      ) : null}
      <button
        aria-expanded={panelOpen}
        aria-label="战区划定"
        className={
          zoneModeActive
            ? 'secondary-button planet-map-toolbar__button planet-theater-controls__button--active'
            : 'secondary-button planet-map-toolbar__button'
        }
        onClick={() => setPanelOpen((open) => !open)}
        title="战区划定"
        type="button"
      >
        <Landmark size={18} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}

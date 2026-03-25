import { useEffect, useMemo, useState } from 'react';

import { DEFAULT_GALAXY_ID, DEFAULT_SYSTEM_ID } from '@shared/config';
import type { ApiClient } from '@shared/api';
import type { CatalogView, PlanetView } from '@shared/types';

import { getBuildingDisplayName, getTechDisplayName } from '@/features/planet-map/model';
import { usePlanetViewStore } from '@/features/planet-map/store';

interface PlanetCommandPanelProps {
  catalog?: CatalogView;
  client: ApiClient;
  planet: PlanetView;
}

export function PlanetCommandPanel({ catalog, client, planet }: PlanetCommandPanelProps) {
  const selected = usePlanetViewStore((state) => state.selected);
  const [scanGalaxyId, setScanGalaxyId] = useState(DEFAULT_GALAXY_ID);
  const [scanSystemId, setScanSystemId] = useState(DEFAULT_SYSTEM_ID);
  const [buildX, setBuildX] = useState(0);
  const [buildY, setBuildY] = useState(0);
  const [buildingType, setBuildingType] = useState('');
  const [buildDirection, setBuildDirection] = useState<'north' | 'east' | 'south' | 'west' | 'auto'>('auto');
  const [recipeId, setRecipeId] = useState('');
  const [moveUnitId, setMoveUnitId] = useState('');
  const [moveX, setMoveX] = useState(0);
  const [moveY, setMoveY] = useState(0);
  const [researchId, setResearchId] = useState('');
  const [demolishId, setDemolishId] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [resultMessage, setResultMessage] = useState('');
  const [resultTone, setResultTone] = useState<'ok' | 'error'>('ok');

  const ownBuildings = useMemo(
    () => Object.values(planet.buildings ?? {}).filter((building) => building.owner_id === client.getAuth().playerId),
    [client, planet.buildings],
  );
  const ownUnits = useMemo(
    () => Object.values(planet.units ?? {}).filter((unit) => unit.owner_id === client.getAuth().playerId),
    [client, planet.units],
  );
  const buildableBuildings = useMemo(
    () => [...(catalog?.buildings ?? [])]
      .filter((entry) => entry.buildable)
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
    [catalog?.buildings],
  );
  const recipesForBuilding = useMemo(
    () => [...(catalog?.recipes ?? [])]
      .filter((recipe) => recipe.building_types?.includes(buildingType))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
    [buildingType, catalog?.recipes],
  );
  const techOptions = useMemo(
    () => [...(catalog?.techs ?? [])]
      .filter((tech) => !tech.hidden)
      .sort((left, right) => {
        if (left.level !== right.level) {
          return left.level - right.level;
        }
        return left.name.localeCompare(right.name, 'zh-CN');
      }),
    [catalog?.techs],
  );

  useEffect(() => {
    if (buildableBuildings.length > 0 && !buildingType) {
      setBuildingType(buildableBuildings[0].id);
    }
  }, [buildableBuildings, buildingType]);

  useEffect(() => {
    if (techOptions.length > 0 && !researchId) {
      setResearchId(techOptions[0].id);
    }
  }, [researchId, techOptions]);

  useEffect(() => {
    if (selected?.position) {
      setBuildX(selected.position.x);
      setBuildY(selected.position.y);
      setMoveX(selected.position.x);
      setMoveY(selected.position.y);
    }
    if (selected?.kind === 'building') {
      setDemolishId(selected.id);
    }
    if (selected?.kind === 'unit') {
      setMoveUnitId(selected.id);
    }
  }, [selected]);

  async function runCommand(actionLabel: string, execute: () => Promise<{ accepted: boolean; results: Array<{ message: string }> }>) {
    setBusyAction(actionLabel);
    setResultMessage('');
    try {
      const response = await execute();
      setResultTone(response.accepted ? 'ok' : 'error');
      setResultMessage(response.results.map((result) => result.message).join(' / ') || `${actionLabel} 已发送`);
    } catch (error) {
      setResultTone('error');
      setResultMessage(error instanceof Error ? error.message : `${actionLabel} 失败`);
    } finally {
      setBusyAction('');
    }
  }

  return (
    <div className="planet-panel-stack">
      <section className="planet-side-section">
        <div className="section-title">命令操作面板</div>
        <p className="subtle-text">
          当前页直接支持扫描、建造、移动、研究、拆除。所有命令都走同一套 `/commands` 契约。
        </p>
        {resultMessage ? (
          <div className={resultTone === 'ok' ? 'command-result command-result--ok' : 'command-result command-result--error'}>
            {resultMessage}
          </div>
        ) : null}
      </section>

      <section className="planet-side-section">
        <div className="section-title">扫描</div>
        <div className="compact-form-grid">
          <label className="field">
            <span>galaxy_id</span>
            <input onChange={(event) => setScanGalaxyId(event.target.value)} value={scanGalaxyId} />
          </label>
          <button
            className="secondary-button"
            disabled={busyAction !== ''}
            onClick={() => { void runCommand('scan_galaxy', () => client.cmdScanGalaxy(scanGalaxyId)); }}
            type="button"
          >
            扫描银河
          </button>

          <label className="field">
            <span>system_id</span>
            <input onChange={(event) => setScanSystemId(event.target.value)} value={scanSystemId} />
          </label>
          <button
            className="secondary-button"
            disabled={busyAction !== ''}
            onClick={() => { void runCommand('scan_system', () => client.cmdScanSystem(scanSystemId)); }}
            type="button"
          >
            扫描星系
          </button>

          <label className="field">
            <span>planet_id</span>
            <input readOnly value={planet.planet_id} />
          </label>
          <button
            className="secondary-button"
            disabled={busyAction !== ''}
            onClick={() => { void runCommand('scan_planet', () => client.cmdScanPlanet(planet.planet_id)); }}
            type="button"
          >
            扫描当前行星
          </button>
        </div>
      </section>

      <section className="planet-side-section">
        <div className="section-title">建造</div>
        <div className="compact-form-grid">
          <label className="field">
            <span>x</span>
            <input onChange={(event) => setBuildX(Number(event.target.value) || 0)} type="number" value={buildX} />
          </label>
          <label className="field">
            <span>y</span>
            <input onChange={(event) => setBuildY(Number(event.target.value) || 0)} type="number" value={buildY} />
          </label>
          <label className="field field--span-2">
            <span>building_type</span>
            <select onChange={(event) => setBuildingType(event.target.value)} value={buildingType}>
              {buildableBuildings.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} · {entry.id}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>direction</span>
            <select onChange={(event) => setBuildDirection(event.target.value as typeof buildDirection)} value={buildDirection}>
              <option value="auto">auto</option>
              <option value="north">north</option>
              <option value="east">east</option>
              <option value="south">south</option>
              <option value="west">west</option>
            </select>
          </label>
          <label className="field">
            <span>recipe_id</span>
            <select onChange={(event) => setRecipeId(event.target.value)} value={recipeId}>
              <option value="">无</option>
              {recipesForBuilding.map((recipe) => (
                <option key={recipe.id} value={recipe.id}>
                  {recipe.name} · {recipe.id}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary-button field--span-2"
            disabled={busyAction !== '' || !buildingType}
            onClick={() => {
              void runCommand('build', () => client.cmdBuild(
                { x: buildX, y: buildY, z: 0 },
                buildingType,
                {
                  direction: buildDirection,
                  ...(recipeId ? { recipeId } : {}),
                },
              ));
            }}
            type="button"
          >
            发送建造命令
          </button>
        </div>
      </section>

      <section className="planet-side-section">
        <div className="section-title">移动</div>
        <div className="compact-form-grid">
          <label className="field field--span-2">
            <span>unit_id</span>
            <select onChange={(event) => setMoveUnitId(event.target.value)} value={moveUnitId}>
              <option value="">选择单位</option>
              {ownUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.id} · {unit.type}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>x</span>
            <input onChange={(event) => setMoveX(Number(event.target.value) || 0)} type="number" value={moveX} />
          </label>
          <label className="field">
            <span>y</span>
            <input onChange={(event) => setMoveY(Number(event.target.value) || 0)} type="number" value={moveY} />
          </label>
          <button
            className="secondary-button field--span-2"
            disabled={busyAction !== '' || !moveUnitId}
            onClick={() => { void runCommand('move', () => client.cmdMove(moveUnitId, { x: moveX, y: moveY, z: 0 })); }}
            type="button"
          >
            移动单位
          </button>
        </div>
      </section>

      <section className="planet-side-section">
        <div className="section-title">研究</div>
        <div className="compact-form-grid">
          <label className="field field--span-2">
            <span>tech_id</span>
            <select onChange={(event) => setResearchId(event.target.value)} value={researchId}>
              {techOptions.map((tech) => (
                <option key={tech.id} value={tech.id}>
                  {getTechDisplayName(catalog, tech.id)} · Lv.{tech.level}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary-button field--span-2"
            disabled={busyAction !== '' || !researchId}
            onClick={() => { void runCommand('start_research', () => client.cmdStartResearch(researchId)); }}
            type="button"
          >
            开始研究
          </button>
        </div>
      </section>

      <section className="planet-side-section">
        <div className="section-title">拆除</div>
        <div className="compact-form-grid">
          <label className="field field--span-2">
            <span>building_id</span>
            <select onChange={(event) => setDemolishId(event.target.value)} value={demolishId}>
              <option value="">选择建筑</option>
              {ownBuildings.map((building) => (
                <option key={building.id} value={building.id}>
                  {building.id} · {getBuildingDisplayName(catalog, building.type)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary-button field--span-2"
            disabled={busyAction !== '' || !demolishId}
            onClick={() => { void runCommand('demolish', () => client.cmdDemolish(demolishId)); }}
            type="button"
          >
            拆除建筑
          </button>
        </div>
      </section>
    </div>
  );
}

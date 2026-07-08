import { useMemo, useState } from 'react';

import type {
  PlanetRef,
  WarTheaterView,
  WarTheaterZoneType,
} from '@shared/types';

import { WarField } from '@/features/war/components/WarField';
import type { WarCommandInput, WarQueryScope } from '@/features/war/war-query-keys';
import { useApiClient } from '@/hooks/use-api-client';

const THEATER_ZONE_TYPES: WarTheaterZoneType[] = [
  'primary',
  'secondary',
  'no_entry',
  'rally',
  'supply_priority',
];

const THEATER_OBJECTIVE_TYPES = [
  'secure_planet',
  'deny_planet',
  'hold_orbit',
  'interdict_system',
  'destroy_fleet',
];

interface TheaterFormProps {
  scope: WarQueryScope;
  runCommand: (input: WarCommandInput) => void;
  isPending: boolean;
  theaters: WarTheaterView[];
  currentPlanets: PlanetRef[];
  focusSystemId: string;
}

/**
 * theater_create / theater_define_zone / theater_set_objective：
 * 战区的创建、区域定义与目标设定三件套，过去必须切 CLI。
 */
export function TheaterForm({
  scope,
  runCommand,
  isPending,
  theaters,
  currentPlanets,
  focusSystemId,
}: TheaterFormProps) {
  const client = useApiClient();

  const [createId, setCreateId] = useState('');
  const [createName, setCreateName] = useState('');

  const [zoneTheaterId, setZoneTheaterId] = useState('');
  const [zoneType, setZoneType] = useState<WarTheaterZoneType>('primary');
  const [zonePlanetId, setZonePlanetId] = useState('');
  const [zoneRadius, setZoneRadius] = useState(8);

  const [objectiveTheaterId, setObjectiveTheaterId] = useState('');
  const [objectiveType, setObjectiveType] = useState('secure_planet');
  const [objectivePlanetId, setObjectivePlanetId] = useState('');
  const [objectiveDescription, setObjectiveDescription] = useState('');

  const zoneTheater = useMemo(
    () => theaters.find((item) => item.id === zoneTheaterId) ?? theaters[0],
    [theaters, zoneTheaterId],
  );
  const objectiveTheater = useMemo(
    () => theaters.find((item) => item.id === objectiveTheaterId) ?? theaters[0],
    [theaters, objectiveTheaterId],
  );
  const zonePlanet = useMemo(
    () => currentPlanets.find((item) => item.planet_id === zonePlanetId) ?? currentPlanets[0],
    [currentPlanets, zonePlanetId],
  );
  const objectivePlanet = useMemo(
    () => currentPlanets.find((item) => item.planet_id === objectivePlanetId) ?? currentPlanets[0],
    [currentPlanets, objectivePlanetId],
  );

  function handleCreate() {
    const trimmedId = createId.trim();
    if (!trimmedId) {
      return;
    }
    runCommand({
      section: 'theater',
      invalidateKeys: [['war-theaters', scope.serverUrl, scope.playerId]],
      execute: () => client.cmdTheaterCreate(trimmedId, {
        name: createName.trim() || undefined,
      }),
    });
    setCreateId('');
    setCreateName('');
  }

  function handleDefineZone() {
    if (!zoneTheater?.id || !zonePlanet?.planet_id) {
      return;
    }
    runCommand({
      section: 'theater',
      invalidateKeys: [['war-theaters', scope.serverUrl, scope.playerId]],
      execute: () => client.cmdTheaterDefineZone(zoneTheater.id, {
        zoneType,
        systemId: focusSystemId || undefined,
        planetId: zonePlanet.planet_id,
        radius: Math.max(1, Number(zoneRadius) || 1),
      }),
    });
  }

  function handleSetObjective() {
    if (!objectiveTheater?.id || !objectivePlanet?.planet_id) {
      return;
    }
    runCommand({
      section: 'theater',
      invalidateKeys: [['war-theaters', scope.serverUrl, scope.playerId]],
      execute: () => client.cmdTheaterSetObjective(objectiveTheater.id, {
        objectiveType,
        systemId: focusSystemId || undefined,
        planetId: objectivePlanet.planet_id,
        description: objectiveDescription.trim() || undefined,
      }),
    });
  }

  return (
    <>
      <article className="war-card">
        <h3>创建战区</h3>
        <WarField label="战区 ID">
          <input value={createId} onChange={(event) => setCreateId(event.target.value)} placeholder="例如 theater-north" />
        </WarField>
        <WarField label="战区名称">
          <input value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="可选" />
        </WarField>
        <button
          className="secondary-button war-button"
          type="button"
          disabled={isPending || !createId.trim()}
          onClick={handleCreate}
        >
          创建战区
        </button>
      </article>

      {zoneTheater ? (
        <article className="war-card">
          <h3>定义战区区域</h3>
          <WarField label="区域所属战区">
            <select value={zoneTheater.id} onChange={(event) => setZoneTheaterId(event.target.value)}>
              {theaters.map((theater) => (
                <option key={theater.id} value={theater.id}>
                  {theater.name || theater.id} ({theater.id})
                </option>
              ))}
            </select>
          </WarField>
          <WarField label="区域类型">
            <select value={zoneType} onChange={(event) => setZoneType(event.target.value as WarTheaterZoneType)}>
              {THEATER_ZONE_TYPES.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </WarField>
          {zonePlanet ? (
            <WarField label="区域行星">
              <select value={zonePlanet.planet_id} onChange={(event) => setZonePlanetId(event.target.value)}>
                {currentPlanets.map((planet) => (
                  <option key={planet.planet_id} value={planet.planet_id}>
                    {planet.name || planet.planet_id}
                  </option>
                ))}
              </select>
            </WarField>
          ) : null}
          <WarField label="区域半径">
            <input
              type="number"
              min={1}
              value={zoneRadius}
              onChange={(event) => setZoneRadius(Number(event.target.value))}
            />
          </WarField>
          <button
            className="secondary-button war-button"
            type="button"
            disabled={isPending}
            onClick={handleDefineZone}
          >
            定义区域
          </button>
        </article>
      ) : null}

      {objectiveTheater ? (
        <article className="war-card">
          <h3>设定战区目标</h3>
          <WarField label="目标战区">
            <select value={objectiveTheater.id} onChange={(event) => setObjectiveTheaterId(event.target.value)}>
              {theaters.map((theater) => (
                <option key={theater.id} value={theater.id}>
                  {theater.name || theater.id} ({theater.id})
                </option>
              ))}
            </select>
          </WarField>
          <WarField label="目标类型">
            <select value={objectiveType} onChange={(event) => setObjectiveType(event.target.value)}>
              {THEATER_OBJECTIVE_TYPES.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </WarField>
          {objectivePlanet ? (
            <WarField label="目标行星">
              <select value={objectivePlanet.planet_id} onChange={(event) => setObjectivePlanetId(event.target.value)}>
                {currentPlanets.map((planet) => (
                  <option key={planet.planet_id} value={planet.planet_id}>
                    {planet.name || planet.planet_id}
                  </option>
                ))}
              </select>
              </WarField>
          ) : null}
          <WarField label="目标说明">
            <input
              value={objectiveDescription}
              onChange={(event) => setObjectiveDescription(event.target.value)}
              placeholder="可选"
            />
          </WarField>
          <button
            className="secondary-button war-button"
            type="button"
            disabled={isPending}
            onClick={handleSetObjective}
          >
            设定目标
          </button>
        </article>
      ) : null}
    </>
  );
}

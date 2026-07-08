import { useMemo, useState } from 'react';

import type {
  FleetDetailView,
  PlanetRef,
  WarTaskForceMemberKind,
  WarTaskForceStance,
  WarTaskForceView,
  WarTheaterView,
} from '@shared/types';

import { WarField } from '@/features/war/components/WarField';
import type { WarCommandInput, WarQueryScope } from '@/features/war/war-query-keys';
import { useApiClient } from '@/hooks/use-api-client';

const TASK_FORCE_STANCES: WarTaskForceStance[] = [
  'hold',
  'patrol',
  'escort',
  'intercept',
  'harass',
  'siege',
  'bombard',
  'retreat_on_losses',
];

const MEMBER_KINDS: WarTaskForceMemberKind[] = ['fleet', 'squad'];

interface TaskForceFormProps {
  scope: WarQueryScope;
  runCommand: (input: WarCommandInput) => void;
  isPending: boolean;
  taskForces: WarTaskForceView[];
  theaters: WarTheaterView[];
  fleets: FleetDetailView[];
  currentPlanets: PlanetRef[];
  focusSystemId: string;
  selectedPlanetId: string;
}

/**
 * task_force_create / task_force_assign / task_force_deploy：
 * 任务群的组建、编组成员、部署到位三件套，过去必须切 CLI。
 */
export function TaskForceForm({
  scope,
  runCommand,
  isPending,
  taskForces,
  theaters,
  fleets,
  currentPlanets,
  focusSystemId,
  selectedPlanetId,
}: TaskForceFormProps) {
  const client = useApiClient();

  const [createId, setCreateId] = useState('');
  const [createName, setCreateName] = useState('');
  const [createStance, setCreateStance] = useState<WarTaskForceStance>('escort');

  const [assignTaskForceId, setAssignTaskForceId] = useState('');
  const [assignMemberKind, setAssignMemberKind] = useState<WarTaskForceMemberKind>('fleet');
  const [assignMemberIds, setAssignMemberIds] = useState<Record<string, boolean>>({});
  const [assignPlanetId, setAssignPlanetId] = useState('');

  const [deployTaskForceId, setDeployTaskForceId] = useState('');
  const [deployTheaterId, setDeployTheaterId] = useState('');
  const [deployPlanetId, setDeployPlanetId] = useState('');

  const assignTaskForce = useMemo(
    () => taskForces.find((item) => item.id === assignTaskForceId) ?? taskForces[0],
    [taskForces, assignTaskForceId],
  );
  const deployTaskForce = useMemo(
    () => taskForces.find((item) => item.id === deployTaskForceId) ?? taskForces[0],
    [taskForces, deployTaskForceId],
  );
  const deployTheater = useMemo(
    () => theaters.find((item) => item.id === deployTheaterId) ?? theaters[0],
    [theaters, deployTheaterId],
  );
  const assignPlanet = useMemo(
    () => currentPlanets.find((item) => item.planet_id === assignPlanetId)
      ?? currentPlanets.find((item) => item.planet_id === selectedPlanetId)
      ?? currentPlanets[0],
    [currentPlanets, assignPlanetId, selectedPlanetId],
  );
  const deployPlanet = useMemo(
    () => currentPlanets.find((item) => item.planet_id === deployPlanetId)
      ?? currentPlanets.find((item) => item.planet_id === selectedPlanetId)
      ?? currentPlanets[0],
    [currentPlanets, deployPlanetId, selectedPlanetId],
  );

  function handleCreate() {
    const trimmedId = createId.trim();
    if (!trimmedId) {
      return;
    }
    runCommand({
      section: 'theater',
      invalidateKeys: [['war-task-forces', scope.serverUrl, scope.playerId]],
      execute: () => client.cmdTaskForceCreate(trimmedId, {
        name: createName.trim() || undefined,
        stance: createStance,
      }),
    });
    setCreateId('');
    setCreateName('');
  }

  function handleAssign() {
    if (!assignTaskForce?.id) {
      return;
    }
    const memberIds = fleets
      .map((fleet) => fleet.fleet_id)
      .filter((fleetId) => assignMemberIds[fleetId]);
    if (memberIds.length === 0) {
      return;
    }
    runCommand({
      section: 'theater',
      invalidateKeys: [['war-task-forces', scope.serverUrl, scope.playerId]],
      execute: () => client.cmdTaskForceAssign(assignTaskForce.id, {
        memberKind: assignMemberKind,
        memberIds,
        systemId: focusSystemId || undefined,
        planetId: assignPlanet?.planet_id,
      }),
    });
    setAssignMemberIds({});
  }

  function handleDeploy() {
    if (!deployTaskForce?.id) {
      return;
    }
    runCommand({
      section: 'theater',
      invalidateKeys: [
        ['war-task-forces', scope.serverUrl, scope.playerId],
        ['system-runtime', scope.serverUrl, scope.playerId, focusSystemId],
      ],
      execute: () => client.cmdTaskForceDeploy(deployTaskForce.id, {
        theaterId: deployTheater?.id,
        systemId: focusSystemId || undefined,
        planetId: deployPlanet?.planet_id,
      }),
    });
  }

  function toggleMember(fleetId: string) {
    setAssignMemberIds((current) => ({ ...current, [fleetId]: !current[fleetId] }));
  }

  return (
    <>
      <article className="war-card">
        <h3>组建任务群</h3>
        <WarField label="任务群 ID">
          <input value={createId} onChange={(event) => setCreateId(event.target.value)} placeholder="例如 tf-strike" />
        </WarField>
        <WarField label="任务群名称">
          <input value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="可选" />
        </WarField>
        <WarField label="初始姿态">
          <select value={createStance} onChange={(event) => setCreateStance(event.target.value as WarTaskForceStance)}>
            {TASK_FORCE_STANCES.map((stance) => (
              <option key={stance} value={stance}>{stance}</option>
            ))}
          </select>
        </WarField>
        <button
          className="secondary-button war-button"
          type="button"
          disabled={isPending || !createId.trim()}
          onClick={handleCreate}
        >
          组建任务群
        </button>
      </article>

      {assignTaskForce ? (
        <article className="war-card">
          <h3>编组成员</h3>
          <WarField label="编入目标群">
            <select value={assignTaskForce.id} onChange={(event) => setAssignTaskForceId(event.target.value)}>
              {taskForces.map((taskForce) => (
                <option key={taskForce.id} value={taskForce.id}>
                  {taskForce.name || taskForce.id} ({taskForce.id})
                </option>
              ))}
            </select>
          </WarField>
          <WarField label="成员类型">
            <select value={assignMemberKind} onChange={(event) => setAssignMemberKind(event.target.value as WarTaskForceMemberKind)}>
              {MEMBER_KINDS.map((kind) => (
                <option key={kind} value={kind}>{kind}</option>
              ))}
            </select>
          </WarField>
          <div className="war-field">
            <span>编入舰队</span>
            <ul className="war-list">
              {fleets.length === 0 ? <li>暂无可编入的舰队。</li> : fleets.map((fleet) => (
                <li key={fleet.fleet_id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(assignMemberIds[fleet.fleet_id])}
                      onChange={() => toggleMember(fleet.fleet_id)}
                    />
                    {' '}
                    {fleet.fleet_id}
                  </label>
                </li>
              ))}
            </ul>
          </div>
          {assignPlanet ? (
            <WarField label="驻守行星">
              <select value={assignPlanet.planet_id} onChange={(event) => setAssignPlanetId(event.target.value)}>
                {currentPlanets.map((planet) => (
                  <option key={planet.planet_id} value={planet.planet_id}>
                    {planet.name || planet.planet_id}
                  </option>
                ))}
              </select>
            </WarField>
          ) : null}
          <button
            className="secondary-button war-button"
            type="button"
            disabled={isPending}
            onClick={handleAssign}
          >
            编入任务群
          </button>
        </article>
      ) : null}

      {deployTaskForce ? (
        <article className="war-card">
          <h3>部署任务群</h3>
          <WarField label="部署目标任务群">
            <select value={deployTaskForce.id} onChange={(event) => setDeployTaskForceId(event.target.value)}>
              {taskForces.map((taskForce) => (
                <option key={taskForce.id} value={taskForce.id}>
                  {taskForce.name || taskForce.id} ({taskForce.id})
                </option>
              ))}
            </select>
          </WarField>
          {deployTheater ? (
            <WarField label="归属战区">
              <select value={deployTheater.id} onChange={(event) => setDeployTheaterId(event.target.value)}>
                {theaters.map((theater) => (
                  <option key={theater.id} value={theater.id}>
                    {theater.name || theater.id} ({theater.id})
                  </option>
                ))}
              </select>
            </WarField>
          ) : null}
          {deployPlanet ? (
            <WarField label="部署行星">
              <select value={deployPlanet.planet_id} onChange={(event) => setDeployPlanetId(event.target.value)}>
                {currentPlanets.map((planet) => (
                  <option key={planet.planet_id} value={planet.planet_id}>
                    {planet.name || planet.planet_id}
                  </option>
                ))}
              </select>
            </WarField>
          ) : null}
          <button
            className="secondary-button war-button"
            type="button"
            disabled={isPending}
            onClick={handleDeploy}
          >
            部署到位
          </button>
        </article>
      ) : null}
    </>
  );
}

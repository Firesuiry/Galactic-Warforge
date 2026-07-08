import { useMemo, useState } from 'react';

import type {
  FleetDetailView,
  FormationType,
  PlanetRef,
  SensorContact,
} from '@shared/types';

import { WarField } from '@/features/war/components/WarField';
import type { WarCommandInput, WarQueryScope } from '@/features/war/war-query-keys';
import { useApiClient } from '@/hooks/use-api-client';

const FORMATIONS: FormationType[] = ['line', 'vee', 'circle', 'wedge'];

interface FleetActionFormProps {
  scope: WarQueryScope;
  runCommand: (input: WarCommandInput) => void;
  isPending: boolean;
  fleets: FleetDetailView[];
  currentPlanets: PlanetRef[];
  contacts: SensorContact[];
  selectedPlanetId: string;
  focusSystemId: string;
}

/**
 * fleet_assign / fleet_attack / fleet_disband：
 * 舰队的编队、攻击与解散，过去必须切 CLI。
 */
export function FleetActionForm({
  scope,
  runCommand,
  isPending,
  fleets,
  currentPlanets,
  contacts,
  selectedPlanetId,
  focusSystemId,
}: FleetActionFormProps) {
  const client = useApiClient();

  const [assignFleetId, setAssignFleetId] = useState('');
  const [formation, setFormation] = useState<FormationType>('line');

  const [attackFleetId, setAttackFleetId] = useState('');
  const [attackPlanetId, setAttackPlanetId] = useState('');
  const [attackTargetId, setAttackTargetId] = useState('');

  const [disbandFleetId, setDisbandFleetId] = useState('');

  const assignFleet = useMemo(
    () => fleets.find((item) => item.fleet_id === assignFleetId) ?? fleets[0],
    [fleets, assignFleetId],
  );
  const attackFleet = useMemo(
    () => fleets.find((item) => item.fleet_id === attackFleetId) ?? fleets[0],
    [fleets, attackFleetId],
  );
  const attackPlanet = useMemo(
    () => currentPlanets.find((item) => item.planet_id === attackPlanetId)
      ?? currentPlanets.find((item) => item.planet_id === selectedPlanetId)
      ?? currentPlanets[0],
    [currentPlanets, attackPlanetId, selectedPlanetId],
  );
  const enemyContacts = useMemo(
    () => contacts.filter((contact) => contact.contact_kind === 'enemy_force' && contact.entity_id),
    [contacts],
  );
  const attackTarget = useMemo(
    () => enemyContacts.find((contact) => contact.entity_id === attackTargetId) ?? enemyContacts[0],
    [enemyContacts, attackTargetId],
  );
  const disbandFleet = useMemo(
    () => fleets.find((item) => item.fleet_id === disbandFleetId) ?? fleets[0],
    [fleets, disbandFleetId],
  );

  function handleAssign() {
    if (!assignFleet?.fleet_id) {
      return;
    }
    runCommand({
      section: 'reports',
      invalidateKeys: [['war-fleets', scope.serverUrl, scope.playerId]],
      execute: () => client.cmdFleetAssign(assignFleet.fleet_id, formation),
    });
  }

  function handleAttack() {
    if (!attackFleet?.fleet_id || !attackPlanet?.planet_id || !attackTarget?.entity_id) {
      return;
    }
    const targetId = attackTarget.entity_id;
    runCommand({
      section: 'reports',
      invalidateKeys: [
        ['war-fleets', scope.serverUrl, scope.playerId],
        ['system-runtime', scope.serverUrl, scope.playerId, focusSystemId],
      ],
      execute: () => client.cmdFleetAttack(
        attackFleet.fleet_id,
        attackPlanet.planet_id,
        targetId,
      ),
    });
  }

  function handleDisband() {
    if (!disbandFleet?.fleet_id) {
      return;
    }
    runCommand({
      section: 'reports',
      invalidateKeys: [['war-fleets', scope.serverUrl, scope.playerId]],
      execute: () => client.cmdFleetDisband(disbandFleet.fleet_id),
    });
  }

  if (fleets.length === 0) {
    return (
      <article className="war-card">
        <h3>舰队指挥</h3>
        <p className="subtle-text">暂无可用舰队，先在工作台编成舰队后再下达指挥。</p>
      </article>
    );
  }

  return (
    <>
      <article className="war-card">
        <h3>舰队编队</h3>
        <WarField label="编队舰队">
          <select value={assignFleet.fleet_id} onChange={(event) => setAssignFleetId(event.target.value)}>
            {fleets.map((fleet) => (
              <option key={fleet.fleet_id} value={fleet.fleet_id}>
                {fleet.fleet_id}（{fleet.formation}）
              </option>
            ))}
          </select>
        </WarField>
        <WarField label="编队阵型">
          <select value={formation} onChange={(event) => setFormation(event.target.value as FormationType)}>
            {FORMATIONS.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </WarField>
        <button
          className="secondary-button war-button"
          type="button"
          disabled={isPending}
          onClick={handleAssign}
        >
          调整编队
        </button>
      </article>

      {attackFleet && attackPlanet ? (
        <article className="war-card">
          <h3>舰队攻击</h3>
          <WarField label="攻击舰队">
            <select value={attackFleet.fleet_id} onChange={(event) => setAttackFleetId(event.target.value)}>
              {fleets.map((fleet) => (
                <option key={fleet.fleet_id} value={fleet.fleet_id}>{fleet.fleet_id}</option>
              ))}
            </select>
          </WarField>
          <WarField label="交战行星">
            <select value={attackPlanet.planet_id} onChange={(event) => setAttackPlanetId(event.target.value)}>
              {currentPlanets.map((planet) => (
                <option key={planet.planet_id} value={planet.planet_id}>
                  {planet.name || planet.planet_id}
                </option>
              ))}
            </select>
          </WarField>
          <WarField label="攻击目标">
            <select
              value={attackTarget?.entity_id ?? ''}
              onChange={(event) => setAttackTargetId(event.target.value)}
              disabled={enemyContacts.length === 0}
            >
              {enemyContacts.length === 0 ? (
                <option value="">暂无可锁定的敌方接触</option>
              ) : enemyContacts.map((contact) => (
                <option key={contact.entity_id} value={contact.entity_id}>
                  {contact.entity_id}（{contact.classification ?? contact.contact_kind}）
                </option>
              ))}
            </select>
          </WarField>
          <button
            className="secondary-button war-button"
            type="button"
            disabled={isPending || enemyContacts.length === 0}
            onClick={handleAttack}
          >
            下达攻击
          </button>
        </article>
      ) : null}

      {disbandFleet ? (
        <article className="war-card">
          <h3>解散舰队</h3>
          <WarField label="解散舰队">
            <select value={disbandFleet.fleet_id} onChange={(event) => setDisbandFleetId(event.target.value)}>
              {fleets.map((fleet) => (
                <option key={fleet.fleet_id} value={fleet.fleet_id}>{fleet.fleet_id}</option>
              ))}
            </select>
          </WarField>
          <button
            className="secondary-button war-button"
            type="button"
            disabled={isPending}
            onClick={handleDisband}
          >
            解散舰队
          </button>
        </article>
      ) : null}
    </>
  );
}

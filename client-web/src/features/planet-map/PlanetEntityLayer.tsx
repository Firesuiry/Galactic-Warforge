import { memo, useMemo } from 'react';

import type { CatalogView } from '@shared/types';

import type { VisibleEntities } from '@/features/planet-map/visible-entities';
import type { SceneRenderDetailPolicy } from '@/features/planet-map/render';
import type { SelectedEntity } from '@/features/planet-map/model';
import {
  BuildingNode,
  ConstructionNode,
  DetectionNode,
  DroneNode,
  EnemyForceNode,
  EntityLinkLayer,
  PipelineNodeComponent,
  PowerCoverageNode,
  ResourceNode,
  ShipNode,
  UnitNode,
  buildLogisticsSegments,
  buildPipelineSegments,
  buildPowerLinkSegments,
} from '@/features/planet-map/PlanetEntityNode';

/**
 * 语义实体层：叠在 canvas 底图之上的只读 DOM 节点集合。
 *
 * 本组件只负责渲染节点（Fragment），外层 `.entity-layer` 容器（含 transform/--tile）由
 * PlanetMapPixi 持有并交 useImperativeCameraTransform 写入。
 * - memo 时 props 不含 camera.offset，平移不触发节点 DOM 变更（节点按 tile 空间定位，靠容器 transform 整体平移）。
 * - overview 模式（zoom 0-2）下不渲染实体（canvas 只画热力图）。
 * - 实体是 pointer-events:none 的语义 DOM，命中检测走 canvas。
 * - 可见实体集合由 collectVisibleEntities 统一计算（与 PNG 导出共用，避免两处各算一遍）。
 * - V3：selected 用于在对应实体节点上叠 data-selected（CSS 选中呼吸环），tile 选中追加一个 DOM 呼吸环。
 */
export interface PlanetEntityLayerProps {
  catalog?: CatalogView;
  playerId: string;
  tileSize: number;
  detailPolicy: SceneRenderDetailPolicy;
  overviewMode: boolean;
  selected: SelectedEntity | null;
  layers: {
    buildings: boolean;
    units: boolean;
    resources: boolean;
    logistics: boolean;
    construction: boolean;
    threat: boolean;
    power: boolean;
    pipelines: boolean;
  };
  visible: VisibleEntities;
}

function PlanetEntityLayerImpl(props: PlanetEntityLayerProps) {
  const {
    catalog,
    playerId,
    tileSize,
    detailPolicy,
    overviewMode,
    selected,
    layers,
    visible,
  } = props;

  const simplify = detailPolicy.simplifyStructures;
  const showBuildingLabels = detailPolicy.showBuildingLabels;
  // 实体型选中（building/unit/resource）才有 id；tile 选中单独走 DOM 呼吸环分支。
  const selectedEntityId =
    selected && (selected.kind === 'building' || selected.kind === 'unit' || selected.kind === 'resource')
      ? selected.id
      : null;
  const tileSelection =
    selected && selected.kind === 'tile' ? selected.position : null;

  const logisticsSegments = useMemo(
    () => (layers.logistics ? buildLogisticsSegments(visible.logisticsDrones, visible.logisticsShips) : []),
    [layers.logistics, visible.logisticsDrones, visible.logisticsShips],
  );
  const powerSegments = useMemo(
    () => (layers.power ? buildPowerLinkSegments(visible.powerLinks) : []),
    [layers.power, visible.powerLinks],
  );
  const pipelineSegments = useMemo(
    () => (layers.pipelines ? buildPipelineSegments(visible.pipelineSegments) : []),
    [layers.pipelines, visible.pipelineSegments],
  );

  if (overviewMode) {
    return null;
  }

  return (
    <>
      {layers.resources
        ? visible.resources.map((resource) => <ResourceNode key={`resource-${resource.id}`} resource={resource} isSelected={resource.id === selectedEntityId} />)
        : null}

      {layers.construction
        ? visible.constructionTasks.map((task) => (
            <ConstructionNode key={`construction-${task.id}`} task={task} catalog={catalog} showLabel={showBuildingLabels} />
          ))
        : null}

      {layers.pipelines ? (
        <>
          <EntityLinkLayer segments={pipelineSegments} tileSize={tileSize} kind="pipeline" />
          {visible.pipelineNodes.map((node) => (
            <PipelineNodeComponent key={`pipeline-node-${node.id}`} node={node} />
          ))}
        </>
      ) : null}

      {layers.power ? (
        <>
          <EntityLinkLayer segments={powerSegments} tileSize={tileSize} kind="power" />
          {visible.powerCoverage.map((coverage) => (
            <PowerCoverageNode key={`power-coverage-${coverage.building_id}`} coverage={coverage} />
          ))}
        </>
      ) : null}

      {layers.buildings
        ? visible.buildings.map((building) => (
            <BuildingNode
              key={`building-${building.id}`}
              building={building}
              catalog={catalog}
              playerId={playerId}
              simplify={simplify}
              showLabel={showBuildingLabels}
              isSelected={building.id === selectedEntityId}
            />
          ))
        : null}

      {layers.units
        ? visible.units.map((unit) => (
            <UnitNode
              key={`unit-${unit.id}`}
              unit={unit}
              playerId={playerId}
              simplify={simplify}
              isSelected={unit.id === selectedEntityId}
            />
          ))
        : null}

      {layers.logistics ? (
        <>
          <EntityLinkLayer segments={logisticsSegments} tileSize={tileSize} kind="logistics" />
          {visible.logisticsDrones.map((drone) => <DroneNode key={`drone-${drone.id}`} drone={drone} />)}
          {visible.logisticsShips.map((ship) => <ShipNode key={`ship-${ship.id}`} ship={ship} />)}
        </>
      ) : null}

      {layers.threat ? (
        <>
          {visible.enemyForces.map((force) => <EnemyForceNode key={`enemy-${force.id}`} force={force} />)}
          {visible.detections.flatMap((detection, detectionIndex) => (
            (detection.detected_positions ?? []).map((_, positionIndex) => (
              <DetectionNode
                key={`detection-${detection.player_id}-${detectionIndex}-${positionIndex}`}
                detection={detection}
                positionIndex={positionIndex}
              />
            ))
          ))}
        </>
      ) : null}

      {/* V3：tile 选中的 DOM 呼吸环（canvas 已画高亮，此为叠加的 accent 呼吸） */}
      {tileSelection ? (
        <div
          aria-hidden="true"
          className="entity-node entity-node--selection-tile"
          style={{
            left: `calc(var(--tile) * ${tileSelection.x})`,
            top: `calc(var(--tile) * ${tileSelection.y})`,
            width: 'calc(var(--tile) * 1)',
            height: 'calc(var(--tile) * 1)',
          }}
        />
      ) : null}
    </>
  );
}

export const PlanetEntityLayer = memo(PlanetEntityLayerImpl);

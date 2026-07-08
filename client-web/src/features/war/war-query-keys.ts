import type { CommandResult } from '@shared/types';

/**
 * 战争工作台查询键的集中构造器。
 *
 * 消除 WarPage 内散落的 `['war-blueprints', serverUrl, playerId]` 等字面量重复，
 * 同时让命令提交后的 `invalidateQueries` 与 SSE 实时层的失效逻辑共用同一份真相源。
 */
export interface WarQueryScope {
  serverUrl: string;
  playerId: string;
}

export type FeedbackSection = 'blueprint' | 'industry' | 'theater' | 'reports';

export interface WarCommandInput {
  section: FeedbackSection;
  invalidateKeys: unknown[][];
  execute: () => Promise<{ results: CommandResult[] }>;
}

export const warQueryKeys = {
  summary: (scope: WarQueryScope) => ['summary', scope.serverUrl, scope.playerId] as const,
  catalog: (scope: WarQueryScope) => ['catalog', scope.serverUrl, scope.playerId] as const,
  blueprints: (scope: WarQueryScope) => ['war-blueprints', scope.serverUrl, scope.playerId] as const,
  industry: (scope: WarQueryScope) => ['war-industry', scope.serverUrl, scope.playerId] as const,
  taskForces: (scope: WarQueryScope) => ['war-task-forces', scope.serverUrl, scope.playerId] as const,
  theaters: (scope: WarQueryScope) => ['war-theaters', scope.serverUrl, scope.playerId] as const,
  fleets: (scope: WarQueryScope) => ['war-fleets', scope.serverUrl, scope.playerId] as const,
  planet: (scope: WarQueryScope, planetId: string) =>
    ['planet', scope.serverUrl, scope.playerId, planetId] as const,
  system: (scope: WarQueryScope, systemId: string) =>
    ['system', scope.serverUrl, scope.playerId, systemId] as const,
  systemRuntime: (scope: WarQueryScope, systemId: string) =>
    ['system-runtime', scope.serverUrl, scope.playerId, systemId] as const,
};

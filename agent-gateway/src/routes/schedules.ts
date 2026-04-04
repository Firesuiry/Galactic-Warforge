import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AgentInstance, ScheduleJob } from '../types.js';

interface AgentStore {
  get: (id: string) => Promise<AgentInstance | null>;
}

interface ScheduleStore {
  list: () => Promise<ScheduleJob[]>;
  get: (id: string) => Promise<ScheduleJob | null>;
  save: (schedule: ScheduleJob) => Promise<void>;
}

interface ScheduleRouteContext {
  agentStore: AgentStore;
  scheduleStore: ScheduleStore;
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw) as T;
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

async function canCreateSchedule(
  creatorType: 'player' | 'agent',
  creatorId: string,
  agentStore: AgentStore,
) {
  if (creatorType === 'player') {
    return true;
  }
  const creator = await agentStore.get(creatorId);
  return Boolean(creator?.policy?.canCreateSchedules);
}

export async function handleScheduleRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  context: ScheduleRouteContext,
) {
  const url = new URL(request.url ?? '/schedules', 'http://127.0.0.1');

  if (request.method === 'GET' && url.pathname === '/schedules') {
    writeJson(response, 200, await context.scheduleStore.list());
    return;
  }

  if (request.method === 'POST' && url.pathname === '/schedules') {
    const payload = await readJsonBody<{
      id?: string;
      workspaceId?: string;
      name?: string;
      ownerAgentId: string;
      creatorType: 'player' | 'agent';
      creatorId: string;
      targetType: 'agent_dm' | 'conversation';
      targetId: string;
      intervalSeconds: number;
      messageTemplate: string;
    }>(request);

    if (!await canCreateSchedule(payload.creatorType, payload.creatorId, context.agentStore)) {
      writeJson(response, 403, { error: 'schedule_not_allowed' });
      return;
    }

    const now = new Date().toISOString();
    const schedule: ScheduleJob = {
      id: payload.id ?? randomUUID(),
      workspaceId: payload.workspaceId ?? 'workspace-default',
      name: payload.name ?? '定时任务',
      ownerAgentId: payload.ownerAgentId,
      creatorType: payload.creatorType,
      creatorId: payload.creatorId,
      targetType: payload.targetType,
      targetId: payload.targetId,
      intervalSeconds: payload.intervalSeconds,
      messageTemplate: payload.messageTemplate,
      enabled: true,
      nextRunAt: new Date(Date.now() + payload.intervalSeconds * 1000).toISOString(),
      createdAt: now,
      updatedAt: now,
    };
    await context.scheduleStore.save(schedule);
    writeJson(response, 201, schedule);
    return;
  }

  if (request.method === 'PATCH' && url.pathname.match(/^\/schedules\/[^/]+$/)) {
    const scheduleId = url.pathname.split('/')[2] ?? '';
    const schedule = await context.scheduleStore.get(scheduleId);
    if (!schedule) {
      writeJson(response, 404, { error: 'schedule_not_found' });
      return;
    }

    const payload = await readJsonBody<Partial<Pick<ScheduleJob, 'targetType' | 'targetId' | 'intervalSeconds' | 'messageTemplate' | 'enabled'>>>(request);
    const updated: ScheduleJob = {
      ...schedule,
      ...payload,
      updatedAt: new Date().toISOString(),
    };
    await context.scheduleStore.save(updated);
    writeJson(response, 200, updated);
    return;
  }

  writeJson(response, 404, { error: 'schedule_route_not_found', path: url.pathname });
}

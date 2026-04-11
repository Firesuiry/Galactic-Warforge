import { useEffect, useState, type FormEvent } from 'react';

import { getMissingPolicyCategories, getProviderCommandCoverageCategories } from './provider-command-catalog';
import { ProviderManagerView } from './ProviderManagerView';
import type {
  AgentPolicyView,
  AgentProfileView,
  CreateProviderPayload,
  ModelProviderView,
  ScheduleView,
} from './types';

interface MemberWorkspaceViewProps {
  fixtureMode: boolean;
  agents: AgentProfileView[];
  providers: ModelProviderView[];
  schedules: ScheduleView[];
  selectedAgentId: string;
  showCreateMember: boolean;
  showProviderManager: boolean;
  memberName: string;
  memberProviderId: string;
  scheduleIntervalSeconds: string;
  scheduleMessage: string;
  onMemberNameChange: (value: string) => void;
  onMemberProviderIdChange: (value: string) => void;
  onOpenProviderManager: () => void;
  onCloseProviderManager: () => void;
  onCreateProvider: (payload: CreateProviderPayload) => void;
  onCreateMember: (event: FormEvent<HTMLFormElement>) => void;
  onStartDm: (agentId: string) => void;
  onScheduleIntervalChange: (value: string) => void;
  onScheduleMessageChange: (value: string) => void;
  onCreateSchedule: (event: FormEvent<HTMLFormElement>) => void;
  onToggleScheduleEnabled: (scheduleId: string, enabled: boolean) => void;
  onSavePolicy: (policy: AgentPolicyView) => void;
  onSaveAgentProvider: (providerId: string) => void;
}

function createEmptyPolicy(): AgentPolicyView {
  return {
    planetIds: [],
    commandCategories: [],
    canCreateAgents: false,
    canCreateChannel: false,
    canManageMembers: false,
    canInviteByPlanet: false,
    canCreateSchedules: false,
    canDirectMessageAgentIds: [],
    canDispatchAgentIds: [],
  };
}

function parseCommaSeparated(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formatProviderName(providerId: string, providers: ModelProviderView[]) {
  return providers.find((provider) => provider.id === providerId)?.name ?? providerId;
}

function formatScheduleTarget(schedule: ScheduleView, agent: AgentProfileView) {
  if (schedule.targetType === 'agent_dm') {
    return `投递到与 ${agent.name} 的定时私聊`;
  }
  return `投递到会话 ${schedule.targetId}`;
}

export function MemberWorkspaceView(props: MemberWorkspaceViewProps) {
  const selectedAgent = props.agents.find((agent) => agent.id === props.selectedAgentId);
  const selectedProvider = selectedAgent
    ? props.providers.find((provider) => provider.id === selectedAgent.providerId)
    : undefined;
  const selectedDraftProvider = props.providers.find((provider) => provider.id === props.memberProviderId);
  const ownedSchedules = selectedAgent
    ? props.schedules.filter((schedule) => schedule.ownerAgentId === selectedAgent.id)
    : [];
  const selectedProviderMissingCategories = selectedAgent && selectedProvider
    ? getMissingPolicyCategories(
        selectedProvider.toolPolicy.commandWhitelist,
        selectedAgent.policy?.commandCategories ?? [],
      )
    : [];
  const [planetIdsText, setPlanetIdsText] = useState('');
  const [commandCategoriesText, setCommandCategoriesText] = useState('');
  const [directMessageAgentIdsText, setDirectMessageAgentIdsText] = useState('');
  const [dispatchAgentIdsText, setDispatchAgentIdsText] = useState('');
  const [selectedAgentProviderId, setSelectedAgentProviderId] = useState('');
  const [canCreateAgents, setCanCreateAgents] = useState(false);
  const [canCreateChannel, setCanCreateChannel] = useState(false);
  const [canManageMembers, setCanManageMembers] = useState(false);
  const [canInviteByPlanet, setCanInviteByPlanet] = useState(false);
  const [canCreateSchedules, setCanCreateSchedules] = useState(false);

  useEffect(() => {
    const policy = selectedAgent?.policy ?? createEmptyPolicy();
    setPlanetIdsText(policy.planetIds.join(', '));
    setCommandCategoriesText(policy.commandCategories.join(', '));
    setDirectMessageAgentIdsText(policy.canDirectMessageAgentIds.join(', '));
    setDispatchAgentIdsText(policy.canDispatchAgentIds.join(', '));
    setSelectedAgentProviderId(selectedAgent?.providerId ?? '');
    setCanCreateAgents(policy.canCreateAgents ?? false);
    setCanCreateChannel(policy.canCreateChannel);
    setCanManageMembers(policy.canManageMembers);
    setCanInviteByPlanet(policy.canInviteByPlanet);
    setCanCreateSchedules(policy.canCreateSchedules);
  }, [selectedAgent]);

  function handleSavePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAgent || props.fixtureMode) {
      return;
    }

    props.onSavePolicy({
      planetIds: parseCommaSeparated(planetIdsText),
      commandCategories: parseCommaSeparated(commandCategoriesText),
      canCreateAgents,
      canCreateChannel,
      canManageMembers,
      canInviteByPlanet,
      canCreateSchedules,
      canDirectMessageAgentIds: parseCommaSeparated(directMessageAgentIdsText),
      canDispatchAgentIds: parseCommaSeparated(dispatchAgentIdsText),
    });
  }

  function handleSaveAgentProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAgentProviderId || props.fixtureMode) {
      return;
    }
    props.onSaveAgentProvider(selectedAgentProviderId);
  }

  return (
    <section className="panel agent-members-view">
      <div className="agent-members-view__header">
        <div>
          <h2>{props.showCreateMember ? '新建成员' : selectedAgent?.name ?? '选择一个成员'}</h2>
          <p className="subtle-text">
            {props.showCreateMember
              ? '成员先独立创建，再由频道设置把成员拉进不同协作频道。'
              : selectedAgent
                ? `当前状态 ${selectedAgent.status}，可在这里管理模型 Provider、私聊入口和成员级定时任务。`
                : '从左侧选择成员，或直接创建一个新的成员。'}
          </p>
        </div>
        {!props.showCreateMember && selectedAgent ? (
          <div className="agent-members-view__actions">
            <button className="primary-button" onClick={() => props.onStartDm(selectedAgent.id)} type="button">
              发起私聊
            </button>
          </div>
        ) : null}
      </div>

      {props.showCreateMember ? (
        <div className="agent-members-view__stack">
          <form className="agent-im__composer-card" onSubmit={props.onCreateMember}>
            <label className="field">
              <span>成员名称</span>
              <input
                aria-label="成员名称"
                value={props.memberName}
                onChange={(event) => props.onMemberNameChange(event.target.value)}
              />
            </label>
            <label className="field">
              <span>绑定模型 Provider</span>
              <select
                aria-label="绑定模型 Provider"
                value={props.memberProviderId}
                onChange={(event) => props.onMemberProviderIdChange(event.target.value)}
              >
                <option value="">请选择一个模型 Provider</option>
                {props.providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.name}</option>
                ))}
              </select>
            </label>
            <div className="agent-members-view__inline-actions">
              <button className="secondary-button" onClick={props.onOpenProviderManager} type="button">
                新建模型 Provider
              </button>
              <button
                className="primary-button"
                disabled={!props.memberName.trim() || !props.memberProviderId || props.fixtureMode}
                type="submit"
              >
                保存成员
              </button>
            </div>
          </form>

          {selectedDraftProvider ? (
            <div className="agent-im__detail-card">
              <strong>当前模型 Provider</strong>
              <span>{selectedDraftProvider.name}</span>
              <span>{selectedDraftProvider.description || '未填写模型 Provider 说明'}</span>
              <span>
                {selectedDraftProvider.toolPolicy.commandWhitelist.length > 0
                  ? `命令白名单 ${selectedDraftProvider.toolPolicy.commandWhitelist.length} 项 · ${getProviderCommandCoverageCategories(selectedDraftProvider.toolPolicy.commandWhitelist).join(', ')}`
                  : '命令白名单未限制'}
              </span>
              {selectedDraftProvider.toolPolicy.commandWhitelist.length > 0 ? (
                <span>{selectedDraftProvider.toolPolicy.commandWhitelist.join(', ')}</span>
              ) : null}
            </div>
          ) : (
            <div className="agent-members-view__placeholder">
              <div className="section-title">先选择模型 Provider</div>
              <p className="subtle-text">成员创建时必须绑定模型 Provider。没有 Provider 时，可直接在这里新建。</p>
            </div>
          )}

          {props.showProviderManager ? (
            <ProviderManagerView
              fixtureMode={props.fixtureMode}
              providers={props.providers}
              onCreateProvider={props.onCreateProvider}
              onClose={props.onCloseProviderManager}
            />
          ) : null}
        </div>
      ) : selectedAgent ? (
        <div className="agent-members-view__stack">
          <div className="agent-members-view__body">
            <div className="agent-im__detail-card">
              <strong>模型 Provider</strong>
              <span>{selectedProvider?.name ?? formatProviderName(selectedAgent.providerId, props.providers)}</span>
              <span>{selectedProvider?.description || '未填写模型 Provider 说明'}</span>
              {selectedProvider ? (
                <>
                  <span>
                    {selectedProvider.toolPolicy.commandWhitelist.length > 0
                      ? `命令白名单 ${selectedProvider.toolPolicy.commandWhitelist.length} 项 · ${getProviderCommandCoverageCategories(selectedProvider.toolPolicy.commandWhitelist).join(', ')}`
                      : '命令白名单未限制'}
                  </span>
                  {selectedProvider.toolPolicy.commandWhitelist.length > 0 ? (
                    <span>{selectedProvider.toolPolicy.commandWhitelist.join(', ')}</span>
                  ) : null}
                  {selectedProviderMissingCategories.length > 0 ? (
                    <span className="subtle-text">
                      当前成员权限包含 {selectedProviderMissingCategories.join(', ')}，但 Provider 白名单未显式覆盖这些类别，请同步检查两边配置。
                    </span>
                  ) : null}
                </>
              ) : null}
            </div>
            <div className="agent-im__detail-card">
              <strong>运行状态</strong>
              <span>{selectedAgent.status}</span>
              <span>{selectedAgent.role ? `角色 ${selectedAgent.role}` : '未声明角色'}</span>
            </div>
            <div className="agent-im__detail-card">
              <strong>权限范围</strong>
              {selectedAgent.policy?.planetIds.length ? <span>星球 {selectedAgent.policy.planetIds.join(', ')}</span> : <span>未配置星球范围</span>}
              {selectedAgent.policy?.commandCategories.length ? (
                <div className="agent-im__tag-row">
                  {selectedAgent.policy.commandCategories.map((category) => (
                    <span key={category} className="agent-im__tag">{category}</span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <section className="agent-members-view__section">
            <div className="agent-members-view__section-header">
              <div>
                <div className="section-title">模型 Provider 绑定</div>
                <p className="subtle-text">可以在成员详情页切换当前成员绑定的模型 Provider。</p>
              </div>
            </div>

            <form className="agent-im__composer-card" onSubmit={handleSaveAgentProvider}>
              <label className="field">
                <span>绑定模型 Provider</span>
                <select
                  aria-label="绑定模型 Provider"
                  value={selectedAgentProviderId}
                  onChange={(event) => setSelectedAgentProviderId(event.target.value)}
                >
                  <option value="">请选择一个模型 Provider</option>
                  {props.providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.name}</option>
                  ))}
                </select>
              </label>
              <button className="primary-button" disabled={!selectedAgentProviderId || props.fixtureMode} type="submit">
                保存模型 Provider 绑定
              </button>
            </form>
          </section>

          <section className="agent-members-view__section">
            <div className="agent-members-view__section-header">
              <div>
                <div className="section-title">权限配置</div>
                <p className="subtle-text">在这里限定成员可操作的星球、命令分类和协作能力。</p>
              </div>
            </div>

            <form className="agent-im__composer-card" onSubmit={handleSavePolicy}>
              <label className="field">
                <span>星球范围</span>
                <input
                  aria-label="星球范围"
                  value={planetIdsText}
                  onChange={(event) => setPlanetIdsText(event.target.value)}
                />
                <span className="field-hint">多个值用英文逗号分隔，例如 `planet-a, planet-b`。</span>
              </label>
              <label className="field">
                <span>命令分类</span>
                <input
                  aria-label="命令分类"
                  value={commandCategoriesText}
                  onChange={(event) => setCommandCategoriesText(event.target.value)}
                />
              </label>
              <label className="field">
                <span>可私聊成员</span>
                <input
                  aria-label="可私聊成员"
                  value={directMessageAgentIdsText}
                  onChange={(event) => setDirectMessageAgentIdsText(event.target.value)}
                />
              </label>
              <label className="field">
                <span>可调度成员</span>
                <input
                  aria-label="可调度成员"
                  value={dispatchAgentIdsText}
                  onChange={(event) => setDispatchAgentIdsText(event.target.value)}
                />
              </label>

              <div className="agent-form__checkbox-grid">
                <label className="agent-form__checkbox">
                  <input
                    aria-label="允许创建智能体"
                    checked={canCreateAgents}
                    onChange={(event) => setCanCreateAgents(event.target.checked)}
                    type="checkbox"
                  />
                  <span>允许创建智能体</span>
                </label>
                <label className="agent-form__checkbox">
                  <input
                    aria-label="允许创建频道"
                    checked={canCreateChannel}
                    onChange={(event) => setCanCreateChannel(event.target.checked)}
                    type="checkbox"
                  />
                  <span>允许创建频道</span>
                </label>
                <label className="agent-form__checkbox">
                  <input
                    aria-label="允许管理成员"
                    checked={canManageMembers}
                    onChange={(event) => setCanManageMembers(event.target.checked)}
                    type="checkbox"
                  />
                  <span>允许管理成员</span>
                </label>
                <label className="agent-form__checkbox">
                  <input
                    aria-label="允许按星球拉人"
                    checked={canInviteByPlanet}
                    onChange={(event) => setCanInviteByPlanet(event.target.checked)}
                    type="checkbox"
                  />
                  <span>允许按星球拉人</span>
                </label>
                <label className="agent-form__checkbox">
                  <input
                    aria-label="允许创建定时任务"
                    checked={canCreateSchedules}
                    onChange={(event) => setCanCreateSchedules(event.target.checked)}
                    type="checkbox"
                  />
                  <span>允许创建定时任务</span>
                </label>
              </div>

              <button className="primary-button" disabled={props.fixtureMode} type="submit">
                保存权限配置
              </button>
            </form>
          </section>

          <section className="agent-members-view__section">
            <div className="agent-members-view__section-header">
              <div>
                <div className="section-title">成员定时任务</div>
                <p className="subtle-text">任务归属到成员，由成员详情页统一查看、启停和新增。</p>
              </div>
            </div>

            {ownedSchedules.length > 0 ? (
              <ul className="agent-im__detail-list">
                {ownedSchedules.map((schedule) => (
                  <li key={schedule.id} className="agent-im__detail-card">
                    <strong>{schedule.messageTemplate}</strong>
                    <span>{`每 ${schedule.intervalSeconds} 秒发送一次`}</span>
                    <span>{formatScheduleTarget(schedule, selectedAgent)}</span>
                    <span>{schedule.enabled ? '已启用' : '已停用'}</span>
                    <button
                      className="secondary-button"
                      onClick={() => props.onToggleScheduleEnabled(schedule.id, !schedule.enabled)}
                      type="button"
                    >
                      {schedule.enabled ? '停用任务' : '启用任务'}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="agent-members-view__placeholder">
                <div className="section-title">还没有定时任务</div>
                <p className="subtle-text">从这里为成员创建自己的巡检、汇报或同步任务。</p>
              </div>
            )}

            <form className="agent-im__composer-card" onSubmit={props.onCreateSchedule}>
              <label className="field">
                <span>任务间隔（秒）</span>
                <input
                  aria-label="任务间隔（秒）"
                  value={props.scheduleIntervalSeconds}
                  onChange={(event) => props.onScheduleIntervalChange(event.target.value)}
                />
              </label>
              <label className="field">
                <span>任务内容</span>
                <textarea
                  aria-label="任务内容"
                  rows={4}
                  value={props.scheduleMessage}
                  onChange={(event) => props.onScheduleMessageChange(event.target.value)}
                />
              </label>
              <button className="primary-button" disabled={props.fixtureMode} type="submit">
                创建定时任务
              </button>
            </form>
          </section>
        </div>
      ) : (
        <div className="agent-members-view__placeholder">
          <div className="section-title">还没有可查看的成员</div>
          <p className="subtle-text">在左侧点击“新建成员”，随后可从这里进入成员详情、模型 Provider 和定时任务。</p>
        </div>
      )}
    </section>
  );
}

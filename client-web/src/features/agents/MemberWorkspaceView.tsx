import type { FormEvent } from 'react';

import { TemplateManagerView } from './TemplateManagerView';
import type {
  AgentProfileView,
  AgentTemplateView,
  ScheduleView,
} from './types';

interface MemberWorkspaceViewProps {
  fixtureMode: boolean;
  agents: AgentProfileView[];
  templates: AgentTemplateView[];
  schedules: ScheduleView[];
  selectedAgentId: string;
  showCreateMember: boolean;
  showTemplateManager: boolean;
  memberName: string;
  memberTemplateId: string;
  templateName: string;
  templateDescription: string;
  scheduleIntervalSeconds: string;
  scheduleMessage: string;
  onMemberNameChange: (value: string) => void;
  onMemberTemplateIdChange: (value: string) => void;
  onOpenTemplateManager: () => void;
  onCloseTemplateManager: () => void;
  onTemplateNameChange: (value: string) => void;
  onTemplateDescriptionChange: (value: string) => void;
  onCreateTemplate: (event: FormEvent<HTMLFormElement>) => void;
  onCreateMember: (event: FormEvent<HTMLFormElement>) => void;
  onStartDm: (agentId: string) => void;
  onScheduleIntervalChange: (value: string) => void;
  onScheduleMessageChange: (value: string) => void;
  onCreateSchedule: (event: FormEvent<HTMLFormElement>) => void;
  onToggleScheduleEnabled: (scheduleId: string, enabled: boolean) => void;
}

function formatTemplateName(templateId: string, templates: AgentTemplateView[]) {
  return templates.find((template) => template.id === templateId)?.name ?? templateId;
}

function formatScheduleTarget(schedule: ScheduleView, agent: AgentProfileView) {
  if (schedule.targetType === 'agent_dm') {
    return `投递到与 ${agent.name} 的定时私聊`;
  }
  return `投递到会话 ${schedule.targetId}`;
}

export function MemberWorkspaceView(props: MemberWorkspaceViewProps) {
  const selectedAgent = props.agents.find((agent) => agent.id === props.selectedAgentId);
  const selectedTemplate = selectedAgent
    ? props.templates.find((template) => template.id === selectedAgent.templateId)
    : undefined;
  const selectedDraftTemplate = props.templates.find((template) => template.id === props.memberTemplateId);
  const ownedSchedules = selectedAgent
    ? props.schedules.filter((schedule) => schedule.ownerAgentId === selectedAgent.id)
    : [];

  return (
    <section className="panel agent-members-view">
      <div className="agent-members-view__header">
        <div>
          <h2>{props.showCreateMember ? '新建成员' : selectedAgent?.name ?? '选择一个成员'}</h2>
          <p className="subtle-text">
            {props.showCreateMember
              ? '成员先独立创建，再由频道设置把成员拉进不同协作频道。'
              : selectedAgent
                ? `当前状态 ${selectedAgent.status}，可在这里管理模板、私聊入口和成员级定时任务。`
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
              <span>绑定模板</span>
              <select
                aria-label="绑定模板"
                value={props.memberTemplateId}
                onChange={(event) => props.onMemberTemplateIdChange(event.target.value)}
              >
                <option value="">请选择一个模板</option>
                {props.templates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            </label>
            <div className="agent-members-view__inline-actions">
              <button className="secondary-button" onClick={props.onOpenTemplateManager} type="button">
                新建模板
              </button>
              <button
                className="primary-button"
                disabled={!props.memberName.trim() || !props.memberTemplateId || props.fixtureMode}
                type="submit"
              >
                保存成员
              </button>
            </div>
          </form>

          {selectedDraftTemplate ? (
            <div className="agent-im__detail-card">
              <strong>当前模板</strong>
              <span>{selectedDraftTemplate.name}</span>
              <span>{selectedDraftTemplate.description || '未填写模板说明'}</span>
            </div>
          ) : (
            <div className="agent-members-view__placeholder">
              <div className="section-title">先选择模板</div>
              <p className="subtle-text">成员创建时必须绑定模板。没有模板时，可直接在这里新建。</p>
            </div>
          )}

          {props.showTemplateManager ? (
            <TemplateManagerView
              fixtureMode={props.fixtureMode}
              templates={props.templates}
              templateName={props.templateName}
              templateDescription={props.templateDescription}
              onTemplateNameChange={props.onTemplateNameChange}
              onTemplateDescriptionChange={props.onTemplateDescriptionChange}
              onCreateTemplate={props.onCreateTemplate}
              onClose={props.onCloseTemplateManager}
            />
          ) : null}
        </div>
      ) : selectedAgent ? (
        <div className="agent-members-view__stack">
          <div className="agent-members-view__body">
            <div className="agent-im__detail-card">
              <strong>模板</strong>
              <span>{selectedTemplate?.name ?? formatTemplateName(selectedAgent.templateId, props.templates)}</span>
              <span>{selectedTemplate?.description || '未填写模板说明'}</span>
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
          <p className="subtle-text">在左侧点击“新建成员”，随后可从这里进入成员详情、模板和定时任务。</p>
        </div>
      )}
    </section>
  );
}

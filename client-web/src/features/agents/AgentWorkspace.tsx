import type { FormEvent } from 'react';

import { AgentsSidebar, type AgentsPane } from './AgentsSidebar';
import type {
  AgentProfileView,
  ConversationMessageView,
  ConversationView,
  ScheduleView,
} from './types';

interface AgentWorkspaceProps {
  gatewayOnline: boolean;
  fixtureMode: boolean;
  activePane: AgentsPane;
  conversations: ConversationView[];
  selectedConversationId: string;
  messages: ConversationMessageView[];
  messagesLoading: boolean;
  agents: AgentProfileView[];
  selectedAgentId: string;
  schedules: ScheduleView[];
  showCreateChannel: boolean;
  showCreateMember: boolean;
  channelName: string;
  channelTopic: string;
  messageInput: string;
  invitePlanetId: string;
  scheduleIntervalSeconds: string;
  scheduleMessage: string;
  onPaneChange: (pane: AgentsPane) => void;
  onSelectConversation: (conversationId: string) => void;
  onSelectAgent: (agentId: string) => void;
  onToggleCreateChannel: () => void;
  onOpenCreateMember: () => void;
  onChannelNameChange: (value: string) => void;
  onChannelTopicChange: (value: string) => void;
  onMessageInputChange: (value: string) => void;
  onInvitePlanetIdChange: (value: string) => void;
  onScheduleIntervalChange: (value: string) => void;
  onScheduleMessageChange: (value: string) => void;
  onCreateChannel: (event: FormEvent<HTMLFormElement>) => void;
  onSendMessage: (event: FormEvent<HTMLFormElement>) => void;
  onInviteByPlanet: (event: FormEvent<HTMLFormElement>) => void;
  onCreateSchedule: (event: FormEvent<HTMLFormElement>) => void;
}

function formatMemberLabel(memberId: string, agents: AgentProfileView[]) {
  if (memberId.startsWith('player:')) {
    return `玩家 ${memberId.slice('player:'.length)}`;
  }
  const agentId = memberId.slice('agent:'.length);
  return agents.find((agent) => agent.id === agentId)?.name ?? agentId;
}

export function AgentWorkspace(props: AgentWorkspaceProps) {
  const selectedConversation = props.conversations.find((conversation) => conversation.id === props.selectedConversationId);
  const selectedConversationSchedules = selectedConversation
    ? props.schedules.filter((schedule) => schedule.targetType === 'conversation' && schedule.targetId === selectedConversation.id)
    : [];
  const selectedConversationAgents = selectedConversation
    ? selectedConversation.memberIds
      .filter((memberId) => memberId.startsWith('agent:'))
      .map((memberId) => props.agents.find((agent) => agent.id === memberId.slice('agent:'.length)))
      .filter((agent): agent is AgentProfileView => Boolean(agent))
    : [];
  const selectedAgent = props.agents.find((agent) => agent.id === props.selectedAgentId);

  return (
    <div className="agent-workspace-shell">
      <AgentsSidebar
        gatewayOnline={props.gatewayOnline}
        fixtureMode={props.fixtureMode}
        activePane={props.activePane}
        conversations={props.conversations}
        selectedConversationId={props.selectedConversationId}
        agents={props.agents}
        selectedAgentId={props.selectedAgentId}
        showCreateChannel={props.showCreateChannel}
        channelName={props.channelName}
        channelTopic={props.channelTopic}
        onPaneChange={props.onPaneChange}
        onSelectConversation={props.onSelectConversation}
        onSelectAgent={props.onSelectAgent}
        onToggleCreateChannel={props.onToggleCreateChannel}
        onChannelNameChange={props.onChannelNameChange}
        onChannelTopicChange={props.onChannelTopicChange}
        onCreateChannel={props.onCreateChannel}
        onOpenCreateMember={props.onOpenCreateMember}
      />

      {props.activePane === 'channels' ? (
        <div className="agent-workspace-shell__content agent-workspace-shell__content--channels">
          <main className="panel agent-im__thread">
            <div className="agent-im__thread-header">
              <div>
                <h2>{selectedConversation?.name ?? '选择一个会话'}</h2>
                <p className="subtle-text">{selectedConversation?.topic || '在频道里通过 @ 或私聊推动协作。'}</p>
              </div>
              {selectedConversation ? (
                <div className="agent-im__thread-meta">
                  <span>{selectedConversation.type === 'channel' ? '频道' : '私聊'}</span>
                  <span>{selectedConversation.memberIds.length} 名成员</span>
                </div>
              ) : null}
            </div>

            <div className="agent-im__messages">
              {props.messagesLoading ? (
                <p className="subtle-text">正在加载消息...</p>
              ) : props.messages.length > 0 ? props.messages.map((message) => (
                <article key={message.id} className={`agent-im__message agent-im__message--${message.senderType}`}>
                  <header>
                    <strong>{message.senderType === 'player' ? '玩家' : message.senderType === 'agent' ? message.senderId : message.kind}</strong>
                  </header>
                  <p>{message.content}</p>
                </article>
              )) : (
                <p className="subtle-text">当前会话暂无消息。</p>
              )}
            </div>

            <form className="agent-im__composer" onSubmit={props.onSendMessage}>
              <label className="field">
                <span>发送消息</span>
                <textarea
                  aria-label="发送消息"
                  rows={4}
                  value={props.messageInput}
                  onChange={(event) => props.onMessageInputChange(event.target.value)}
                />
              </label>
              <button className="primary-button" disabled={!selectedConversation || props.fixtureMode} type="submit">
                发送
              </button>
            </form>
          </main>

          <aside className="panel agent-im__details">
            <div className="section-title">成员与权限</div>
            {selectedConversation ? (
              <ul className="agent-im__detail-list">
                {selectedConversation.memberIds.map((memberId) => {
                  const agent = memberId.startsWith('agent:')
                    ? props.agents.find((entry) => entry.id === memberId.slice('agent:'.length))
                    : undefined;
                  return (
                    <li key={memberId} className="agent-im__detail-card">
                      <strong>{formatMemberLabel(memberId, props.agents)}</strong>
                      {agent?.policy?.planetIds.length ? <span>星球 {agent.policy.planetIds.join(', ')}</span> : null}
                      {agent?.policy?.commandCategories.length ? (
                        <div className="agent-im__tag-row">
                          {agent.policy.commandCategories.map((category) => (
                            <span key={category} className="agent-im__tag">{category}</span>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="subtle-text">选择会话后可查看成员和权限范围。</p>
            )}

            <form className="agent-im__composer-card" onSubmit={props.onInviteByPlanet}>
              <div className="section-title">按星球拉人</div>
              <label className="field">
                <span>星球 ID</span>
                <input value={props.invitePlanetId} onChange={(event) => props.onInvitePlanetIdChange(event.target.value)} />
              </label>
              <button className="secondary-button" disabled={!selectedConversation || props.fixtureMode} type="submit">
                按星球拉人
              </button>
            </form>

            <div className="section-title">定时任务</div>
            <ul className="agent-im__detail-list">
              {selectedConversationSchedules.length > 0 ? selectedConversationSchedules.map((schedule) => (
                <li key={schedule.id} className="agent-im__detail-card">
                  <strong>{schedule.messageTemplate}</strong>
                  <span>每 {schedule.intervalSeconds} 秒</span>
                </li>
              )) : (
                <li className="agent-im__detail-card">
                  <span className="subtle-text">当前会话暂无定时任务。</span>
                </li>
              )}
            </ul>

            <form className="agent-im__composer-card" onSubmit={props.onCreateSchedule}>
              <label className="field">
                <span>间隔秒数</span>
                <input value={props.scheduleIntervalSeconds} onChange={(event) => props.onScheduleIntervalChange(event.target.value)} />
              </label>
              <label className="field">
                <span>任务消息</span>
                <textarea rows={3} value={props.scheduleMessage} onChange={(event) => props.onScheduleMessageChange(event.target.value)} />
              </label>
              <button className="secondary-button" disabled={!selectedConversation || props.fixtureMode} type="submit">
                创建定时任务
              </button>
            </form>

            {selectedConversationAgents.length > 0 ? (
              <>
                <div className="section-title">会话内智能体</div>
                <ul className="agent-im__detail-list">
                  {selectedConversationAgents.map((agent) => (
                    <li key={agent.id} className="agent-im__detail-card">
                      <strong>{agent.name}</strong>
                      <span>{agent.status}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </aside>
        </div>
      ) : (
        <section className="panel agent-members-view">
          <div className="agent-members-view__header">
            <div>
              <h2>{props.showCreateMember ? '新建成员' : selectedAgent?.name ?? '选择一个成员'}</h2>
              <p className="subtle-text">
                {props.showCreateMember
                  ? '成员创建、模板绑定和权限编辑将在下一步接入。'
                  : selectedAgent
                    ? `当前状态 ${selectedAgent.status}，后续会在这里挂接模板、权限和定时任务。`
                    : '从左侧选择成员，或直接创建一个新的成员。'}
              </p>
            </div>
          </div>

          {props.showCreateMember ? (
            <div className="agent-members-view__placeholder">
              <div className="section-title">新建成员入口已就位</div>
              <p className="subtle-text">下一步会在这里补上成员表单、模板选择和保存流程。</p>
            </div>
          ) : selectedAgent ? (
            <div className="agent-members-view__body">
              <div className="agent-im__detail-card">
                <strong>模板</strong>
                <span>{selectedAgent.templateId}</span>
              </div>
              <div className="agent-im__detail-card">
                <strong>运行状态</strong>
                <span>{selectedAgent.status}</span>
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
          ) : (
            <div className="agent-members-view__placeholder">
              <div className="section-title">还没有可查看的成员</div>
              <p className="subtle-text">在左侧点击“新建成员”，后续可从这里进入成员详情、模板和定时任务。</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

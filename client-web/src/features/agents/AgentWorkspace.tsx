import type { FormEvent } from 'react';

import type {
  AgentProfileView,
  ConversationMessageView,
  ConversationView,
  ScheduleView,
} from './types';
import {
  translateAgentCommandCategory,
  translateAgentMessageKind,
  translateAgentStatus,
} from '@/i18n/translate';

interface AgentWorkspaceProps {
  gatewayOnline: boolean;
  fixtureMode: boolean;
  conversations: ConversationView[];
  selectedConversationId: string;
  messages: ConversationMessageView[];
  messagesLoading: boolean;
  agents: AgentProfileView[];
  schedules: ScheduleView[];
  showCreateChannel: boolean;
  channelName: string;
  channelTopic: string;
  messageInput: string;
  invitePlanetId: string;
  scheduleIntervalSeconds: string;
  scheduleMessage: string;
  onSelectConversation: (conversationId: string) => void;
  onToggleCreateChannel: () => void;
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
  onStartDm: (agentId: string) => void;
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

  function formatMessageAuthor(message: ConversationMessageView) {
    if (message.senderType === 'player') {
      return '玩家';
    }
    if (message.senderType === 'agent') {
      return props.agents.find((agent) => agent.id === message.senderId)?.name ?? message.senderId;
    }
    return translateAgentMessageKind(message.kind);
  }

  return (
    <div className="agent-im">
      <aside className="panel agent-im__sidebar">
        <div className="agent-im__sidebar-header">
          <div>
            <h1>智能体协作台</h1>
            <p className="subtle-text">
              {props.gatewayOnline ? '本地 Agent 网关在线。' : '本地 Agent 网关不可达。'}
              {props.fixtureMode ? ' 当前为离线样例模式，发送和管理入口会禁用。' : ''}
            </p>
          </div>
          <button className="secondary-button" onClick={props.onToggleCreateChannel} type="button">
            新建频道
          </button>
        </div>

        <form className="agent-im__composer-card" onSubmit={props.onCreateChannel}>
          <label className="field">
            <span>频道名称</span>
            <input aria-label="频道名称" value={props.channelName} onChange={(event) => props.onChannelNameChange(event.target.value)} />
          </label>
          <label className="field">
            <span>频道主题</span>
            <input aria-label="频道主题" value={props.channelTopic} onChange={(event) => props.onChannelTopicChange(event.target.value)} />
          </label>
          <button className="primary-button" disabled={props.fixtureMode} type="submit">创建频道</button>
        </form>

        <div className="section-title">频道</div>
        <ul className="agent-im__conversation-list">
          {props.conversations.filter((conversation) => conversation.type === 'channel').map((conversation) => (
            <li key={conversation.id}>
              <button
                className={conversation.id === props.selectedConversationId ? 'secondary-button agent-im__conversation-button agent-im__conversation-button--active' : 'secondary-button agent-im__conversation-button'}
                onClick={() => props.onSelectConversation(conversation.id)}
                type="button"
              >
                <strong>{conversation.name}</strong>
                <span>{conversation.topic || '无主题'}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="section-title">私聊</div>
        <ul className="agent-im__conversation-list">
          {props.conversations.filter((conversation) => conversation.type === 'dm').map((conversation) => (
            <li key={conversation.id}>
              <button
                className={conversation.id === props.selectedConversationId ? 'secondary-button agent-im__conversation-button agent-im__conversation-button--active' : 'secondary-button agent-im__conversation-button'}
                onClick={() => props.onSelectConversation(conversation.id)}
                type="button"
              >
                <strong>{conversation.name}</strong>
                <span>私聊</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="section-title">智能体目录</div>
        <ul className="agent-im__agent-list">
          {props.agents.map((agent) => (
            <li key={agent.id} className="agent-im__agent-card">
              <div>
                <strong>{agent.name}</strong>
                <div className="subtle-text">{translateAgentStatus(agent.status)}</div>
              </div>
              <button className="secondary-button" onClick={() => props.onStartDm(agent.id)} type="button">
                私聊
              </button>
            </li>
          ))}
        </ul>
      </aside>

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
                <strong>{formatMessageAuthor(message)}</strong>
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
                        <span key={category} className="agent-im__tag">{translateAgentCommandCategory(category)}</span>
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
                  <span>{translateAgentStatus(agent.status)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </aside>
    </div>
  );
}

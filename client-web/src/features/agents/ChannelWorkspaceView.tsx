import type { FormEvent } from 'react';

import type {
  AgentProfileView,
  ConversationMessageView,
  ConversationView,
} from './types';

interface ChannelWorkspaceViewProps {
  mode: 'chat' | 'settings';
  fixtureMode: boolean;
  conversation?: ConversationView;
  messages: ConversationMessageView[];
  messagesLoading: boolean;
  agents: AgentProfileView[];
  messageInput: string;
  invitePlanetId: string;
  inviteAgentId: string;
  onMessageInputChange: (value: string) => void;
  onInvitePlanetIdChange: (value: string) => void;
  onInviteAgentIdChange: (value: string) => void;
  onSendMessage: (event: FormEvent<HTMLFormElement>) => void;
  onInviteByPlanet: (event: FormEvent<HTMLFormElement>) => void;
  onAddMembers: (event: FormEvent<HTMLFormElement>) => void;
  onOpenSettings: () => void;
  onBackToChat: () => void;
}

function formatMemberLabel(memberId: string, agents: AgentProfileView[]) {
  if (memberId.startsWith('player:')) {
    return `玩家 ${memberId.slice('player:'.length)}`;
  }
  const agentId = memberId.slice('agent:'.length);
  return agents.find((agent) => agent.id === agentId)?.name ?? agentId;
}

export function ChannelWorkspaceView(props: ChannelWorkspaceViewProps) {
  const currentMembers = props.conversation?.memberIds.map((memberId) => {
    const agent = memberId.startsWith('agent:')
      ? props.agents.find((entry) => entry.id === memberId.slice('agent:'.length))
      : undefined;

    return {
      memberId,
      label: formatMemberLabel(memberId, props.agents),
      agent,
    };
  }) ?? [];

  const availableAgents = props.conversation
    ? props.agents.filter((agent) => !props.conversation?.memberIds.includes(`agent:${agent.id}`))
    : [];

  if (props.mode === 'settings') {
    return (
      <section className="panel channel-workspace channel-workspace--settings">
        <div className="channel-workspace__header">
          <div>
            <h2>{props.conversation?.name ?? '频道设置'}</h2>
            <p className="subtle-text">{props.conversation?.topic || '管理频道成员与协作入口。'}</p>
          </div>
          <button className="secondary-button" onClick={props.onBackToChat} type="button">
            返回聊天
          </button>
        </div>

        <section className="channel-workspace__section">
          <div className="section-title">当前成员</div>
          <ul className="agent-im__detail-list">
            {currentMembers.map((member) => (
              <li key={member.memberId} className="agent-im__detail-card">
                <strong>{member.label}</strong>
                {member.agent?.policy?.planetIds.length ? <span>星球 {member.agent.policy.planetIds.join(', ')}</span> : null}
                {member.agent?.policy?.commandCategories.length ? (
                  <div className="agent-im__tag-row">
                    {member.agent.policy.commandCategories.map((category) => (
                      <span key={category} className="agent-im__tag">{category}</span>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="channel-workspace__section">
          <div className="section-title">添加成员到频道</div>
          {availableAgents.length > 0 ? (
            <form className="agent-im__composer-card" onSubmit={props.onAddMembers}>
              <label className="field">
                <span>选择成员</span>
                <select aria-label="选择成员" value={props.inviteAgentId} onChange={(event) => props.onInviteAgentIdChange(event.target.value)}>
                  <option value="">请选择一个成员</option>
                  {availableAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                  ))}
                </select>
              </label>
              <button className="secondary-button" disabled={!props.inviteAgentId || props.fixtureMode} type="submit">
                添加到频道
              </button>
            </form>
          ) : (
            <div className="channel-workspace__empty">
              <p className="subtle-text">先去成员页创建成员，或当前所有成员都已在频道内。</p>
            </div>
          )}
        </section>

        <section className="channel-workspace__section">
          <div className="section-title">按星球拉人</div>
          <form className="agent-im__composer-card" onSubmit={props.onInviteByPlanet}>
            <label className="field">
              <span>星球 ID</span>
              <input value={props.invitePlanetId} onChange={(event) => props.onInvitePlanetIdChange(event.target.value)} />
            </label>
            <button className="secondary-button" disabled={!props.conversation || props.fixtureMode} type="submit">
              按星球拉人
            </button>
          </form>
        </section>
      </section>
    );
  }

  return (
    <section className="panel channel-workspace">
      <div className="channel-workspace__header">
        <div>
          <h2>{props.conversation?.name ?? '选择一个会话'}</h2>
          <p className="subtle-text">{props.conversation?.topic || '在频道里通过 @ 或私聊推动协作。'}</p>
        </div>
        {props.conversation ? (
          <div className="channel-workspace__actions">
            <span className="channel-workspace__meta">{props.conversation.memberIds.length} 名成员</span>
            <button className="secondary-button" onClick={props.onOpenSettings} type="button">
              频道设置
            </button>
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
        <button className="primary-button" disabled={!props.conversation || props.fixtureMode} type="submit">
          发送
        </button>
      </form>
    </section>
  );
}

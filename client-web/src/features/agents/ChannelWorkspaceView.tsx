import type { FormEvent } from 'react';

import type {
  AgentProfileView,
  ConversationMessageView,
  ConversationTurnActionSummaryView,
  ConversationTurnView,
  ConversationView,
} from './types';

interface ChannelWorkspaceViewProps {
  mode: 'chat' | 'settings';
  fixtureMode: boolean;
  conversation?: ConversationView;
  messages: ConversationMessageView[];
  messagesLoading: boolean;
  turns: ConversationTurnView[];
  turnsLoading: boolean;
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

function formatMessageSender(message: ConversationMessageView, agents: AgentProfileView[]) {
  if (message.senderType === 'player') {
    return '玩家';
  }
  if (message.senderType === 'agent') {
    return agents.find((agent) => agent.id === message.senderId)?.name ?? message.senderId;
  }
  if (message.senderType === 'schedule') {
    return '定时任务';
  }
  return '系统';
}

function formatTurnStatus(status: ConversationTurnView['status']) {
  switch (status) {
    case 'accepted':
      return '已接收';
    case 'queued':
      return '排队中';
    case 'planning':
      return '规划中';
    case 'executing':
      return '执行中';
    case 'succeeded':
      return '已完成';
    case 'failed':
      return '失败';
    default:
      return status;
  }
}

function formatActionStatus(status: ConversationTurnActionSummaryView['status']) {
  switch (status) {
    case 'pending':
      return '待执行';
    case 'succeeded':
      return '已完成';
    case 'failed':
      return '失败';
    default:
      return status;
  }
}

function formatTurnTarget(turn: ConversationTurnView, agents: AgentProfileView[]) {
  return agents.find((agent) => agent.id === turn.targetAgentId)?.name ?? turn.targetAgentId;
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

  const sortedMessages = [...props.messages].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const sortedTurns = [...props.turns].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const messagesById = new Map(sortedMessages.map((message) => [message.id, message]));
  const requestMessages = sortedMessages.filter(
    (message) => message.senderType === 'player' || message.senderType === 'schedule',
  );
  const requestMessageIds = new Set(requestMessages.map((message) => message.id));
  const turnsByRequest = new Map<string, ConversationTurnView[]>();
  const repliesByRequest = new Map<string, ConversationMessageView[]>();

  for (const turn of sortedTurns) {
    const existing = turnsByRequest.get(turn.requestMessageId) ?? [];
    existing.push(turn);
    turnsByRequest.set(turn.requestMessageId, existing);
  }

  for (const message of sortedMessages) {
    if (!message.replyToMessageId) {
      continue;
    }
    const existing = repliesByRequest.get(message.replyToMessageId) ?? [];
    existing.push(message);
    repliesByRequest.set(message.replyToMessageId, existing);
  }

  const standaloneMessages = sortedMessages.filter((message) => (
    !requestMessageIds.has(message.id)
    && !message.replyToMessageId
    && !message.turnId
  ));

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
        {props.messagesLoading || props.turnsLoading ? (
          <p className="subtle-text">正在加载消息...</p>
        ) : requestMessages.length === 0 && standaloneMessages.length === 0 ? (
          <p className="subtle-text">当前会话暂无消息。</p>
        ) : (
          <>
            {requestMessages.map((requestMessage) => {
              const requestTurns = turnsByRequest.get(requestMessage.id) ?? [];
              const requestReplies = repliesByRequest.get(requestMessage.id) ?? [];
              const usedReplyIds = new Set<string>();

              return (
                <article key={requestMessage.id} className="agent-im__detail-card">
                  <header>
                    <strong>{requestMessage.senderType === 'schedule' ? '定时请求' : '玩家请求'}</strong>
                  </header>
                  <p>{requestMessage.content}</p>

                  {requestTurns.map((turn) => {
                    const turnReplies = requestReplies.filter((reply) => {
                      if (reply.turnId) {
                        return reply.turnId === turn.id;
                      }
                      if (turn.finalMessageId) {
                        return reply.id === turn.finalMessageId;
                      }
                      return requestTurns.length === 1;
                    });
                    const finalReply = turn.finalMessageId
                      ? messagesById.get(turn.finalMessageId) ?? turnReplies[turnReplies.length - 1]
                      : turnReplies[turnReplies.length - 1];
                    const extraReplies = turnReplies.filter((reply) => reply.id !== finalReply?.id);

                    if (finalReply) {
                      usedReplyIds.add(finalReply.id);
                    }
                    for (const reply of extraReplies) {
                      usedReplyIds.add(reply.id);
                    }

                    return (
                      <section key={turn.id} className="agent-im__detail-card">
                        <header>
                          <strong>{formatTurnTarget(turn, props.agents)}</strong>
                          <span>{formatTurnStatus(turn.status)}</span>
                        </header>
                        {turn.assistantPreview ? (
                          <div>
                            <div className="section-title">规划摘要</div>
                            <p>{turn.assistantPreview}</p>
                          </div>
                        ) : null}
                        {turn.actionSummaries.length > 0 ? (
                          <div>
                            <div className="section-title">动作摘要</div>
                            <ul className="agent-im__detail-list">
                              {turn.actionSummaries.map((summary, index) => (
                                <li key={`${turn.id}:${summary.type}:${index}`} className="agent-im__detail-card">
                                  <strong>{summary.type}</strong>
                                  <span>{formatActionStatus(summary.status)}</span>
                                  <span>{summary.detail}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {extraReplies.length > 0 ? (
                          <div>
                            <div className="section-title">阶段消息</div>
                            <ul className="agent-im__detail-list">
                              {extraReplies.map((reply) => (
                                <li key={reply.id} className="agent-im__detail-card">
                                  <strong>{formatMessageSender(reply, props.agents)}</strong>
                                  <span>{reply.content}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {finalReply ? (
                          <div>
                            <div className="section-title">最终回复</div>
                            <p>{finalReply.content}</p>
                          </div>
                        ) : null}
                        {turn.errorMessage ? (
                          <div>
                            <div className="section-title">失败原因</div>
                            <p>{turn.errorMessage}</p>
                          </div>
                        ) : null}
                      </section>
                    );
                  })}

                  {requestReplies
                    .filter((reply) => !usedReplyIds.has(reply.id))
                    .map((reply) => (
                      <section key={reply.id} className="agent-im__detail-card">
                        <header>
                          <strong>{formatMessageSender(reply, props.agents)}</strong>
                        </header>
                        <p>{reply.content}</p>
                      </section>
                    ))}

                  {requestTurns.length === 0 && requestReplies.length === 0 ? (
                    <p className="subtle-text">消息已发送，等待 turn 生命周期回写。</p>
                  ) : null}
                </article>
              );
            })}

            {standaloneMessages.map((message) => (
              <article key={message.id} className={`agent-im__message agent-im__message--${message.senderType}`}>
                <header>
                  <strong>{formatMessageSender(message, props.agents)}</strong>
                </header>
                <p>{message.content}</p>
              </article>
            ))}
          </>
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

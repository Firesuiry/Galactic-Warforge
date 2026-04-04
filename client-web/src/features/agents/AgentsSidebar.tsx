import type { FormEvent } from 'react';

import type {
  AgentProfileView,
  ConversationView,
} from './types';

export type AgentsPane = 'channels' | 'members';

interface AgentsSidebarProps {
  gatewayOnline: boolean;
  fixtureMode: boolean;
  activePane: AgentsPane;
  conversations: ConversationView[];
  selectedConversationId: string;
  agents: AgentProfileView[];
  selectedAgentId: string;
  showCreateChannel: boolean;
  channelName: string;
  channelTopic: string;
  onPaneChange: (pane: AgentsPane) => void;
  onSelectConversation: (conversationId: string) => void;
  onSelectAgent: (agentId: string) => void;
  onToggleCreateChannel: () => void;
  onChannelNameChange: (value: string) => void;
  onChannelTopicChange: (value: string) => void;
  onCreateChannel: (event: FormEvent<HTMLFormElement>) => void;
  onOpenCreateMember: () => void;
}

export function AgentsSidebar(props: AgentsSidebarProps) {
  const channelConversations = props.conversations.filter((conversation) => conversation.type === 'channel');
  const directConversations = props.conversations.filter((conversation) => conversation.type === 'dm');

  return (
    <aside className="panel agent-sidebar">
      <div className="agent-sidebar__header">
        <div>
          <h1>智能体协作台</h1>
          <p className="subtle-text">
            {props.gatewayOnline ? '本地 Agent 网关在线。' : '本地 Agent 网关不可达。'}
            {props.fixtureMode ? ' 当前为离线样例模式，发送和管理入口会禁用。' : ''}
          </p>
        </div>
      </div>

      <div className="agent-sidebar__pane-switch" role="tablist" aria-label="智能体工作区导航">
        <button
          aria-pressed={props.activePane === 'channels'}
          className={props.activePane === 'channels' ? 'secondary-button agent-sidebar__pane-button agent-sidebar__pane-button--active' : 'secondary-button agent-sidebar__pane-button'}
          onClick={() => props.onPaneChange('channels')}
          type="button"
        >
          频道
        </button>
        <button
          aria-pressed={props.activePane === 'members'}
          className={props.activePane === 'members' ? 'secondary-button agent-sidebar__pane-button agent-sidebar__pane-button--active' : 'secondary-button agent-sidebar__pane-button'}
          onClick={() => props.onPaneChange('members')}
          type="button"
        >
          成员
        </button>
      </div>

      {props.activePane === 'channels' ? (
        <>
          <div className="agent-sidebar__section-header">
            <div className="section-title">频道</div>
            <button className="secondary-button" onClick={props.onToggleCreateChannel} type="button">
              新建频道
            </button>
          </div>

          {props.showCreateChannel ? (
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
          ) : null}

          <ul className="agent-sidebar__list">
            {channelConversations.map((conversation) => (
              <li key={conversation.id}>
                <button
                  className={conversation.id === props.selectedConversationId ? 'secondary-button agent-sidebar__list-button agent-sidebar__list-button--active' : 'secondary-button agent-sidebar__list-button'}
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
          <ul className="agent-sidebar__list">
            {directConversations.map((conversation) => (
              <li key={conversation.id}>
                <button
                  className={conversation.id === props.selectedConversationId ? 'secondary-button agent-sidebar__list-button agent-sidebar__list-button--active' : 'secondary-button agent-sidebar__list-button'}
                  onClick={() => props.onSelectConversation(conversation.id)}
                  type="button"
                >
                  <strong>{conversation.name}</strong>
                  <span>私聊</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="agent-sidebar__section-header">
            <div className="section-title">成员</div>
            <button className="secondary-button" onClick={props.onOpenCreateMember} type="button">
              新建成员
            </button>
          </div>

          <ul className="agent-sidebar__list">
            {props.agents.map((agent) => (
              <li key={agent.id}>
                <button
                  className={agent.id === props.selectedAgentId ? 'secondary-button agent-sidebar__list-button agent-sidebar__list-button--active' : 'secondary-button agent-sidebar__list-button'}
                  onClick={() => props.onSelectAgent(agent.id)}
                  type="button"
                >
                  <strong>{agent.name}</strong>
                  <span>{agent.status}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}

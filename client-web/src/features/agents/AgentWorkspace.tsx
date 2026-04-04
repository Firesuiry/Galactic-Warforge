import type { FormEvent } from 'react';

import { AgentsSidebar, type AgentsPane } from './AgentsSidebar';
import { ChannelWorkspaceView } from './ChannelWorkspaceView';
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
  channelView: 'chat' | 'settings';
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
  inviteAgentId: string;
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
  onInviteAgentIdChange: (value: string) => void;
  onScheduleIntervalChange: (value: string) => void;
  onScheduleMessageChange: (value: string) => void;
  onCreateChannel: (event: FormEvent<HTMLFormElement>) => void;
  onSendMessage: (event: FormEvent<HTMLFormElement>) => void;
  onAddConversationMembers: (event: FormEvent<HTMLFormElement>) => void;
  onInviteByPlanet: (event: FormEvent<HTMLFormElement>) => void;
  onCreateSchedule: (event: FormEvent<HTMLFormElement>) => void;
  onOpenChannelSettings: () => void;
  onBackToChannelChat: () => void;
}

export function AgentWorkspace(props: AgentWorkspaceProps) {
  const selectedConversation = props.conversations.find((conversation) => conversation.id === props.selectedConversationId);
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
        <div className="agent-workspace-shell__content">
          <ChannelWorkspaceView
            mode={props.channelView}
            fixtureMode={props.fixtureMode}
            conversation={selectedConversation}
            messages={props.messages}
            messagesLoading={props.messagesLoading}
            agents={props.agents}
            messageInput={props.messageInput}
            invitePlanetId={props.invitePlanetId}
            inviteAgentId={props.inviteAgentId}
            onMessageInputChange={props.onMessageInputChange}
            onInvitePlanetIdChange={props.onInvitePlanetIdChange}
            onInviteAgentIdChange={props.onInviteAgentIdChange}
            onSendMessage={props.onSendMessage}
            onInviteByPlanet={props.onInviteByPlanet}
            onAddMembers={props.onAddConversationMembers}
            onOpenSettings={props.onOpenChannelSettings}
            onBackToChat={props.onBackToChannelChat}
          />
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

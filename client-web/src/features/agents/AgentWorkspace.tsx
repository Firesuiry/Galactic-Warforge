import type { FormEvent } from 'react';

import { AgentsSidebar, type AgentsPane } from './AgentsSidebar';
import { ChannelWorkspaceView } from './ChannelWorkspaceView';
import { MemberWorkspaceView } from './MemberWorkspaceView';
import type {
  AgentProfileView,
  AgentTemplateView,
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
  templates: AgentTemplateView[];
  schedules: ScheduleView[];
  showCreateChannel: boolean;
  showCreateMember: boolean;
  showTemplateManager: boolean;
  channelName: string;
  channelTopic: string;
  memberName: string;
  memberTemplateId: string;
  templateName: string;
  templateDescription: string;
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
  onOpenTemplateManager: () => void;
  onCloseTemplateManager: () => void;
  onChannelNameChange: (value: string) => void;
  onChannelTopicChange: (value: string) => void;
  onMemberNameChange: (value: string) => void;
  onMemberTemplateIdChange: (value: string) => void;
  onTemplateNameChange: (value: string) => void;
  onTemplateDescriptionChange: (value: string) => void;
  onMessageInputChange: (value: string) => void;
  onInvitePlanetIdChange: (value: string) => void;
  onInviteAgentIdChange: (value: string) => void;
  onScheduleIntervalChange: (value: string) => void;
  onScheduleMessageChange: (value: string) => void;
  onCreateTemplate: (event: FormEvent<HTMLFormElement>) => void;
  onCreateMember: (event: FormEvent<HTMLFormElement>) => void;
  onCreateChannel: (event: FormEvent<HTMLFormElement>) => void;
  onSendMessage: (event: FormEvent<HTMLFormElement>) => void;
  onAddConversationMembers: (event: FormEvent<HTMLFormElement>) => void;
  onInviteByPlanet: (event: FormEvent<HTMLFormElement>) => void;
  onCreateSchedule: (event: FormEvent<HTMLFormElement>) => void;
  onOpenChannelSettings: () => void;
  onBackToChannelChat: () => void;
  onStartDm: (agentId: string) => void;
  onToggleScheduleEnabled: (scheduleId: string, enabled: boolean) => void;
}

export function AgentWorkspace(props: AgentWorkspaceProps) {
  const selectedConversation = props.conversations.find((conversation) => conversation.id === props.selectedConversationId);

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
        <MemberWorkspaceView
          fixtureMode={props.fixtureMode}
          agents={props.agents}
          templates={props.templates}
          schedules={props.schedules}
          selectedAgentId={props.selectedAgentId}
          showCreateMember={props.showCreateMember}
          showTemplateManager={props.showTemplateManager}
          memberName={props.memberName}
          memberTemplateId={props.memberTemplateId}
          templateName={props.templateName}
          templateDescription={props.templateDescription}
          scheduleIntervalSeconds={props.scheduleIntervalSeconds}
          scheduleMessage={props.scheduleMessage}
          onMemberNameChange={props.onMemberNameChange}
          onMemberTemplateIdChange={props.onMemberTemplateIdChange}
          onOpenTemplateManager={props.onOpenTemplateManager}
          onCloseTemplateManager={props.onCloseTemplateManager}
          onTemplateNameChange={props.onTemplateNameChange}
          onTemplateDescriptionChange={props.onTemplateDescriptionChange}
          onCreateTemplate={props.onCreateTemplate}
          onCreateMember={props.onCreateMember}
          onStartDm={props.onStartDm}
          onScheduleIntervalChange={props.onScheduleIntervalChange}
          onScheduleMessageChange={props.onScheduleMessageChange}
          onCreateSchedule={props.onCreateSchedule}
          onToggleScheduleEnabled={props.onToggleScheduleEnabled}
        />
      )}
    </div>
  );
}

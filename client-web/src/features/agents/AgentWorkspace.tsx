import type { FormEvent } from 'react';

import { AgentsSidebar, type AgentsPane } from './AgentsSidebar';
import { ChannelWorkspaceView } from './ChannelWorkspaceView';
import { MemberWorkspaceView } from './MemberWorkspaceView';
import type {
  AgentPolicyView,
  AgentProfileView,
  ConversationMessageView,
  ConversationView,
  CreateProviderPayload,
  ModelProviderView,
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
  providers: ModelProviderView[];
  schedules: ScheduleView[];
  showCreateChannel: boolean;
  showCreateMember: boolean;
  showProviderManager: boolean;
  channelName: string;
  channelTopic: string;
  memberName: string;
  memberProviderId: string;
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
  onOpenProviderManager: () => void;
  onCloseProviderManager: () => void;
  onChannelNameChange: (value: string) => void;
  onChannelTopicChange: (value: string) => void;
  onMemberNameChange: (value: string) => void;
  onMemberProviderIdChange: (value: string) => void;
  onMessageInputChange: (value: string) => void;
  onInvitePlanetIdChange: (value: string) => void;
  onInviteAgentIdChange: (value: string) => void;
  onScheduleIntervalChange: (value: string) => void;
  onScheduleMessageChange: (value: string) => void;
  onCreateProvider: (payload: CreateProviderPayload) => void;
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
  onSaveAgentPolicy: (policy: AgentPolicyView) => void;
  onSaveAgentProvider: (providerId: string) => void;
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
          providers={props.providers}
          schedules={props.schedules}
          selectedAgentId={props.selectedAgentId}
          showCreateMember={props.showCreateMember}
          showProviderManager={props.showProviderManager}
          memberName={props.memberName}
          memberProviderId={props.memberProviderId}
          scheduleIntervalSeconds={props.scheduleIntervalSeconds}
          scheduleMessage={props.scheduleMessage}
          onMemberNameChange={props.onMemberNameChange}
          onMemberProviderIdChange={props.onMemberProviderIdChange}
          onOpenProviderManager={props.onOpenProviderManager}
          onCloseProviderManager={props.onCloseProviderManager}
          onCreateProvider={props.onCreateProvider}
          onCreateMember={props.onCreateMember}
          onStartDm={props.onStartDm}
          onScheduleIntervalChange={props.onScheduleIntervalChange}
          onScheduleMessageChange={props.onScheduleMessageChange}
          onCreateSchedule={props.onCreateSchedule}
          onToggleScheduleEnabled={props.onToggleScheduleEnabled}
          onSavePolicy={props.onSaveAgentPolicy}
          onSaveAgentProvider={props.onSaveAgentProvider}
        />
      )}
    </div>
  );
}

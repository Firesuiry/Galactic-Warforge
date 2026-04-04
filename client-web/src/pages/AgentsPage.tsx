import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AgentWorkspace } from '@/features/agents/AgentWorkspace';
import {
  addConversationMembers,
  createAgent,
  createConversation,
  createSchedule,
  createTemplate,
  fetchAgents,
  fetchConversationMessages,
  fetchConversations,
  fetchGatewayHealth,
  fetchSchedules,
  fetchTemplates,
  inviteConversationMembersByPlanet,
  sendConversationMessage,
  updateSchedule,
} from '@/features/agents/api';
import { useConversationEvents } from '@/features/agents/use-agent-events';
import { isFixtureServerUrl } from '@/fixtures';
import { useSessionSnapshot } from '@/hooks/use-session';

export function AgentsPage() {
  const session = useSessionSnapshot();
  const queryClient = useQueryClient();
  const fixtureMode = isFixtureServerUrl(session.serverUrl);
  const [activePane, setActivePane] = useState<'channels' | 'members'>('channels');
  const [selectedConversationId, setSelectedConversationId] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [channelView, setChannelView] = useState<'chat' | 'settings'>('chat');
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showCreateMember, setShowCreateMember] = useState(false);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [channelTopic, setChannelTopic] = useState('');
  const [memberName, setMemberName] = useState('');
  const [memberTemplateId, setMemberTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const [inviteAgentId, setInviteAgentId] = useState('');
  const [invitePlanetId, setInvitePlanetId] = useState('');
  const [scheduleIntervalSeconds, setScheduleIntervalSeconds] = useState('300');
  const [scheduleMessage, setScheduleMessage] = useState('@建造官 每五分钟同步一次当前状态');

  const healthQuery = useQuery({
    queryKey: ['agent-health'],
    queryFn: fetchGatewayHealth,
  });

  const conversationsQuery = useQuery({
    queryKey: ['agent-conversations'],
    queryFn: fetchConversations,
  });

  const agentsQuery = useQuery({
    queryKey: ['agent-profiles'],
    queryFn: fetchAgents,
  });

  const templatesQuery = useQuery({
    queryKey: ['agent-templates'],
    queryFn: fetchTemplates,
    enabled: showCreateMember,
  });

  const schedulesQuery = useQuery({
    queryKey: ['agent-schedules'],
    queryFn: fetchSchedules,
  });

  const messagesQuery = useQuery({
    queryKey: ['agent-conversation-messages', selectedConversationId],
    queryFn: () => fetchConversationMessages(selectedConversationId),
    enabled: selectedConversationId !== '',
  });

  useEffect(() => {
    const firstConversationId = conversationsQuery.data?.[0]?.id ?? '';
    if (!selectedConversationId && firstConversationId) {
      setSelectedConversationId(firstConversationId);
    }
  }, [conversationsQuery.data, selectedConversationId]);

  useEffect(() => {
    const firstAgentId = agentsQuery.data?.[0]?.id ?? '';
    if (!selectedAgentId && firstAgentId) {
      setSelectedAgentId(firstAgentId);
    }
  }, [agentsQuery.data, selectedAgentId]);

  useEffect(() => {
    const firstTemplateId = templatesQuery.data?.[0]?.id ?? '';
    if (showCreateMember && !memberTemplateId && firstTemplateId) {
      setMemberTemplateId(firstTemplateId);
    }
  }, [memberTemplateId, showCreateMember, templatesQuery.data]);

  useConversationEvents(selectedConversationId, () => {
    void queryClient.invalidateQueries({ queryKey: ['agent-conversation-messages', selectedConversationId] });
    void queryClient.invalidateQueries({ queryKey: ['agent-profiles'] });
    void queryClient.invalidateQueries({ queryKey: ['agent-schedules'] });
  });

  const createConversationMutation = useMutation({
    mutationFn: createConversation,
    onSuccess: (conversation) => {
      setActivePane('channels');
      setChannelView('chat');
      setSelectedConversationId(conversation.id);
      setChannelName('');
      setChannelTopic('');
      setShowCreateChannel(false);
      void queryClient.invalidateQueries({ queryKey: ['agent-conversations'] });
    },
  });

  const createTemplateMutation = useMutation({
    mutationFn: createTemplate,
    onSuccess: (template) => {
      setMemberTemplateId(template.id);
      setTemplateName('');
      setTemplateDescription('');
      setShowTemplateManager(false);
      void queryClient.invalidateQueries({ queryKey: ['agent-templates'] });
    },
  });

  const createAgentMutation = useMutation({
    mutationFn: createAgent,
    onSuccess: (agent) => {
      setActivePane('members');
      setSelectedAgentId(agent.id);
      setShowCreateMember(false);
      setShowTemplateManager(false);
      setMemberName('');
      setMemberTemplateId(agent.templateId);
      setScheduleMessage(`@${agent.name} 每五分钟同步一次当前状态`);
      void queryClient.invalidateQueries({ queryKey: ['agent-profiles'] });
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: ({ conversationId, content }: { conversationId: string; content: string }) => sendConversationMessage(conversationId, {
      senderType: 'player',
      senderId: session.playerId,
      content,
    }),
    onSuccess: () => {
      setMessageInput('');
      void queryClient.invalidateQueries({ queryKey: ['agent-conversation-messages', selectedConversationId] });
      scheduleConversationRefresh(selectedConversationId);
    },
  });

  const inviteByPlanetMutation = useMutation({
    mutationFn: ({ conversationId, planetId }: { conversationId: string; planetId: string }) => inviteConversationMembersByPlanet(conversationId, {
      actorType: 'player',
      actorId: session.playerId,
      planetId,
    }),
    onSuccess: () => {
      setInvitePlanetId('');
      void queryClient.invalidateQueries({ queryKey: ['agent-conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['agent-profiles'] });
    },
  });

  const addConversationMembersMutation = useMutation({
    mutationFn: ({ conversationId, memberIds }: { conversationId: string; memberIds: string[] }) => addConversationMembers(conversationId, {
      actorType: 'player',
      actorId: session.playerId,
      memberIds,
    }),
    onSuccess: () => {
      setInviteAgentId('');
      void queryClient.invalidateQueries({ queryKey: ['agent-conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['agent-profiles'] });
    },
  });

  const createScheduleMutation = useMutation({
    mutationFn: ({ ownerAgentId, intervalSeconds, messageTemplate }: { ownerAgentId: string; intervalSeconds: number; messageTemplate: string }) => createSchedule({
      ownerAgentId,
      creatorType: 'player',
      creatorId: session.playerId,
      targetType: 'agent_dm',
      targetId: ownerAgentId,
      intervalSeconds,
      messageTemplate,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agent-schedules'] });
    },
  });

  const updateScheduleMutation = useMutation({
    mutationFn: ({ scheduleId, enabled }: { scheduleId: string; enabled: boolean }) => updateSchedule(scheduleId, { enabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agent-schedules'] });
    },
  });

  const conversations = conversationsQuery.data ?? [];
  const agents = agentsQuery.data ?? [];
  const templates = templatesQuery.data ?? [];
  const schedules = schedulesQuery.data ?? [];
  const messages = messagesQuery.data ?? [];
  const memberDataLoading = showCreateMember && templatesQuery.isLoading;
  const coreLoading = healthQuery.isLoading || conversationsQuery.isLoading || agentsQuery.isLoading || schedulesQuery.isLoading || memberDataLoading;
  const messagesLoading = selectedConversationId !== '' && messagesQuery.isLoading;

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId),
    [conversations, selectedConversationId],
  );

  function scheduleConversationRefresh(conversationId: string) {
    if (!conversationId) {
      return;
    }

    for (const delayMs of [250, 1000]) {
      globalThis.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['agent-conversation-messages', conversationId] });
      }, delayMs);
    }
  }

  function handleCreateChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!channelName.trim() || fixtureMode) {
      return;
    }
    void createConversationMutation.mutate({
      type: 'channel',
      name: channelName.trim(),
      topic: channelTopic.trim(),
      createdByType: 'player',
      createdById: session.playerId,
      memberIds: [`player:${session.playerId}`],
    });
  }

  function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedConversationId || !messageInput.trim() || fixtureMode) {
      return;
    }
    void sendMessageMutation.mutate({
      conversationId: selectedConversationId,
      content: messageInput.trim(),
    });
  }

  function handleInviteByPlanet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedConversationId || !invitePlanetId.trim() || fixtureMode) {
      return;
    }
    void inviteByPlanetMutation.mutate({
      conversationId: selectedConversationId,
      planetId: invitePlanetId.trim(),
    });
  }

  function handleCreateSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAgentId || !scheduleMessage.trim() || fixtureMode) {
      return;
    }
    const intervalSeconds = Number(scheduleIntervalSeconds);
    if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
      return;
    }
    void createScheduleMutation.mutate({
      ownerAgentId: selectedAgentId,
      intervalSeconds,
      messageTemplate: scheduleMessage.trim(),
    });
  }

  function handleStartDm(agentId: string) {
    const existingConversation = conversations.find((conversation) => (
      conversation.type === 'dm'
      && conversation.memberIds.includes(`player:${session.playerId}`)
      && conversation.memberIds.includes(`agent:${agentId}`)
    ));

    if (existingConversation) {
      setActivePane('channels');
      setChannelView('chat');
      setShowCreateMember(false);
      setSelectedConversationId(existingConversation.id);
      return;
    }

    const agent = agents.find((entry) => entry.id === agentId);
    void createConversationMutation.mutate({
      type: 'dm',
      name: `与 ${agent?.name ?? agentId} 私聊`,
      topic: '',
      createdByType: 'player',
      createdById: session.playerId,
      memberIds: [`player:${session.playerId}`, `agent:${agentId}`],
    });
  }

  function handleSelectConversation(conversationId: string) {
    setActivePane('channels');
    setChannelView('chat');
    setShowCreateMember(false);
    setSelectedConversationId(conversationId);
  }

  function handlePaneChange(pane: 'channels' | 'members') {
    setActivePane(pane);
    if (pane === 'channels') {
      setShowCreateMember(false);
      setShowTemplateManager(false);
    }
  }

  function handleSelectAgent(agentId: string) {
    setActivePane('members');
    setShowCreateMember(false);
    setShowTemplateManager(false);
    setSelectedAgentId(agentId);
  }

  function handleToggleCreateChannel() {
    setActivePane('channels');
    setChannelView('chat');
    setShowCreateChannel((current) => !current);
  }

  function handleOpenCreateMember() {
    setActivePane('members');
    setShowCreateMember(true);
    setShowTemplateManager(false);
    setMemberName('');
    setMemberTemplateId(templatesQuery.data?.[0]?.id ?? '');
    setTemplateName('');
    setTemplateDescription('');
  }

  function handleAddConversationMembers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedConversationId || !inviteAgentId || fixtureMode) {
      return;
    }

    void addConversationMembersMutation.mutate({
      conversationId: selectedConversationId,
      memberIds: [`agent:${inviteAgentId}`],
    });
  }

  function handleCreateTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!templateName.trim() || fixtureMode) {
      return;
    }

    void createTemplateMutation.mutate({
      name: templateName.trim(),
      providerKind: 'codex_cli',
      description: templateDescription.trim(),
      defaultModel: 'gpt-5-codex',
      systemPrompt: [
        `你是 ${templateName.trim()}。`,
        templateDescription.trim() ? `职责说明：${templateDescription.trim()}` : '职责说明：负责在 SiliconWorld 中执行协作任务。',
      ].join('\n'),
      toolPolicy: {
        cliEnabled: true,
        maxSteps: 8,
        maxToolCallsPerTurn: 4,
        commandWhitelist: ['build', 'overview', 'galaxy', 'planet'],
      },
      providerConfig: {
        command: 'codex',
        model: 'gpt-5-codex',
        workdir: '/home/firesuiry/develop/siliconWorld',
        argsTemplate: [],
        envOverrides: {},
      },
    });
  }

  function handleCreateMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!memberName.trim() || !memberTemplateId || fixtureMode) {
      return;
    }

    void createAgentMutation.mutate({
      name: memberName.trim(),
      templateId: memberTemplateId,
      serverUrl: session.serverUrl,
      playerId: session.playerId,
      playerKey: session.playerKey,
    });
  }

  if (coreLoading) {
    return <div className="panel">正在加载智能体协作台...</div>;
  }

  const templatesError = showCreateMember ? templatesQuery.error : null;

  if (healthQuery.error || conversationsQuery.error || agentsQuery.error || templatesError || schedulesQuery.error || messagesQuery.error) {
    const error = healthQuery.error || conversationsQuery.error || agentsQuery.error || templatesError || schedulesQuery.error || messagesQuery.error;
    return (
      <div className="panel error-banner" role="alert">
        {error instanceof Error ? error.message : '智能体协作台加载失败'}
      </div>
    );
  }

  return (
    <AgentWorkspace
      gatewayOnline={healthQuery.data?.status === 'ok'}
      fixtureMode={fixtureMode}
      activePane={activePane}
      channelView={channelView}
      conversations={conversations}
      selectedConversationId={selectedConversation?.id ?? ''}
      messages={messages}
      messagesLoading={messagesLoading}
      agents={agents}
      selectedAgentId={selectedAgentId}
      templates={templates}
      schedules={schedules}
      showCreateChannel={showCreateChannel}
      showCreateMember={showCreateMember}
      showTemplateManager={showTemplateManager}
      channelName={channelName}
      channelTopic={channelTopic}
      memberName={memberName}
      memberTemplateId={memberTemplateId}
      templateName={templateName}
      templateDescription={templateDescription}
      messageInput={messageInput}
      inviteAgentId={inviteAgentId}
      invitePlanetId={invitePlanetId}
      scheduleIntervalSeconds={scheduleIntervalSeconds}
      scheduleMessage={scheduleMessage}
      onPaneChange={handlePaneChange}
      onSelectConversation={handleSelectConversation}
      onSelectAgent={handleSelectAgent}
      onToggleCreateChannel={handleToggleCreateChannel}
      onOpenCreateMember={handleOpenCreateMember}
      onOpenTemplateManager={() => setShowTemplateManager(true)}
      onCloseTemplateManager={() => setShowTemplateManager(false)}
      onChannelNameChange={setChannelName}
      onChannelTopicChange={setChannelTopic}
      onMemberNameChange={setMemberName}
      onMemberTemplateIdChange={setMemberTemplateId}
      onTemplateNameChange={setTemplateName}
      onTemplateDescriptionChange={setTemplateDescription}
      onMessageInputChange={setMessageInput}
      onInviteAgentIdChange={setInviteAgentId}
      onInvitePlanetIdChange={setInvitePlanetId}
      onScheduleIntervalChange={setScheduleIntervalSeconds}
      onScheduleMessageChange={setScheduleMessage}
      onCreateTemplate={handleCreateTemplate}
      onCreateMember={handleCreateMember}
      onCreateChannel={handleCreateChannel}
      onSendMessage={handleSendMessage}
      onAddConversationMembers={handleAddConversationMembers}
      onInviteByPlanet={handleInviteByPlanet}
      onCreateSchedule={handleCreateSchedule}
      onOpenChannelSettings={() => setChannelView('settings')}
      onBackToChannelChat={() => setChannelView('chat')}
      onStartDm={handleStartDm}
      onToggleScheduleEnabled={(scheduleId, enabled) => {
        if (fixtureMode) {
          return;
        }
        void updateScheduleMutation.mutate({ scheduleId, enabled });
      }}
    />
  );
}

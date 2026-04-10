import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AgentWorkspace } from '@/features/agents/AgentWorkspace';
import {
  addConversationMembers,
  createAgent,
  createConversation,
  createProvider,
  createSchedule,
  fetchAgents,
  fetchConversationMessages,
  fetchConversationTurns,
  fetchConversations,
  fetchGatewayHealth,
  fetchProviders,
  fetchSchedules,
  inviteConversationMembersByPlanet,
  sendConversationMessage,
  updateAgent,
  updateSchedule,
} from '@/features/agents/api';
import { useConversationEvents, type ConversationStreamEvent } from '@/features/agents/use-agent-events';
import { isFixtureServerUrl } from '@/fixtures';
import { useSessionSnapshot } from '@/hooks/use-session';
import type {
  ConversationMessageView,
  ConversationTurnView,
} from '@/features/agents/types';

function mergeById<T extends { id: string; createdAt: string }>(items: T[], nextItem: T) {
  const existing = items.find((item) => item.id === nextItem.id);
  const merged = existing
    ? items.map((item) => item.id === nextItem.id ? nextItem : item)
    : [...items, nextItem];
  return merged.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function mergeTurnById(items: ConversationTurnView[], nextItem: ConversationTurnView) {
  const existing = items.find((item) => item.id === nextItem.id);
  const merged = existing
    ? items.map((item) => item.id === nextItem.id ? nextItem : item)
    : [...items, nextItem];
  return merged.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

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
  const [showProviderManager, setShowProviderManager] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [channelTopic, setChannelTopic] = useState('');
  const [memberName, setMemberName] = useState('');
  const [memberProviderId, setMemberProviderId] = useState('');
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

  const providersQuery = useQuery({
    queryKey: ['agent-providers'],
    queryFn: fetchProviders,
    enabled: activePane === 'members' || showCreateMember,
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

  const turnsQuery = useQuery({
    queryKey: ['agent-conversation-turns', selectedConversationId],
    queryFn: () => fetchConversationTurns(selectedConversationId),
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
    const firstProviderId = providersQuery.data?.[0]?.id ?? '';
    if (showCreateMember && !memberProviderId && firstProviderId) {
      setMemberProviderId(firstProviderId);
    }
  }, [memberProviderId, showCreateMember, providersQuery.data]);

  useConversationEvents(selectedConversationId, (event: ConversationStreamEvent) => {
    if (event.type === 'message') {
      const message = event.payload as ConversationMessageView;
      queryClient.setQueryData<ConversationMessageView[]>(
        ['agent-conversation-messages', selectedConversationId],
        (current = []) => mergeById(current, message),
      );
    } else {
      const turn = event.payload as ConversationTurnView;
      queryClient.setQueryData<ConversationTurnView[]>(
        ['agent-conversation-turns', selectedConversationId],
        (current = []) => mergeTurnById(current, turn),
      );
    }
    void queryClient.invalidateQueries({ queryKey: ['agent-conversations'] });
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

  const createProviderMutation = useMutation({
    mutationFn: createProvider,
    onSuccess: (provider) => {
      setMemberProviderId(provider.id);
      setShowProviderManager(false);
      void queryClient.invalidateQueries({ queryKey: ['agent-providers'] });
    },
  });

  const createAgentMutation = useMutation({
    mutationFn: createAgent,
    onSuccess: (agent) => {
      setActivePane('members');
      setSelectedAgentId(agent.id);
      setShowCreateMember(false);
      setShowProviderManager(false);
      setMemberName('');
      setMemberProviderId(agent.providerId);
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
    onSuccess: (result, variables) => {
      setMessageInput('');
      queryClient.setQueryData<ConversationMessageView[]>(
        ['agent-conversation-messages', variables.conversationId],
        (current = []) => mergeById(current, result.message),
      );
      queryClient.setQueryData<ConversationTurnView[]>(
        ['agent-conversation-turns', variables.conversationId],
        (current = []) => result.turns.reduce(
          (merged, turn) => mergeTurnById(merged, turn),
          current,
        ),
      );
      scheduleConversationRefresh(variables.conversationId);
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

  const updateAgentMutation = useMutation({
    mutationFn: ({ agentId, payload }: { agentId: string; payload: Parameters<typeof updateAgent>[1] }) => updateAgent(agentId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agent-profiles'] });
    },
  });

  const conversations = conversationsQuery.data ?? [];
  const agents = agentsQuery.data ?? [];
  const providers = providersQuery.data ?? [];
  const schedules = schedulesQuery.data ?? [];
  const messages = messagesQuery.data ?? [];
  const turns = turnsQuery.data ?? [];
  const memberDataLoading = (activePane === 'members' || showCreateMember) && providersQuery.isLoading;
  const coreLoading = healthQuery.isLoading || conversationsQuery.isLoading || agentsQuery.isLoading || schedulesQuery.isLoading || memberDataLoading;
  const messagesLoading = selectedConversationId !== '' && messagesQuery.isLoading;
  const turnsLoading = selectedConversationId !== '' && turnsQuery.isLoading;

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
        void queryClient.invalidateQueries({ queryKey: ['agent-conversations'] });
        void queryClient.invalidateQueries({ queryKey: ['agent-profiles'] });
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
      setShowProviderManager(false);
    }
  }

  function handleSelectAgent(agentId: string) {
    setActivePane('members');
    setShowCreateMember(false);
    setShowProviderManager(false);
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
    setShowProviderManager(false);
    setMemberName('');
    setMemberProviderId(providersQuery.data?.[0]?.id ?? '');
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

  function handleCreateProvider(payload: Parameters<typeof createProviderMutation.mutate>[0]) {
    if (fixtureMode) {
      return;
    }
    void createProviderMutation.mutate(payload);
  }

  function handleCreateMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!memberName.trim() || !memberProviderId || fixtureMode) {
      return;
    }

    void createAgentMutation.mutate({
      name: memberName.trim(),
      providerId: memberProviderId,
      serverUrl: session.serverUrl,
      playerId: session.playerId,
      playerKey: session.playerKey,
    });
  }

  if (coreLoading) {
    return <div className="panel">正在加载智能体协作台...</div>;
  }

  if (healthQuery.error || conversationsQuery.error || agentsQuery.error || providersQuery.error || schedulesQuery.error || messagesQuery.error || turnsQuery.error) {
    const error = healthQuery.error || conversationsQuery.error || agentsQuery.error || providersQuery.error || schedulesQuery.error || messagesQuery.error || turnsQuery.error;
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
      turns={turns}
      turnsLoading={turnsLoading}
      agents={agents}
      selectedAgentId={selectedAgentId}
      providers={providers}
      schedules={schedules}
      showCreateChannel={showCreateChannel}
      showCreateMember={showCreateMember}
      showProviderManager={showProviderManager}
      channelName={channelName}
      channelTopic={channelTopic}
      memberName={memberName}
      memberProviderId={memberProviderId}
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
      onOpenProviderManager={() => setShowProviderManager(true)}
      onCloseProviderManager={() => setShowProviderManager(false)}
      onChannelNameChange={setChannelName}
      onChannelTopicChange={setChannelTopic}
      onMemberNameChange={setMemberName}
      onMemberProviderIdChange={setMemberProviderId}
      onMessageInputChange={setMessageInput}
      onInviteAgentIdChange={setInviteAgentId}
      onInvitePlanetIdChange={setInvitePlanetId}
      onScheduleIntervalChange={setScheduleIntervalSeconds}
      onScheduleMessageChange={setScheduleMessage}
      onCreateProvider={handleCreateProvider}
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
      onSaveAgentPolicy={(policy) => {
        if (fixtureMode || !selectedAgentId) {
          return;
        }
        void updateAgentMutation.mutate({ agentId: selectedAgentId, payload: { policy } });
      }}
      onSaveAgentProvider={(providerId) => {
        if (fixtureMode || !selectedAgentId) {
          return;
        }
        void updateAgentMutation.mutate({ agentId: selectedAgentId, payload: { providerId } });
      }}
    />
  );
}

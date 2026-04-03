import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AgentWorkspace } from '@/features/agents/AgentWorkspace';
import {
  createConversation,
  createSchedule,
  fetchAgents,
  fetchConversationMessages,
  fetchConversations,
  fetchGatewayHealth,
  fetchSchedules,
  inviteConversationMembersByPlanet,
  sendConversationMessage,
} from '@/features/agents/api';
import { useConversationEvents } from '@/features/agents/use-agent-events';
import { isFixtureServerUrl } from '@/fixtures';
import { useSessionSnapshot } from '@/hooks/use-session';

export function AgentsPage() {
  const session = useSessionSnapshot();
  const queryClient = useQueryClient();
  const fixtureMode = isFixtureServerUrl(session.serverUrl);
  const [selectedConversationId, setSelectedConversationId] = useState('');
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [channelTopic, setChannelTopic] = useState('');
  const [messageInput, setMessageInput] = useState('');
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

  useConversationEvents(selectedConversationId, () => {
    void queryClient.invalidateQueries({ queryKey: ['agent-conversation-messages', selectedConversationId] });
    void queryClient.invalidateQueries({ queryKey: ['agent-profiles'] });
    void queryClient.invalidateQueries({ queryKey: ['agent-schedules'] });
  });

  const createConversationMutation = useMutation({
    mutationFn: createConversation,
    onSuccess: (conversation) => {
      setSelectedConversationId(conversation.id);
      setChannelName('');
      setChannelTopic('');
      setShowCreateChannel(false);
      void queryClient.invalidateQueries({ queryKey: ['agent-conversations'] });
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

  const createScheduleMutation = useMutation({
    mutationFn: ({ targetId, intervalSeconds, messageTemplate }: { targetId: string; intervalSeconds: number; messageTemplate: string }) => createSchedule({
      creatorType: 'player',
      creatorId: session.playerId,
      targetType: 'conversation',
      targetId,
      intervalSeconds,
      messageTemplate,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agent-schedules'] });
      scheduleConversationRefresh(selectedConversationId);
    },
  });

  const conversations = conversationsQuery.data ?? [];
  const agents = agentsQuery.data ?? [];
  const schedules = schedulesQuery.data ?? [];
  const messages = messagesQuery.data ?? [];
  const coreLoading = healthQuery.isLoading || conversationsQuery.isLoading || agentsQuery.isLoading || schedulesQuery.isLoading;
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
    if (!selectedConversationId || !scheduleMessage.trim() || fixtureMode) {
      return;
    }
    const intervalSeconds = Number(scheduleIntervalSeconds);
    if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
      return;
    }
    void createScheduleMutation.mutate({
      targetId: selectedConversationId,
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

  if (coreLoading) {
    return <div className="panel">正在加载智能体协作台...</div>;
  }

  if (healthQuery.error || conversationsQuery.error || agentsQuery.error || schedulesQuery.error || messagesQuery.error) {
    const error = healthQuery.error || conversationsQuery.error || agentsQuery.error || schedulesQuery.error || messagesQuery.error;
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
      conversations={conversations}
      selectedConversationId={selectedConversation?.id ?? ''}
      messages={messages}
      messagesLoading={messagesLoading}
      agents={agents}
      schedules={schedules}
      showCreateChannel={showCreateChannel}
      channelName={channelName}
      channelTopic={channelTopic}
      messageInput={messageInput}
      invitePlanetId={invitePlanetId}
      scheduleIntervalSeconds={scheduleIntervalSeconds}
      scheduleMessage={scheduleMessage}
      onSelectConversation={setSelectedConversationId}
      onToggleCreateChannel={() => setShowCreateChannel((current) => !current)}
      onChannelNameChange={setChannelName}
      onChannelTopicChange={setChannelTopic}
      onMessageInputChange={setMessageInput}
      onInvitePlanetIdChange={setInvitePlanetId}
      onScheduleIntervalChange={setScheduleIntervalSeconds}
      onScheduleMessageChange={setScheduleMessage}
      onCreateChannel={handleCreateChannel}
      onSendMessage={handleSendMessage}
      onInviteByPlanet={handleInviteByPlanet}
      onCreateSchedule={handleCreateSchedule}
      onStartDm={handleStartDm}
    />
  );
}

import type { AgentInstance, Conversation, ConversationMessage } from '../types.js';

type MailboxStatus = 'idle' | 'running';

export interface MailboxEntry {
  agentId: string;
  turnId: string;
  message: ConversationMessage;
  conversation: Conversation;
}

interface MailboxControllerOptions {
  runAgent: (input: MailboxEntry) => Promise<void>;
}

export function resolveAutoWakeTargets(input: {
  conversation: Conversation;
  message: ConversationMessage;
}) {
  if (input.conversation.type === 'dm') {
    if (input.message.senderType === 'agent' && input.message.trigger !== 'agent_dispatch') {
      return [];
    }
    return input.conversation.memberIds
      .filter((memberId) => memberId.startsWith('agent:'))
      .map((memberId) => memberId.slice('agent:'.length))
      .filter((agentId) => !(input.message.senderType === 'agent' && input.message.senderId === agentId));
  }

  return input.message.mentions
    .map((mention) => mention.id)
    .filter((agentId) => !(input.message.senderType === 'agent' && input.message.senderId === agentId));
}

export function resolveMentionTargetsFromContent(content: string, agents: AgentInstance[]) {
  const mentions = new Map<string, { type: 'agent'; id: string }>();
  for (const agent of agents) {
    if (content.includes(`@${agent.name}`) || content.includes(`@${agent.id}`)) {
      mentions.set(agent.id, { type: 'agent', id: agent.id });
    }
  }
  return [...mentions.values()];
}

export function createMailboxController(options: MailboxControllerOptions) {
  const mailboxes = new Map<string, MailboxEntry[]>();
  const statuses = new Map<string, MailboxStatus>();
  const drains = new Map<string, Promise<void>>();

  function mailboxFor(agentId: string) {
    return (mailboxes.get(agentId) ?? []).map((entry) => entry.message.id);
  }

  function statusOf(agentId: string): MailboxStatus {
    return statuses.get(agentId) ?? 'idle';
  }

  async function drain(agentId: string) {
    if (statusOf(agentId) === 'running') {
      return drains.get(agentId);
    }

    statuses.set(agentId, 'running');
    const currentDrain = (async () => {
      try {
        while ((mailboxes.get(agentId)?.length ?? 0) > 0) {
          const next = mailboxes.get(agentId)?.[0];
          if (!next) {
            break;
          }
          await options.runAgent(next);
          mailboxes.get(agentId)?.shift();
        }
      } finally {
        statuses.set(agentId, 'idle');
        drains.delete(agentId);
      }
    })();
    drains.set(agentId, currentDrain);
    return currentDrain;
  }

  return {
    async accept(entries: MailboxEntry[]) {
      const targets = [...new Set(entries.map((entry) => entry.agentId))];
      for (const entry of entries) {
        const agentId = entry.agentId;
        const mailbox = mailboxes.get(agentId) ?? [];
        mailbox.push(entry);
        mailboxes.set(agentId, mailbox);
        void drain(agentId);
      }
      await Promise.all(targets.map((agentId) => drains.get(agentId)));
    },
    mailboxFor,
    statusOf,
  };
}

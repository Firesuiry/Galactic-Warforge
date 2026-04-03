import { useMemo, useState, type FormEvent } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AgentWorkspace } from '@/features/agents/AgentWorkspace';
import {
  createAgent,
  createTemplate,
  exportAgentBundle,
  fetchAgents,
  fetchAgentThread,
  fetchGatewayHealth,
  fetchTemplates,
  importAgentBundle,
  sendAgentMessage,
} from '@/features/agents/api';
import { useAgentEvents } from '@/features/agents/use-agent-events';
import { isFixtureServerUrl } from '@/fixtures';
import { useSessionSnapshot } from '@/hooks/use-session';

export function AgentsPage() {
  const session = useSessionSnapshot();
  const queryClient = useQueryClient();
  const fixtureMode = isFixtureServerUrl(session.serverUrl);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [agentName, setAgentName] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const [exportText, setExportText] = useState('');
  const [importText, setImportText] = useState('');
  const [templateForm, setTemplateForm] = useState({
    name: '新模板',
    providerKind: 'openai_compatible_http' as const,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-5',
    command: 'codex',
    workdir: '/home/firesuiry/develop/siliconWorld',
    systemPrompt: '你是 SiliconWorld 游戏智能体。优先用 CLI 查询局势，再逐步执行。返回严格 JSON。',
  });

  const healthQuery = useQuery({
    queryKey: ['agent-health'],
    queryFn: fetchGatewayHealth,
  });

  const templatesQuery = useQuery({
    queryKey: ['agent-templates'],
    queryFn: fetchTemplates,
  });

  const agentsQuery = useQuery({
    queryKey: ['agent-instances'],
    queryFn: fetchAgents,
  });

  const threadQuery = useQuery({
    queryKey: ['agent-thread', selectedAgentId],
    queryFn: () => fetchAgentThread(selectedAgentId),
    enabled: selectedAgentId !== '',
  });

  useAgentEvents(selectedAgentId, () => {
    void queryClient.invalidateQueries({ queryKey: ['agent-thread', selectedAgentId] });
    void queryClient.invalidateQueries({ queryKey: ['agent-instances'] });
  });

  const createTemplateMutation = useMutation({
    mutationFn: createTemplate,
    onSuccess: (template) => {
      setSelectedTemplateId(template.id);
      void queryClient.invalidateQueries({ queryKey: ['agent-templates'] });
    },
  });

  const createAgentMutation = useMutation({
    mutationFn: createAgent,
    onSuccess: (agent) => {
      setSelectedAgentId(agent.id);
      void queryClient.invalidateQueries({ queryKey: ['agent-instances'] });
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: ({ agentId, content }: { agentId: string; content: string }) => sendAgentMessage(agentId, content),
    onSuccess: () => {
      setMessageInput('');
      void queryClient.invalidateQueries({ queryKey: ['agent-thread', selectedAgentId] });
      void queryClient.invalidateQueries({ queryKey: ['agent-instances'] });
    },
  });

  const templates = templatesQuery.data ?? [];
  const agents = agentsQuery.data ?? [];

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? templates[0],
    [selectedTemplateId, templates],
  );

  function updateTemplateField(field: string, value: string) {
    setTemplateForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function handleCreateTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void createTemplateMutation.mutate({
      name: templateForm.name,
      providerKind: templateForm.providerKind,
      description: '',
      defaultModel: templateForm.model,
      systemPrompt: templateForm.systemPrompt,
      toolPolicy: {
        cliEnabled: true,
        maxSteps: 6,
        maxToolCallsPerTurn: 3,
        commandWhitelist: [],
      },
      providerConfig: templateForm.providerKind === 'openai_compatible_http'
        ? {
            baseUrl: templateForm.baseUrl,
            apiKey: templateForm.apiKey,
            model: templateForm.model,
            extraHeaders: {},
          }
        : {
            command: templateForm.command,
            model: templateForm.model,
            workdir: templateForm.workdir,
            argsTemplate: [],
            envOverrides: {},
          },
    });
  }

  function handleCreateAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTemplate) {
      return;
    }
    void createAgentMutation.mutate({
      name: agentName.trim() || `${selectedTemplate.name} 实例`,
      templateId: selectedTemplate.id,
      serverUrl: session.serverUrl,
      playerId: session.playerId,
      playerKey: session.playerKey,
      goal: '',
    });
  }

  function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAgentId || !messageInput.trim() || fixtureMode) {
      return;
    }
    void sendMessageMutation.mutate({
      agentId: selectedAgentId,
      content: messageInput.trim(),
    });
  }

  async function handleExport() {
    const bundle = await exportAgentBundle(false);
    setExportText(JSON.stringify(bundle, null, 2));
  }

  async function handleImport() {
    if (!importText.trim()) {
      return;
    }
    await importAgentBundle(JSON.parse(importText));
    void queryClient.invalidateQueries({ queryKey: ['agent-templates'] });
    void queryClient.invalidateQueries({ queryKey: ['agent-instances'] });
  }

  if (healthQuery.isLoading || templatesQuery.isLoading || agentsQuery.isLoading) {
    return <div className="panel">正在加载智能体工作台...</div>;
  }

  if (healthQuery.error || templatesQuery.error || agentsQuery.error) {
    const error = healthQuery.error || templatesQuery.error || agentsQuery.error;
    return (
      <div className="panel error-banner" role="alert">
        {error instanceof Error ? error.message : '智能体工作台加载失败'}
      </div>
    );
  }

  return (
    <AgentWorkspace
      gatewayOnline={healthQuery.data?.status === 'ok'}
      fixtureMode={fixtureMode}
      templates={templates}
      agents={agents}
      selectedTemplateId={selectedTemplate?.id ?? ''}
      selectedAgentId={selectedAgentId}
      thread={threadQuery.data}
      templateForm={templateForm}
      agentName={agentName}
      messageInput={messageInput}
      importText={importText}
      exportText={exportText}
      onTemplateFieldChange={updateTemplateField}
      onSelectedTemplateChange={setSelectedTemplateId}
      onSelectedAgentChange={setSelectedAgentId}
      onAgentNameChange={setAgentName}
      onMessageInputChange={setMessageInput}
      onImportTextChange={setImportText}
      onCreateTemplate={handleCreateTemplate}
      onCreateAgent={handleCreateAgent}
      onSendMessage={handleSendMessage}
      onExport={() => { void handleExport(); }}
      onImport={() => { void handleImport(); }}
    />
  );
}

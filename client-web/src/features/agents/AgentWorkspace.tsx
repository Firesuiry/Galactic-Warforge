import type { FormEvent } from 'react';

import type {
  AgentInstanceSummary,
  AgentTemplateSummary,
  AgentThreadView,
} from './types';

interface AgentWorkspaceProps {
  gatewayOnline: boolean;
  fixtureMode: boolean;
  templates: AgentTemplateSummary[];
  agents: AgentInstanceSummary[];
  selectedTemplateId: string;
  selectedAgentId: string;
  thread?: AgentThreadView;
  templateForm: {
    name: string;
    providerKind: 'openai_compatible_http' | 'codex_cli' | 'claude_code_cli';
    baseUrl: string;
    apiKey: string;
    model: string;
    command: string;
    workdir: string;
    systemPrompt: string;
  };
  agentName: string;
  messageInput: string;
  importText: string;
  exportText: string;
  onTemplateFieldChange: (field: string, value: string) => void;
  onSelectedTemplateChange: (value: string) => void;
  onSelectedAgentChange: (value: string) => void;
  onAgentNameChange: (value: string) => void;
  onMessageInputChange: (value: string) => void;
  onImportTextChange: (value: string) => void;
  onCreateTemplate: (event: FormEvent<HTMLFormElement>) => void;
  onCreateAgent: (event: FormEvent<HTMLFormElement>) => void;
  onSendMessage: (event: FormEvent<HTMLFormElement>) => void;
  onExport: () => void;
  onImport: () => void;
}

export function AgentWorkspace(props: AgentWorkspaceProps) {
  const selectedAgent = props.agents.find((agent) => agent.id === props.selectedAgentId);
  const selectedTemplate = props.templates.find((template) => template.id === props.selectedTemplateId);

  return (
    <div className="agent-workspace">
      <section className="panel agent-workspace__column">
        <div className="page-header">
          <h1>智能体工作台</h1>
          <p className="subtle-text">
            {props.gatewayOnline ? '本地 Agent 网关在线。' : '本地 Agent 网关不可达。'}
            {props.fixtureMode ? ' 当前为离线样例模式，执行入口会被禁用。' : ''}
          </p>
        </div>

        <div className="section-title">模板</div>
        <ul className="agent-list">
          {props.templates.map((template) => (
            <li key={template.id}>
              <button
                className={template.id === props.selectedTemplateId ? 'secondary-button agent-list__button agent-list__button--active' : 'secondary-button agent-list__button'}
                onClick={() => props.onSelectedTemplateChange(template.id)}
                type="button"
              >
                {template.name}
              </button>
            </li>
          ))}
        </ul>

        <form className="agent-form" onSubmit={props.onCreateTemplate}>
          <div className="section-title">新建模板</div>
          <label className="field">
            <span>模板名称</span>
            <input value={props.templateForm.name} onChange={(event) => props.onTemplateFieldChange('name', event.target.value)} />
          </label>
          <label className="field">
            <span>Provider</span>
            <select value={props.templateForm.providerKind} onChange={(event) => props.onTemplateFieldChange('providerKind', event.target.value)}>
              <option value="openai_compatible_http">OpenAI Compatible HTTP</option>
              <option value="codex_cli">Codex CLI</option>
              <option value="claude_code_cli">Claude Code CLI</option>
            </select>
          </label>
          {props.templateForm.providerKind === 'openai_compatible_http' ? (
            <>
              <label className="field">
                <span>base_url</span>
                <input value={props.templateForm.baseUrl} onChange={(event) => props.onTemplateFieldChange('baseUrl', event.target.value)} />
              </label>
              <label className="field">
                <span>api_key</span>
                <input value={props.templateForm.apiKey} onChange={(event) => props.onTemplateFieldChange('apiKey', event.target.value)} />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>command</span>
                <input value={props.templateForm.command} onChange={(event) => props.onTemplateFieldChange('command', event.target.value)} />
              </label>
              <label className="field">
                <span>workdir</span>
                <input value={props.templateForm.workdir} onChange={(event) => props.onTemplateFieldChange('workdir', event.target.value)} />
              </label>
            </>
          )}
          <label className="field">
            <span>model</span>
            <input value={props.templateForm.model} onChange={(event) => props.onTemplateFieldChange('model', event.target.value)} />
          </label>
          <label className="field">
            <span>system_prompt</span>
            <textarea value={props.templateForm.systemPrompt} onChange={(event) => props.onTemplateFieldChange('systemPrompt', event.target.value)} rows={5} />
          </label>
          <button className="primary-button" type="submit">创建模板</button>
        </form>
      </section>

      <section className="panel agent-workspace__column">
        <div className="section-title">实例</div>
        <ul className="agent-list">
          {props.agents.map((agent) => (
            <li key={agent.id}>
              <button
                className={agent.id === props.selectedAgentId ? 'secondary-button agent-list__button agent-list__button--active' : 'secondary-button agent-list__button'}
                onClick={() => props.onSelectedAgentChange(agent.id)}
                type="button"
              >
                {agent.name} · {agent.status}
              </button>
            </li>
          ))}
        </ul>

        <form className="agent-form" onSubmit={props.onCreateAgent}>
          <div className="section-title">基于模板创建实例</div>
          <label className="field">
            <span>名称</span>
            <input value={props.agentName} onChange={(event) => props.onAgentNameChange(event.target.value)} />
          </label>
          <label className="field">
            <span>当前模板</span>
            <input readOnly value={selectedTemplate?.name ?? ''} />
          </label>
          <button className="primary-button" disabled={!selectedTemplate} type="submit">创建实例</button>
        </form>

        <div className="section-title">对话线程</div>
        <div className="agent-thread">
          {props.thread?.messages.length ? props.thread.messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`agent-thread__message agent-thread__message--${message.role}`}>
              <strong>{message.role}</strong>
              <p>{message.content}</p>
            </div>
          )) : (
            <p className="subtle-text">选择实例后可查看消息和工具调用结果。</p>
          )}
        </div>

        <form className="agent-form" onSubmit={props.onSendMessage}>
          <label className="field">
            <span>发送指令</span>
            <textarea
              value={props.messageInput}
              onChange={(event) => props.onMessageInputChange(event.target.value)}
              rows={4}
            />
          </label>
          <button
            className="primary-button"
            disabled={!selectedAgent || props.fixtureMode}
            type="submit"
          >
            运行智能体
          </button>
        </form>
      </section>

      <section className="panel agent-workspace__column">
        <div className="section-title">当前上下文</div>
        <div className="agent-context">
          <p>当前模板：{selectedTemplate?.name ?? '未选择'}</p>
          <p>当前实例：{selectedAgent?.name ?? '未选择'}</p>
          <p>状态：{selectedAgent?.status ?? '-'}</p>
          <p>目标：{selectedAgent?.goal || '-'}</p>
        </div>

        <div className="section-title">导入导出</div>
        <div className="agent-actions">
          <button className="secondary-button" onClick={props.onExport} type="button">导出模板</button>
          <button className="secondary-button" onClick={props.onImport} type="button">导入 Bundle</button>
        </div>
        <label className="field">
          <span>导出结果</span>
          <textarea readOnly rows={10} value={props.exportText} />
        </label>
        <label className="field">
          <span>导入内容</span>
          <textarea rows={10} value={props.importText} onChange={(event) => props.onImportTextChange(event.target.value)} />
        </label>
      </section>
    </div>
  );
}

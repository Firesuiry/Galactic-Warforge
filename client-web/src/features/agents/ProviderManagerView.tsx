import { useState, type FormEvent } from 'react';

import type { AgentProviderKindView, CreateProviderPayload, ModelProviderView } from './types';

interface ProviderManagerViewProps {
  fixtureMode: boolean;
  providers: ModelProviderView[];
  onCreateProvider: (payload: CreateProviderPayload) => void;
  onClose: () => void;
}

const DEFAULT_WORKDIR = '/home/firesuiry/develop/siliconWorld';
const DEFAULT_API_URL = 'https://api.minimaxi.com/v1';

function getProviderDefaults(providerKind: AgentProviderKindView) {
  if (providerKind === 'http_api') {
    return {
      apiUrl: DEFAULT_API_URL,
      apiStyle: 'openai' as const,
      command: '',
      model: 'MiniMax-M2.1',
    };
  }

  if (providerKind === 'claude_code_cli') {
    return {
      apiUrl: DEFAULT_API_URL,
      apiStyle: 'openai' as const,
      command: 'claude',
      model: 'sonnet',
    };
  }

  return {
    apiUrl: DEFAULT_API_URL,
    apiStyle: 'openai' as const,
    command: 'codex',
    model: 'gpt-5-codex',
  };
}

function parseArgsText(value: string) {
  return value
    .split(/\r?\n/)
    .flatMap((line) => line.split(/\s+/))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function ProviderManagerView(props: ProviderManagerViewProps) {
  const [providerName, setProviderName] = useState('');
  const [providerDescription, setProviderDescription] = useState('');
  const [providerKind, setProviderKind] = useState<AgentProviderKindView>('codex_cli');
  const [modelName, setModelName] = useState(getProviderDefaults('codex_cli').model);
  const [apiUrl, setApiUrl] = useState(getProviderDefaults('http_api').apiUrl);
  const [apiStyle, setApiStyle] = useState<'openai' | 'claude'>(getProviderDefaults('http_api').apiStyle);
  const [apiKey, setApiKey] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('你是智能体成员。请直接在当前会话中回复，并保持结论清晰。');
  const [command, setCommand] = useState(getProviderDefaults('codex_cli').command);
  const [workdir, setWorkdir] = useState(DEFAULT_WORKDIR);
  const [argsText, setArgsText] = useState('');

  function handleProviderKindChange(nextProviderKind: AgentProviderKindView) {
    const defaults = getProviderDefaults(nextProviderKind);
    setProviderKind(nextProviderKind);
    setApiUrl(defaults.apiUrl);
    setApiStyle(defaults.apiStyle);
    setCommand(defaults.command);
    setModelName(defaults.model);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!providerName.trim()) {
      return;
    }

    props.onCreateProvider({
      name: providerName.trim(),
      providerKind,
      description: providerDescription.trim(),
      defaultModel: modelName.trim(),
      systemPrompt: systemPrompt.trim(),
      toolPolicy: {
        cliEnabled: true,
        maxSteps: 8,
        maxToolCallsPerTurn: 4,
        commandWhitelist: ['build', 'overview', 'galaxy', 'planet'],
      },
      providerConfig: providerKind === 'http_api'
        ? {
            apiUrl: apiUrl.trim(),
            apiStyle,
            apiKey: apiKey.trim(),
            model: modelName.trim(),
            extraHeaders: {},
          }
        : {
            command: command.trim(),
            model: modelName.trim(),
            workdir: workdir.trim(),
            argsTemplate: parseArgsText(argsText),
            envOverrides: {},
          },
    });
  }

  return (
    <section className="agent-members-view__section agent-template-manager">
      <div className="agent-members-view__section-header">
        <div>
          <div className="section-title">模型 Provider 管理</div>
          <p className="subtle-text">模型 Provider 定义成员绑定的 AI 接口、模型、系统提示词与启动参数。</p>
        </div>
        <button className="secondary-button" onClick={props.onClose} type="button">
          收起模型 Provider
        </button>
      </div>

      {props.providers.length > 0 ? (
        <ul className="agent-im__detail-list">
          {props.providers.map((provider) => (
            <li key={provider.id} className="agent-im__detail-card">
              <strong>{provider.name}</strong>
              <span>{provider.description || '未填写模型 Provider 说明'}</span>
              <span>{provider.providerKind} / {provider.defaultModel}</span>
              {'command' in provider.providerConfig ? (
                <>
                  <span>{`命令 ${provider.providerConfig.command}`}</span>
                  <span>{provider.providerConfig.workdir || '未配置工作目录'}</span>
                  {provider.providerConfig.argsTemplate?.length ? (
                    <span>{`启动参数 ${provider.providerConfig.argsTemplate.join(' ')}`}</span>
                  ) : null}
                </>
              ) : (
                <>
                  <span>{`API ${provider.providerConfig.apiUrl}`}</span>
                  <span>{`接口 ${provider.providerConfig.apiStyle}`}</span>
                  <span>{provider.providerConfig.hasSecret ? '已保存 API Key' : '未保存 API Key'}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="agent-members-view__placeholder">
          <div className="section-title">还没有模型 Provider</div>
          <p className="subtle-text">先创建一个模型 Provider，再把它绑定到成员。</p>
        </div>
      )}

      <form className="agent-im__composer-card" onSubmit={handleSubmit}>
        <label className="field">
          <span>模型 Provider 名称</span>
          <input
            aria-label="模型 Provider 名称"
            value={providerName}
            onChange={(event) => setProviderName(event.target.value)}
          />
        </label>
        <label className="field">
          <span>模型 Provider 说明</span>
          <textarea
            aria-label="模型 Provider 说明"
            rows={3}
            value={providerDescription}
            onChange={(event) => setProviderDescription(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Provider 类型</span>
          <select
            aria-label="Provider 类型"
            value={providerKind}
            onChange={(event) => handleProviderKindChange(event.target.value as AgentProviderKindView)}
          >
            <option value="http_api">HTTP API</option>
            <option value="codex_cli">Codex CLI</option>
            <option value="claude_code_cli">Claude Code CLI</option>
          </select>
        </label>
        {providerKind !== 'http_api' ? (
          <label className="field">
            <span>模型名称</span>
            <input
              aria-label="模型名称"
              value={modelName}
              onChange={(event) => setModelName(event.target.value)}
            />
          </label>
        ) : null}
        <label className="field">
          <span>系统提示词</span>
          <textarea
            aria-label="系统提示词"
            rows={5}
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
          />
        </label>
        {providerKind === 'http_api' ? (
          <>
            <label className="field">
              <span>API URL</span>
              <input
                aria-label="API URL"
                value={apiUrl}
                onChange={(event) => setApiUrl(event.target.value)}
              />
            </label>
            <label className="field">
              <span>接口类型</span>
              <select
                aria-label="接口类型"
                value={apiStyle}
                onChange={(event) => setApiStyle(event.target.value as 'openai' | 'claude')}
              >
                <option value="openai">OpenAI</option>
                <option value="claude">Claude</option>
              </select>
            </label>
            <label className="field">
              <span>模型名称</span>
              <input
                aria-label="模型名称"
                value={modelName}
                onChange={(event) => setModelName(event.target.value)}
              />
            </label>
            <label className="field">
              <span>API Key</span>
              <input
                aria-label="API Key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
          </>
        ) : (
          <>
            <label className="field">
              <span>启动命令</span>
              <input
                aria-label="启动命令"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
              />
            </label>
            <label className="field">
              <span>工作目录</span>
              <input
                aria-label="工作目录"
                value={workdir}
                onChange={(event) => setWorkdir(event.target.value)}
              />
            </label>
            <label className="field">
              <span>启动参数</span>
              <textarea
                aria-label="启动参数"
                rows={4}
                value={argsText}
                onChange={(event) => setArgsText(event.target.value)}
              />
              <span className="field-hint">按空格或换行拆分参数，例如每行一个 flag 或 value。</span>
            </label>
          </>
        )}
        <button className="primary-button" disabled={!providerName.trim() || props.fixtureMode} type="submit">
          保存模型 Provider
        </button>
      </form>
    </section>
  );
}

import type { FormEvent } from 'react';

import type { AgentTemplateView } from './types';

interface TemplateManagerViewProps {
  fixtureMode: boolean;
  templates: AgentTemplateView[];
  templateName: string;
  templateDescription: string;
  onTemplateNameChange: (value: string) => void;
  onTemplateDescriptionChange: (value: string) => void;
  onCreateTemplate: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}

export function TemplateManagerView(props: TemplateManagerViewProps) {
  return (
    <section className="agent-members-view__section agent-template-manager">
      <div className="agent-members-view__section-header">
        <div>
          <div className="section-title">模板管理</div>
          <p className="subtle-text">模板属于成员体系，用来规定成员默认模型、系统提示词与工具策略。</p>
        </div>
        <button className="secondary-button" onClick={props.onClose} type="button">
          收起模板
        </button>
      </div>

      {props.templates.length > 0 ? (
        <ul className="agent-im__detail-list">
          {props.templates.map((template) => (
            <li key={template.id} className="agent-im__detail-card">
              <strong>{template.name}</strong>
              <span>{template.description || '未填写模板说明'}</span>
              <span>{template.providerKind} / {template.defaultModel}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="agent-members-view__placeholder">
          <div className="section-title">还没有模板</div>
          <p className="subtle-text">先创建一个模板，再把它绑定到成员。</p>
        </div>
      )}

      <form className="agent-im__composer-card" onSubmit={props.onCreateTemplate}>
        <label className="field">
          <span>模板名称</span>
          <input
            aria-label="模板名称"
            value={props.templateName}
            onChange={(event) => props.onTemplateNameChange(event.target.value)}
          />
        </label>
        <label className="field">
          <span>模板说明</span>
          <textarea
            aria-label="模板说明"
            rows={3}
            value={props.templateDescription}
            onChange={(event) => props.onTemplateDescriptionChange(event.target.value)}
          />
        </label>
        <button className="primary-button" disabled={!props.templateName.trim() || props.fixtureMode} type="submit">
          保存模板
        </button>
      </form>
    </section>
  );
}

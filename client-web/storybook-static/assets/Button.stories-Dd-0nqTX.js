import{j as e}from"./jsx-runtime-QerWQ8Km.js";import{R as S}from"./rocket-8m0mMmS2.js";import{c as b}from"./createLucideIcon-ClIhKPqQ.js";import"./iframe-BWVhyVYz.js";import"./preload-helper-Dp1pzeXC.js";/**
 * @license lucide-react v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const V=[["path",{d:"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",key:"1c8476"}],["path",{d:"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7",key:"1ydtos"}],["path",{d:"M7 3v4a1 1 0 0 0 1 1h7",key:"t51u73"}]],M=b("save",V);/**
 * @license lucide-react v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _=[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],T=b("trash-2",_),N={primary:"primary-button",secondary:"secondary-button",danger:"danger-button"};function r({variant:a="primary",size:i="md",icon:o,className:j,children:I,type:z="button",...k}){return e.jsxs("button",{type:z,className:[N[a],i==="sm"?"sw-btn--sm":"",j].filter(Boolean).join(" "),...k,children:[o?e.jsx(o,{size:i==="sm"?14:16,strokeWidth:2,"aria-hidden":"true"}):null,I]})}r.__docgenInfo={description:`全息按钮（期3 控件库）。受控语义与原生 button 一致（type 默认 "button"，提交传 type="submit"），
皮肤复用 .primary-button/.secondary-button 体系，danger 为新增变体（样式见 components.css 控件库区）。`,methods:[],displayName:"Button",props:{variant:{required:!1,tsType:{name:"union",raw:"'primary' | 'secondary' | 'danger'",elements:[{name:"literal",value:"'primary'"},{name:"literal",value:"'secondary'"},{name:"literal",value:"'danger'"}]},description:"视觉变体：primary 主行动 / secondary 次行动 / danger 危险行动。",defaultValue:{value:"'primary'",computed:!1}},size:{required:!1,tsType:{name:"union",raw:"'sm' | 'md'",elements:[{name:"literal",value:"'sm'"},{name:"literal",value:"'md'"}]},description:"尺寸：md 默认（表单主行动），sm 紧凑（卡片/抽屉内）。",defaultValue:{value:"'md'",computed:!1}},icon:{required:!1,tsType:{name:"LucideIcon"},description:"可选 lucide 图标插槽（渲染在文字前，装饰性 aria-hidden）。"},type:{defaultValue:{value:"'button'",computed:!1},required:!1}},composes:["ButtonHTMLAttributes"]};const L={title:"Common/Controls/Button",component:r,parameters:{layout:"centered"},tags:["autodocs"],argTypes:{variant:{control:"radio",options:["primary","secondary","danger"]},size:{control:"radio",options:["sm","md"]},disabled:{control:"boolean"}},args:{variant:"primary",size:"md",children:"执行指令"}},t={render:a=>e.jsxs("div",{style:{display:"flex",gap:12,padding:16,alignItems:"center"},children:[e.jsx(r,{...a,variant:"primary",children:"主要行动"}),e.jsx(r,{...a,variant:"secondary",children:"次要行动"}),e.jsx(r,{...a,variant:"danger",children:"危险行动"})]})},n={render:a=>e.jsxs("div",{style:{display:"flex",gap:12,padding:16,alignItems:"center"},children:[e.jsx(r,{...a,size:"md",children:"md 默认"}),e.jsx(r,{...a,size:"sm",variant:"secondary",children:"sm 紧凑"})]})},s={render:a=>e.jsxs("div",{style:{display:"flex",gap:12,padding:16,alignItems:"center"},children:[e.jsx(r,{...a,icon:S,children:"发起跃迁"}),e.jsx(r,{...a,variant:"secondary",icon:M,children:"保存"}),e.jsx(r,{...a,variant:"danger",size:"sm",icon:T,children:"解散"})]})},d={render:a=>e.jsxs("div",{style:{display:"flex",gap:12,padding:16,alignItems:"center"},children:[e.jsx(r,{...a,disabled:!0,children:"主要行动"}),e.jsx(r,{...a,variant:"secondary",disabled:!0,children:"次要行动"}),e.jsx(r,{...a,variant:"danger",disabled:!0,children:"危险行动"})]})};var c,l,m;t.parameters={...t.parameters,docs:{...(c=t.parameters)==null?void 0:c.docs,source:{originalSource:`{
  render: args => <div style={{
    display: 'flex',
    gap: 12,
    padding: 16,
    alignItems: 'center'
  }}>
      <Button {...args} variant="primary">主要行动</Button>
      <Button {...args} variant="secondary">次要行动</Button>
      <Button {...args} variant="danger">危险行动</Button>
    </div>
}`,...(m=(l=t.parameters)==null?void 0:l.docs)==null?void 0:m.source}}};var p,u,y;n.parameters={...n.parameters,docs:{...(p=n.parameters)==null?void 0:p.docs,source:{originalSource:`{
  render: args => <div style={{
    display: 'flex',
    gap: 12,
    padding: 16,
    alignItems: 'center'
  }}>
      <Button {...args} size="md">md 默认</Button>
      <Button {...args} size="sm" variant="secondary">sm 紧凑</Button>
    </div>
}`,...(y=(u=n.parameters)==null?void 0:u.docs)==null?void 0:y.source}}};var g,v,h;s.parameters={...s.parameters,docs:{...(g=s.parameters)==null?void 0:g.docs,source:{originalSource:`{
  render: args => <div style={{
    display: 'flex',
    gap: 12,
    padding: 16,
    alignItems: 'center'
  }}>
      <Button {...args} icon={Rocket}>发起跃迁</Button>
      <Button {...args} variant="secondary" icon={Save}>保存</Button>
      <Button {...args} variant="danger" size="sm" icon={Trash2}>解散</Button>
    </div>
}`,...(h=(v=s.parameters)==null?void 0:v.docs)==null?void 0:h.source}}};var x,B,f;d.parameters={...d.parameters,docs:{...(x=d.parameters)==null?void 0:x.docs,source:{originalSource:`{
  render: args => <div style={{
    display: 'flex',
    gap: 12,
    padding: 16,
    alignItems: 'center'
  }}>
      <Button {...args} disabled>主要行动</Button>
      <Button {...args} variant="secondary" disabled>次要行动</Button>
      <Button {...args} variant="danger" disabled>危险行动</Button>
    </div>
}`,...(f=(B=d.parameters)==null?void 0:B.docs)==null?void 0:f.source}}};const C=["Variants","Sizes","WithIcon","Disabled"];export{d as Disabled,n as Sizes,t as Variants,s as WithIcon,C as __namedExportsOrder,L as default};

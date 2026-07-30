import{j as e}from"./jsx-runtime-CemGYn60.js";import{r as i}from"./iframe-CbuGUzys.js";import"./preload-helper-Dp1pzeXC.js";function r({className:s,type:t="text",...a}){const n=t==="checkbox"?"sw-checkbox":"sw-input";return e.jsx("input",{type:t,className:[n,s].filter(Boolean).join(" "),...a})}r.__docgenInfo={description:`全息输入框（期3 控件库）：text/number 通用受控组件，语义与原生 input 一致，
保留 name/aria-label/disabled/inputMode；type="checkbox" 时渲染全息勾选框（.sw-checkbox）。`,methods:[],displayName:"Input",props:{type:{defaultValue:{value:"'text'",computed:!1},required:!1}},composes:["InputHTMLAttributes"]};const w={title:"Common/Controls/Input",component:r,parameters:{layout:"centered"},tags:["autodocs"],argTypes:{type:{control:"radio",options:["text","number","checkbox"]},disabled:{control:"boolean"},placeholder:{control:"text"}},args:{type:"text",placeholder:"输入指令参数","aria-label":"演示输入框"}},l={render:function(){const[t,a]=i.useState("");return e.jsx("div",{style:{padding:16,width:280},children:e.jsx(r,{"aria-label":"文本输入",placeholder:"例如 tf-strike",value:t,onChange:n=>a(n.target.value)})})}},o={render:function(){const[t,a]=i.useState(8);return e.jsx("div",{style:{padding:16,width:280},children:e.jsx(r,{"aria-label":"数值输入",type:"number",min:1,value:t,onChange:n=>a(Number(n.target.value))})})}},c={render:function(){const[t,a]=i.useState(!0);return e.jsxs("div",{style:{display:"flex",gap:16,padding:16,alignItems:"center",color:"#e8f1ff"},children:[e.jsxs("label",{style:{display:"inline-flex",alignItems:"center",gap:8},children:[e.jsx(r,{"aria-label":"勾选开关",type:"checkbox",checked:t,onChange:n=>a(n.target.checked)}),"校验 snapshot digest（",t?"开":"关","）"]}),e.jsxs("label",{style:{display:"inline-flex",alignItems:"center",gap:8,opacity:.6},children:[e.jsx(r,{"aria-label":"禁用勾选",type:"checkbox",disabled:!0,checked:!1,onChange:()=>{}}),"禁用态"]})]})}},d={render:s=>e.jsx("div",{style:{padding:16,width:280},children:e.jsx(r,{...s,disabled:!0,value:"不可编辑",onChange:()=>{}})})};var u,p,h;l.parameters={...l.parameters,docs:{...(u=l.parameters)==null?void 0:u.docs,source:{originalSource:`{
  render: function TextInput() {
    const [value, setValue] = useState('');
    return <div style={{
      padding: 16,
      width: 280
    }}>
        <Input aria-label="文本输入" placeholder="例如 tf-strike" value={value} onChange={event => setValue(event.target.value)} />
      </div>;
  }
}`,...(h=(p=l.parameters)==null?void 0:p.docs)==null?void 0:h.source}}};var m,b,g;o.parameters={...o.parameters,docs:{...(m=o.parameters)==null?void 0:m.docs,source:{originalSource:`{
  render: function NumberInput() {
    const [value, setValue] = useState(8);
    return <div style={{
      padding: 16,
      width: 280
    }}>
        <Input aria-label="数值输入" type="number" min={1} value={value} onChange={event => setValue(Number(event.target.value))} />
      </div>;
  }
}`,...(g=(b=o.parameters)==null?void 0:b.docs)==null?void 0:g.source}}};var x,v,f;c.parameters={...c.parameters,docs:{...(x=c.parameters)==null?void 0:x.docs,source:{originalSource:`{
  render: function CheckboxInput() {
    const [checked, setChecked] = useState(true);
    return <div style={{
      display: 'flex',
      gap: 16,
      padding: 16,
      alignItems: 'center',
      color: '#e8f1ff'
    }}>
        <label style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8
      }}>
          <Input aria-label="勾选开关" type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />
          校验 snapshot digest（{checked ? '开' : '关'}）
        </label>
        <label style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        opacity: 0.6
      }}>
          <Input aria-label="禁用勾选" type="checkbox" disabled checked={false} onChange={() => undefined} />
          禁用态
        </label>
      </div>;
  }
}`,...(f=(v=c.parameters)==null?void 0:v.docs)==null?void 0:f.source}}};var y,k,I;d.parameters={...d.parameters,docs:{...(y=d.parameters)==null?void 0:y.docs,source:{originalSource:`{
  render: args => <div style={{
    padding: 16,
    width: 280
  }}>
      <Input {...args} disabled value="不可编辑" onChange={() => undefined} />
    </div>
}`,...(I=(k=d.parameters)==null?void 0:k.docs)==null?void 0:I.source}}};const N=["Text","Numeric","Checkbox","Disabled"];export{c as Checkbox,d as Disabled,o as Numeric,l as Text,N as __namedExportsOrder,w as default};

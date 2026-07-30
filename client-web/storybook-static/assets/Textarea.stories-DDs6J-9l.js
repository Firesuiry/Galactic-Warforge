import{j as e}from"./jsx-runtime-CemGYn60.js";import{r as x}from"./iframe-CbuGUzys.js";import"./preload-helper-Dp1pzeXC.js";function s({className:a,...o}){return e.jsx("textarea",{className:["sw-textarea",a].filter(Boolean).join(" "),...o})}s.__docgenInfo={description:`全息多行输入（期7 控件库补全）：受控语义与原生 textarea 一致，
保留 rows/aria-label/disabled；皮肤与 sw-input 同族（.sw-textarea）。`,methods:[],displayName:"Textarea",composes:["TextareaHTMLAttributes"]};const b={title:"Common/Controls/Textarea",component:s,parameters:{layout:"centered"},tags:["autodocs"],argTypes:{rows:{control:"number"},disabled:{control:"boolean"},placeholder:{control:"text"}},args:{rows:4,placeholder:"输入多行指令内容","aria-label":"演示多行输入"}},r={render:function(){const[o,p]=x.useState("");return e.jsx("div",{style:{padding:16,width:320},children:e.jsx(s,{"aria-label":"多行输入",placeholder:"例如：@建造官 每五分钟同步一次当前状态",rows:4,value:o,onChange:m=>p(m.target.value)})})}},t={render:a=>e.jsx("div",{style:{padding:16,width:320},children:e.jsx(s,{...a,disabled:!0,value:"离线样例模式不可编辑",onChange:()=>{}})})};var n,l,d;r.parameters={...r.parameters,docs:{...(n=r.parameters)==null?void 0:n.docs,source:{originalSource:`{
  render: function DefaultTextarea() {
    const [value, setValue] = useState('');
    return <div style={{
      padding: 16,
      width: 320
    }}>
        <Textarea aria-label="多行输入" placeholder="例如：@建造官 每五分钟同步一次当前状态" rows={4} value={value} onChange={event => setValue(event.target.value)} />
      </div>;
  }
}`,...(d=(l=r.parameters)==null?void 0:l.docs)==null?void 0:d.source}}};var i,c,u;t.parameters={...t.parameters,docs:{...(i=t.parameters)==null?void 0:i.docs,source:{originalSource:`{
  render: args => <div style={{
    padding: 16,
    width: 320
  }}>
      <Textarea {...args} disabled value="离线样例模式不可编辑" onChange={() => undefined} />
    </div>
}`,...(u=(c=t.parameters)==null?void 0:c.docs)==null?void 0:u.source}}};const f=["Default","Disabled"];export{r as Default,t as Disabled,f as __namedExportsOrder,b as default};

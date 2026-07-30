import{j as e}from"./jsx-runtime-CemGYn60.js";import{r as h}from"./iframe-CbuGUzys.js";import{c as b}from"./createLucideIcon-Be8mrng5.js";import"./preload-helper-Dp1pzeXC.js";/**
 * @license lucide-react v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const g=[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]],S=b("chevron-down",g);function s({className:a,children:t,...r}){return e.jsxs("span",{className:["sw-select",a].filter(Boolean).join(" "),children:[e.jsx("select",{className:"sw-select__native",...r,children:t}),e.jsx(S,{className:"sw-select__chevron",size:14,strokeWidth:2,"aria-hidden":"true"})]})}s.__docgenInfo={description:`全息下拉（期3 控件库）：原生 select + 深度定制皮肤（appearance:none + 自定义箭头），
不自造弹出层，option 行为/无障碍与原生一致（getByLabel/selectOption 等选择器不受影响）。
受控用法与原生 select 相同（value + onChange），保留 name/aria-label/disabled。`,methods:[],displayName:"Select",composes:["SelectHTMLAttributes"]};const _={title:"Common/Controls/Select",component:s,parameters:{layout:"centered"},tags:["autodocs"]},m=[{value:"ground",label:"ground 地面"},{value:"air",label:"air 空中"},{value:"orbital",label:"orbital 轨道"},{value:"space",label:"space 深空"}],o={render:function(){const[t,r]=h.useState("space");return e.jsxs("div",{style:{display:"grid",gap:10,padding:16,width:280},children:[e.jsxs("span",{style:{color:"#8fa3c8",fontSize:12},children:["当前值：",t]}),e.jsx(s,{"aria-label":"作战域",value:t,onChange:l=>r(l.target.value),children:m.map(l=>e.jsx("option",{value:l.value,children:l.label},l.value))})]})}},n={render:()=>e.jsx("div",{style:{padding:16,width:280},children:e.jsx(s,{"aria-label":"禁用下拉",disabled:!0,value:"space",onChange:()=>{},children:m.map(a=>e.jsx("option",{value:a.value,children:a.label},a.value))})})};var i,c,d;o.parameters={...o.parameters,docs:{...(i=o.parameters)==null?void 0:i.docs,source:{originalSource:`{
  render: function ControlledSelect() {
    const [value, setValue] = useState('space');
    return <div style={{
      display: 'grid',
      gap: 10,
      padding: 16,
      width: 280
    }}>
        <span style={{
        color: '#8fa3c8',
        fontSize: 12
      }}>当前值：{value}</span>
        <Select aria-label="作战域" value={value} onChange={event => setValue(event.target.value)}>
          {DOMAIN_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
      </div>;
  }
}`,...(d=(c=o.parameters)==null?void 0:c.docs)==null?void 0:d.source}}};var p,u,v;n.parameters={...n.parameters,docs:{...(p=n.parameters)==null?void 0:p.docs,source:{originalSource:`{
  render: () => <div style={{
    padding: 16,
    width: 280
  }}>
      <Select aria-label="禁用下拉" disabled value="space" onChange={() => undefined}>
        {DOMAIN_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </Select>
    </div>
}`,...(v=(u=n.parameters)==null?void 0:u.docs)==null?void 0:v.source}}};const C=["Controlled","Disabled"];export{o as Controlled,n as Disabled,C as __namedExportsOrder,_ as default};

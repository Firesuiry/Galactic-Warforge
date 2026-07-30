import{j as a}from"./jsx-runtime-CemGYn60.js";import{r as v}from"./iframe-CbuGUzys.js";import{c as y}from"./createLucideIcon-Be8mrng5.js";import{F as I,T as f}from"./target-DZI3ZSwA.js";import"./preload-helper-Dp1pzeXC.js";/**
 * @license lucide-react v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const k=[["path",{d:"m10 16 1.5 1.5",key:"11lckj"}],["path",{d:"m14 8-1.5-1.5",key:"1ohn8i"}],["path",{d:"M15 2c-1.798 1.998-2.518 3.995-2.807 5.993",key:"80uv8i"}],["path",{d:"m16.5 10.5 1 1",key:"696xn5"}],["path",{d:"m17 6-2.891-2.891",key:"xu6p2f"}],["path",{d:"M2 15c6.667-6 13.333 0 20-6",key:"1pyr53"}],["path",{d:"m20 9 .891.891",key:"3xwk7g"}],["path",{d:"M3.109 14.109 4 15",key:"q76aoh"}],["path",{d:"m6.5 12.5 1 1",key:"cs35ky"}],["path",{d:"m7 18 2.891 2.891",key:"1sisit"}],["path",{d:"M9 22c1.798-1.998 2.518-3.995 2.807-5.993",key:"q3hbxp"}]],w=y("dna",k);/**
 * @license lucide-react v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _=[["path",{d:"M15 12h-5",key:"r7krc0"}],["path",{d:"M15 8h-5",key:"1khuty"}],["path",{d:"M19 17V5a2 2 0 0 0-2-2H4",key:"zz82l3"}],["path",{d:"M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3",key:"1ph1d7"}]],j=y("scroll-text",_);function d({tabs:o,activeId:t,onChange:i,ariaLabel:g,idPrefix:r,className:x}){return a.jsx("div",{className:["sw-tabs",x].filter(Boolean).join(" "),role:"tablist","aria-label":g,children:o.map(e=>{const c=e.id===t;return a.jsxs("button",{id:r?`${r}-tab-${e.id}`:void 0,className:`sw-tabs__tab${c?" sw-tabs__tab--active":""}`,role:"tab",type:"button","aria-selected":c,"aria-controls":r?`${r}-panel-${e.id}`:void 0,disabled:e.disabled,onClick:()=>i(e.id),children:[e.icon?a.jsx(e.icon,{size:16,strokeWidth:2,"aria-hidden":"true"}):null,a.jsx("span",{className:"sw-tabs__text",children:e.label})]},e.id)})})}d.__docgenInfo={description:`全息图标 Tab（期3 控件库）：图标 + 可选文字，active 态 teal 描边/底色 + 微光。
受控组件：activeId/onChange 由外部持有；role=tablist/tab + aria-selected 语义齐全，
用于抽屉/卡片切换（战争工作台抽屉等）。`,methods:[],displayName:"Tabs",props:{tabs:{required:!0,tsType:{name:"Array",elements:[{name:"HoloTabItem"}],raw:"HoloTabItem[]"},description:""},activeId:{required:!0,tsType:{name:"string"},description:""},onChange:{required:!0,tsType:{name:"signature",type:"function",raw:"(id: string) => void",signature:{arguments:[{type:{name:"string"},name:"id"}],return:{name:"void"}}},description:""},ariaLabel:{required:!0,tsType:{name:"string"},description:"tablist 的 aria-label（如「战争工作台面板」）。"},idPrefix:{required:!1,tsType:{name:"string"},description:"提供时 tab 元素 id 取 `${idPrefix}-tab-${id}`、aria-controls 取 `${idPrefix}-panel-${id}`，\n与对应面板的 id 约定配套（如 war 抽屉的 war-drawer-panel-*）。"},className:{required:!1,tsType:{name:"string"},description:""}}};const T=[{id:"blueprint",icon:w,label:"蓝图"},{id:"industry",icon:I,label:"军工"},{id:"theater",icon:f,label:"战区"},{id:"reports",icon:j,label:"战报"}],M={title:"Common/Controls/Tabs",component:d,parameters:{layout:"centered"},tags:["autodocs"],args:{tabs:T,activeId:"blueprint",onChange:()=>{},ariaLabel:"战争工作台面板"}},s={render:function(){const[t,i]=v.useState("blueprint");return a.jsxs("div",{style:{padding:16,width:420},children:[a.jsx(d,{ariaLabel:"战争工作台面板",idPrefix:"war-drawer",tabs:T,activeId:t,onChange:i}),a.jsxs("p",{style:{color:"#8fa3c8",fontSize:12,marginTop:10},children:["当前分组：",t]})]})}},n={render:function(){const[t,i]=v.useState("overview");return a.jsx("div",{style:{padding:16,width:360},children:a.jsx(d,{ariaLabel:"演示分组",tabs:[{id:"overview",label:"总览"},{id:"detail",label:"明细"},{id:"history",label:"历史",disabled:!0}],activeId:t,onChange:i})})}};var l,p,m;s.parameters={...s.parameters,docs:{...(l=s.parameters)==null?void 0:l.docs,source:{originalSource:`{
  render: function IconTabsDemo() {
    const [activeId, setActiveId] = useState('blueprint');
    return <div style={{
      padding: 16,
      width: 420
    }}>
        <Tabs ariaLabel="战争工作台面板" idPrefix="war-drawer" tabs={WAR_TABS} activeId={activeId} onChange={setActiveId} />
        <p style={{
        color: '#8fa3c8',
        fontSize: 12,
        marginTop: 10
      }}>当前分组：{activeId}</p>
      </div>;
  }
}`,...(m=(p=s.parameters)==null?void 0:p.docs)==null?void 0:m.source}}};var b,u,h;n.parameters={...n.parameters,docs:{...(b=n.parameters)==null?void 0:b.docs,source:{originalSource:`{
  render: function TextTabsDemo() {
    const [activeId, setActiveId] = useState('overview');
    return <div style={{
      padding: 16,
      width: 360
    }}>
        <Tabs ariaLabel="演示分组" tabs={[{
        id: 'overview',
        label: '总览'
      }, {
        id: 'detail',
        label: '明细'
      }, {
        id: 'history',
        label: '历史',
        disabled: true
      }]} activeId={activeId} onChange={setActiveId} />
      </div>;
  }
}`,...(h=(u=n.parameters)==null?void 0:u.docs)==null?void 0:h.source}}};const L=["IconTabs","TextOnly"];export{s as IconTabs,n as TextOnly,L as __namedExportsOrder,M as default};

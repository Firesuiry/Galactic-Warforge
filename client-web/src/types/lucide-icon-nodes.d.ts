/**
 * lucide-react 未为 dist/esm/icons 下的单图标模块提供类型声明。
 * 这些模块统一导出 `__iconNode`（SVG 节点数据）与默认组件；
 * common/icon-map 深导入 `__iconNode`，供 Canvas 烘焙（Path2D）与 DOM 渲染共用同一份节点数据。
 */
declare module 'lucide-react/dist/esm/icons/*.mjs' {
  export const __iconNode: import('lucide-react').IconNode;
  const component: import('lucide-react').LucideIcon;
  export default component;
}

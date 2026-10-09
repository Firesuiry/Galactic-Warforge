import type { CatalogView } from '@shared/types';

import { getItemDisplayName } from '@/features/planet-map/model';

/**
 * 弹药条：当前/容量 + 弹药物品中文名。
 * 物品名走 i18n 词典（catalog 有中文名时优先），绝不显示 ammo_bullet 这类裸 id。
 */
export function AmmunitionBar({current,capacity,item,catalog}:{current:number;capacity:number;item?:string;catalog?:CatalogView}){
 if(capacity<=0)return null;
 const itemName = item ? getItemDisplayName(catalog, item) : '';
 return <div className="ammunition-status"><span>{current<=0?'弹药耗尽':'弹药'} {current}/{capacity}{itemName?' · '+itemName:''}</span><progress aria-label="弹药" max={capacity} value={current}/></div>;
}

export function AmmunitionBar({current,capacity,item}:{current:number;capacity:number;item?:string}){
 if(capacity<=0)return null;
 return <div className="ammunition-status"><span>{current<=0?'弹药耗尽':'弹药'} {current}/{capacity}{item?' · '+item:''}</span><progress aria-label="弹药" max={capacity} value={current}/></div>;
}

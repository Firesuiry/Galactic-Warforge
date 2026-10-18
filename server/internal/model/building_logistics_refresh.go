package model

import modelpower "siliconworld/internal/model/power"

// RefreshLogisticsRuntime overwrites a logistics building's runtime definition
// fields (transport/sorter/energy modules, energy consume and connection
// points) with the current catalog definition for its type and level.
//
// 用于读旧存档：旧存档的 Runtime 里冻结着当时的参数（例如传送带 stack_limit=5、
// 分拣器 range=1 且没有 energy 模块）。读档后应改用当前定义结算，但库存、
// Buffer、状态等实例数据必须原样保留。
func RefreshLogisticsRuntime(b *Building) {
	if b == nil {
		return
	}
	if !IsConveyorBuilding(b.Type) && !IsSorterBuilding(b.Type) {
		return
	}
	if _, ok := BuildingRuntimeDefinitionByID(b.Type); !ok {
		return
	}
	def := BuildingProfileFor(b.Type, b.Level).Runtime
	// 直接从定义重建指针，避免与 catalog 共享对象，也清掉定义里已不存在的模块。
	b.Runtime.Functions.Transport = nil
	if def.Functions.Transport != nil {
		module := *def.Functions.Transport
		b.Runtime.Functions.Transport = &module
	}
	b.Runtime.Functions.Sorter = nil
	if def.Functions.Sorter != nil {
		module := *def.Functions.Sorter
		b.Runtime.Functions.Sorter = &module
	}
	b.Runtime.Functions.Energy = nil
	if def.Functions.Energy != nil {
		module := *def.Functions.Energy
		if len(def.Functions.Energy.FuelRules) > 0 {
			module.FuelRules = append([]modelpower.FuelRule(nil), def.Functions.Energy.FuelRules...)
		}
		b.Runtime.Functions.Energy = &module
	}
	b.Runtime.Params.EnergyConsume = def.Params.EnergyConsume
	b.Runtime.Params.ConnectionPoints = cloneConnectionPoints(def.Params.ConnectionPoints)
}

func cloneConnectionPoints(points []ConnectionPoint) []ConnectionPoint {
	if len(points) == 0 {
		return nil
	}
	out := make([]ConnectionPoint, len(points))
	copy(out, points)
	return out
}

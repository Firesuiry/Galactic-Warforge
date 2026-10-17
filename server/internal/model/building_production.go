package model

import (
	"fmt"
	"math"
)

// IsFeedbackItem identifies a recipe material that is both consumed and produced.
// Its input stock must not be exported before it has been processed.
func (building *Building) IsFeedbackItem(itemID string) bool {
	if building == nil || building.Production == nil {
		return false
	}
	recipe, ok := Recipe(building.Production.RecipeID)
	if !ok {
		return false
	}
	input := false
	for _, item := range recipe.Inputs {
		if item.ItemID == itemID {
			input = true
			break
		}
	}
	if !input {
		return false
	}
	for _, item := range recipe.AllOutputs() {
		if item.ItemID == itemID {
			return true
		}
	}
	return false
}

// IsProductionMachine 报告该建筑是否「把配方原料加工成产物」（熔炉、制造台、
// 研究站、精炼厂……，即带 production 功能模块的建筑）。
//
// DSP 口径（试玩 1016 报告 B-2）：分拣器 / 传送带 / 管道 / 运输机器人从生产建筑
// 取货时只能拿产物，绝不能把机器正在吃的原料抽走——否则熔炉的输出分拣器会把
// 刚到货的铁矿搬上产物带，机器永远吃不饱。原料留在主库存 / 输入缓冲里，只有
// 产物会进输出缓冲。
func (building *Building) IsProductionMachine() bool {
	return building != nil && building.Runtime.Functions.Production != nil
}

// ExportableItemQuantity returns how many units of itemID may leave the building
// through logistics (belt / sorter / pipe / haul).
//
// 生产建筑只出产物（输出缓冲）：主库存里的同种物品可能是尚未加工的原料或
// 玩家装入的料，不能当成品搬走。仓储类（储物仓、补给站、物流站、HQ 等没有
// production 功能的建筑）的主库存本来就是给别人用的，照旧可导出。
// 循环配方的反馈料（IsFeedbackItem）即使对生产建筑也只算输出缓冲里的产物份额。
func (building *Building) ExportableItemQuantity(itemID string) int {
	if building == nil || building.Storage == nil {
		return 0
	}
	if building.IsFeedbackItem(itemID) || building.IsProductionMachine() {
		return building.Storage.OutputBuffer[itemID]
	}
	return building.Storage.OutputQuantity(itemID)
}

// ProductionState tracks the active recipe and the in-flight production cycle.
type ProductionState struct {
	RecipeID       string    `json:"recipe_id,omitempty"`
	Mode           BonusMode `json:"mode,omitempty"`
	RemainingTicks int       `json:"remaining_ticks,omitempty"`
	// ProgressFraction is completed work toward the next remaining tick.
	// It survives power changes and saves, and stays in [0, 1).
	ProgressFraction  float64      `json:"progress_fraction,omitempty"`
	PendingOutputs    []ItemAmount `json:"pending_outputs,omitempty"`
	PendingByproducts []ItemAmount `json:"pending_byproducts,omitempty"`
}

func (p *ProductionState) Validate() error {
	if p == nil {
		return fmt.Errorf("production state required")
	}
	if p.RemainingTicks < 0 || math.IsNaN(p.ProgressFraction) || math.IsInf(p.ProgressFraction, 0) || p.ProgressFraction < 0 || p.ProgressFraction >= 1 {
		return fmt.Errorf("invalid production progress")
	}
	if p.RemainingTicks == 0 && p.ProgressFraction != 0 {
		return fmt.Errorf("production fraction requires remaining work")
	}
	return nil
}

// Clone returns a deep copy of the production state.
func (p *ProductionState) Clone() *ProductionState {
	if p == nil {
		return nil
	}
	out := *p
	out.PendingOutputs = append([]ItemAmount(nil), p.PendingOutputs...)
	out.PendingByproducts = append([]ItemAmount(nil), p.PendingByproducts...)
	return &out
}

// InitBuildingProduction ensures a building has initialized production state when applicable.
func InitBuildingProduction(building *Building) {
	if building == nil {
		return
	}
	if building.Runtime.Functions.Production == nil {
		building.Production = nil
		return
	}
	if building.Production == nil {
		building.Production = &ProductionState{}
	}
	if building.Production.Mode == "" {
		building.Production.Mode = CurrentProductionBonusConfig().DefaultMode
		if building.Production.Mode == "" {
			building.Production.Mode = BonusModeSpeed
		}
	}
}

// SyncStorageReserve 按建筑当前配方写入「产出预留」：主库存里必须留出的空位数，
// 等于该配方一批产出的总量（不含增产模式加成——没有任何命令能切换 Mode，加成
// 只在目录配置里存在）。没有配方（含研究模式的研究站）时预留归零。
func (building *Building) SyncStorageReserve() {
	if building == nil || building.Storage == nil {
		return
	}
	if building.Runtime.Functions.Production == nil || building.Production == nil || building.Production.RecipeID == "" {
		building.Storage.SyncStorageReserve(0)
		return
	}
	recipe, ok := Recipe(building.Production.RecipeID)
	if !ok {
		building.Storage.SyncStorageReserve(0)
		return
	}
	batch := 0
	for _, output := range recipe.AllOutputs() {
		if output.Quantity > 0 {
			batch += output.Quantity
		}
	}
	building.Storage.SyncStorageReserve(batch)
}

// SyncBuildingProduction reconciles production state after runtime changes.
func SyncBuildingProduction(building *Building) {
	InitBuildingProduction(building)
	if building == nil || building.Production == nil || building.Production.RecipeID == "" {
		building.SyncStorageReserve()
		return
	}
	recipe, ok := Recipe(building.Production.RecipeID)
	if !ok || !recipeAllowsBuilding(recipe, building.Type) {
		building.Production.RecipeID = ""
		building.Production.RemainingTicks = 0
		building.Production.ProgressFraction = 0
		building.Production.PendingOutputs = nil
		building.Production.PendingByproducts = nil
	}
	building.SyncStorageReserve()
}

package model

import (
	"sort"
	"strings"
)

// MechaRecord is the persistent per-mecha dossier: one record per executor unit,
// owned by a player. The backpack lives here (not on Unit) so it survives death
// and is restored with the respawned unit. Operator binds an issuer_id to this
// mecha; "" means idle.
type MechaRecord struct {
	UnitID        string        `json:"unit_id"`
	PlanetID      string        `json:"planet_id"`
	Operator      string        `json:"operator,omitempty"`
	Inventory     ItemInventory `json:"inventory,omitempty"`
	RespawnAtTick int64         `json:"respawn_at_tick,omitempty"`
}

// Clone returns a deep copy of the record.
func (m *MechaRecord) Clone() *MechaRecord {
	if m == nil {
		return nil
	}
	out := *m
	out.Inventory = m.Inventory.Clone()
	return &out
}

// EnsureInventory returns a writable inventory map.
func (m *MechaRecord) EnsureInventory() ItemInventory {
	if m == nil {
		return nil
	}
	if m.Inventory == nil {
		m.Inventory = make(ItemInventory)
	}
	return m.Inventory
}

// HasItems reports whether the backpack holds the required amounts.
func (m *MechaRecord) HasItems(cost []ItemAmount) bool {
	if m == nil {
		return len(cost) == 0
	}
	return m.Inventory.HasItems(cost)
}

// DeductItems removes item amounts from the backpack if possible.
func (m *MechaRecord) DeductItems(cost []ItemAmount) bool {
	if m == nil {
		return len(cost) == 0
	}
	return m.Inventory.DeductItems(cost)
}

// AddItems adds items to the backpack under the slot limit and returns how many
// were accepted.
func (m *MechaRecord) AddItems(items []ItemAmount, slots int) int {
	if m == nil {
		return 0
	}
	if len(items) == 0 {
		return 0
	}
	m.EnsureInventory()
	return m.Inventory.AddItems(items, slots)
}

// EnsureMechas returns a writable mecha registry.
func (ps *PlayerState) EnsureMechas() map[string]*MechaRecord {
	if ps == nil {
		return nil
	}
	if ps.Mechas == nil {
		ps.Mechas = make(map[string]*MechaRecord)
	}
	return ps.Mechas
}

// MechaByUnitID returns the dossier for a mecha unit.
func (ps *PlayerState) MechaByUnitID(unitID string) *MechaRecord {
	if ps == nil || unitID == "" {
		return nil
	}
	return ps.Mechas[unitID]
}

// MechasByOperator 返回绑定给某个 issuer_id 的全部机甲，按 unit ID 升序。
// 第 22 轮起一个发令者可以绑多台机甲（分散在不同行星），命令用 target.mecha_id
// 点名执行哪一台；缺省时由执行器取「当前行星上 unit ID 最小」的那台。
func (ps *PlayerState) MechasByOperator(operator string) []*MechaRecord {
	if ps == nil || operator == "" {
		return nil
	}
	ids := sortedMechaIDs(ps.Mechas)
	out := make([]*MechaRecord, 0, len(ids))
	for _, id := range ids {
		if mecha := ps.Mechas[id]; mecha != nil && mecha.Operator == operator {
			out = append(out, mecha)
		}
	}
	return out
}

// MechaByOperatorOnPlanet 返回某行星上绑定给 operator 的机甲，按 unit ID 升序取第一台。
func (ps *PlayerState) MechaByOperatorOnPlanet(operator, planetID string) *MechaRecord {
	for _, mecha := range ps.MechasByOperator(operator) {
		if mecha.PlanetID == planetID {
			return mecha
		}
	}
	return nil
}

// SortedMechas returns every dossier ordered by unit ID (deterministic views).
func (ps *PlayerState) SortedMechas() []*MechaRecord {
	if ps == nil {
		return nil
	}
	ids := sortedMechaIDs(ps.Mechas)
	out := make([]*MechaRecord, 0, len(ids))
	for _, id := range ids {
		if mecha := ps.Mechas[id]; mecha != nil {
			out = append(out, mecha)
		}
	}
	return out
}

// TotalItems sums one item across every mecha backpack.
func (ps *PlayerState) TotalItems(itemID string) int {
	if ps == nil || itemID == "" {
		return 0
	}
	total := 0
	for _, mecha := range ps.Mechas {
		if mecha != nil {
			total += mecha.Inventory[itemID]
		}
	}
	return total
}

func sortedMechaIDs(mechas map[string]*MechaRecord) []string {
	ids := make([]string, 0, len(mechas))
	for id := range mechas {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// SetPermissions normalizes and sets permissions on the player state.
func (ps *PlayerState) SetPermissions(perms []string) {
	ps.Permissions = normalizePermissions(perms)
	ps.permissionSet = buildPermissionSet(ps.Permissions)
}

// HasPermission checks whether a player has permission to issue a command type.
func (ps *PlayerState) HasPermission(cmdType CommandType) bool {
	if ps == nil {
		return false
	}
	if ps.permissionSet == nil {
		ps.permissionSet = buildPermissionSet(ps.Permissions)
	}
	if _, ok := ps.permissionSet["*"]; ok {
		return true
	}
	_, ok := ps.permissionSet[strings.ToLower(string(cmdType))]
	return ok
}

// EnsureWarBlueprints returns a writable blueprint map.
func (ps *PlayerState) EnsureWarBlueprints() map[string]*WarBlueprint {
	if ps == nil {
		return nil
	}
	if ps.WarBlueprints == nil {
		ps.WarBlueprints = make(map[string]*WarBlueprint)
	}
	return ps.WarBlueprints
}

// EnsureWarIndustry returns a writable warfare industry state.
func (ps *PlayerState) EnsureWarIndustry() *WarIndustryState {
	if ps == nil {
		return nil
	}
	if ps.WarIndustry == nil {
		ps.WarIndustry = &WarIndustryState{
			ProductionOrders: make(map[string]*WarProductionOrder),
			RefitOrders:      make(map[string]*WarRefitOrder),
			ProductionLines:  make(map[string]*WarProductionLineState),
			DeploymentHubs:   make(map[string]*WarDeploymentHubState),
		}
	}
	if ps.WarIndustry.ProductionOrders == nil {
		ps.WarIndustry.ProductionOrders = make(map[string]*WarProductionOrder)
	}
	if ps.WarIndustry.RefitOrders == nil {
		ps.WarIndustry.RefitOrders = make(map[string]*WarRefitOrder)
	}
	if ps.WarIndustry.ProductionLines == nil {
		ps.WarIndustry.ProductionLines = make(map[string]*WarProductionLineState)
	}
	if ps.WarIndustry.DeploymentHubs == nil {
		ps.WarIndustry.DeploymentHubs = make(map[string]*WarDeploymentHubState)
	}
	return ps.WarIndustry
}

// EnsureWarCoordination returns a writable warfare coordination state.
func (ps *PlayerState) EnsureWarCoordination() *WarCoordinationState {
	if ps == nil {
		return nil
	}
	if ps.WarCoordination == nil {
		ps.WarCoordination = &WarCoordinationState{
			TaskForces: make(map[string]*WarTaskForce),
			Theaters:   make(map[string]*WarTheater),
		}
	}
	if ps.WarCoordination.TaskForces == nil {
		ps.WarCoordination.TaskForces = make(map[string]*WarTaskForce)
	}
	if ps.WarCoordination.Theaters == nil {
		ps.WarCoordination.Theaters = make(map[string]*WarTheater)
	}
	return ps.WarCoordination
}

func normalizePermissions(perms []string) []string {
	if len(perms) == 0 {
		return nil
	}
	out := make([]string, 0, len(perms))
	seen := make(map[string]struct{}, len(perms))
	for _, p := range perms {
		p = strings.TrimSpace(strings.ToLower(p))
		if p == "" {
			continue
		}
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	return out
}

func buildPermissionSet(perms []string) map[string]struct{} {
	set := make(map[string]struct{}, len(perms))
	for _, p := range perms {
		if p == "" {
			continue
		}
		set[p] = struct{}{}
	}
	return set
}

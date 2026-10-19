package gamecore

import (
	"sort"

	"siliconworld/internal/model"
)

// 脚本化开局（存档点重建用）。
//
// 目的：把「空背包 → 风机/电塔 → 矿机 → 熔炉 → 制造台」这条开局链做成**可执行**
// 的东西。存档点重建工具（internal/checkpointbuild）用它把 cp-power / cp-mining /
// cp-base 这几层从 cp-root 重放出来，于是「构建记录」不再是一段人写的文字。
//
// 为什么放在引擎里而不是写在重建工具里：选址要读真实局面（整块占地能不能落位、
// 有没有压矿脉、有没有罩住机甲），手写坐标会随地图与网格改动立刻过期——
// 1014 那批存档点就是这么全部失效的。
//
// 生产链走传送带（矿机 → 传送带 → 熔炉），不用「装入建筑」手喂：矿机压在矿脉上
// 时必须有出口，否则几 tick 就被自己的产出堵死（试玩 1015 的口径：落不下就不扣
// 矿脉，于是整局矿物收入归零）。
//
// 首选来源仍然是「真实 UI 试玩的审计日志导出」（见 checkpoint.ExportBuildSteps）：
// 有试玩记录时重建 = 回放玩家实际下过的命令，本脚本是没有记录时的兜底。

// ScriptedOpening 是一个逐步推进的开局脚本。
type ScriptedOpening struct {
	PlayerID string

	plan []scriptStep
	next int

	// awaiting 表示「上一条命令是建造，正在等这栋建筑落成」。
	awaiting bool
	// built 记录已建成的建筑：角色名 → 建筑 ID。
	built map[string]string
	// claimed 记录已经被本脚本认领过的建筑 ID（防止重复认领同一栋）。
	claimed map[string]bool
	// links 记录已经算好的「上游 → 带子 → 下游」落位（先放带子，再放下游）。
	links map[string]BeltLink

	lastActionTick int64
}

type scriptStep struct {
	role   string
	btype  model.BuildingType
	recipe string
	// ore 非空时这是采矿机，落点由 PlanMinerSpot 在真实局面上选。
	ore string
	// linkTo 非空时这栋建筑要贴着 linkTo 那栋建，中间夹一条传送带 + 一台分拣器
	// （第 16 轮契约 §3：生产建筑不再与传送带直连）。
	// 带子先放（belt=true）、分拣器第二（sorter=true）、下游建筑最后。
	linkTo string
	belt   bool
	sorter bool
}

// ScriptedOpeningPlan 是开局链的建造顺序（对应存档点 cp-power → cp-base）。
//
// 顺序的取法见 docs/guide/存档点回归测试.md 与 skirmish_from_zero_test.go 的开局
// 注释：先风机通电、再矿机出矿；熔炉紧跟矿机（矿机一开工就有矿要吃，而且必须有
// 出口，否则几 tick 就被自己的产出堵死）。
//
// 第 16 轮契约 §3 起，矿机 → 熔炉这条产线中间必须夹一台分拣器：
// 矿机（direct_belt_io）出矿到带子，带子把矿送到分拣器取货端，分拣器投进熔炉。
func ScriptedOpeningPlan() []scriptStep {
	return []scriptStep{
		{role: "wind1", btype: model.BuildingTypeWindTurbine},
		{role: "tesla1", btype: model.BuildingTypeTeslaTower},
		{role: "ironMiner", btype: model.BuildingTypeMiningMachine, ore: model.ItemIronOre},
		{role: "ironBelt", linkTo: "ironMiner", belt: true},
		{role: "ironSorter", linkTo: "ironMiner", sorter: true},
		{role: "ironSmelter", btype: model.BuildingTypeArcSmelter, recipe: "smelt_iron", linkTo: "ironMiner"},
		{role: "tesla2", btype: model.BuildingTypeTeslaTower},
		{role: "copperMiner", btype: model.BuildingTypeMiningMachine, ore: model.ItemCopperOre},
		{role: "copperBelt", linkTo: "copperMiner", belt: true},
		{role: "copperSorter", linkTo: "copperMiner", sorter: true},
		{role: "copperSmelter", btype: model.BuildingTypeArcSmelter, recipe: "smelt_copper", linkTo: "copperMiner"},
		{role: "wind2", btype: model.BuildingTypeWindTurbine},
		{role: "assembler", btype: model.BuildingTypeAssemblingMachineMk1, recipe: "gear"},
	}
}

// ScriptedOpeningRoles 返回计划里各步的角色名（下标即 PlanIndex），
// 供重建工具把命令切成 cp-power / cp-mining / cp-base-a / cp-base 几层。
func ScriptedOpeningRoles() []string {
	plan := ScriptedOpeningPlan()
	roles := make([]string, len(plan))
	for i, step := range plan {
		roles[i] = step.role
	}
	return roles
}

// NewScriptedOpening 建一个开局脚本。
func NewScriptedOpening(playerID string) *ScriptedOpening {
	return &ScriptedOpening{
		PlayerID: playerID,
		plan:     ScriptedOpeningPlan(),
		built:    map[string]string{},
		claimed:  map[string]bool{},
		links:    map[string]BeltLink{},
	}
}

// Done 报告脚本是否已经走完（全部步骤都建成并登记）。
func (s *ScriptedOpening) Done() bool {
	return s == nil || (s.next >= len(s.plan) && !s.awaiting)
}

// Plan 返回本 tick 该下发的一条命令；ok=false 表示这一 tick 无事可做。
func (s *ScriptedOpening) Plan(ws *model.WorldState) (model.Command, bool) {
	if s == nil || ws == nil {
		return model.Command{}, false
	}
	if s.awaiting {
		s.settleAwaiting(ws)
		if s.awaiting {
			// 还在等上一条建造落成：不要重复下发同一条建造命令（会被
			// POSITION_OCCUPIED 拒掉），也不要在这一步上继续折腾机甲。
			return model.Command{}, false
		}
	}
	if s.next >= len(s.plan) {
		return model.Command{}, false
	}
	player := ws.Players[s.PlayerID]
	if player == nil || !player.IsAlive {
		return model.Command{}, false
	}
	unit := executorUnitFor(ws, s.PlayerID)
	if unit == nil || unit.Mecha == nil {
		return model.Command{}, false
	}
	record := player.MechaByUnitID(unit.ID)
	if record == nil {
		return model.Command{}, false
	}
	if cmd, ok := s.refuel(ws, unit, record); ok {
		return cmd, true
	}
	step := s.plan[s.next]
	if cmd, ok := s.buildStep(ws, player, record, step); ok {
		return cmd, true
	}
	return s.driveMecha(ws, unit, player, record, step)
}

// settleAwaiting 在上一条建造命令结算后认领新落成的建筑。
func (s *ScriptedOpening) settleAwaiting(ws *model.WorldState) {
	step := s.plan[s.next]
	want := step.btype
	if step.belt {
		want = model.BuildingTypeConveyorBeltMk1
	}
	if step.sorter {
		want = model.BuildingTypeSorterMk1
	}
	if id := s.claimNewBuilding(ws, want); id != "" {
		s.built[step.role] = id
		s.awaiting = false
		s.next++
	}
}

// claimNewBuilding 认领一栋「刚出现、还没被认领」的己方建筑（按 ID 排序取第一栋）。
func (s *ScriptedOpening) claimNewBuilding(ws *model.WorldState, btype model.BuildingType) string {
	ids := make([]string, 0, len(ws.Buildings))
	for id := range ws.Buildings {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		b := ws.Buildings[id]
		if b == nil || b.OwnerID != s.PlayerID || b.HP <= 0 || b.Type != btype {
			continue
		}
		if s.claimed[id] {
			continue
		}
		s.claimed[id] = true
		return id
	}
	return ""
}

// refuel 核心能量低时烧煤（煤是手动采矿的副产品，开局就能采到）。
func (s *ScriptedOpening) refuel(ws *model.WorldState, unit *model.Unit, record *model.MechaRecord) (model.Command, bool) {
	if unit.Mecha.Energy >= 20 || unit.Mecha.Job != nil {
		return model.Command{}, false
	}
	if record.Inventory[model.ItemCoal] <= 0 {
		return model.Command{}, false
	}
	if ws.Tick-s.lastActionTick < 4 {
		return model.Command{}, false
	}
	s.lastActionTick = ws.Tick
	return model.Command{
		Type:   model.CmdRefuelMecha,
		Target: model.CommandTarget{Layer: "planet", EntityID: unit.ID},
		Payload: map[string]any{
			"item_id": model.ItemCoal,
			"count":   2,
		},
	}, true
}

// buildStep 推进当前这一步：先放传送带，再放分拣器，最后放下游建筑。
func (s *ScriptedOpening) buildStep(ws *model.WorldState, player *model.PlayerState, record *model.MechaRecord, step scriptStep) (model.Command, bool) {
	if step.belt {
		if s.built[step.role] != "" {
			// 带子已经落成并认领：跳过这一步。
			s.next++
			return model.Command{}, false
		}
		if _, ok := s.links[step.linkTo]; ok {
			// 建造命令已经下达过，正在等落成（settleAwaiting 认领）——
			// 不能在这里直接 next++，否则后面的分拣器/下游建筑拿不到落位。
			return model.Command{}, false
		}
		src := ws.Buildings[s.built[step.linkTo]]
		if src == nil || !scriptBuildingSettled(ws, src) {
			// 上游还在施工：它的占地外圈仍被施工任务预约着，现在放带子会被
			// POSITION_OCCUPIED 拒掉。等它建成再说。
			return model.Command{}, false
		}
		link, ok := PlanBeltLink(ws, src, s.linkedTargetType(step))
		if !ok {
			return model.Command{}, false
		}
		if !scriptMaterialsReady(record, model.BuildingTypeConveyorBeltMk1) {
			return model.Command{}, false
		}
		s.links[step.linkTo] = link
		s.awaiting = true
		return BuildCommand(link.Belt.X, link.Belt.Y, model.BuildingTypeConveyorBeltMk1, "", link.Dir), true
	}
	if step.sorter {
		// 分拣器夹在带子与下游建筑之间（第 16 轮契约 §3）：背面朝带子取货、
		// 正面朝下游占地放货。
		if s.built[step.role] != "" {
			s.next++
			return model.Command{}, false
		}
		link, ok := s.links[step.linkTo]
		if !ok || s.built[s.beltRoleFor(step.linkTo)] == "" {
			return model.Command{}, false
		}
		if !scriptMaterialsReady(record, model.BuildingTypeSorterMk1) {
			return model.Command{}, false
		}
		s.awaiting = true
		return BuildRotatedCommand(link.Sorter.X, link.Sorter.Y, model.BuildingTypeSorterMk1, link.SorterRotation), true
	}
	if step.linkTo != "" {
		link, ok := s.links[step.linkTo]
		if !ok || s.built[s.sorterRoleFor(step.linkTo)] == "" {
			return model.Command{}, false
		}
		// 第 16 轮起建造门槛只剩「背包物品够不够」（scriptMaterialsReady）：
		// 不够时脚本会先去手搓/采矿，不再等一个已经不存在的矿物池。
		if !scriptMaterialsReady(record, step.btype) {
			return model.Command{}, false
		}
		s.awaiting = true
		return BuildCommand(link.Target.X, link.Target.Y, step.btype, step.recipe, model.ConveyorAuto), true
	}
	if !scriptMaterialsReady(record, step.btype) {
		return model.Command{}, false
	}
	unit := executorUnitFor(ws, s.PlayerID)
	var pos model.Position
	if step.ore != "" {
		if unit == nil {
			return model.Command{}, false
		}
		node := scriptFindMineNode(ws, unit.Position, step.ore, scriptMineTravelRadius)
		if node == nil {
			return model.Command{}, false
		}
		anchor, ok := PlanMinerSpot(ws, node, step.ore)
		if !ok {
			// 矿脉夹在混合簇里（石矿常这样）时找不到「纯矿」落点：退一步接受
			// 覆盖框里混了别的矿种的落点。矿机被杂矿堵住是已知代价，总好过
			// 整层卡在建不出矿机。
			anchor, ok = PlanMinerSpot(ws, node, "")
		}
		if !ok {
			return model.Command{}, false
		}
		pos = anchor
	} else {
		spot := PlanBuildSpot(ws, playerHome(ws, s.PlayerID), 30, step.btype)
		if spot == nil {
			// 半径 30 内没空位（前期层不会遇到，后期层挤满时会）：放宽到 60。
			spot = PlanBuildSpot(ws, playerHome(ws, s.PlayerID), 60, step.btype)
		}
		if spot == nil {
			return model.Command{}, false
		}
		pos = *spot
	}
	s.awaiting = true
	return BuildCommand(pos.X, pos.Y, step.btype, step.recipe, model.ConveyorAuto), true
}

// linkedTargetType 返回「这条产线通向哪栋建筑」（带子那一步的 linkTo 角色之后的
// 下游建筑那一步的类型），PlanBeltLink 需要它来算下游落位。
func (s *ScriptedOpening) linkedTargetType(beltStep scriptStep) model.BuildingType {
	for i := s.next + 1; i < len(s.plan); i++ {
		step := s.plan[i]
		if step.linkTo == beltStep.linkTo && !step.belt && !step.sorter {
			return step.btype
		}
	}
	return ""
}

// beltRoleFor 返回某条产线上带子那一步的角色名。
func (s *ScriptedOpening) beltRoleFor(linkTo string) string {
	for _, step := range s.plan {
		if step.belt && step.linkTo == linkTo {
			return step.role
		}
	}
	return ""
}

// sorterRoleFor 返回某条产线上分拣器那一步的角色名。
func (s *ScriptedOpening) sorterRoleFor(linkTo string) string {
	for _, step := range s.plan {
		if step.sorter && step.linkTo == linkTo {
			return step.role
		}
	}
	return ""
}

// scriptBuildingSettled 报告这栋建筑是否已经真正落成（施工任务已出队）。
// 施工中的建筑占地外圈仍被施工任务预约，此时在旁边放带子会被 POSITION_OCCUPIED 拒掉。
func scriptBuildingSettled(ws *model.WorldState, b *model.Building) bool {
	if ws == nil || b == nil || ws.Construction == nil {
		return b != nil
	}
	return ws.Construction.ReservedTiles[model.TileKey(b.Position.X, b.Position.Y)] == ""
}

// scriptGoMine 让机甲去采 node：已经站在 6 格判定圈内就直接开挖，否则先移动
// 到矿脉邻格（真人也是「先走过去再点采集」；直接开挖会被 OutOfRange 拒绝）。
//
// 开采用「脚下的矿」而不是远处那条：quantity 超过背包空位会让作业停在
// inventory_full 等玩家腾位置，脚本腾不出位置就整局停摆，所以请求量按
// 背包剩余空间截断。
func scriptGoMine(ws *model.WorldState, unit *model.Unit, node *model.ResourceNodeState, want int) (model.Command, bool) {
	if ws == nil || unit == nil || unit.Mecha == nil || node == nil || want <= 0 {
		return model.Command{}, false
	}
	if ws.SurfaceDistance(unit.Position, node.Position) > 6 {
		dest := botAdjacentFreeTile(ws, node.Position, unit.ID)
		if dest == nil {
			return model.Command{}, false
		}
		path, reachable := computeUnitPath(ws, unit.Position, *dest, unit.ID)
		if !reachable || len(path) < 2 {
			return model.Command{}, false
		}
		step := path[len(path)-1]
		return model.Command{
			Type:   model.CmdMove,
			Target: model.CommandTarget{Layer: "planet", EntityID: unit.ID, PlanetID: ws.PlanetID, Position: &step},
		}, true
	}
	if node.Remaining < want {
		want = node.Remaining
	}
	if record := ws.Players[unit.OwnerID].MechaByUnitID(unit.ID); record != nil {
		if free := mechaInventoryFree(record, mechaInventorySlots(ws.Players[unit.OwnerID]), node.Kind, want); free < want {
			want = free
		}
	}
	if want <= 0 {
		return model.Command{}, false
	}
	return model.Command{
		Type:   model.CmdMineResource,
		Target: model.CommandTarget{Layer: "planet", EntityID: unit.ID, PlanetID: ws.PlanetID},
		Payload: map[string]any{
			"resource_id": node.ID,
			"quantity":    want,
		},
	}, true
}

// driveMecha 让机甲做「下一步建造缺的那件东西」：能手搓就手搓，是原矿就去采。
func (s *ScriptedOpening) driveMecha(ws *model.WorldState, unit *model.Unit, player *model.PlayerState, record *model.MechaRecord, step scriptStep) (model.Command, bool) {
	if unit.Mecha.Job != nil {
		return model.Command{}, false
	}
	// 正在赶路（上一条 move 还没走完）：等它走完再决定下一步，否则每两 tick
	// 重新下一条 move 会一直重置路径。
	if len(unit.Path) > 0 && unit.PathIndex < len(unit.Path) {
		return model.Command{}, false
	}
	if ws.Tick-s.lastActionTick < 2 {
		return model.Command{}, false
	}
	actions := scriptBuildActions(record, s.driveTarget(step))
	for _, action := range actions {
		switch action.kind {
		case "mine":
			node := scriptFindMineNode(ws, unit.Position, action.item, scriptMineTravelRadius)
			if node == nil {
				continue
			}
			qty := action.qty
			if qty <= 0 {
				continue
			}
			if cmd, ok := scriptGoMine(ws, unit, node, qty); ok {
				s.lastActionTick = ws.Tick
				return cmd, true
			}
		case "craft":
			recipe, ok := model.Recipe(action.recipe)
			if !ok || !recipe.HandcraftAllowed || action.qty <= 0 {
				continue
			}
			if !scriptRecipeInputsReady(record, recipe) {
				continue
			}
			batches := action.qty
			if out := scriptRecipeOutputQty(recipe, action.item); out > 0 {
				if free := mechaInventoryFree(record, mechaInventorySlots(player), action.item, batches*out); free/out < batches {
					batches = free / out
				}
			}
			if batches <= 0 {
				continue
			}
			s.lastActionTick = ws.Tick
			return model.Command{
				Type:   model.CmdCraftItem,
				Target: model.CommandTarget{Layer: "planet", EntityID: unit.ID, PlanetID: ws.PlanetID},
				Payload: map[string]any{
					"recipe_id": action.recipe,
					"quantity":  batches,
				},
			}, true
		}
	}
	return model.Command{}, false
}

// scriptAction 是「凑一栋建筑的材料」里的一步：采哪种原矿，或手搓哪个配方。
type scriptAction struct {
	kind   string // "mine" | "craft"
	item   string
	recipe string
	qty    int
}

// scriptBuildActions 把一栋建筑的材料展开成有序动作：原矿在前、手搓在后
// （后序遍历），且每一步都已经扣掉背包里现有的存货。
//
// 这就是「手搓链下钻」：风机缺齿轮 → 齿轮缺铁块 → 铁块缺铁矿，一路钻到原矿。
// 不这么做的话，脚本会在「背包里没有铁块」时一直干等——真人玩家会先去挖矿。
func scriptBuildActions(record *model.MechaRecord, btype model.BuildingType) []scriptAction {
	if record == nil {
		return nil
	}
	def, ok := model.BuildingDefinitionByID(btype)
	if !ok {
		return nil
	}
	available := make(map[string]int, len(record.Inventory))
	for item, qty := range record.Inventory {
		available[item] = qty
	}
	var actions []scriptAction
	var consume func(item string, qty int, depth int)
	consume = func(item string, qty int, depth int) {
		if qty <= 0 {
			return
		}
		if have := available[item]; have > 0 {
			use := min(have, qty)
			available[item] -= use
			qty -= use
			if qty <= 0 {
				return
			}
		}
		recipe, ok := scriptHandcraftRecipe(item)
		if !ok || depth > 4 {
			actions = append(actions, scriptAction{kind: "mine", item: item, qty: qty})
			return
		}
		outQty := scriptRecipeOutputQty(recipe, item)
		if outQty <= 0 {
			outQty = 1
		}
		batches := (qty + outQty - 1) / outQty
		for _, in := range recipe.Inputs {
			consume(in.ItemID, in.Quantity*batches, depth+1)
		}
		available[item] += batches * outQty
		actions = append(actions, scriptAction{kind: "craft", item: item, recipe: recipe.ID, qty: batches})
	}
	for _, need := range def.BuildCost.Items {
		consume(need.ItemID, need.Quantity, 0)
	}
	return actions
}

// scriptHandcraftRecipe 返回产出 item 的、可手搓的配方（按配方 ID 排序取第一个，
// 保证确定性）。
func scriptHandcraftRecipe(item string) (model.RecipeDefinition, bool) {
	recipes := model.RecipesProducingItem(item)
	sort.Slice(recipes, func(i, j int) bool { return recipes[i].ID < recipes[j].ID })
	for _, recipe := range recipes {
		if recipe.HandcraftAllowed {
			return recipe, true
		}
	}
	return model.RecipeDefinition{}, false
}

func scriptRecipeOutputQty(recipe model.RecipeDefinition, item string) int {
	for _, out := range recipe.AllOutputs() {
		if out.ItemID == item {
			return out.Quantity
		}
	}
	return 0
}

// driveTarget 返回「现在要凑料的那栋建筑」的类型：带子那一步要凑带子的料，
// 分拣器那一步要凑分拣器的料，其余建筑那一步要凑建筑自己的料。
func (s *ScriptedOpening) driveTarget(step scriptStep) model.BuildingType {
	if step.belt {
		return model.BuildingTypeConveyorBeltMk1
	}
	if step.sorter {
		return model.BuildingTypeSorterMk1
	}
	return step.btype
}

// ---- 材料与工具 ----

var scriptOreItems = []string{model.ItemIronOre, model.ItemCopperOre, model.ItemStoneOre}

// scriptCraftOrder 手搓顺序：先中间件（齿轮/电路板/磁线圈），再熔炼（锭/磁铁）。
var scriptCraftOrder = []string{"gear", "circuit_board", "magnetic_coil", "smelt_iron", "smelt_copper", "smelt_magnet", "smelt_stone"}

// scriptMaterialsReady 背包里是否已经凑齐这栋建筑的全部物品材料（第 16 轮起这是唯一的建造门槛）。
func scriptMaterialsReady(record *model.MechaRecord, btype model.BuildingType) bool {
	for _, missing := range scriptMissingItems(record, btype) {
		if missing > 0 {
			return false
		}
	}
	return true
}

// scriptMissingItems 返回建造这栋建筑还缺的物品与数量。
func scriptMissingItems(record *model.MechaRecord, btype model.BuildingType) map[string]int {
	out := map[string]int{}
	def, ok := model.BuildingDefinitionByID(btype)
	if !ok {
		return out
	}
	for _, need := range def.BuildCost.Items {
		if have := record.Inventory[need.ItemID]; have < need.Quantity {
			out[need.ItemID] = need.Quantity - have
		}
	}
	return out
}

// scriptRecipeInputsReady 手搓这批的原料是否都在背包里。
func scriptRecipeInputsReady(record *model.MechaRecord, recipe model.RecipeDefinition) bool {
	for _, in := range recipe.Inputs {
		if record.Inventory[in.ItemID] < in.Quantity {
			return false
		}
	}
	return true
}

// nearestMineNode 返回机甲附近最近的可采矿脉（判定半径与 execMineResource 的
// 6 格一致）。
//
// 只在机甲周围的地表格上找，**不遍历全行星矿脉表**：SurfaceDistance 是球面上的
// 精确最短四邻距离（跨面要跑有界 A*），行星上有上千条脉，逐个算一遍会让「脚本每
// tick 找一次矿脉」变成 50ms/tick（实测脚本推进 8000 tick 因此要多花 6 分钟）。
// 本地格扫描是 O(半径²) 且完全不碰 A*。
func nearestMineNode(ws *model.WorldState, from model.Position, kind string) *model.ResourceNodeState {
	return scriptFindMineNode(ws, from, kind, 6)
}

// scriptFindMineNode 在 maxRadius 格地表范围内找最近的可采矿脉（同距取较小 ID）。
// 采矿机压在矿脉上的判定是 6 格；脚本要出远门时把半径放宽，让机甲走过去再采。
func scriptFindMineNode(ws *model.WorldState, from model.Position, kind string, maxRadius int) *model.ResourceNodeState {
	if ws == nil || maxRadius < 1 {
		return nil
	}
	var best *model.ResourceNodeState
	bestDist := 1 << 30
	for _, cell := range ws.SurfaceDisc(from, maxRadius) {
		if !ws.InBounds(cell.X, cell.Y) {
			continue
		}
		id := ws.Grid[cell.Y][cell.X].ResourceNodeID
		if id == "" {
			continue
		}
		node := ws.Resources[id]
		if node == nil || node.Kind != kind || node.Remaining <= 0 {
			continue
		}
		dist := ws.SurfaceDistance(from, node.Position)
		if dist > maxRadius {
			continue
		}
		if dist < bestDist || (dist == bestDist && (best == nil || node.ID < best.ID)) {
			best, bestDist = node, dist
		}
	}
	return best
}

// scriptMineTravelRadius 是脚本「为凑料出远门」的采矿搜索半径。开局时石矿常在
// 基地十几格外（铁/铜紧邻 HQ），只认 6 格会一直等不到石砖、整层卡死。
const scriptMineTravelRadius = 60

// playerHome 返回该玩家的指挥中枢位置（开局选址的圆心）。
func playerHome(ws *model.WorldState, playerID string) model.Position {
	ids := make([]string, 0, len(ws.Buildings))
	for id := range ws.Buildings {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		b := ws.Buildings[id]
		if b != nil && b.OwnerID == playerID && b.HP > 0 && b.Type == model.BuildingTypeBattlefieldAnalysisBase {
			return b.Position
		}
	}
	for _, id := range ids {
		b := ws.Buildings[id]
		if b != nil && b.OwnerID == playerID && b.HP > 0 {
			return b.Position
		}
	}
	return model.Position{}
}

// executorUnitFor 返回该玩家在本行星上的机甲（按 ID 排序取第一台，保证确定性）。
func executorUnitFor(ws *model.WorldState, playerID string) *model.Unit {
	ids := make([]string, 0, len(ws.Units))
	for id := range ws.Units {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		u := ws.Units[id]
		if u == nil || u.OwnerID != playerID || u.HP <= 0 || u.Type != model.UnitTypeExecutor || u.Mecha == nil {
			continue
		}
		return u
	}
	return nil
}

// ScriptedStepResult 是脚本开局里一条命令的结果（重建失败时报出「第几步、哪条命令、
// 拒绝原因」，这本身就是回归信号）。
type ScriptedStepResult struct {
	Index   int
	Tick    int64
	Command model.Command
	Result  model.CommandResult
	Err     error
	// IssueTick 是下发这条命令时（结算前一 tick）的 tick。生成构建记录时用它
	// 补 advance_to_tick，重建才能按同一节奏回放。
	IssueTick int64
	// Role / PlanIndex 记录这条命令是在「推进哪一步」时下的——生成分层构建记录
	// 时按它把命令切给 cp-power / cp-mining / cp-base。
	Role      string
	PlanIndex int
}

// CurrentRole 返回脚本此刻正在推进的那一步的角色名（已走完时返回空）。
func (s *ScriptedOpening) CurrentRole() string {
	if s == nil || s.next >= len(s.plan) {
		return ""
	}
	return s.plan[s.next].role
}

// PlanIndex 返回脚本此刻正在推进的那一步的下标（已走完时返回 len(plan)）。
func (s *ScriptedOpening) PlanIndex() int {
	if s == nil {
		return 0
	}
	if s.next > len(s.plan) {
		return len(s.plan)
	}
	return s.next
}

// ScriptedOpeningRun 是一次脚本开局的完整结果：每一步的命令 + 结果，
// 以及「命令恰好走完时」的最后一步下标（用于把命令切成几层）。
type ScriptedOpeningRun struct {
	Steps []ScriptedStepResult
	// RoleLastIndex / RoleFirstIndex 是该角色首末一条命令的 Index；
	// 分层时用它们决定某一层的命令区间。
	RoleLastIndex  map[string]int
	RoleFirstIndex map[string]int
	// EndTick 是脚本跑完时的 tick。
	EndTick int64
}

// RunScriptedOpening 从当前局面跑完开局脚本：每 tick 取一条命令、下发、推进，
// 直到脚本走完或达到 maxTicks。返回每一步的结果（含被拒的命令）。
//
// 与「真人下命令」同一条路径（SubmitAndAdvance → 队列 → 下一 tick 结算），
// 因此被拒的命令会如实出现在结果里，而不是被静默吞掉。
func (gc *GameCore) RunScriptedOpening(playerID string, maxTicks int64) []ScriptedStepResult {
	return gc.RunScriptedOpeningDetailed(playerID, maxTicks).Steps
}

// RunScriptedOpeningDetailed 与 RunScriptedOpening 同一条路径，但额外回报
// 每个角色最后一条命令的下标（重建工具据此切层）。
func (gc *GameCore) RunScriptedOpeningDetailed(playerID string, maxTicks int64) ScriptedOpeningRun {
	script := NewScriptedOpening(playerID)
	run := ScriptedOpeningRun{RoleLastIndex: map[string]int{}, RoleFirstIndex: map[string]int{}}
	start := gc.CurrentTick()
	for gc.CurrentTick()-start < maxTicks {
		ws := gc.World()
		if ws == nil {
			break
		}
		cmd, ok := script.Plan(ws)
		if !ok {
			// 脚本这一 tick 无事可做（在等建造结算或机甲作业）：推进一个 tick。
			gc.AdvanceTick()
			if script.Done() {
				break
			}
			continue
		}
		role, planIndex := script.CurrentRole(), script.PlanIndex()
		issueTick := gc.CurrentTick()
		result, err := gc.SubmitAndAdvance(playerID, cmd)
		step := ScriptedStepResult{
			Index:     len(run.Steps) + 1,
			Tick:      gc.CurrentTick(),
			IssueTick: issueTick,
			Command:   cmd,
			Result:    result,
			Err:       err,
			Role:      role,
			PlanIndex: planIndex,
		}
		run.Steps = append(run.Steps, step)
		if role != "" {
			run.RoleLastIndex[role] = step.Index
			if run.RoleFirstIndex[role] == 0 {
				run.RoleFirstIndex[role] = step.Index
			}
		}
		if script.Done() {
			break
		}
	}
	run.EndTick = gc.CurrentTick()
	return run
}

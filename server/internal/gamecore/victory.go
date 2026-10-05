package gamecore

import (
	"sort"

	"siliconworld/internal/model"
)

// resolveBattlefieldVictory keeps elimination / mission_complete / hybrid /
// sandbox, then applies a time-limit score win. Sandbox never declares.
func resolveBattlefieldVictory(rule string, worlds map[string]*model.WorldState, tick, timeLimit int64) model.VictoryState {
	if model.VictoryRuleNeverDeclares(rule) {
		return model.VictoryState{}
	}
	if victory := resolveVictory(rule, worlds); victory.Declared() {
		return victory
	}
	if timeLimit > 0 && tick >= timeLimit {
		return resolveScoreVictory(worlds, rule)
	}
	return model.VictoryState{}
}

// resolveScoreVictory ranks units_killed + buildings_destroyed, then fewer
// units_lost, then player_id lexicographic order.
func resolveScoreVictory(worlds map[string]*model.WorldState, rule string) model.VictoryState {
	players := scorePlayers(worlds)
	if len(players) == 0 {
		return model.VictoryState{}
	}
	ids := make([]string, 0, len(players))
	for id := range players {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool {
		si, sj := combatScore(players[ids[i]]), combatScore(players[ids[j]])
		if si.score != sj.score {
			return si.score > sj.score
		}
		if si.lost != sj.lost {
			return si.lost < sj.lost
		}
		return ids[i] < ids[j]
	})
	return model.VictoryState{
		WinnerID:    ids[0],
		Reason:      model.VictoryReasonTimeLimit,
		VictoryRule: model.NormalizeVictoryRule(rule),
	}
}

type combatScoreTotals struct {
	score int
	lost  int
}

func combatScore(player *model.PlayerState) combatScoreTotals {
	if player == nil || player.Stats == nil {
		return combatScoreTotals{}
	}
	stats := player.Stats.CombatStats
	return combatScoreTotals{
		score: stats.UnitsKilled + stats.BuildingsDestroyed,
		lost:  stats.UnitsLost,
	}
}

func scorePlayers(worlds map[string]*model.WorldState) map[string]*model.PlayerState {
	if len(worlds) == 0 {
		return nil
	}
	ids := make([]string, 0, len(worlds))
	for id := range worlds {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	players := make(map[string]*model.PlayerState)
	for _, id := range ids {
		ws := worlds[id]
		if ws == nil {
			continue
		}
		for pid, player := range ws.Players {
			if player == nil || players[pid] != nil {
				continue
			}
			players[pid] = player
		}
	}
	return players
}

func resolveVictory(rule string, worlds map[string]*model.WorldState) model.VictoryState {
	rule = model.NormalizeVictoryRule(rule)
	if model.VictoryRuleAllowsMissionComplete(rule) {
		if victory := resolveMissionCompleteVictory(worlds, rule); victory.Declared() {
			return victory
		}
	}
	if model.VictoryRuleAllowsElimination(rule) {
		return resolveEliminationVictory(worlds, rule)
	}
	return model.VictoryState{}
}

func resolveMissionCompleteVictory(worlds map[string]*model.WorldState, rule string) model.VictoryState {
	players := researchPlayers(worlds)
	if len(players) == 0 {
		return model.VictoryState{}
	}
	winners := make([]string, 0, len(players))
	for playerID, player := range players {
		if player == nil || !player.IsAlive || player.Tech == nil || !player.Tech.HasTech("mission_complete") {
			continue
		}
		winners = append(winners, playerID)
	}
	if len(winners) == 0 {
		return model.VictoryState{}
	}
	sort.Strings(winners)
	return model.VictoryState{
		WinnerID:    winners[0],
		Reason:      model.VictoryReasonGameWin,
		VictoryRule: rule,
		TechID:      "mission_complete",
	}
}

// resolveEliminationVictory 淘汰胜利（F3 修正版）：
//   - 存活判定覆盖所有已加载世界：玩家在任一世界拥有 HQ 或存活机甲单位即视为在场；
//   - 单人配置不判淘汰（沙盒/PvE 可以输但没有"胜者"）；
//   - 团队对局按队伍判定：仅存一队的全部存活玩家时团队获胜；
//   - 全部同时淘汰（同归于尽）不判胜。
func resolveEliminationVictory(worlds map[string]*model.WorldState, rule string) model.VictoryState {
	players := make(map[string]*model.PlayerState)
	worldIDs := make([]string, 0, len(worlds))
	for id := range worlds {
		worldIDs = append(worldIDs, id)
	}
	sort.Strings(worldIDs)
	for _, id := range worldIDs {
		ws := worlds[id]
		if ws == nil {
			continue
		}
		for pid, p := range ws.Players {
			if p == nil {
				continue
			}
			if players[pid] == nil {
				players[pid] = p
			}
		}
	}
	if len(players) < 2 {
		return model.VictoryState{}
	}

	// 在场判定：任一世界的 HQ 或存活机甲单位。
	presence := make(map[string]bool, len(players))
	for _, id := range worldIDs {
		ws := worlds[id]
		if ws == nil {
			continue
		}
		for _, b := range ws.Buildings {
			if b != nil && b.Type == model.BuildingTypeBattlefieldAnalysisBase && b.HP > 0 {
				presence[b.OwnerID] = true
			}
		}
		for _, u := range ws.Units {
			if u != nil && u.HP > 0 && u.Mecha != nil {
				presence[u.OwnerID] = true
			}
		}
	}
	// 淘汰：存活但不在场的玩家出局（所有世界的玩家副本同步）。
	eliminated := false
	for pid, p := range players {
		if p.IsAlive && !presence[pid] {
			eliminated = true
			for _, id := range worldIDs {
				if ws := worlds[id]; ws != nil {
					if copy := ws.Players[pid]; copy != nil {
						copy.IsAlive = false
					}
				}
			}
		}
	}
	_ = eliminated

	var alive []string
	for pid, p := range players {
		if p.IsAlive {
			alive = append(alive, pid)
		}
	}
	sort.Strings(alive)
	if len(alive) == 0 {
		return model.VictoryState{}
	}
	// 团队判定：存活玩家是否同属一队。
	teams := make(map[string]bool)
	for _, pid := range alive {
		teams[players[pid].TeamID] = true
	}
	if len(teams) == 1 {
		team := ""
		for t := range teams {
			team = t
		}
		victory := model.VictoryState{
			WinnerID:    alive[0],
			Reason:      model.VictoryReasonElimination,
			VictoryRule: rule,
		}
		if team != "" && team != alive[0] {
			victory.TeamID = team
		}
		return victory
	}
	// FFA：仅剩一人。
	if len(alive) == 1 {
		return model.VictoryState{
			WinnerID:    alive[0],
			Reason:      model.VictoryReasonElimination,
			VictoryRule: rule,
		}
	}
	return model.VictoryState{}
}

func victoryDeclaredEvent(victory model.VictoryState) *model.GameEvent {
	if !victory.Declared() {
		return nil
	}
	payload := map[string]any{
		"winner_id":     victory.WinnerID,
		"reason":        victory.Reason,
		"victory_rule":  victory.VictoryRule,
		"declared_tick": victory.DeclaredTick,
	}
	if victory.TechID != "" {
		payload["tech_id"] = victory.TechID
	}
	if victory.TeamID != "" {
		payload["team_id"] = victory.TeamID
	}
	return &model.GameEvent{
		EventType:       model.EvtVictoryDeclared,
		VisibilityScope: "all",
		Payload:         payload,
	}
}

// Winner returns the winning player ID, or empty string if game is ongoing
func (gc *GameCore) Winner() string {
	return gc.Victory().WinnerID
}

// Victory returns the resolved victory payload, or zero value while ongoing.
func (gc *GameCore) Victory() model.VictoryState {
	gc.victoryMu.RLock()
	defer gc.victoryMu.RUnlock()
	return gc.victory
}

// Finished 报告对局是否已终局（F2）：victory 宣判即 finished；sandbox 永不宣判故永不 finished。
func (gc *GameCore) Finished() bool {
	return gc.Victory().Declared()
}

// Settlement 返回宣判时冻结的终局结算报告；未宣判（未 finished）时为 nil。
func (gc *GameCore) Settlement() *model.SettlementReport {
	gc.victoryMu.RLock()
	defer gc.victoryMu.RUnlock()
	return gc.settlement.Clone()
}

// declareVictory 记录宣判结果并冻结结算报告（F2）。currentTick 为宣判 tick；
// 调用方须已持有世界写锁（结算管线内），以便读取玩家双边统计。
func (gc *GameCore) declareVictory(victory model.VictoryState, currentTick int64) bool {
	if !victory.Declared() {
		return false
	}
	gc.victoryMu.Lock()
	defer gc.victoryMu.Unlock()
	if gc.victory.Declared() {
		return false
	}
	victory.DeclaredTick = currentTick
	gc.victory = victory
	gc.settlement = buildSettlementReport(victory, gc.world, currentTick)
	return true
}

func (gc *GameCore) setVictoryState(victory model.VictoryState) {
	gc.victoryMu.Lock()
	defer gc.victoryMu.Unlock()
	gc.victory = victory
}

// setSettlementState 恢复/回滚结算报告（读档与 rollback 路径与 victory 同步替换）。
func (gc *GameCore) setSettlementState(report *model.SettlementReport) {
	gc.victoryMu.Lock()
	defer gc.victoryMu.Unlock()
	gc.settlement = report.Clone()
}

// buildSettlementReport 在宣判时刻聚合结算报告：胜者/队伍/规则/时长 tick +
// 每玩家冻结的双边战损。时间线只放 tick 指针，事件流本体由 /events/snapshot 提供。
func buildSettlementReport(victory model.VictoryState, ws *model.WorldState, currentTick int64) *model.SettlementReport {
	if !victory.Declared() {
		return nil
	}
	report := &model.SettlementReport{
		WinnerID:      victory.WinnerID,
		TeamID:        victory.TeamID,
		Reason:        victory.Reason,
		VictoryRule:   victory.VictoryRule,
		TechID:        victory.TechID,
		StartTick:     0,
		DeclaredTick:  currentTick,
		DurationTicks: currentTick,
	}
	if ws == nil {
		return report
	}
	playerIDs := make([]string, 0, len(ws.Players))
	for playerID := range ws.Players {
		playerIDs = append(playerIDs, playerID)
	}
	sort.Strings(playerIDs)
	for _, playerID := range playerIDs {
		player := ws.Players[playerID]
		if player == nil {
			continue
		}
		entry := model.SettlementPlayerStats{
			PlayerID: playerID,
			TeamID:   player.TeamID,
			IsAlive:  player.IsAlive,
			Winner:   playerID == victory.WinnerID || (victory.TeamID != "" && player.TeamID == victory.TeamID),
		}
		if player.Stats != nil {
			entry.UnitsKilled = player.Stats.CombatStats.UnitsKilled
			entry.UnitsLost = player.Stats.CombatStats.UnitsLost
			entry.BuildingsDestroyed = player.Stats.CombatStats.BuildingsDestroyed
			entry.BuildingsLost = player.Stats.CombatStats.BuildingsLost
		}
		report.Players = append(report.Players, entry)
	}
	return report
}

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

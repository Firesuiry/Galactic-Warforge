package query

import (
	"sort"

	"siliconworld/internal/model"
)

// DefaultAgentBriefingAlertLimit is the default number of recent production
// alerts included in an agent briefing when the caller does not specify one.
const DefaultAgentBriefingAlertLimit = 20

// AgentBriefing is the aggregated snapshot for GET /state/agent-briefing.
// It collapses the multi-call agent/GUI bootstrap (summary + stats + war +
// fleets + alerts + command surface) into a single authoritative view.
type AgentBriefing struct {
	Tick              int64                    `json:"tick"`
	ActivePlanetID    string                   `json:"active_planet_id"`
	MapWidth          int                      `json:"map_width"`
	MapHeight         int                      `json:"map_height"`
	Winner            string                   `json:"winner,omitempty"`
	VictoryReason     string                   `json:"victory_reason,omitempty"`
	VictoryRule       string                   `json:"victory_rule,omitempty"`
	Self              AgentBriefingSelf        `json:"self"`
	EnergyStats       model.EnergyStats        `json:"energy_stats"`
	CombatStats       model.CombatStats        `json:"combat_stats"`
	RecentAlerts      []*model.ProductionAlert `json:"recent_alerts"`
	Fleets            []AgentBriefingFleet     `json:"fleets"`
	TaskForces        []model.WarTaskForceView `json:"task_forces"`
	Theaters          []model.WarTheaterView   `json:"theaters"`
	EnemyForces       []EnemyForceView         `json:"enemy_forces"`
	AvailableCommands []string                 `json:"available_commands"`
}

// AgentBriefingSelf is the calling player's compact identity + economy + tech.
type AgentBriefingSelf struct {
	PlayerID  string              `json:"player_id"`
	TeamID    string              `json:"team_id,omitempty"`
	Role      string              `json:"role,omitempty"`
	IsAlive   bool                `json:"is_alive"`
	Resources model.Resources     `json:"resources"`
	Inventory model.ItemInventory `json:"inventory,omitempty"`
	Tech      *AgentBriefingTech  `json:"tech,omitempty"`
}

// AgentBriefingTech summarizes research without dumping the full tech tree.
type AgentBriefingTech struct {
	CompletedCount   int                   `json:"completed_count"`
	CompletedTechs   []string              `json:"completed_techs,omitempty"`
	CurrentResearch  *model.PlayerResearch `json:"current_research,omitempty"`
	ResearchQueueLen int                   `json:"research_queue_len"`
	TotalResearched  int64                 `json:"total_researched"`
}

// AgentBriefingFleet is a compact own-fleet card for the briefing surface.
type AgentBriefingFleet struct {
	FleetID    string             `json:"fleet_id"`
	SystemID   string             `json:"system_id"`
	Formation  string             `json:"formation"`
	State      string             `json:"state"`
	UnitCount  int                `json:"unit_count"`
	Target     *model.FleetTarget `json:"target,omitempty"`
	InTransit  bool               `json:"in_transit,omitempty"`
	TransitTo  string             `json:"transit_to,omitempty"`
}

// AgentBriefing assembles the one-shot agent/GUI briefing snapshot.
// recentAlerts should already be a player-scoped (or unfiltered) history
// slice ordered oldest→newest; this method re-filters by playerID and keeps
// the newest alertLimit entries.
func (ql *Layer) AgentBriefing(
	ws *model.WorldState,
	playerID string,
	victory model.VictoryState,
	worlds map[string]*model.WorldState,
	spaceRuntime *model.SpaceRuntimeState,
	recentAlerts []*model.ProductionAlert,
	alertLimit int,
) *AgentBriefing {
	if alertLimit <= 0 {
		alertLimit = DefaultAgentBriefingAlertLimit
	}

	briefing := &AgentBriefing{
		RecentAlerts:      []*model.ProductionAlert{},
		Fleets:            []AgentBriefingFleet{},
		TaskForces:        []model.WarTaskForceView{},
		Theaters:          []model.WarTheaterView{},
		EnemyForces:       []EnemyForceView{},
		AvailableCommands: []string{},
	}
	if ws == nil {
		return briefing
	}

	// Reuse existing war/fleet projections (they manage their own locks).
	taskForces := ql.WarTaskForces(ws, playerID, worlds, spaceRuntime)
	if taskForces != nil && taskForces.TaskForces != nil {
		briefing.TaskForces = taskForces.TaskForces
	}
	theaters := ql.WarTheaters(ws, playerID)
	if theaters != nil && theaters.Theaters != nil {
		briefing.Theaters = theaters.Theaters
	}
	for _, fleet := range ql.Fleets(playerID, spaceRuntime) {
		briefing.Fleets = append(briefing.Fleets, compactBriefingFleet(fleet))
	}

	ws.RLock()
	defer ws.RUnlock()

	briefing.Tick = ws.Tick
	briefing.ActivePlanetID = ws.PlanetID
	briefing.MapWidth = ws.MapWidth
	briefing.MapHeight = ws.MapHeight
	briefing.Winner = victory.WinnerID
	briefing.VictoryReason = victory.Reason
	briefing.VictoryRule = victory.VictoryRule

	player := ws.Players[playerID]
	briefing.Self = buildBriefingSelf(player, playerID)
	if player != nil && player.Stats != nil {
		briefing.EnergyStats = player.Stats.EnergyStats
		briefing.CombatStats = player.Stats.CombatStats
	}
	if player != nil {
		briefing.AvailableCommands = listAvailableCommands(player)
	}

	briefing.EnemyForces = collectEnemyForces(ws, playerID)
	briefing.RecentAlerts = filterRecentAlerts(recentAlerts, playerID, alertLimit)
	return briefing
}

func buildBriefingSelf(player *model.PlayerState, playerID string) AgentBriefingSelf {
	self := AgentBriefingSelf{PlayerID: playerID}
	if player == nil {
		return self
	}
	self.PlayerID = player.PlayerID
	self.TeamID = player.TeamID
	self.Role = player.Role
	self.IsAlive = player.IsAlive
	self.Resources = player.Resources
	if player.Inventory != nil {
		self.Inventory = player.Inventory.Clone()
	}
	if player.Tech != nil {
		self.Tech = compactBriefingTech(player.Tech)
	}
	return self
}

func compactBriefingTech(tech *model.PlayerTechState) *AgentBriefingTech {
	if tech == nil {
		return nil
	}
	out := &AgentBriefingTech{
		CompletedCount:   len(tech.CompletedTechs),
		ResearchQueueLen: len(tech.ResearchQueue),
		TotalResearched:  tech.TotalResearched,
	}
	if len(tech.CompletedTechs) > 0 {
		ids := make([]string, 0, len(tech.CompletedTechs))
		for id := range tech.CompletedTechs {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		out.CompletedTechs = ids
	}
	if tech.CurrentResearch != nil {
		current := *tech.CurrentResearch
		if tech.CurrentResearch.RequiredCost != nil {
			current.RequiredCost = append([]model.ItemAmount(nil), tech.CurrentResearch.RequiredCost...)
		}
		if tech.CurrentResearch.ConsumedCost != nil {
			current.ConsumedCost = make(map[string]int, len(tech.CurrentResearch.ConsumedCost))
			for k, v := range tech.CurrentResearch.ConsumedCost {
				current.ConsumedCost[k] = v
			}
		}
		out.CurrentResearch = &current
	}
	return out
}

func compactBriefingFleet(fleet FleetDetailView) AgentBriefingFleet {
	unitCount := 0
	for _, stack := range fleet.Units {
		unitCount += stack.Count
	}
	card := AgentBriefingFleet{
		FleetID:   fleet.FleetID,
		SystemID:  fleet.SystemID,
		Formation: fleet.Formation,
		State:     fleet.State,
		UnitCount: unitCount,
	}
	if fleet.Target != nil {
		target := *fleet.Target
		card.Target = &target
	}
	if fleet.Transit != nil {
		card.InTransit = true
		card.TransitTo = fleet.Transit.TargetSystemID
	}
	return card
}

func filterRecentAlerts(alerts []*model.ProductionAlert, playerID string, limit int) []*model.ProductionAlert {
	if limit <= 0 {
		limit = DefaultAgentBriefingAlertLimit
	}
	filtered := make([]*model.ProductionAlert, 0, limit)
	for _, alert := range alerts {
		if alert == nil || alert.PlayerID != playerID {
			continue
		}
		filtered = append(filtered, alert)
	}
	if len(filtered) > limit {
		filtered = filtered[len(filtered)-limit:]
	}
	// Always return a non-nil slice for stable JSON [] contracts.
	if filtered == nil {
		return []*model.ProductionAlert{}
	}
	out := make([]*model.ProductionAlert, len(filtered))
	copy(out, filtered)
	return out
}

func listAvailableCommands(player *model.PlayerState) []string {
	all := model.AllCommandTypes()
	out := make([]string, 0, len(all))
	for _, cmd := range all {
		if player.HasPermission(cmd) {
			out = append(out, string(cmd))
		}
	}
	return out
}

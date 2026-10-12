package snapshot

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"siliconworld/internal/mapstate"
	"siliconworld/internal/model"
)

// CurrentVersion 细分网格（1 格 = 3×3 cell）后坐标语义改变，旧存档一律拒绝加载，
// 不写兼容层（与当年 cube_sphere 迁移同样处理）。版本 1 = 旧网格；
// 版本 3 = 快照只存地形游程与资源差异（可由地图配置 + seed 重建的部分不入快照）。
const CurrentVersion = 3

// Snapshot captures a tick-level world snapshot with versioned payload.
type Snapshot struct {
	Version        int                           `json:"version"`
	Tick           int64                         `json:"tick"`
	Timestamp      time.Time                     `json:"timestamp"`
	ActivePlanetID string                        `json:"active_planet_id,omitempty"`
	Players        map[string]*model.PlayerState `json:"players,omitempty"`
	PlanetWorlds   map[string]*WorldSnapshot     `json:"planet_worlds,omitempty"`
	World          *WorldSnapshot                `json:"world,omitempty"`
	Discovery      *mapstate.DiscoverySnapshot   `json:"discovery,omitempty"`
	Space          *model.SpaceRuntimeState      `json:"space,omitempty"`
}

// Capture builds a full snapshot from runtime state.
func Capture(world *model.WorldState, discovery *mapstate.Discovery) *Snapshot {
	if world == nil {
		return &Snapshot{Version: CurrentVersion, Timestamp: time.Now().UTC()}
	}
	return CaptureRuntime(map[string]*model.WorldState{world.PlanetID: world}, world.PlanetID, discovery, nil)
}

// CaptureRuntime builds a snapshot from a multi-planet runtime registry.
func CaptureRuntime(worlds map[string]*model.WorldState, activePlanetID string, discovery *mapstate.Discovery, space *model.SpaceRuntimeState) *Snapshot {
	snap := &Snapshot{
		Version:        CurrentVersion,
		Timestamp:      time.Now().UTC(),
		ActivePlanetID: activePlanetID,
		Players:        make(map[string]*model.PlayerState),
		PlanetWorlds:   make(map[string]*WorldSnapshot),
		Space:          model.CloneSpaceRuntimeState(space),
	}
	for planetID, world := range worlds {
		if world == nil {
			continue
		}
		worldSnap := CaptureWorld(world)
		snap.PlanetWorlds[planetID] = worldSnap
		if planetID == activePlanetID {
			snap.World = worldSnap
			snap.Tick = worldSnap.Tick
		}
		if len(snap.Players) == 0 {
			for playerID, player := range world.Players {
				snap.Players[playerID] = clonePlayer(player)
			}
		}
	}
	if snap.World == nil {
		for planetID, worldSnap := range snap.PlanetWorlds {
			snap.World = worldSnap
			snap.ActivePlanetID = planetID
			if worldSnap != nil {
				snap.Tick = worldSnap.Tick
			}
			break
		}
	}
	if discovery != nil {
		snap.Discovery = discovery.Snapshot()
	}
	return snap
}

// Encode serializes a snapshot to JSON. 快照里不存可由地图配置 + seed 确定性重建
// 的整幅地形与资源静态字段（见 WorldSnapshot.Terrain / ResourceDeltas）。
func Encode(snap *Snapshot) ([]byte, error) {
	if snap == nil {
		return nil, errors.New("snapshot is nil")
	}
	if snap.Version == 0 {
		snap.Version = CurrentVersion
	}
	if snap.Version != CurrentVersion {
		return nil, fmt.Errorf("存档版本 %d 不受支持（当前为 %d）：细分网格后坐标语义已改变，旧存档无法加载，请开新局", snap.Version, CurrentVersion)
	}
	if snap.Timestamp.IsZero() {
		snap.Timestamp = time.Now().UTC()
	}
	if snap.World == nil && len(snap.PlanetWorlds) == 0 {
		return nil, errors.New("snapshot missing world state")
	}
	// ResourceBaseline 标了 json:"-"，不会进 JSON；它随进程内快照保留，
	// 供回放/回滚/自动存档在内存里直接还原（写盘快照读回后由地图配置重建）。
	return json.MarshalIndent(snap, "", "  ")
}

// Decode parses snapshot JSON and validates the version.
func Decode(data []byte) (*Snapshot, error) {
	if len(data) == 0 {
		return nil, errors.New("snapshot payload is empty")
	}
	var snap Snapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		return nil, err
	}
	if snap.Version == 0 {
		return nil, errors.New("snapshot version required")
	}
	if snap.Version != CurrentVersion {
		return nil, fmt.Errorf("存档版本 %d 不受支持（当前为 %d）：细分网格后坐标语义已改变，旧存档无法加载，请开新局", snap.Version, CurrentVersion)
	}
	return &snap, nil
}

// RestoreWorld rebuilds a WorldState from the snapshot payload.
func (snap *Snapshot) RestoreWorld() (*model.WorldState, error) {
	if snap == nil {
		return nil, errors.New("snapshot is nil")
	}
	if snap.World != nil {
		return snap.World.Restore()
	}
	if len(snap.PlanetWorlds) == 0 {
		return nil, errors.New("snapshot missing world state")
	}
	if snap.ActivePlanetID != "" {
		if worldSnap := snap.PlanetWorlds[snap.ActivePlanetID]; worldSnap != nil {
			return worldSnap.Restore()
		}
	}
	for _, worldSnap := range snap.PlanetWorlds {
		if worldSnap != nil {
			return worldSnap.Restore()
		}
	}
	return nil, errors.New("snapshot missing world state")
}

// RestoreRuntime rebuilds multi-planet runtime worlds sharing one player state map.
func (snap *Snapshot) RestoreRuntime() (map[string]*model.WorldState, string, *model.SpaceRuntimeState, error) {
	if snap == nil {
		return nil, "", nil, errors.New("snapshot is nil")
	}
	if len(snap.PlanetWorlds) == 0 {
		world, err := snap.RestoreWorld()
		if err != nil {
			return nil, "", nil, err
		}
		worlds := map[string]*model.WorldState{world.PlanetID: world}
		activePlanetID := snap.ActivePlanetID
		if activePlanetID == "" {
			activePlanetID = world.PlanetID
		}
		return worlds, activePlanetID, model.CloneSpaceRuntimeState(snap.Space), nil
	}
	worlds := make(map[string]*model.WorldState, len(snap.PlanetWorlds))
	for planetID, worldSnap := range snap.PlanetWorlds {
		if worldSnap == nil {
			continue
		}
		world, err := worldSnap.Restore()
		if err != nil {
			return nil, "", nil, err
		}
		worlds[planetID] = world
	}
	sharedPlayers := cloneSnapshotPlayers(snap.Players)
	if len(sharedPlayers) == 0 {
		for _, world := range worlds {
			sharedPlayers = cloneSnapshotPlayers(world.Players)
			break
		}
	}
	for _, world := range worlds {
		world.Players = sharedPlayers
	}
	activePlanetID := snap.ActivePlanetID
	if activePlanetID == "" {
		for planetID := range worlds {
			activePlanetID = planetID
			break
		}
	}
	return worlds, activePlanetID, model.CloneSpaceRuntimeState(snap.Space), nil
}

// RestoreDiscovery rebuilds discovery state from the snapshot payload.
func (snap *Snapshot) RestoreDiscovery() (*mapstate.Discovery, error) {
	if snap == nil {
		return nil, errors.New("snapshot is nil")
	}
	if snap.Discovery == nil {
		return nil, nil
	}
	return snap.Discovery.Restore(), nil
}

func cloneSnapshotPlayers(players map[string]*model.PlayerState) map[string]*model.PlayerState {
	if len(players) == 0 {
		return nil
	}
	out := make(map[string]*model.PlayerState, len(players))
	for playerID, player := range players {
		out[playerID] = clonePlayer(player)
	}
	return out
}

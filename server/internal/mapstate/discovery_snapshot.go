package mapstate

import "sort"

// DiscoverySnapshot captures discovered galaxies/systems/planets per player.
type DiscoverySnapshot struct {
	Players map[string]*PlayerDiscoverySnapshot `json:"players"`
}

// PlayerDiscoverySnapshot captures discovery state for a player.
type PlayerDiscoverySnapshot struct {
	Galaxies []string `json:"galaxies,omitempty"`
	Systems  []string `json:"systems,omitempty"`
	Planets  []string `json:"planets,omitempty"`
}

// Snapshot returns a serializable discovery snapshot.
func (d *Discovery) Snapshot() *DiscoverySnapshot {
	if d == nil {
		return nil
	}
	d.mu.RLock()
	defer d.mu.RUnlock()

	snap := &DiscoverySnapshot{
		Players: make(map[string]*PlayerDiscoverySnapshot, len(d.players)),
	}
	for playerID, pd := range d.players {
		ps := &PlayerDiscoverySnapshot{
			Galaxies: mapKeysSorted(pd.Galaxies),
			Systems:  mapKeysSorted(pd.Systems),
			Planets:  mapKeysSorted(pd.Planets),
		}
		snap.Players[playerID] = ps
	}
	return snap
}

// Restore rebuilds Discovery state from snapshot.
func (s *DiscoverySnapshot) Restore() *Discovery {
	if s == nil {
		return nil
	}
	d := &Discovery{
		players: make(map[string]*PlayerDiscovery, len(s.Players)),
	}
	for playerID, ps := range s.Players {
		d.players[playerID] = &PlayerDiscovery{
			Galaxies: mapFromSlice(ps.Galaxies),
			Systems:  mapFromSlice(ps.Systems),
			Planets:  mapFromSlice(ps.Planets),
		}
	}
	return d
}

// ReplaceFromSnapshot overwrites the discovery state with snapshot data.
func (d *Discovery) ReplaceFromSnapshot(snap *DiscoverySnapshot) {
	if d == nil || snap == nil {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.players = make(map[string]*PlayerDiscovery, len(snap.Players))
	for playerID, ps := range snap.Players {
		d.players[playerID] = &PlayerDiscovery{
			Galaxies: mapFromSlice(ps.Galaxies),
			Systems:  mapFromSlice(ps.Systems),
			Planets:  mapFromSlice(ps.Planets),
		}
	}
}

func mapKeysSorted(src map[string]bool) []string {
	if len(src) == 0 {
		return nil
	}
	keys := make([]string, 0, len(src))
	for key := range src {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func mapFromSlice(src []string) map[string]bool {
	m := make(map[string]bool, len(src))
	for _, v := range src {
		if v == "" {
			continue
		}
		m[v] = true
	}
	return m
}

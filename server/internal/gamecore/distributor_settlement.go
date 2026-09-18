package gamecore

import (
	"siliconworld/internal/model"
	"sort"
)

func distributorIDs(ws *model.WorldState) []string {
	ids := []string{}
	for id, b := range ws.Buildings {
		if b != nil && b.Distributor != nil {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}
func logisticsBotIDs(ws *model.WorldState) []string {
	ids := []string{}
	for id, b := range ws.LogisticsBots {
		if b != nil {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}

// distributorEffectiveRange derives the delivery range from the persisted base
// range plus the owner's distribution_range tech effect. The base range is
// never mutated, so snapshot restores cannot accumulate the bonus.
func distributorEffectiveRange(ws *model.WorldState, home *model.Building) int {
	if home == nil || home.Distributor == nil {
		return 0
	}
	return home.Distributor.Range + int(model.TechEffectValue(ws.Players[home.OwnerID], "distribution_range"))
}

// Cargo and prepaid flight energy belong to the robot. Reservations are
// derived from these saved flights rather than a separate mutable ledger.
func settleDistributors(ws *model.WorldState, active bool) {
	if ws == nil {
		return
	}
	ids := logisticsBotIDs(ws)
	for _, id := range ids {
		bot := ws.LogisticsBots[id]
		home := ws.Buildings[bot.DistributorID]
		if home == nil || home.OwnerID != bot.OwnerID || model.DistributorHost(ws, home) == nil {
			bot.Status = model.LogisticsDroneStranded
			bot.StateReason = "home_unavailable"
			continue
		}
		if bot.Status == model.LogisticsDroneIdle {
			continue
		}
		if bot.Status == model.LogisticsDroneStranded {
			bot.Returning = true
		}
		if !bot.Returning {
			pos, valid := distributorBotTarget(ws, bot, active)
			if !valid {
				returnDistributorBot(bot, home, "target_unavailable")
			} else {
				bot.TargetPos = &pos
				if ws.SurfaceDistance(home.Position, pos) > distributorEffectiveRange(ws, home) || bot.EnergyRemaining < ws.SurfaceDistance(bot.Position, pos)+ws.SurfaceDistance(pos, home.Position) {
					returnDistributorBot(bot, home, "range_or_energy")
				}
			}
		}
		if bot.Returning {
			pos := home.Position
			bot.TargetPos = &pos
		}
		if bot.TargetPos == nil {
			returnDistributorBot(bot, home, "target_unavailable")
		}
		if bot.Status != model.LogisticsDroneWaitingUnload {
			moveDistributorBot(ws, bot, home)
		}
		if sameBotTile(bot.Position, *bot.TargetPos) {
			bot.Position = *bot.TargetPos
			if bot.Returning {
				finishDistributorReturn(ws, bot, home)
			} else {
				arriveDistributorBot(ws, bot, home, active)
			}
		}
	}
	for _, id := range ids {
		bot := ws.LogisticsBots[id]
		if bot.Status == model.LogisticsDroneIdle && bot.CargoQty() == 0 {
			dispatchDistributorBot(ws, bot, active)
		}
	}
}
func sameBotTile(a, b model.Position) bool { return a.X == b.X && a.Y == b.Y }
func distributorCanDispatch(ws *model.WorldState, b *model.Building) bool {
	if b == nil || b.Job != nil || b.Runtime.State != model.BuildingWorkRunning || model.DistributorHost(ws, b) == nil {
		return false
	}
	snapshot := model.CurrentPowerSettlementSnapshot(ws)
	if snapshot == nil {
		return false
	}
	allocation, ok := snapshot.Allocations.Buildings[b.ID]
	return ok && allocation.Allocated > 0 && allocation.Ratio > 0
}
func distributorMecha(ws *model.WorldState, owner string, active bool) *model.Unit {
	if !active {
		return nil
	}
	p := ws.Players[owner]
	if p == nil {
		return nil
	}
	executor := p.ExecutorForPlanet(ws.PlanetID)
	if executor == nil {
		return nil
	}
	u := ws.Units[executor.UnitID]
	if u == nil || u.OwnerID != owner || u.Type != model.UnitTypeExecutor || u.Mecha == nil || u.HP <= 0 {
		return nil
	}
	return u
}
func distributorSupply(ws *model.WorldState, b *model.Building, item, exclude string) int {
	host := model.DistributorHost(ws, b)
	if host == nil || b.Distributor.ItemID != item || b.Distributor.Mode != model.LogisticsStationModeSupply {
		return 0
	}
	return max(0, min(host.Storage.OutputQuantity(item), host.Storage.ItemQuantity(item)-b.Distributor.LocalStorage)-distributorPickupReservations(ws, "distributor", b.ID, item, exclude))
}
func distributorPickupReservations(ws *model.WorldState, kind, id, item, exclude string) int {
	total := 0
	for botID, bot := range ws.LogisticsBots {
		if botID != exclude && bot != nil && bot.Status != model.LogisticsDroneIdle && bot.Status != model.LogisticsDroneStranded && !bot.Returning && bot.TripKind == "pickup" && bot.TargetKind == kind && bot.TargetID == id && bot.PickupItemID == item {
			total += bot.PickupQuantity
		}
	}
	return total
}

// Pickup flights reserve their eventual home capacity before leaving empty.
func botIncoming(bot *model.LogisticsBotState, kind, id string) model.ItemInventory {
	if bot == nil || bot.Status == model.LogisticsDroneIdle || bot.Status == model.LogisticsDroneStranded {
		return nil
	}
	if bot.Returning {
		if kind == "distributor" && id == bot.DistributorID {
			return bot.Cargo
		}
		return nil
	}
	if bot.TripKind == "pickup" {
		if kind == "distributor" && id == bot.DistributorID {
			return model.ItemInventory{bot.PickupItemID: bot.PickupQuantity}
		}
		return nil
	}
	if bot.TargetKind == kind && bot.TargetID == id {
		return bot.Cargo
	}
	return nil
}
func distributorIncoming(ws *model.WorldState, kind, id, item, exclude string) int {
	total := 0
	for botID, bot := range ws.LogisticsBots {
		if botID != exclude {
			total += botIncoming(bot, kind, id)[item]
		}
	}
	return total
}
func distributorFreeSpace(ws *model.WorldState, b *model.Building, item, exclude string) int {
	host := model.DistributorHost(ws, b)
	if host == nil {
		return 0
	}
	forecast := host.Storage.Clone()
	unplaced := 0
	for _, id := range logisticsBotIDs(ws) {
		if id == exclude {
			continue
		}
		for incomingItem, qty := range botIncoming(ws.LogisticsBots[id], "distributor", b.ID) {
			accepted, _, _ := forecast.Load(incomingItem, qty)
			unplaced += qty - accepted
		}
	}
	accepted, _, _ := forecast.PreviewReceive(item, host.Storage.Capacity+host.Storage.BufferCapacity)
	return max(0, accepted-unplaced)
}
func distributorDemand(ws *model.WorldState, b *model.Building, item, exclude string) int {
	host := model.DistributorHost(ws, b)
	if host == nil || b.Distributor.ItemID != item || b.Distributor.Mode != model.LogisticsStationModeDemand {
		return 0
	}
	return max(0, min(b.Distributor.LocalStorage-host.Storage.ItemQuantity(item)-distributorIncoming(ws, "distributor", b.ID, item, exclude), distributorFreeSpace(ws, b, item, exclude)))
}
func dispatchDistributorBot(ws *model.WorldState, bot *model.LogisticsBotState, active bool) {
	home := ws.Buildings[bot.DistributorID]
	if !distributorCanDispatch(ws, home) {
		return
	}
	s := home.Distributor
	item := s.ItemID
	if item == "" {
		return
	}
	effectiveRange := distributorEffectiveRange(ws, home)
	host := model.DistributorHost(ws, home)
	if unit := distributorMecha(ws, bot.OwnerID, active); unit != nil && ws.SurfaceDistance(home.Position, unit.Position) <= effectiveRange {
		if request, ok := unit.Mecha.LogisticsRequests[item]; ok {
			count := ws.Players[bot.OwnerID].Inventory[item]
			if s.PlayerDeliveryEnabled && count < request.Min {
				qty := min(bot.Capacity, max(0, request.Max-count-distributorIncoming(ws, "mecha", unit.ID, item, "")), max(0, min(host.Storage.OutputQuantity(item), host.Storage.ItemQuantity(item)-s.LocalStorage)))
				if startDistributorFlight(ws, bot, home, "mecha", unit.ID, unit.Position, "delivery", item, qty, 2*effectiveRange) {
					return
				}
			}
			if s.PlayerCollectionEnabled && count > request.Max {
				qty := min(bot.Capacity, max(0, count-request.Max-distributorPickupReservations(ws, "mecha", unit.ID, item, "")), distributorFreeSpace(ws, home, item, ""))
				if startDistributorFlight(ws, bot, home, "mecha", unit.ID, unit.Position, "pickup", item, qty, 2*effectiveRange) {
					return
				}
			}
		}
	}
	for _, id := range distributorIDs(ws) {
		target := ws.Buildings[id]
		if id == home.ID || target.OwnerID != home.OwnerID || target.Job != nil || target.Distributor.ItemID != item || model.DistributorHost(ws, target) == nil {
			continue
		}
		distance := ws.SurfaceDistance(home.Position, target.Position)
		if distance > effectiveRange {
			continue
		}
		if s.Mode == model.LogisticsStationModeSupply {
			qty := min(bot.Capacity, distributorSupply(ws, home, item, ""), distributorDemand(ws, target, item, ""))
			if startDistributorFlight(ws, bot, home, "distributor", id, target.Position, "delivery", item, qty, 2*distance) {
				return
			}
		} else if s.Mode == model.LogisticsStationModeDemand {
			qty := min(bot.Capacity, distributorDemand(ws, home, item, ""), distributorSupply(ws, target, item, ""))
			if startDistributorFlight(ws, bot, home, "distributor", id, target.Position, "pickup", item, qty, 2*distance) {
				return
			}
		}
	}
}
func startDistributorFlight(ws *model.WorldState, bot *model.LogisticsBotState, home *model.Building, kind, id string, pos model.Position, trip, item string, qty, cost int) bool {
	if qty <= 0 || !home.Distributor.SpendEnergy(cost) {
		return false
	}
	if trip == "delivery" {
		taken, _, err := model.DistributorHost(ws, home).Storage.Provide(item, qty)
		if err != nil || taken <= 0 {
			home.Distributor.Energy += cost
			return false
		}
		bot.Load(item, taken)
		qty = taken
	}
	homePos := home.Position
	bot.HomePos = &homePos
	bot.Position = homePos
	bot.TargetKind = kind
	bot.TargetID = id
	bot.TargetPos = &pos
	bot.TripKind = trip
	bot.PickupItemID = item
	bot.PickupQuantity = qty
	bot.Returning = false
	bot.EnergyCost = cost
	bot.EnergyRemaining = cost
	bot.Status = model.LogisticsDroneTakeoff
	bot.StateReason = ""
	bot.TravelTicks = (ws.SurfaceDistance(homePos, pos) + bot.Speed - 1) / bot.Speed
	bot.RemainingTicks = bot.TravelTicks
	return true
}
func distributorBotTarget(ws *model.WorldState, bot *model.LogisticsBotState, active bool) (model.Position, bool) {
	home := ws.Buildings[bot.DistributorID]
	if home == nil || home.Distributor == nil || home.Job != nil || home.Distributor.ItemID != bot.PickupItemID {
		return model.Position{}, false
	}
	if bot.TargetKind == "mecha" {
		unit := distributorMecha(ws, bot.OwnerID, active)
		if unit == nil || unit.ID != bot.TargetID {
			return model.Position{}, false
		}
		ok := false
		if unit.Mecha.LogisticsRequests != nil {
			_, ok = unit.Mecha.LogisticsRequests[bot.PickupItemID]
		}
		if !ok || (bot.TripKind == "delivery" && !home.Distributor.PlayerDeliveryEnabled) || (bot.TripKind == "pickup" && !home.Distributor.PlayerCollectionEnabled) {
			return model.Position{}, false
		}
		return unit.Position, true
	}
	target := ws.Buildings[bot.TargetID]
	if target == nil || target.OwnerID != bot.OwnerID || target.Distributor == nil || target.Job != nil || model.DistributorHost(ws, target) == nil || target.Distributor.ItemID != bot.PickupItemID {
		return model.Position{}, false
	}
	if bot.TripKind == "delivery" && target.Distributor.Mode != model.LogisticsStationModeDemand {
		return model.Position{}, false
	}
	if bot.TripKind == "pickup" && (target.Distributor.Mode != model.LogisticsStationModeSupply || home.Distributor.Mode != model.LogisticsStationModeDemand) {
		return model.Position{}, false
	}
	return target.Position, true
}
func returnDistributorBot(bot *model.LogisticsBotState, home *model.Building, reason string) {
	bot.Returning = true
	pos := home.Position
	bot.TargetPos = &pos
	bot.Status = model.LogisticsDroneTakeoff
	bot.StateReason = reason
}
func moveDistributorBot(ws *model.WorldState, bot *model.LogisticsBotState, home *model.Building) {
	bot.Status = model.LogisticsDroneInFlight
	for i := 0; i < bot.Speed && !sameBotTile(bot.Position, *bot.TargetPos); i++ {
		distance := ws.SurfaceDistance(bot.Position, *bot.TargetPos)
		var next *model.Position
		for _, candidate := range ws.SurfaceNeighbors(bot.Position) {
			if ws.SurfaceDistance(candidate, *bot.TargetPos) < distance {
				p := candidate
				next = &p
				break
			}
		}
		if next == nil || bot.EnergyRemaining <= 0 {
			bot.Status = model.LogisticsDroneStranded
			bot.StateReason = "energy_exhausted"
			return
		}
		if !bot.Returning && bot.EnergyRemaining-1 < ws.SurfaceDistance(*next, home.Position) {
			returnDistributorBot(bot, home, "return_reserve")
			return
		}
		bot.Position = *next
		bot.EnergyRemaining--
	}
	bot.RemainingTicks = (ws.SurfaceDistance(bot.Position, *bot.TargetPos) + bot.Speed - 1) / bot.Speed
}
func arriveDistributorBot(ws *model.WorldState, bot *model.LogisticsBotState, home *model.Building, active bool) {
	item := bot.PickupItemID
	if _, ok := distributorBotTarget(ws, bot, active); !ok {
		returnDistributorBot(bot, home, "target_unavailable")
		return
	}
	if bot.TargetKind == "mecha" {
		unit := distributorMecha(ws, bot.OwnerID, active)
		p := ws.Players[bot.OwnerID]
		request := model.MechaLogisticsRequest{}
		if unit.Mecha.LogisticsRequests != nil {
			request = unit.Mecha.LogisticsRequests[item]
		}
		if bot.TripKind == "delivery" {
			qty := min(bot.Cargo[item], max(0, request.Max-p.Inventory[item]))
			if qty > 0 {
				p.AddItems([]model.ItemAmount{{ItemID: item, Quantity: qty}})
				bot.Unload(item, qty)
			}
		} else {
			qty := min(bot.PickupQuantity, max(0, p.Inventory[item]-request.Max), distributorFreeSpace(ws, home, item, bot.ID))
			if qty > 0 {
				p.DeductItems([]model.ItemAmount{{ItemID: item, Quantity: qty}})
				bot.Load(item, qty)
			}
		}
		returnDistributorBot(bot, home, "")
		return
	}
	target := ws.Buildings[bot.TargetID]
	host := model.DistributorHost(ws, target)
	if bot.TripKind == "pickup" {
		qty := min(bot.PickupQuantity, distributorSupply(ws, target, item, bot.ID), distributorDemand(ws, home, item, bot.ID))
		if qty > 0 {
			taken, _, _ := host.Storage.Provide(item, qty)
			if taken > 0 {
				bot.Load(item, taken)
			}
		}
		returnDistributorBot(bot, home, "")
		return
	}
	logicalSpace := max(0, target.Distributor.LocalStorage-host.Storage.ItemQuantity(item))
	qty := min(bot.Cargo[item], logicalSpace)
	if qty > 0 {
		accepted, _, _ := host.Storage.Load(item, qty)
		if accepted > 0 {
			bot.Unload(item, accepted)
		}
	}
	if bot.CargoQty() > 0 && target.Distributor.LocalStorage > host.Storage.ItemQuantity(item) {
		bot.Status = model.LogisticsDroneWaitingUnload
		bot.StateReason = "destination_full"
		return
	}
	returnDistributorBot(bot, home, "")
}
func finishDistributorReturn(ws *model.WorldState, bot *model.LogisticsBotState, home *model.Building) {
	host := model.DistributorHost(ws, home)
	for item, qty := range bot.Cargo {
		accepted, _, _ := host.Storage.Load(item, qty)
		if accepted > 0 {
			bot.Unload(item, accepted)
		}
	}
	if bot.CargoQty() > 0 {
		bot.Status = model.LogisticsDroneWaitingUnload
		bot.StateReason = "home_full"
		return
	}
	home.Distributor.Energy = min(home.Distributor.EnergyCapacity, home.Distributor.Energy+bot.EnergyRemaining)
	bot.Status = model.LogisticsDroneIdle
	bot.Returning = false
	bot.TargetID = ""
	bot.TargetKind = ""
	bot.TargetPos = nil
	bot.TripKind = ""
	bot.PickupItemID = ""
	bot.PickupQuantity = 0
	bot.EnergyCost = 0
	bot.EnergyRemaining = 0
	bot.RemainingTicks = 0
	bot.TravelTicks = 0
	bot.StateReason = ""
}

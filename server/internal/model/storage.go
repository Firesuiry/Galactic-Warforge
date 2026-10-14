package model

import (
	"fmt"
	"sort"
)

// StoragePriority configures input/output bias for storage buffers.
type StoragePriority struct {
	Input  int `json:"input" yaml:"input"`
	Output int `json:"output" yaml:"output"`
}

// StorageState tracks the storage inventory and IO buffers.
//
// 三个桶的语义（试玩 1015 理顺）：
//   - InputBuffer 只收原料：传送带 / 分拣器 / 管道 / 装入（Receive / Load /
//     PreviewReceive）走的是「输入路径」，只写输入缓冲与主库存的非预留段。
//   - OutputBuffer 只装成品：配方产物、副产物与采集产物都经 StoreProduct 落这里。
//     皮带 / 分拣器 / 机器人取货（ExportableItemQuantity）看到的就是成品，
//     未处理原料不会混在里面被送走。成品**绝不进输入缓冲**——旧实现用 Receive
//     落成品，成品占满输入缓冲后与原料互相卡死（熔炉表面 running、每 tick
//     storeProductionOutputs 失败，试玩 1015）。
//   - Reserve 是「产出预留」：主库存里必须留出的空位数，成品在输出缓冲放不下时
//     落在这里（StoreProduct 的第二落点）。生产建筑按当前配方写入预留量
//     （见 Building.SyncStorageReserve），输入路径一律不得越过它——否则整批产出
//     会落不下，建筑表面 running 却永远不产出（试玩 1014 层 04 P1）。
type StorageState struct {
	Capacity       int             `json:"capacity"`
	Slots          int             `json:"slots"`
	BufferCapacity int             `json:"buffer_capacity"`
	Priority       StoragePriority `json:"priority"`
	Reserve        int             `json:"reserve,omitempty"`
	Inventory      ItemInventory   `json:"inventory,omitempty"`
	InputBuffer    ItemInventory   `json:"input_buffer,omitempty"`
	OutputBuffer   ItemInventory   `json:"output_buffer,omitempty"`
}

// NewStorageState initializes a storage state from a storage module definition.
func NewStorageState(module StorageModule) *StorageState {
	state := &StorageState{
		Capacity:       module.Capacity,
		Slots:          module.Slots,
		BufferCapacity: module.Buffer,
		Priority: StoragePriority{
			Input:  module.InputPriority,
			Output: module.OutputPriority,
		},
	}
	state.normalize()
	return state
}

// Clone returns a deep copy of the storage state.
func (s *StorageState) Clone() *StorageState {
	if s == nil {
		return nil
	}
	out := *s
	out.Inventory = s.Inventory.Clone()
	out.InputBuffer = s.InputBuffer.Clone()
	out.OutputBuffer = s.OutputBuffer.Clone()
	return &out
}

// EnsureInventory returns a writable inventory map.
func (s *StorageState) EnsureInventory() ItemInventory {
	if s == nil {
		return nil
	}
	if s.Inventory == nil {
		s.Inventory = make(ItemInventory)
	}
	return s.Inventory
}

// EnsureInputBuffer returns a writable input buffer map.
func (s *StorageState) EnsureInputBuffer() ItemInventory {
	if s == nil {
		return nil
	}
	if s.InputBuffer == nil {
		s.InputBuffer = make(ItemInventory)
	}
	return s.InputBuffer
}

// EnsureOutputBuffer returns a writable output buffer map.
func (s *StorageState) EnsureOutputBuffer() ItemInventory {
	if s == nil {
		return nil
	}
	if s.OutputBuffer == nil {
		s.OutputBuffer = make(ItemInventory)
	}
	return s.OutputBuffer
}

// InputBufferCapacity returns the computed input buffer capacity.
func (s *StorageState) InputBufferCapacity() int {
	in, _ := s.bufferCaps()
	return in
}

// OutputBufferCapacity returns the computed output buffer capacity.
func (s *StorageState) OutputBufferCapacity() int {
	_, out := s.bufferCaps()
	return out
}

// UsedInventory returns total quantity in the main inventory.
func (s *StorageState) UsedInventory() int {
	return inventoryQty(s.Inventory)
}

// UsedInputBuffer returns total quantity in the input buffer.
func (s *StorageState) UsedInputBuffer() int {
	return inventoryQty(s.InputBuffer)
}

// UsedOutputBuffer returns total quantity in the output buffer.
func (s *StorageState) UsedOutputBuffer() int {
	return inventoryQty(s.OutputBuffer)
}

// DistinctItems returns the number of distinct item ids held.
func (s *StorageState) DistinctItems() int {
	return distinctItems(s.Inventory, s.InputBuffer, s.OutputBuffer)
}

// OutputBufferSpace returns the free room in the output buffer.
func (s *StorageState) OutputBufferSpace() int {
	if s == nil {
		return 0
	}
	return max(0, s.OutputBufferCapacity()-s.UsedOutputBuffer())
}

// InputBufferSpace returns the free room in the input buffer.
func (s *StorageState) InputBufferSpace() int {
	if s == nil {
		return 0
	}
	return max(0, s.InputBufferCapacity()-s.UsedInputBuffer())
}

// ReservedSpace returns the free room inside the production output reserve.
// 预留段是主库存顶端 Reserve 个槽位：总空位先算给预留段（与 AvailableInventory
// 互补——两者之和恒等于主库存空位总数）。
func (s *StorageState) ReservedSpace() int {
	if s == nil || s.Reserve <= 0 || s.Capacity <= 0 {
		return 0
	}
	return min(s.Reserve, max(0, s.Capacity-s.UsedInventory()))
}

// Receive accepts incoming material (belt/sorter/pipe) into the input path.
// 输入路径 = 输入缓冲优先，其次是主库存的「容量 − 预留」段；成品不走这里
// （见 StoreProduct）。
func (s *StorageState) Receive(itemID string, qty int) (int, int, error) {
	return s.receive(itemID, qty, false)
}

// Load stores player-delivered material directly into local storage so it can
// be consumed immediately by building logic such as production or launch.
// 与 Receive 同属输入路径，只是先填主库存（玩家装入希望在「本地存储」立刻看到）。
func (s *StorageState) Load(itemID string, qty int) (int, int, error) {
	return s.receive(itemID, qty, true)
}

// receive 是 Receive（输入缓冲优先）与 Load（主库存优先）的共用实现。
// 两者的主库存可用量都必须扣掉产出预留（见 StorageState.Reserve）。
func (s *StorageState) receive(itemID string, qty int, inventoryFirst bool) (int, int, error) {
	if s == nil {
		return 0, qty, fmt.Errorf("缺少存储")
	}
	if err := validateItemQuantity(itemID, qty); err != nil {
		return 0, qty, err
	}
	if !s.canAcceptNewItem(itemID) {
		return 0, qty, nil
	}

	accepted := 0
	remaining := qty
	fillInventory := func() {
		if remaining <= 0 {
			return
		}
		available := s.availableInventory()
		if available <= 0 {
			return
		}
		take := min(available, remaining)
		if take > 0 {
			addToInventory(s.EnsureInventory(), itemID, take)
			accepted += take
			remaining -= take
		}
	}
	fillInputBuffer := func() {
		if remaining <= 0 {
			return
		}
		available := s.InputBufferCapacity() - s.UsedInputBuffer()
		if available <= 0 {
			return
		}
		take := min(available, remaining)
		if take > 0 {
			addToInventory(s.EnsureInputBuffer(), itemID, take)
			accepted += take
			remaining -= take
		}
	}
	if inventoryFirst {
		fillInventory()
		fillInputBuffer()
	} else {
		fillInputBuffer()
		fillInventory()
	}

	return accepted, remaining, nil
}

// StoreProduct deposits finished products on the output path: the output buffer
// first, then the production output reserve in the main inventory.
// 成品与原料走两条互不挤占的通道：
//   - 原料（Receive / Load / PreviewReceive / FlushInput）只填输入缓冲与主库存的
//     「容量 − 预留」段，永远不越预留线；
//   - 成品只填输出缓冲与主库存的**产出预留段**，绝不进输入缓冲。
//
// 旧实现用 Receive 落成品：成品挤进输入缓冲、把输入缓冲占满，原料与成品互相
// 卡死（试玩 1015：熔炉表面 running、每 tick storeProductionOutputs 失败）。
func (s *StorageState) StoreProduct(itemID string, qty int) (int, int, error) {
	if s == nil {
		return 0, qty, fmt.Errorf("缺少存储")
	}
	if err := validateItemQuantity(itemID, qty); err != nil {
		return 0, qty, err
	}
	if !s.canAcceptNewItem(itemID) {
		return 0, qty, nil
	}

	accepted := 0
	remaining := qty
	if remaining > 0 {
		available := max(0, s.OutputBufferCapacity()-s.UsedOutputBuffer())
		if take := min(available, remaining); take > 0 {
			addToInventory(s.EnsureOutputBuffer(), itemID, take)
			accepted += take
			remaining -= take
		}
	}
	if remaining > 0 {
		if take := min(s.ReservedSpace(), remaining); take > 0 {
			addToInventory(s.EnsureInventory(), itemID, take)
			accepted += take
			remaining -= take
		}
	}
	return accepted, remaining, nil
}

// StoreCollectorProduct deposits collector output. 采集建筑没有配方、也没有产出
// 预留：它的主库存本来就是出货缓冲（settleStorage 每 tick 把主库存搬进输出缓冲，
// 「满仓阻塞」告警也据此判定），所以产物可以占满主库存、不受预留约束。
// 落点仍是「输出缓冲 → 主库存」，与生产建筑的 StoreProduct 同一顺序。
func (s *StorageState) StoreCollectorProduct(itemID string, qty int) (int, int, error) {
	return s.storeProductInInventory(itemID, qty, s.availableInventorySpace())
}

// PreviewStoreProduct calculates how many products would be accepted without
// mutating state (same landing path as StoreProduct).
func (s *StorageState) PreviewStoreProduct(itemID string, qty int) (int, int, error) {
	if s == nil {
		return 0, qty, fmt.Errorf("缺少存储")
	}
	if err := validateItemQuantity(itemID, qty); err != nil {
		return 0, qty, err
	}
	if !s.canAcceptNewItem(itemID) {
		return 0, qty, nil
	}
	accepted := min(qty, max(0, s.OutputBufferCapacity()-s.UsedOutputBuffer()))
	if remaining := qty - accepted; remaining > 0 {
		accepted += min(remaining, s.ReservedSpace())
	}
	return accepted, qty - accepted, nil
}

// storeProductInInventory 是产出的共用落货实现：输出缓冲 → 主库存（inventoryRoom
// 由调用方给出：生产建筑用产出预留段，采集建筑用整个主库存）。
func (s *StorageState) storeProductInInventory(itemID string, qty, inventoryRoom int) (int, int, error) {
	if s == nil {
		return 0, qty, fmt.Errorf("缺少存储")
	}
	if err := validateItemQuantity(itemID, qty); err != nil {
		return 0, qty, err
	}
	if !s.canAcceptNewItem(itemID) {
		return 0, qty, nil
	}

	accepted := 0
	remaining := qty
	if remaining > 0 {
		available := max(0, s.OutputBufferCapacity()-s.UsedOutputBuffer())
		if take := min(available, remaining); take > 0 {
			addToInventory(s.EnsureOutputBuffer(), itemID, take)
			accepted += take
			remaining -= take
		}
	}
	if remaining > 0 {
		if take := min(inventoryRoom, remaining); take > 0 {
			addToInventory(s.EnsureInventory(), itemID, take)
			accepted += take
			remaining -= take
		}
	}
	return accepted, remaining, nil
}

// PreviewReceive calculates how many items would be accepted without mutating state.
func (s *StorageState) PreviewReceive(itemID string, qty int) (int, int, error) {
	if s == nil {
		return 0, qty, fmt.Errorf("缺少存储")
	}
	if err := validateItemQuantity(itemID, qty); err != nil {
		return 0, qty, err
	}
	if !s.canAcceptNewItem(itemID) {
		return 0, qty, nil
	}

	accepted := 0
	remaining := qty

	inCap := s.InputBufferCapacity()
	if inCap > 0 {
		available := inCap - s.UsedInputBuffer()
		if available > 0 {
			take := min(available, remaining)
			if take > 0 {
				accepted += take
				remaining -= take
			}
		}
	}

	if remaining > 0 {
		available := s.availableInventory()
		if available > 0 {
			take := min(available, remaining)
			if take > 0 {
				accepted += take
				remaining -= take
			}
		}
	}

	return accepted, remaining, nil
}

// ItemQuantity counts all owned stock, including items staged in IO buffers.
func (s *StorageState) ItemQuantity(itemID string) int {
	if s == nil {
		return 0
	}
	return s.Inventory[itemID] + s.InputBuffer[itemID] + s.OutputBuffer[itemID]
}

// OutputQuantity returns total quantity available for output for an item.
func (s *StorageState) OutputQuantity(itemID string) int {
	if s == nil || itemID == "" {
		return 0
	}
	total := 0
	if s.OutputBuffer != nil {
		if qty := s.OutputBuffer[itemID]; qty > 0 {
			total += qty
		}
	}
	if s.Inventory != nil {
		if qty := s.Inventory[itemID]; qty > 0 {
			total += qty
		}
	}
	return total
}

// OutputCandidates returns item ids available for output, preferring output buffer contents.
func (s *StorageState) OutputCandidates() []string {
	if s == nil {
		return nil
	}
	outputKeys := sortedItemKeys(s.OutputBuffer)
	invKeys := sortedItemKeys(s.Inventory)
	if len(outputKeys) == 0 {
		return invKeys
	}
	if len(invKeys) == 0 {
		return outputKeys
	}
	seen := make(map[string]struct{}, len(outputKeys))
	out := make([]string, 0, len(outputKeys)+len(invKeys))
	for _, id := range outputKeys {
		seen[id] = struct{}{}
		out = append(out, id)
	}
	for _, id := range invKeys {
		if _, ok := seen[id]; ok {
			continue
		}
		out = append(out, id)
	}
	return out
}

// Provide supplies items from output buffers/inventory and returns provided and remaining quantities.
func (s *StorageState) Provide(itemID string, qty int) (int, int, error) {
	if s == nil {
		return 0, qty, fmt.Errorf("缺少存储")
	}
	if err := validateItemQuantity(itemID, qty); err != nil {
		return 0, qty, err
	}

	provided := 0
	remaining := qty

	if remaining > 0 {
		take := removeFromInventory(s.OutputBuffer, itemID, remaining)
		provided += take
		remaining -= take
	}

	if remaining > 0 {
		take := removeFromInventory(s.Inventory, itemID, remaining)
		provided += take
		remaining -= take
	}

	return provided, remaining, nil
}

// Tick flushes input buffers and refills output buffers.
func (s *StorageState) Tick() {
	if s == nil {
		return
	}
	s.FlushInput()
	s.RefillOutput()
}

// FlushInput moves items from input buffer to main inventory. 主库存只填到
// 「容量 − 产出预留」，输入缓冲里超出预留的空位搬不动的部分留在原地等下一 tick。
func (s *StorageState) FlushInput() int {
	if s == nil {
		return 0
	}
	available := s.availableInventory()
	if available <= 0 {
		return 0
	}
	return moveUpTo(s.InputBuffer, s.EnsureInventory(), available)
}

// RefillOutput moves items from inventory into output buffer.
func (s *StorageState) RefillOutput() int {
	if s == nil {
		return 0
	}
	outCap := s.OutputBufferCapacity()
	if outCap <= 0 {
		return 0
	}
	available := outCap - s.UsedOutputBuffer()
	if available <= 0 {
		return 0
	}
	return moveUpTo(s.Inventory, s.EnsureOutputBuffer(), available)
}

// InputPriorityValue returns normalized input priority.
func (s *StorageState) InputPriorityValue() int {
	input, _ := normalizePriority(s.Priority.Input, s.Priority.Output)
	return input
}

// OutputPriorityValue returns normalized output priority.
func (s *StorageState) OutputPriorityValue() int {
	_, output := normalizePriority(s.Priority.Input, s.Priority.Output)
	return output
}

func (s *StorageState) normalize() {
	if s.Capacity < 0 {
		s.Capacity = 0
	}
	if s.Slots < 0 {
		s.Slots = 0
	}
	if s.BufferCapacity < 0 {
		s.BufferCapacity = 0
	}
	if s.Priority.Input < 0 {
		s.Priority.Input = 0
	}
	if s.Priority.Output < 0 {
		s.Priority.Output = 0
	}
	if s.Priority.Input == 0 && s.Priority.Output == 0 {
		s.Priority.Input = 1
		s.Priority.Output = 1
	}
}

func (s *StorageState) bufferCaps() (int, int) {
	if s == nil || s.BufferCapacity <= 0 {
		return 0, 0
	}
	input, output := normalizePriority(s.Priority.Input, s.Priority.Output)
	total := input + output
	if total <= 0 {
		return 0, 0
	}
	inCap := s.BufferCapacity * input / total
	outCap := s.BufferCapacity - inCap
	if inCap == 0 && input > 0 && s.BufferCapacity > 0 {
		inCap = 1
		outCap = s.BufferCapacity - inCap
	}
	if outCap == 0 && output > 0 && s.BufferCapacity > 0 {
		outCap = 1
		inCap = s.BufferCapacity - outCap
		if inCap < 0 {
			inCap = 0
		}
	}
	return inCap, outCap
}

// SetReserve 写入产出预留（调用方负责夹取到 [0, Capacity]）。
func (s *StorageState) SetReserve(reserve int) {
	if s == nil {
		return
	}
	if reserve < 0 {
		reserve = 0
	}
	if reserve > s.Capacity {
		reserve = s.Capacity
	}
	s.Reserve = reserve
}

// SyncStorageReserve 按建筑当前配方写入「产出预留」：主库存里必须留出的空位数，
// 等于该配方一批产出的总量（不含增产模式加成——没有任何命令能切换 Mode，加成
// 只在目录配置里存在）。没有配方（含研究模式的研究站、采集建筑）时预留归零。
//
// 不变量：预留 ≤ 主库存容量。批产出大于容量的配方（分馏塔无存储模块，走独立结算）
// 退化为预留整个容量，由产出结算走输出缓冲 + 输入缓冲落货。
func (s *StorageState) SyncStorageReserve(batch int) {
	if s == nil {
		return
	}
	if batch > s.Capacity {
		batch = s.Capacity
	}
	s.SetReserve(batch)
}

func (s *StorageState) availableInventory() int {
	if s == nil || s.Capacity <= 0 {
		return 0
	}
	room := s.Capacity - s.Reserve - s.UsedInventory()
	if room < 0 {
		return 0
	}
	return room
}

// availableInventorySpace 是主库存的空位总数（不含预留约束）：采集类产物的
// 落点用它（见 StoreCollectorProduct），输入路径用 availableInventory（扣掉预留）。
func (s *StorageState) availableInventorySpace() int {
	if s == nil || s.Capacity <= 0 {
		return 0
	}
	used := s.UsedInventory()
	if used >= s.Capacity {
		return 0
	}
	return s.Capacity - used
}

// AvailableInventory 是 availableInventory 的导出形式（装入回执判定「主库存是否
// 已到产出预留线」用，见 gamecore.transferLoadBlockReason）。
func (s *StorageState) AvailableInventory() int {
	return s.availableInventory()
}

func (s *StorageState) canAcceptNewItem(itemID string) bool {
	if s.Slots <= 0 {
		return true
	}
	if hasItemInInventories(itemID, s.Inventory, s.InputBuffer, s.OutputBuffer) {
		return true
	}
	return s.DistinctItems() < s.Slots
}

// CanAcceptNewItem 导出给装入回执（gamecore.transferLoadBlockReason）判定槽位。
func (s *StorageState) CanAcceptNewItem(itemID string) bool {
	return s.canAcceptNewItem(itemID)
}

func normalizePriority(input, output int) (int, int) {
	if input < 0 {
		input = 0
	}
	if output < 0 {
		output = 0
	}
	if input == 0 && output == 0 {
		input = 1
		output = 1
	}
	return input, output
}

func validateItemQuantity(itemID string, qty int) error {
	if qty <= 0 {
		return fmt.Errorf("数量必须为正数")
	}
	if _, ok := Item(itemID); !ok {
		return fmt.Errorf("未知物品：%s", itemID)
	}
	return nil
}

func inventoryQty(inv ItemInventory) int {
	if len(inv) == 0 {
		return 0
	}
	total := 0
	for _, qty := range inv {
		if qty > 0 {
			total += qty
		}
	}
	return total
}

func addToInventory(inv ItemInventory, itemID string, qty int) {
	if inv == nil || qty <= 0 {
		return
	}
	inv[itemID] += qty
}

func removeFromInventory(inv ItemInventory, itemID string, qty int) int {
	if inv == nil || qty <= 0 {
		return 0
	}
	current := inv[itemID]
	if current <= 0 {
		return 0
	}
	take := min(current, qty)
	current -= take
	if current <= 0 {
		delete(inv, itemID)
	} else {
		inv[itemID] = current
	}
	return take
}

func moveUpTo(src ItemInventory, dest ItemInventory, limit int) int {
	if src == nil || dest == nil || limit <= 0 {
		return 0
	}
	keys := sortedItemKeys(src)
	moved := 0
	for _, id := range keys {
		if moved >= limit {
			break
		}
		qty := src[id]
		if qty <= 0 {
			continue
		}
		take := min(limit-moved, qty)
		if take <= 0 {
			continue
		}
		dest[id] += take
		src[id] -= take
		if src[id] <= 0 {
			delete(src, id)
		}
		moved += take
	}
	return moved
}

func distinctItems(inventories ...ItemInventory) int {
	seen := make(map[string]struct{})
	for _, inv := range inventories {
		for id, qty := range inv {
			if qty <= 0 {
				continue
			}
			seen[id] = struct{}{}
		}
	}
	return len(seen)
}

func hasItemInInventories(itemID string, inventories ...ItemInventory) bool {
	if itemID == "" {
		return false
	}
	for _, inv := range inventories {
		if inv == nil {
			continue
		}
		if inv[itemID] > 0 {
			return true
		}
	}
	return false
}

func sortedItemKeys(inv ItemInventory) []string {
	if len(inv) == 0 {
		return nil
	}
	keys := make([]string, 0, len(inv))
	for id, qty := range inv {
		if qty > 0 {
			keys = append(keys, id)
		}
	}
	sort.Strings(keys)
	return keys
}

package gamecore

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"testing"

	"siliconworld/internal/model"
)

// 从零脚本化玩家的确定性：同一 seed、同一脚本，跑两次必须得到完全相同的
// 世界（状态摘要 + 逐实体状态 + 命令日志）。脚本里有大量「遍历 map 再下发命令」
// 的地方（背包堆料疏通、制造台喂料、按配方分组的机器列表），map 迭代顺序随机，
// 会让同一 tick 的命令顺序、进而世界状态每次不同——bot 回归与试玩报告里
// 「同一个 seed 两局不一样」的根因就在这里。
//
// 跑到 tick 6000（开局链走完：风机/电塔/矿机/熔炉/制造台/兵营/研究站都已落成，
// 期间会走到背包疏通、制造台喂料、兵营排产这些「遍历 map 再下发命令」的分支）。
// 两次运行约 25 秒，-short 下跳过（与 TestSkirmishFromZeroOpeningByTick6000
// 同为开局链验收，长测试由主代理合并前统一跑）。
// 两次运行都建独立的 GameCore/WorldState，不碰包级可变状态。
//
// 比较口径（为什么不能只看 digestRuntime）：
//   - digestRuntime 只有实体数/能量/资源总量这类粗摘要，内部状态（生产进度、
//     库存、施工剩余）分叉了也看不出来；
//   - 命令日志只记录走 core.queue 的命令，脚本里大量 execCommand 直调
//     handler（挖矿/手搓/送料），这些命令不进日志——只比命令日志等于对
//     「脚本自己发的命令」失明。
//
// 所以这里再加一份 stateFingerprint：按实体 ID 排序逐实体 JSON 序列化
// （建筑/单位/玩家/施工/黑雾），覆盖真正影响后续结算的全部字段。

func TestSkirmishFromZeroScriptedDeterminism(t *testing.T) {
	if testing.Short() {
		t.Skip("脚本开局确定性（两次 6000 tick，约 25 秒）")
	}
	const ticks = 6000
	first := runZeroOpeningDeterminismRun(t, ticks)
	second := runZeroOpeningDeterminismRun(t, ticks)
	if first != second {
		t.Fatalf("同一 seed 两次脚本开局不一致：\n first=%s\nsecond=%s", first, second)
	}
	if first == "" {
		t.Fatal("状态摘要为空")
	}
}

// runZeroOpeningDeterminismRun 跑一次脚本开局并返回「状态 + 逐实体状态 + 命令日志」摘要。
func runZeroOpeningDeterminismRun(t *testing.T, ticks int64) string {
	t.Helper()
	core := newSkirmishCoreForSeed(t, "skirmish-seed-001")
	core.cfg.Battlefield.VictoryRule = model.VictoryRuleSandbox
	op := newZeroOpening(t, core, ticks)
	op.run()

	type runDigest struct {
		Tick      int64            `json:"tick"`
		Digest    string           `json:"digest"`
		State     string           `json:"state"`
		Milestone map[string]int64 `json:"milestone"`
		Buildings int              `json:"buildings"`
		Units     int              `json:"units"`
		Commands  []string         `json:"commands"`
	}
	digest := digestRuntime(op.ws, core.spaceRuntime)
	out := runDigest{
		Tick:      op.ws.Tick,
		Digest:    digest.Hash,
		State:     stateFingerprint(op.ws),
		Milestone: op.milestone,
		Buildings: len(op.ws.Buildings),
		Units:     len(op.ws.Units),
	}
	// 命令日志只取「哪一 tick、谁、什么命令」，不取回执文案（回执里可能带
	// 随机/时间相关内容）；脚本与 bot 的命令顺序完全由决策逻辑决定。
	// 注意：execCommand 直调的命令不经过队列，不在日志里（见文件头）。
	for _, entry := range core.GetCommandLog().All() {
		for _, cmd := range entry.Commands {
			payload, _ := json.Marshal(cmd.Payload)
			out.Commands = append(out.Commands, string(cmd.Type)+"|"+cmd.Target.EntityID+"|"+string(payload))
		}
	}
	raw, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("marshal digest: %v", err)
	}
	return string(raw)
}

// stateFingerprint 按 ID 排序逐实体序列化世界状态，返回 sha256。
//
// 覆盖建筑（含生产进度/库存/分拣器/传送带/单位队列/作业）、单位（含机甲/
// 运输）、玩家（库存/科技/执行体）、施工队列、黑雾实体。资源节点只算总量
// （全图数万个节点逐条序列化太慢，且总量分叉已经能定位到问题）。
func stateFingerprint(ws *model.WorldState) string {
	if ws == nil {
		return ""
	}
	h := sha256.New()
	writeJSON := func(tag, id string, value any) {
		raw, err := json.Marshal(value)
		if err != nil {
			return
		}
		h.Write([]byte(tag))
		h.Write([]byte(id))
		h.Write([]byte{0})
		h.Write(raw)
		h.Write([]byte{'\n'})
	}

	buildingIDs := make([]string, 0, len(ws.Buildings))
	for id := range ws.Buildings {
		buildingIDs = append(buildingIDs, id)
	}
	sort.Strings(buildingIDs)
	for _, id := range buildingIDs {
		writeJSON("b", id, ws.Buildings[id])
	}
	unitIDs := make([]string, 0, len(ws.Units))
	for id := range ws.Units {
		unitIDs = append(unitIDs, id)
	}
	sort.Strings(unitIDs)
	for _, id := range unitIDs {
		writeJSON("u", id, ws.Units[id])
	}
	playerIDs := make([]string, 0, len(ws.Players))
	for id := range ws.Players {
		playerIDs = append(playerIDs, id)
	}
	sort.Strings(playerIDs)
	for _, id := range playerIDs {
		writeJSON("p", id, ws.Players[id])
	}
	if ws.Construction != nil {
		writeJSON("c", "", ws.Construction)
	}
	if ws.EnemyForces != nil {
		writeJSON("e", "", ws.EnemyForces)
	}
	resourceIDs := make([]string, 0, len(ws.Resources))
	for id := range ws.Resources {
		resourceIDs = append(resourceIDs, id)
	}
	sort.Strings(resourceIDs)
	for _, id := range resourceIDs {
		node := ws.Resources[id]
		if node == nil {
			continue
		}
		h.Write([]byte("r"))
		h.Write([]byte(id))
		h.Write([]byte{0})
		var buf [16]byte
		buf[0] = byte(node.Remaining)
		buf[1] = byte(node.Remaining >> 8)
		buf[2] = byte(node.Remaining >> 16)
		buf[3] = byte(node.Remaining >> 24)
		buf[4] = byte(node.Remaining >> 32)
		buf[5] = byte(node.Remaining >> 40)
		buf[6] = byte(node.Remaining >> 48)
		buf[7] = byte(node.Remaining >> 56)
		h.Write(buf[:8])
		h.Write([]byte{'\n'})
	}
	return hex.EncodeToString(h.Sum(nil))
}

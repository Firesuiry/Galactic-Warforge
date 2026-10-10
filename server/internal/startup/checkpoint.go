package startup

import (
	"fmt"
	"time"

	"siliconworld/internal/checkpoint"
	"siliconworld/internal/config"
	"siliconworld/internal/gamedir"
)

// SaveCheckpointRequest 是 POST /checkpoints 的请求体。
type SaveCheckpointRequest struct {
	Name     string              `json:"name"`
	Note     string              `json:"note,omitempty"`
	Contract checkpoint.Contract `json:"contract,omitempty"`
	Replace  bool                `json:"replace,omitempty"`
}

// LoadCheckpointResult 是 POST /checkpoints/{name}/load 的结果：
// 读档后的当前对局概要 + 存档点 manifest + stale 警告。
type LoadCheckpointResult struct {
	Manifest checkpoint.Manifest `json:"manifest"`
	Warnings []string            `json:"warnings"`
	Game     GameSummary         `json:"game"`
}

// Checkpoints 返回存档点存储（未配置 checkpoint_dir 时处于禁用状态）。
func (rt *Runtime) Checkpoints() *checkpoint.Store {
	if rt == nil {
		return checkpoint.Open("")
	}
	return rt.checkpoints
}

// SourceCheckpoint 返回当前对局的来源存档点名：新局与启动新建为空。
func (rt *Runtime) SourceCheckpoint() string {
	if rt == nil {
		return ""
	}
	rt.resetMu.Lock()
	defer rt.resetMu.Unlock()
	return rt.sourceCheckpoint
}

// SaveCheckpoint 把当前对局固化成命名存档点。
//
// regression 存档点的契约必须逐条通过，否则不写盘并返回 ErrContractFailed
// （响应里带逐条结果）；bug 存档点只记录评估结果。
func (rt *Runtime) SaveCheckpoint(req SaveCheckpointRequest) (*checkpoint.Summary, error) {
	if rt == nil {
		return nil, fmt.Errorf("runtime is nil")
	}
	rt.resetMu.Lock()
	defer rt.resetMu.Unlock()

	store := rt.checkpoints
	if !store.Enabled() {
		return nil, checkpoint.ErrDisabled
	}
	if err := checkpoint.ValidateName(req.Name); err != nil {
		return nil, err
	}
	sess := rt.current.Load()
	if sess == nil || sess.Core == nil {
		return nil, fmt.Errorf("no active game session")
	}

	kind := checkpoint.KindOf(req.Name)
	report := sess.Core.EvaluateContract(req.Contract)
	if kind == checkpoint.KindRegression && !report.Passed {
		return nil, fmt.Errorf("%w: %s", checkpoint.ErrContractFailed, contractFailures(report))
	}

	save, err := sess.Core.ExportSaveFile("checkpoint:" + req.Name)
	if err != nil {
		return nil, err
	}
	meta := sess.checkpointMeta(rt)
	commit, dirty := checkpoint.BuildInfo()
	manifest := &checkpoint.Manifest{
		FormatVersion:  checkpoint.FormatVersion,
		Name:           req.Name,
		Kind:           kind,
		Parent:         rt.sourceCheckpoint,
		Tick:           save.Tick,
		MapSeed:        sess.Config.Battlefield.MapSeed,
		Players:        manifestPlayers(sess.Config),
		Commit:         commit,
		Dirty:          dirty,
		CreatedAt:      time.Now().UTC(),
		Note:           req.Note,
		Contract:       req.Contract,
		ContractReport: report,
	}
	if err := store.Write(req.Name, meta, save, manifest, req.Replace); err != nil {
		return nil, err
	}
	return &checkpoint.Summary{Manifest: *manifest, Stale: checkpoint.IsStale(manifest)}, nil
}

// LoadCheckpoint 从命名存档点热加载：按存档内配置与地图拓扑组装新 Session，
// 写入 data_dir 作为当前局存档，原子替换当前对局（与 Reset 同样的互斥/autosave 处理）。
// 存档点目录只读，不被覆盖。stale 时返回警告但仍然加载。
func (rt *Runtime) LoadCheckpoint(name string) (*LoadCheckpointResult, error) {
	if rt == nil {
		return nil, fmt.Errorf("runtime is nil")
	}
	rt.resetMu.Lock()
	defer rt.resetMu.Unlock()

	store := rt.checkpoints
	if !store.Enabled() {
		return nil, checkpoint.ErrDisabled
	}
	manifest, _, _, err := store.Read(name)
	if err != nil {
		return nil, err
	}
	sess, err := rt.assembleFromSave(&config.Config{Server: rt.serverCfg}, gamedir.Open(store.Dir(name)), false)
	if err != nil {
		return nil, err
	}

	// 先停 autosave 并等待收尾，保证写当前局存档期间没有旧局落盘。
	rt.stopAutosaveLocked()
	if _, err := sess.Core.Save("checkpoint_load"); err != nil {
		rt.startAutosaveLocked(rt.current.Load())
		return nil, fmt.Errorf("checkpoint load save: %w", err)
	}

	old := rt.current.Swap(sess)
	old.shutdown()
	rt.sourceCheckpoint = name
	if rt.started {
		rt.startSessionLocked(sess)
	}

	warnings := make([]string, 0, 1)
	if warning := checkpoint.StaleWarning(name, manifest); warning != "" {
		warnings = append(warnings, warning)
	}
	return &LoadCheckpointResult{Manifest: *manifest, Warnings: warnings, Game: sess.Summary()}, nil
}

// ListCheckpoints 列出全部存档点（含 stale 标记）。
func (rt *Runtime) ListCheckpoints() ([]checkpoint.Summary, error) {
	if rt == nil {
		return nil, fmt.Errorf("runtime is nil")
	}
	return rt.checkpoints.List()
}

// checkpointMeta 取写存档点用的 meta：复制一份，避免写只读来源时改动当前局的
// meta 指纹（当前局的 meta 由 core 的存档路径维护）。
func (sess *Session) checkpointMeta(rt *Runtime) *gamedir.MetaFile {
	if sess == nil {
		return nil
	}
	if sess.Meta != nil {
		cp := *sess.Meta
		cp.GameplayConfig.Players = append([]config.PlayerConfig(nil), sess.Meta.GameplayConfig.Players...)
		return &cp
	}
	mapCfg := rt.mapCfg
	return gamedir.NewMetaFile(sess.Config, mapCfg)
}

func manifestPlayers(cfg *config.Config) []checkpoint.Player {
	if cfg == nil {
		return nil
	}
	out := make([]checkpoint.Player, 0, len(cfg.Players))
	for _, player := range cfg.Players {
		out = append(out, checkpoint.Player{PlayerID: player.PlayerID, Role: player.Role, Key: player.Key})
	}
	return out
}

func contractFailures(report checkpoint.ContractReport) string {
	msg := ""
	for _, result := range report.Results {
		if result.Passed {
			continue
		}
		if msg != "" {
			msg += "; "
		}
		msg += fmt.Sprintf("%s 实际=%s", result.Check.Kind, result.Actual)
		if result.Detail != "" {
			msg += "（" + result.Detail + "）"
		}
	}
	if msg == "" {
		msg = "契约未通过"
	}
	return msg
}

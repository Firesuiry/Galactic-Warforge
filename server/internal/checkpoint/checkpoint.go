// Package checkpoint 实现命名存档点：把一局对局固化成 <checkpoint_dir>/<name>/
// 下的 meta.json + save.json + manifest.json，供试玩测试从某个进度反复读档。
//
// 存档点目录只读（读取路径不做 meta 自愈写回），当前局的 data_dir 才是可写的活动存档。
package checkpoint

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"sort"
	"strings"
	"time"

	"siliconworld/internal/gamedir"
)

// FormatVersion 是 manifest.json 的结构版本。
const FormatVersion = 1

// KindRegression 要求契约全过才允许创建；KindBug 只记录契约结果。
const (
	KindRegression = "regression"
	KindBug        = "bug"
)

// BugPrefix 名字以此开头即视为 bug 存档点。
const BugPrefix = "bug-"

var (
	// ErrDisabled 未配置 checkpoint_dir。
	ErrDisabled = errors.New("server.checkpoint_dir 未配置，存档点功能不可用")
	// ErrExists 同名存档点已存在且未要求覆盖。
	ErrExists = errors.New("同名存档点已存在（加 replace 才覆盖）")
	// ErrNotFound 存档点不存在。
	ErrNotFound = errors.New("存档点不存在")
	// ErrContractFailed regression 存档点的契约未全部通过。
	ErrContractFailed = errors.New("契约未通过，拒绝创建 regression 存档点")
)

var namePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

// ValidateName 校验存档点名：小写字母/数字/连字符，首位非连字符，长度 1–64。
func ValidateName(name string) error {
	if !namePattern.MatchString(name) {
		return fmt.Errorf("存档点名必须匹配 [a-z0-9][a-z0-9-]{0,63}，实际为 %q", name)
	}
	return nil
}

// KindOf 由名字推断存档点类型：bug- 开头为 bug，其余为 regression。
func KindOf(name string) string {
	if strings.HasPrefix(name, BugPrefix) {
		return KindBug
	}
	return KindRegression
}

// Player 是 manifest 里记录的玩家身份（含登录 key，测试员用它登录）。
type Player struct {
	PlayerID string `json:"player_id"`
	Role     string `json:"role"`
	Key      string `json:"key"`
}

// Manifest 是存档点自描述：来源、时间、构建信息与状态契约评估结果。
type Manifest struct {
	FormatVersion int       `json:"format_version"`
	Name          string    `json:"name"`
	Kind          string    `json:"kind"`
	Parent        string    `json:"parent,omitempty"`
	Tick          int64     `json:"tick"`
	MapSeed       string    `json:"map_seed"`
	Players       []Player  `json:"players"`
	Commit        string    `json:"commit,omitempty"`
	Dirty         bool      `json:"dirty"`
	CreatedAt     time.Time `json:"created_at"`
	Note          string    `json:"note,omitempty"`
	Contract      Contract  `json:"contract"`
	// ContractReport 是创建瞬间对当前世界评估契约的结果（bug 存档点未通过也照记）。
	ContractReport ContractReport `json:"contract_report"`
}

// Summary 是列表条目：manifest 摘要 + 相对当前二进制的 stale 标记。
type Summary struct {
	Manifest
	Stale bool `json:"stale"`
	// Error 非空表示该目录里的 manifest 无法读取（列表仍返回其余存档点）。
	Error string `json:"error,omitempty"`
}

// BuildInfo 读取当前二进制的 VCS 信息（go build 默认写入，无需 ldflags）。
func BuildInfo() (commit string, dirty bool) {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "", false
	}
	for _, setting := range info.Settings {
		switch setting.Key {
		case "vcs.revision":
			commit = setting.Value
		case "vcs.modified":
			dirty = setting.Value == "true"
		}
	}
	return commit, dirty
}

// IsStale 报告存档点是否来自另一份（或脏的）二进制：commit 不同或任一方 dirty。
func IsStale(m *Manifest) bool {
	if m == nil {
		return false
	}
	commit, dirty := BuildInfo()
	if dirty || m.Dirty {
		return true
	}
	return m.Commit != "" && m.Commit != commit
}

// StaleWarning 是 stale 时返回给人看的警告文本。
func StaleWarning(name string, m *Manifest) string {
	if !IsStale(m) {
		return ""
	}
	commit, dirty := BuildInfo()
	if commit != "" && commit == m.Commit {
		return fmt.Sprintf("存档点 %s 与当前服务端同为 commit=%s，但有未提交改动（dirty），读档结果可能与创建时不同", name, commit)
	}
	now := commit
	if now == "" {
		now = "(unknown)"
	} else if dirty {
		now += " (dirty)"
	}
	was := m.Commit
	if was == "" {
		was = "(unknown)"
	} else if m.Dirty {
		was += " (dirty)"
	}
	return fmt.Sprintf("存档点 %s 由另一份构建创建（存档点 commit=%s，当前 commit=%s），读档结果可能与创建时不同", name, was, now)
}

// Store 是存档点根目录。
type Store struct {
	root string
}

// Open 打开存档点根目录；root 为空时返回的 Store 处于禁用状态。
func Open(root string) *Store {
	return &Store{root: strings.TrimSpace(root)}
}

// Enabled 报告是否配置了 checkpoint_dir。
func (s *Store) Enabled() bool {
	return s != nil && s.root != ""
}

// Root 返回存档点根目录（未配置时为空）。
func (s *Store) Root() string {
	if s == nil {
		return ""
	}
	return s.root
}

// Dir 返回某个存档点的目录（不校验存在性）。
func (s *Store) Dir(name string) string {
	return filepath.Join(s.root, name)
}

// List 列出全部存档点（按名字排序）。读不出 manifest 的目录以 Error 字段呈现。
func (s *Store) List() ([]Summary, error) {
	if !s.Enabled() {
		return nil, ErrDisabled
	}
	entries, err := os.ReadDir(s.root)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []Summary{}, nil
		}
		return nil, fmt.Errorf("读取存档点目录: %w", err)
	}
	out := make([]Summary, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		manifest, err := s.readManifest(entry.Name())
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue // 不是存档点目录
			}
			out = append(out, Summary{Manifest: Manifest{Name: entry.Name()}, Error: err.Error()})
			continue
		}
		out = append(out, Summary{Manifest: *manifest, Stale: IsStale(manifest)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// Read 读取一个存档点的 manifest 与只读的 meta/save。
// 读取路径不写回存档点目录（LoadReadOnly 跳过 meta 自愈）。
func (s *Store) Read(name string) (*Manifest, *gamedir.MetaFile, *gamedir.SaveFile, error) {
	if !s.Enabled() {
		return nil, nil, nil, ErrDisabled
	}
	if err := ValidateName(name); err != nil {
		return nil, nil, nil, err
	}
	manifest, err := s.readManifest(name)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil, nil, fmt.Errorf("%w: %s", ErrNotFound, name)
		}
		return nil, nil, nil, err
	}
	meta, save, err := gamedir.Open(s.Dir(name)).LoadReadOnly()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("读取存档点 %s: %w", name, err)
	}
	return manifest, meta, save, nil
}

// Write 写入一个存档点；同名已存在且未要求覆盖时返回 ErrExists。
func (s *Store) Write(name string, meta *gamedir.MetaFile, save *gamedir.SaveFile, manifest *Manifest, replace bool) error {
	if !s.Enabled() {
		return ErrDisabled
	}
	if err := ValidateName(name); err != nil {
		return err
	}
	dir := s.Dir(name)
	_, statErr := os.Stat(dir)
	exists := statErr == nil
	if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
		return fmt.Errorf("检查存档点目录: %w", statErr)
	}
	if exists && !replace {
		return fmt.Errorf("%w: %s", ErrExists, name)
	}
	// 先在同级临时目录写全三份文件，再 rename 换上：覆盖中途失败不会留下半个存档点。
	// 临时目录以 "." 开头，不满足存档点命名规则，List 会因缺 manifest 跳过它。
	if err := os.MkdirAll(s.root, 0o755); err != nil {
		return fmt.Errorf("创建存档点根目录: %w", err)
	}
	tmp, err := os.MkdirTemp(s.root, "."+name+".tmp-")
	if err != nil {
		return fmt.Errorf("创建存档点临时目录: %w", err)
	}
	defer os.RemoveAll(tmp)
	if err := gamedir.Open(tmp).WriteInitial(meta, save); err != nil {
		return fmt.Errorf("写入存档点 %s: %w", name, err)
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化 manifest: %w", err)
	}
	if err := os.WriteFile(filepath.Join(tmp, "manifest.json"), append(data, '\n'), 0o644); err != nil {
		return fmt.Errorf("写入 manifest.json: %w", err)
	}
	if exists {
		old := tmp + ".old"
		if err := os.Rename(dir, old); err != nil {
			return fmt.Errorf("覆盖存档点 %s: %w", name, err)
		}
		defer os.RemoveAll(old)
	}
	if err := os.Rename(tmp, dir); err != nil {
		return fmt.Errorf("落盘存档点 %s: %w", name, err)
	}
	return nil
}

func (s *Store) readManifest(name string) (*Manifest, error) {
	data, err := os.ReadFile(filepath.Join(s.Dir(name), "manifest.json"))
	if err != nil {
		return nil, err
	}
	manifest := &Manifest{}
	if err := json.Unmarshal(data, manifest); err != nil {
		return nil, fmt.Errorf("解析 %s/manifest.json: %w", name, err)
	}
	if manifest.Name == "" {
		manifest.Name = name
	}
	return manifest, nil
}

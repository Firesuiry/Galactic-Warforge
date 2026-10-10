package gateway

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"siliconworld/internal/checkpoint"
	"siliconworld/internal/startup"
)

// handleCheckpointList handles GET /checkpoints：任意登录玩家可查。
// 每条带 stale 标记（commit 与当前二进制不同，或任一方 dirty）。
func (s *Server) handleCheckpointList(w http.ResponseWriter, r *http.Request, playerID string) {
	items, err := s.rt.ListCheckpoints()
	if err != nil {
		writeCheckpointError(w, err)
		return
	}
	if items == nil {
		items = []checkpoint.Summary{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"checkpoint_dir": s.rt.ServerConfig().CheckpointDir,
		"source":         s.rt.SourceCheckpoint(),
		"checkpoints":    items,
	})
}

// handleCheckpointSave handles POST /checkpoints（仅 admin）：把当前对局存成命名存档点。
// regression 存档点的契约未全过时返回 400 与逐条结果；bug 存档点只记录结果。
func (s *Server) handleCheckpointSave(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	if !s.requireAdminRole(w, sess, playerID) {
		return
	}
	var req startup.SaveCheckpointRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid request body: %v", err))
		return
	}
	summary, err := s.rt.SaveCheckpoint(req)
	if err != nil {
		writeCheckpointError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, summary)
}

// handleCheckpointLoad handles POST /checkpoints/{name}/load（仅 admin）：热加载存档点。
func (s *Server) handleCheckpointLoad(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	if !s.requireAdminRole(w, sess, playerID) {
		return
	}
	result, err := s.rt.LoadCheckpoint(r.PathValue("name"))
	if err != nil {
		writeCheckpointError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// writeCheckpointError 把存档点错误映射为明确的状态码：
// 未配置 checkpoint_dir → 503；契约未通过 → 400（附逐条结果）；同名已存在 → 409。
func writeCheckpointError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, checkpoint.ErrDisabled):
		writeError(w, http.StatusServiceUnavailable, err.Error())
	case errors.Is(err, checkpoint.ErrContractFailed):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, checkpoint.ErrExists):
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, checkpoint.ErrNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	default:
		writeError(w, http.StatusBadRequest, err.Error())
	}
}

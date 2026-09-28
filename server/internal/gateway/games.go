package gateway

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"siliconworld/internal/startup"
)

// handleGameCurrent handles GET /games/current（F1）：任意登录玩家可查当前对局概要。
// 响应中的玩家列表绝不含登录 key。
func (s *Server) handleGameCurrent(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	writeJSON(w, http.StatusOK, sess.Summary())
}

// handleGameNew handles POST /games/new（F1 单局热重置）：仅 role=admin。
// 重建 GameCore（新队列、新事件总线、新世界状态），旧局状态全部清理并原子切换；
// SSE 订阅与旧局 key 立即失效，客户端需重新订阅 /events/stream 并重新拉取全量状态。
func (s *Server) handleGameNew(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	if !s.requireAdminRole(w, sess, playerID) {
		return
	}
	var req startup.NewGameRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid request body: %v", err))
		return
	}
	sess, err := s.rt.Reset(req)
	if err != nil {
		if errors.Is(err, startup.ErrInvalidNewGame) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, sess.Summary())
}

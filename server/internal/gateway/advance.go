package gateway

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"siliconworld/internal/gamecore"
	"siliconworld/internal/model"
	"siliconworld/internal/startup"
)

// 狂飙模式 / 快进（POST /admin/advance、POST /admin/advance/cancel）。
//
// 资格（两道门禁，顺序固定）：
//  1. 多人门禁：非 bot 玩家多于发起者一人时，只有 admin 能快进；否则 403 说明原因。
//     快进会一次性推进全局时间线，其他人类玩家没有任何叫停的机会，所以要挡。
//  2. admin 门禁：与 /save /rollback /games/new 同一口径（requireAdminRole）。
//
// 我方口径（under_attack）：发起者所属玩家；发起者不在本局玩家表里（纯 admin
// 账号）时退回「所有人类玩家」。
func (s *Server) handleAdvance(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	if !s.advanceMultiplayerAllowed(w, sess, playerID) {
		return
	}
	if !s.requireAdminRole(w, sess, playerID) {
		return
	}
	var req model.AdvanceRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid request body: %v", err))
		return
	}
	spec, err := advanceSpecFromRequest(req, sess.Core.CurrentTick())
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	owned := sess.Core.AdvanceOwnedTargets(s.advanceVictimPlayers(sess, playerID))
	result, err := sess.Core.Advance(spec, owned)
	if err != nil {
		if errors.Is(err, gamecore.ErrAdvanceInProgress) {
			writeError(w, http.StatusConflict, "已有快进在进行中")
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, model.AdvanceResponse{
		StartTick:     result.StartTick,
		EndTick:       result.EndTick,
		StoppedReason: result.StoppedReason,
		Detail:        result.Detail,
		ElapsedMS:     result.ElapsedMS,
		TicksPerSec:   result.TicksPerSec,
	})
}

// handleAdvanceCancel 取消进行中的快进；没有快进时返回 cancelled=false（不是错误，
// 客户端可能在上一次快进刚好结束时按下取消）。
func (s *Server) handleAdvanceCancel(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	if !s.requireAdminRole(w, sess, playerID) {
		return
	}
	writeJSON(w, http.StatusOK, model.AdvanceCancelResponse{
		Cancelled: sess.Core.CancelAdvance(),
	})
}

// advanceSpecFromRequest 校验并转换请求体：to_tick 与 ticks 二选一。
func advanceSpecFromRequest(req model.AdvanceRequest, currentTick int64) (gamecore.AdvanceSpec, error) {
	hasTo := req.ToTick != nil
	hasTicks := req.Ticks != nil
	if hasTo == hasTicks {
		return gamecore.AdvanceSpec{}, fmt.Errorf("to_tick 与 ticks 必须且只能给一个")
	}
	spec := gamecore.AdvanceSpec{StopOn: gamecore.DefaultAdvanceStopOn()}
	if hasTo {
		if *req.ToTick <= currentTick {
			return gamecore.AdvanceSpec{}, fmt.Errorf("to_tick 必须大于当前 tick %d", currentTick)
		}
		spec.ToTick = *req.ToTick
	} else {
		if *req.Ticks <= 0 {
			return gamecore.AdvanceSpec{}, fmt.Errorf("ticks 必须为正整数")
		}
		spec.Ticks = *req.Ticks
	}
	if req.StopOn != nil {
		if req.StopOn.GameOver != nil {
			spec.StopOn.GameOver = *req.StopOn.GameOver
		}
		if req.StopOn.UnderAttack != nil {
			spec.StopOn.UnderAttack = *req.StopOn.UnderAttack
		}
		if req.StopOn.CriticalAlert != nil {
			spec.StopOn.CriticalAlert = *req.StopOn.CriticalAlert
		}
	}
	return spec, nil
}

// advanceMultiplayerAllowed 多人门禁：非 bot 玩家多于发起者一人时只允许 admin。
func (s *Server) advanceMultiplayerAllowed(w http.ResponseWriter, sess *startup.Session, playerID string) bool {
	human := s.humanPlayers(sess)
	if len(human) <= 1 {
		return true
	}
	if s.playerRole(sess, playerID) == "admin" {
		return true
	}
	writeError(w, http.StatusForbidden, fmt.Sprintf(
		"多人对局不支持快进：本局有 %d 名非 bot 玩家（%s），只有 admin 可以快进",
		len(human), strings.Join(human, ", ")))
	return false
}

// advanceVictimPlayers 快进的「我方」玩家集合：发起者；发起者不在玩家表里
// （纯 admin 账号）时退回所有人类玩家。
func (s *Server) advanceVictimPlayers(sess *startup.Session, playerID string) map[string]struct{} {
	out := make(map[string]struct{}, 2)
	if s.playerExists(sess, playerID) {
		out[playerID] = struct{}{}
		return out
	}
	for _, id := range s.humanPlayers(sess) {
		out[id] = struct{}{}
	}
	return out
}

// humanPlayers 本局非 bot 玩家（按 id 排序；与 /games/current 的 players[].bot 同口径）。
func (s *Server) humanPlayers(sess *startup.Session) []string {
	if sess == nil || sess.Config == nil {
		return nil
	}
	out := make([]string, 0, len(sess.Config.Players))
	for _, pc := range sess.Config.Players {
		if pc.Bot != "" {
			continue
		}
		out = append(out, pc.PlayerID)
	}
	return out
}

func (s *Server) playerExists(sess *startup.Session, playerID string) bool {
	if sess == nil || sess.Config == nil {
		return false
	}
	for _, pc := range sess.Config.Players {
		if pc.PlayerID == playerID {
			return true
		}
	}
	return false
}

// playerRole 读玩家角色（与 requireAdminRole 同口径）。
func (s *Server) playerRole(sess *startup.Session, playerID string) string {
	if sess == nil || sess.Core == nil {
		return ""
	}
	ws := sess.Core.World()
	if ws == nil {
		return ""
	}
	ws.RLock()
	defer ws.RUnlock()
	if player := ws.Players[playerID]; player != nil {
		return player.Role
	}
	return ""
}

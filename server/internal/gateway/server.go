package gateway

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"siliconworld/internal/model"
	"siliconworld/internal/query"
	"siliconworld/internal/startup"
)

// rateLimiter is a simple per-player token bucket
type rateLimiter struct {
	mu         sync.Mutex
	tokens     map[string]int
	lastRefill map[string]time.Time
	limit      int // max tokens (commands/s)
}

func newRateLimiter(limit int) *rateLimiter {
	return &rateLimiter{
		tokens:     make(map[string]int),
		lastRefill: make(map[string]time.Time),
		limit:      limit,
	}
}

func (rl *rateLimiter) Allow(playerID string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	last, ok := rl.lastRefill[playerID]
	if !ok || now.Sub(last) >= time.Second {
		rl.tokens[playerID] = rl.limit
		rl.lastRefill[playerID] = now
	}

	if rl.tokens[playerID] <= 0 {
		return false
	}
	rl.tokens[playerID]--
	return true
}

// Server is the HTTP server wrapping game services.
// F1 热重置：Server 不再持有 core/bus/queue；所有 handler 通过 rt.Current()
// 取当前对局 Session 再访问其中的组件（一局内整体原子替换）。
type Server struct {
	rt *startup.Runtime
	rl *rateLimiter
}

// New creates and configures the HTTP server
func New(rt *startup.Runtime) *Server {
	return &Server{
		rt: rt,
		rl: newRateLimiter(rt.ServerConfig().RateLimit),
	}
}

// session 返回当前对局 session；nil 表示尚未 boot（不应发生）。
func (s *Server) session() *startup.Session {
	return s.rt.Current()
}

// requireSession 取当前对局；不可用时写 503 并返回 nil。
func (s *Server) requireSession(w http.ResponseWriter) *startup.Session {
	sess := s.rt.Current()
	if sess == nil {
		writeError(w, http.StatusServiceUnavailable, "no active game session")
		return nil
	}
	return sess
}

// Handler returns the root HTTP handler
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// Health check
	mux.HandleFunc("GET /health", s.handleHealth)

	// Metrics
	mux.HandleFunc("GET /metrics", s.handleMetrics)
	// Audit log query
	mux.HandleFunc("GET /audit", s.auth(s.handleAuditQuery))

	// World queries
	mux.HandleFunc("GET /state/summary", s.auth(s.handleStateSummary))
	mux.HandleFunc("GET /state/stats", s.auth(s.handleStateStats))
	mux.HandleFunc("GET /state/agent-briefing", s.auth(s.handleAgentBriefing))
	mux.HandleFunc("GET /world/galaxy", s.auth(s.handleGalaxy))
	mux.HandleFunc("GET /world/systems/{system_id}", s.auth(s.handleSystem))
	mux.HandleFunc("GET /world/systems/{system_id}/runtime", s.auth(s.handleSystemRuntime))
	mux.HandleFunc("GET /world/planets/{planet_id}", s.auth(s.handlePlanet))
	mux.HandleFunc("GET /world/planets/{planet_id}/overview", s.auth(s.handlePlanetOverview))
	mux.HandleFunc("GET /world/planets/{planet_id}/scene", s.auth(s.handlePlanetScene))
	mux.HandleFunc("GET /world/planets/{planet_id}/path", s.auth(s.handlePlanetPath))
	mux.HandleFunc("GET /world/planets/{planet_id}/inspect", s.auth(s.handlePlanetInspect))
	mux.HandleFunc("GET /world/planets/{planet_id}/runtime", s.auth(s.handlePlanetRuntime))
	mux.HandleFunc("GET /world/planets/{planet_id}/networks", s.auth(s.handlePlanetNetworks))
	mux.HandleFunc("GET /world/fleets", s.auth(s.handleFleets))
	mux.HandleFunc("GET /world/fleets/{fleet_id}", s.auth(s.handleFleet))
	mux.HandleFunc("GET /world/warfare/blueprints", s.auth(s.handleWarBlueprints))
	mux.HandleFunc("GET /world/warfare/blueprints/{blueprint_id}", s.auth(s.handleWarBlueprint))
	mux.HandleFunc("GET /world/warfare/industry", s.auth(s.handleWarIndustry))
	mux.HandleFunc("GET /world/warfare/task-forces", s.auth(s.handleWarTaskForces))
	mux.HandleFunc("GET /world/warfare/theaters", s.auth(s.handleWarTheaters))
	mux.HandleFunc("GET /catalog", s.auth(s.handleCatalog))
	mux.HandleFunc("GET /catalog/commands", s.auth(s.handleCommandCatalog))

	// Commands
	mux.HandleFunc("POST /commands", s.auth(s.handleCommands))
	mux.HandleFunc("POST /save", s.auth(s.handleSave))

	// Session management (F1 热重置)
	mux.HandleFunc("GET /games/current", s.auth(s.handleGameCurrent))
	mux.HandleFunc("POST /games/new", s.auth(s.handleGameNew))

	// SSE event stream
	mux.HandleFunc("GET /events/stream", s.auth(s.handleEventStream))
	// Event snapshot
	mux.HandleFunc("GET /events/snapshot", s.auth(s.handleEventSnapshot))
	// Production alert snapshot
	mux.HandleFunc("GET /alerts/production/snapshot", s.auth(s.handleProductionAlertSnapshot))
	// Replay control
	mux.HandleFunc("POST /replay", s.auth(s.handleReplay))
	// Rollback control
	mux.HandleFunc("POST /rollback", s.auth(s.handleRollback))

	return mux
}

// auth middleware extracts and validates the Bearer token.
// 键映射来自当前对局 Session（F1 热重置后旧局 key 立即失效）。
func (s *Server) auth(next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			writeError(w, http.StatusUnauthorized, "missing or invalid Authorization header")
			return
		}
		key := strings.TrimPrefix(authHeader, "Bearer ")
		sess := s.session()
		if sess == nil {
			writeError(w, http.StatusServiceUnavailable, "no active game session")
			return
		}
		playerID, ok := sess.KeyMap[key]
		if !ok {
			writeError(w, http.StatusUnauthorized, "invalid player key")
			return
		}
		next(w, r, playerID)
	}
}

// handleHealth returns a simple health response
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"tick":   sess.Core.CurrentTick(),
	})
}

// handleMetrics returns core runtime metrics
func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	m := sess.Core.GetMetrics()
	snapshot := m.Snapshot()
	if sess.Bus != nil {
		snapshot["dropped_events"] = sess.Bus.DroppedCount()
	}
	writeJSON(w, http.StatusOK, snapshot)
}

// handleStateSummary returns GET /state/summary
func (s *Server) handleStateSummary(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	ws := sess.Core.World()
	sum := sess.Query.Summary(ws, playerID, sess.Core.Victory())
	writeJSON(w, http.StatusOK, sum)
}

// handleStateStats returns GET /state/stats
func (s *Server) handleStateStats(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	ws := sess.Core.World()
	stats := sess.Query.Stats(ws, playerID)
	writeJSON(w, http.StatusOK, stats)
}

// handleAgentBriefing returns GET /state/agent-briefing — one-shot aggregate
// snapshot for agent/GUI bootstrap (self + war + fleets + alerts + commands).
func (s *Server) handleAgentBriefing(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	alertLimit := query.DefaultAgentBriefingAlertLimit
	if v := r.URL.Query().Get("alert_limit"); v != "" {
		parsed, err := strconv.Atoi(v)
		if err != nil || parsed <= 0 {
			writeError(w, http.StatusBadRequest, "alert_limit must be a positive integer")
			return
		}
		alertLimit = parsed
	}
	if max := sess.Config.Server.AlertHistoryLimit; max > 0 && alertLimit > max {
		alertLimit = max
	}

	ws := sess.Core.World()
	briefing := sess.Query.AgentBriefing(
		ws,
		playerID,
		sess.Core.Victory(),
		sess.Core.Worlds(),
		sess.Core.SpaceRuntime(),
		sess.Core.AlertHistory().All(),
		alertLimit,
	)
	writeJSON(w, http.StatusOK, briefing)
}

// handleGalaxy returns GET /world/galaxy
func (s *Server) handleGalaxy(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	writeJSON(w, http.StatusOK, sess.Query.Galaxy(playerID))
}

// handleSystem returns GET /world/systems/{system_id}
func (s *Server) handleSystem(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	systemID := r.PathValue("system_id")
	view, ok := sess.Query.System(playerID, systemID)
	if !ok {
		writeError(w, http.StatusNotFound, "system not found")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// handleSystemRuntime returns GET /world/systems/{system_id}/runtime
func (s *Server) handleSystemRuntime(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	systemID := r.PathValue("system_id")
	// F4：视图上的“活动行星”注释 = 调用玩家自己的焦点行星。
	focusPlanetID := sess.Core.FocusPlanetIDFor(playerID)
	view, ok := sess.Query.SystemRuntime(
		playerID,
		systemID,
		focusPlanetID,
		sess.Core.WorldForPlanet(focusPlanetID),
		sess.Core.SpaceRuntime(),
	)
	if !ok {
		writeError(w, http.StatusNotFound, "system not found")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// handlePlanet returns GET /world/planets/{planet_id}
func (s *Server) handlePlanet(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	planetID := r.PathValue("planet_id")
	ws := sess.Core.WorldForPlanet(planetID)
	view, ok := sess.Query.PlanetSummary(ws, playerID, planetID)
	if !ok {
		writeError(w, http.StatusNotFound, "planet not found")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// handlePlanetOverview returns GET /world/planets/{planet_id}/overview
func (s *Server) handlePlanetOverview(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	planetID := r.PathValue("planet_id")
	req := query.PlanetOverviewRequest{
		Step: parseQueryInt(r, "step", 0),
	}
	view, ok := sess.Query.PlanetOverview(sess.Core.WorldForPlanet(planetID), playerID, planetID, req)
	if !ok {
		writeError(w, http.StatusNotFound, "planet not found")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// handlePlanetScene returns GET /world/planets/{planet_id}/scene
func (s *Server) handlePlanetScene(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	planetID := r.PathValue("planet_id")
	req := query.PlanetSceneRequest{
		NearX: parseQueryInt(r, "near_x", -1), NearY: parseQueryInt(r, "near_y", -1), Radius: parseQueryInt(r, "radius", 0),
		X:      parseQueryInt(r, "x", 0),
		Y:      parseQueryInt(r, "y", 0),
		Width:  parseQueryInt(r, "width", 0),
		Height: parseQueryInt(r, "height", 0),
	}
	if req.Radius < 0 || req.Radius > 128 || (req.Radius > 0 && (req.NearX < 0 || req.NearY < 0)) {
		writeError(w, http.StatusBadRequest, "near_x/near_y must be valid atlas coordinates and radius must be 0..128")
		return
	}
	if req.Radius > 0 {
		planet, exists := sess.Core.Maps().Planet(planetID)
		if exists && (req.NearX >= planet.Width || req.NearY >= planet.Height) {
			writeError(w, http.StatusBadRequest, "near center outside atlas")
			return
		}
	}
	view, ok := sess.Query.PlanetScene(sess.Core.WorldForPlanet(planetID), playerID, planetID, req)
	if !ok {
		writeError(w, http.StatusNotFound, "planet not found")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

type planetInspectResponse struct {
	PlanetID   string                   `json:"planet_id"`
	Discovered bool                     `json:"discovered"`
	EntityKind string                   `json:"entity_kind,omitempty"`
	EntityID   string                   `json:"entity_id,omitempty"`
	Title      string                   `json:"title,omitempty"`
	Building   *model.Building          `json:"building,omitempty"`
	Unit       *model.Unit              `json:"unit,omitempty"`
	Resource   *model.ResourceNodeState `json:"resource,omitempty"`
}

// handlePlanetInspect returns GET /world/planets/{planet_id}/inspect
func (s *Server) handlePlanetInspect(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	planetID := r.PathValue("planet_id")
	q := r.URL.Query()
	entityKind := q.Get("entity_kind")
	if entityKind == "" {
		writeError(w, http.StatusBadRequest, "entity_kind is required")
		return
	}
	entityID := q.Get("entity_id")
	if entityID == "" {
		entityID = q.Get("sector_id")
	}
	if entityID == "" {
		writeError(w, http.StatusBadRequest, "entity_id or sector_id is required")
		return
	}

	ws := sess.Core.WorldForPlanet(planetID)
	view, ok := sess.Query.PlanetInspect(ws, playerID, planetID, query.PlanetInspectRequest{
		TargetType: entityKind,
		TargetID:   entityID,
	})
	if !ok {
		writeError(w, http.StatusNotFound, "target not found")
		return
	}

	writeJSON(w, http.StatusOK, planetInspectResponse{
		PlanetID:   view.PlanetID,
		Discovered: view.Discovered,
		EntityKind: entityKind,
		EntityID:   entityID,
		Title:      view.Title,
		Building:   view.Building,
		Unit:       view.Unit,
		Resource:   view.Resource,
	})
}

// handlePlanetRuntime returns GET /world/planets/{planet_id}/runtime
func (s *Server) handlePlanetRuntime(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	planetID := r.PathValue("planet_id")
	ws := sess.Core.WorldForPlanet(planetID)
	view, ok := sess.Query.PlanetRuntime(ws, playerID, planetID, sess.Core.FocusPlanetIDFor(playerID))
	if !ok {
		writeError(w, http.StatusNotFound, "planet not found")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// handlePlanetNetworks returns GET /world/planets/{planet_id}/networks
func (s *Server) handlePlanetNetworks(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	planetID := r.PathValue("planet_id")
	ws := sess.Core.WorldForPlanet(planetID)
	view, ok := sess.Query.PlanetNetworks(ws, playerID, planetID, sess.Core.FocusPlanetIDFor(playerID))
	if !ok {
		writeError(w, http.StatusNotFound, "planet not found")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// handleFleets returns GET /world/fleets
func (s *Server) handleFleets(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	writeJSON(w, http.StatusOK, sess.Query.Fleets(playerID, sess.Core.SpaceRuntime()))
}

// handleFleet returns GET /world/fleets/{fleet_id}
func (s *Server) handleFleet(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	fleetID := r.PathValue("fleet_id")
	view, ok := sess.Query.Fleet(playerID, fleetID, sess.Core.SpaceRuntime())
	if !ok {
		writeError(w, http.StatusNotFound, "fleet not found")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// handleCatalog returns GET /catalog
func (s *Server) handleCatalog(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	_ = playerID
	writeJSON(w, http.StatusOK, sess.Query.Catalog())
}

// handleCommandCatalog returns GET /catalog/commands
func (s *Server) handleCommandCatalog(w http.ResponseWriter, r *http.Request, playerID string) {
	_ = playerID
	writeJSON(w, http.StatusOK, model.BuildCommandCatalog())
}

// handleWarBlueprints returns GET /world/warfare/blueprints
func (s *Server) handleWarBlueprints(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	writeJSON(w, http.StatusOK, sess.Query.WarBlueprints(sess.Core.World(), playerID))
}

// handleWarBlueprint returns GET /world/warfare/blueprints/{blueprint_id}
func (s *Server) handleWarBlueprint(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	view, ok := sess.Query.WarBlueprint(sess.Core.World(), playerID, r.PathValue("blueprint_id"))
	if !ok {
		writeError(w, http.StatusNotFound, "warfare blueprint not found")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// handleWarIndustry returns GET /world/warfare/industry
func (s *Server) handleWarIndustry(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	view := sess.Query.WarIndustry(sess.Core.World(), playerID)
	writeJSON(w, http.StatusOK, view)
}

// handleWarTaskForces returns GET /world/warfare/task-forces
func (s *Server) handleWarTaskForces(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	view := sess.Query.WarTaskForces(sess.Core.World(), playerID, sess.Core.Worlds(), sess.Core.SpaceRuntime())
	writeJSON(w, http.StatusOK, view)
}

// handleWarTheaters returns GET /world/warfare/theaters
func (s *Server) handleWarTheaters(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	view := sess.Query.WarTheaters(sess.Core.World(), playerID)
	writeJSON(w, http.StatusOK, view)
}

// handleCommands handles POST /commands
func (s *Server) handleCommands(w http.ResponseWriter, r *http.Request, playerID string) {
	if !s.rl.Allow(playerID) {
		writeError(w, http.StatusTooManyRequests, "rate limit exceeded")
		return
	}

	sess := s.requireSession(w)
	if sess == nil {
		return
	}

	var req model.CommandRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid request body: %v", err))
		return
	}

	// Validate request_id
	if req.RequestID == "" {
		writeError(w, http.StatusBadRequest, "request_id is required")
		return
	}
	if req.IssuerType == "" {
		writeError(w, http.StatusBadRequest, "issuer_type is required")
		return
	}
	if req.IssuerID == "" {
		writeError(w, http.StatusBadRequest, "issuer_id is required")
		return
	}
	if req.IssuerType == "player" && req.IssuerID != playerID {
		writeError(w, http.StatusForbidden, "issuer_id does not match authenticated player")
		return
	}
	if len(req.Commands) == 0 {
		writeError(w, http.StatusBadRequest, "commands array must not be empty")
		return
	}

	// Check for duplicate request
	if sess.Queue.HasSeen(req.RequestID) {
		ws := sess.Core.World()
		ws.RLock()
		currentTick := ws.Tick
		ws.RUnlock()
		if len(req.Commands) > 0 {
			qr := &model.QueuedRequest{
				Request:     req,
				PlayerID:    playerID,
				EnqueueTick: currentTick,
			}
			results := make([]model.CommandResult, len(req.Commands))
			for i := range req.Commands {
				issue := model.DuplicateRequestIssue()
				results[i] = model.CommandResult{
					CommandIndex: i,
					Status:       model.StatusRejected,
					Code:         model.CodeDuplicate,
					Message:      issue.Message,
					Issues:       []model.CommandIssue{issue},
				}
			}
			s.recordPrecheckAudit(sess, playerID, qr, results)
		}
		resp := model.CommandResponse{
			RequestID: req.RequestID,
			Accepted:  false,
			Results: []model.CommandResult{{
				CommandIndex: 0,
				Status:       model.StatusRejected,
				Code:         model.CodeDuplicate,
				Message:      model.DuplicateRequestIssue().Message,
				Issues:       []model.CommandIssue{model.DuplicateRequestIssue()},
			}},
		}
		writeJSON(w, http.StatusOK, resp)
		return
	}

	ws := sess.Core.World()
	ws.RLock()
	currentTick := ws.Tick
	ws.RUnlock()

	qr := &model.QueuedRequest{
		Request:     req,
		PlayerID:    playerID,
		EnqueueTick: currentTick,
	}

	// Pre-validate commands at accept time (fast structural checks)
	results := make([]model.CommandResult, len(req.Commands))
	allAccepted := true
	for i, cmd := range req.Commands {
		results[i].CommandIndex = i
		if issues := validateCommandStructure(cmd); len(issues) > 0 {
			results[i].Status = model.StatusRejected
			results[i].Code = model.CodeValidationFailed
			results[i].Issues = issues
			results[i].Message = model.IssuesMessage(issues)
			allAccepted = false
		} else if !sess.Core.CanIssueCommand(playerID, cmd.Type) {
			issue := model.UnauthorizedIssue("permission denied")
			results[i].Status = model.StatusRejected
			results[i].Code = model.CodeUnauthorized
			results[i].Issues = []model.CommandIssue{issue}
			results[i].Message = issue.Message
			allAccepted = false
		} else if issues := s.validateBusinessRules(sess, playerID, cmd); len(issues) > 0 {
			// 业务规则快速预检：当前仅覆盖 start_research（研究站/矩阵存在性），
			// 让玩家在 HTTP 层立即得到可操作的中文错误，而非异步静默失败。
			results[i].Status = model.StatusRejected
			results[i].Code = model.CodeValidationFailed
			results[i].Issues = issues
			results[i].Message = model.IssuesMessage(issues)
			allAccepted = false
		} else {
			results[i].Status = model.StatusAccepted
			results[i].Code = model.CodeOK
			results[i].Message = "accepted, will execute at next tick"
		}
	}

	if allAccepted {
		sess.Queue.Enqueue(qr)
	}
	if !allAccepted {
		s.recordPrecheckAudit(sess, playerID, qr, results)
	}

	resp := model.CommandResponse{
		RequestID:   req.RequestID,
		Accepted:    allAccepted,
		EnqueueTick: currentTick,
		Results:     results,
	}
	writeJSON(w, http.StatusAccepted, resp)
}

// handleAuditQuery handles GET /audit
func (s *Server) handleAuditQuery(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	q := r.URL.Query()
	filter := model.AuditQuery{
		PlayerID:   q.Get("player_id"),
		IssuerType: q.Get("issuer_type"),
		IssuerID:   q.Get("issuer_id"),
		Action:     q.Get("action"),
		RequestID:  q.Get("request_id"),
		Permission: q.Get("permission"),
		Order:      q.Get("order"),
	}
	if filter.PlayerID == "" {
		filter.PlayerID = playerID
	}

	if v := q.Get("from_tick"); v != "" {
		parsed, err := strconv.ParseInt(v, 10, 64)
		if err != nil || parsed < 0 {
			writeError(w, http.StatusBadRequest, "from_tick must be a non-negative integer")
			return
		}
		filter.FromTick = &parsed
	}
	if v := q.Get("to_tick"); v != "" {
		parsed, err := strconv.ParseInt(v, 10, 64)
		if err != nil || parsed < 0 {
			writeError(w, http.StatusBadRequest, "to_tick must be a non-negative integer")
			return
		}
		filter.ToTick = &parsed
	}
	if v := q.Get("from_time"); v != "" {
		parsed, err := time.Parse(time.RFC3339, v)
		if err != nil {
			writeError(w, http.StatusBadRequest, "from_time must be RFC3339 timestamp")
			return
		}
		filter.FromTime = &parsed
	}
	if v := q.Get("to_time"); v != "" {
		parsed, err := time.Parse(time.RFC3339, v)
		if err != nil {
			writeError(w, http.StatusBadRequest, "to_time must be RFC3339 timestamp")
			return
		}
		filter.ToTime = &parsed
	}
	if v := q.Get("permission_granted"); v != "" {
		parsed, err := strconv.ParseBool(v)
		if err != nil {
			writeError(w, http.StatusBadRequest, "permission_granted must be boolean")
			return
		}
		filter.PermissionGranted = &parsed
	}
	if v := q.Get("limit"); v != "" {
		parsed, err := strconv.Atoi(v)
		if err != nil || parsed < 0 {
			writeError(w, http.StatusBadRequest, "limit must be a non-negative integer")
			return
		}
		filter.Limit = parsed
	}

	entries, err := sess.Core.QueryAudit(filter)
	if err != nil {
		writeError(w, http.StatusNotImplemented, err.Error())
		return
	}
	resp := model.AuditQueryResponse{
		Count:   len(entries),
		Entries: entries,
	}
	writeJSON(w, http.StatusOK, resp)
}

// requireAdminRole 要求管理员角色（F5）：/save /rollback /games/new 等对局级操作仅 role=admin 可调用。
func (s *Server) requireAdminRole(w http.ResponseWriter, sess *startup.Session, playerID string) bool {
	role := ""
	if ws := sess.Core.World(); ws != nil {
		ws.RLock()
		if player := ws.Players[playerID]; player != nil {
			role = player.Role
		}
		ws.RUnlock()
	}
	if role != "admin" {
		writeError(w, http.StatusForbidden, "admin role required")
		return false
	}
	return true
}

// handleSave handles POST /save
func (s *Server) handleSave(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	if !s.requireAdminRole(w, sess, playerID) {
		return
	}
	var req model.SaveRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := dec.Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid request body: %v", err))
		return
	}
	trigger := strings.TrimSpace(req.Reason)
	if trigger == "" {
		trigger = "manual"
	}
	// 经 Runtime 存档：与热重置互斥，避免旧局晚到的写入覆盖新局存档（F1）。
	result, err := s.rt.Save(trigger)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, model.SaveResponse{
		Ok:      true,
		Tick:    result.Tick,
		SavedAt: result.SavedAt,
		Path:    result.Path,
		Trigger: result.Trigger,
	})
}

// handleReplay handles POST /replay
func (s *Server) handleReplay(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	var req model.ReplayRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := dec.Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid request body: %v", err))
		return
	}
	resp, err := sess.Core.Replay(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleRollback handles POST /rollback
func (s *Server) handleRollback(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	if !s.requireAdminRole(w, sess, playerID) {
		return
	}
	var req model.RollbackRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := dec.Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid request body: %v", err))
		return
	}
	resp, err := sess.Core.Rollback(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func parseQueryInt(r *http.Request, key string, fallback int) int {
	if r == nil {
		return fallback
	}
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}

// handleEventStream handles GET /events/stream (SSE).
// F1 热重置：订阅挂在当前对局的事件总线上；/games/new 后旧总线被 CloseAll，
// 本连接随之断开，客户端需重新订阅并重新拉取全量状态。
func (s *Server) handleEventStream(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}
	eventTypes, err := parseEventTypesQuery(r, true)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	subID := fmt.Sprintf("%s-%d", playerID, time.Now().UnixNano())
	ch := sess.Bus.Subscribe(subID, eventTypes)
	defer sess.Bus.Unsubscribe(subID)

	log.Printf("[SSE] player %s connected (sub %s)", playerID, subID)
	defer log.Printf("[SSE] player %s disconnected", playerID)

	// Send a welcome ping
	connectedPayload, err := json.Marshal(map[string]any{
		"player_id":   playerID,
		"event_types": eventTypes,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build connected payload")
		return
	}
	fmt.Fprintf(w, "event: connected\ndata: %s\n\n", connectedPayload)
	flusher.Flush()

	// 心跳：空闲连接会被 NAT/代理在几分钟内静默掐断（表现为半开 TCP，
	// 客户端读不到 FIN 也无法感知）。周期性发送 SSE 注释行既保活连接，
	// 也让客户端能据此判断连接死活。心跳间隔须显著小于常见空闲超时（3-5 分钟）。
	heartbeat := time.NewTicker(25 * time.Second)
	defer heartbeat.Stop()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-heartbeat.C:
			fmt.Fprintf(w, ": ping\n\n")
			flusher.Flush()
		case evt, open := <-ch:
			if !open {
				return
			}
			// Apply visibility filter
			if !sess.Vis.FilterEvent(evt, playerID) {
				continue
			}
			data, err := json.Marshal(evt)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "event: game\ndata: %s\n\n", data)
			flusher.Flush()
		}
	}
}

// handleEventSnapshot handles GET /events/snapshot
func (s *Server) handleEventSnapshot(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	q := r.URL.Query()
	eventTypes, err := parseEventTypesQuery(r, true)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	var sinceTick int64
	if v := q.Get("since_tick"); v != "" {
		parsed, err := strconv.ParseInt(v, 10, 64)
		if err != nil || parsed < 0 {
			writeError(w, http.StatusBadRequest, "since_tick must be a non-negative integer")
			return
		}
		sinceTick = parsed
	}

	limit := sess.Config.Server.SnapshotMaxEvents
	if v := q.Get("limit"); v != "" {
		parsed, err := strconv.Atoi(v)
		if err != nil || parsed <= 0 {
			writeError(w, http.StatusBadRequest, "limit must be a positive integer")
			return
		}
		limit = parsed
	}
	if limit <= 0 {
		limit = 200
	}
	if max := sess.Config.Server.SnapshotMaxEvents; max > 0 && limit > max {
		limit = max
	}

	afterEventID := q.Get("after_event_id")
	events, nextEventID, hasMore, availableFrom := sess.Core.EventHistory().Snapshot(eventTypes, afterEventID, sinceTick, limit)

	filtered := make([]*model.GameEvent, 0, len(events))
	for _, evt := range events {
		if sess.Vis.FilterEvent(evt, playerID) {
			filtered = append(filtered, evt)
		}
	}

	resp := model.EventSnapshotResponse{
		EventTypes:        eventTypes,
		SinceTick:         sinceTick,
		AfterEventID:      afterEventID,
		AvailableFromTick: availableFrom,
		NextEventID:       nextEventID,
		HasMore:           hasMore,
		Events:            filtered,
	}
	writeJSON(w, http.StatusOK, resp)
}

func parseEventTypesQuery(r *http.Request, required bool) ([]model.EventType, error) {
	rawValues, ok := r.URL.Query()["event_types"]
	if required && (!ok || len(rawValues) == 0) {
		return nil, fmt.Errorf("event_types is required")
	}
	if !ok || len(rawValues) == 0 {
		return nil, nil
	}

	seen := make(map[model.EventType]struct{})
	out := make([]model.EventType, 0, len(rawValues))
	for _, rawValue := range rawValues {
		for _, part := range strings.Split(rawValue, ",") {
			token := strings.TrimSpace(part)
			if token == "" {
				continue
			}
			if token == "all" {
				return model.AllEventTypes(), nil
			}
			eventType := model.EventType(token)
			if !model.IsKnownEventType(eventType) {
				return nil, fmt.Errorf("unknown event_types value: %s", token)
			}
			if _, exists := seen[eventType]; exists {
				continue
			}
			seen[eventType] = struct{}{}
			out = append(out, eventType)
		}
	}
	if required && len(out) == 0 {
		return nil, fmt.Errorf("event_types is required")
	}
	return out, nil
}

// handleProductionAlertSnapshot handles GET /alerts/production/snapshot
func (s *Server) handleProductionAlertSnapshot(w http.ResponseWriter, r *http.Request, playerID string) {
	sess := s.requireSession(w)
	if sess == nil {
		return
	}
	q := r.URL.Query()

	var sinceTick int64
	if v := q.Get("since_tick"); v != "" {
		parsed, err := strconv.ParseInt(v, 10, 64)
		if err != nil || parsed < 0 {
			writeError(w, http.StatusBadRequest, "since_tick must be a non-negative integer")
			return
		}
		sinceTick = parsed
	}

	limit := sess.Config.Server.AlertHistoryLimit
	if v := q.Get("limit"); v != "" {
		parsed, err := strconv.Atoi(v)
		if err != nil || parsed <= 0 {
			writeError(w, http.StatusBadRequest, "limit must be a positive integer")
			return
		}
		limit = parsed
	}
	if limit <= 0 {
		limit = 200
	}
	if max := sess.Config.Server.AlertHistoryLimit; max > 0 && limit > max {
		limit = max
	}

	afterAlertID := q.Get("after_alert_id")
	alerts, nextAlertID, hasMore, availableFrom := sess.Core.AlertHistory().Snapshot(afterAlertID, sinceTick, limit)

	filtered := make([]*model.ProductionAlert, 0, len(alerts))
	for _, alert := range alerts {
		if alert != nil && alert.PlayerID == playerID {
			filtered = append(filtered, alert)
		}
	}

	resp := model.ProductionAlertSnapshotResponse{
		SinceTick:         sinceTick,
		AfterAlertID:      afterAlertID,
		AvailableFromTick: availableFrom,
		NextAlertID:       nextAlertID,
		HasMore:           hasMore,
		Alerts:            filtered,
	}
	writeJSON(w, http.StatusOK, resp)
}

// validateCommandStructure does fast structural validation without world access.
// Returns field-level issues suitable for agent repair prompts.
// Delegates to the shared model command structure registry (also powers GET /catalog/commands).
func validateCommandStructure(cmd model.Command) []model.CommandIssue {
	return model.ValidateCommandStructure(cmd)
}

// validateBusinessRules 对特定命令做即时业务规则预检，返回问题列表。
// 目的：让玩家在 HTTP 层得到可操作的中文错误，而非异步静默失败。
// 仅覆盖"在接受阶段可快速判断的"情况；严格语义校验仍在 tick 时执行。
func (s *Server) validateBusinessRules(sess *startup.Session, playerID string, cmd model.Command) []model.CommandIssue {
	switch cmd.Type {
	case model.CmdStartResearch:
		techID, _ := cmd.Payload["tech_id"].(string)
		if techID == "" {
			return nil // 结构校验已拒绝，不重复
		}
		ws := sess.Core.World()
		if ws == nil {
			return nil
		}
		ws.RLock()
		defer ws.RUnlock()
		return sess.Core.ValidateStartResearchLocked(playerID, techID, ws)
	}
	return nil
}

// writeJSON writes a JSON response
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("[Gateway] encode response: %v", err)
	}
}

// writeError writes a JSON error response
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{
		"error": msg,
		"code":  status,
	})
}

func (s *Server) recordPrecheckAudit(sess *startup.Session, playerID string, qr *model.QueuedRequest, results []model.CommandResult) {
	if s == nil || sess == nil || sess.Core == nil || qr == nil || len(results) == 0 {
		return
	}

	ws := sess.Core.World()
	ws.RLock()
	tick := ws.Tick
	role := ""
	perms := []string(nil)
	if player := ws.Players[playerID]; player != nil {
		role = player.Role
		perms = clonePermissions(player.Permissions)
	}
	ws.RUnlock()

	for i, cmd := range qr.Request.Commands {
		if i >= len(results) {
			break
		}
		res := results[i]
		perm := permissionFromPrecheckResult(res)
		entry := &model.AuditEntry{
			Timestamp:         time.Now().UTC(),
			Tick:              tick,
			PlayerID:          playerID,
			Role:              role,
			IssuerType:        qr.Request.IssuerType,
			IssuerID:          qr.Request.IssuerID,
			RequestID:         qr.Request.RequestID,
			Action:            "command",
			Permission:        string(cmd.Type),
			PermissionGranted: perm,
			Permissions:       perms,
			Details: map[string]any{
				"command_index":  res.CommandIndex,
				"command":        cmd,
				"status":         res.Status,
				"code":           res.Code,
				"message":        res.Message,
				"stage":          "precheck",
				"enqueued":       false,
				"batch_rejected": true,
				"enqueue_tick":   qr.EnqueueTick,
			},
		}
		sess.Core.AppendAudit(entry)
	}
}

func permissionFromPrecheckResult(res model.CommandResult) *bool {
	switch res.Code {
	case model.CodeUnauthorized:
		denied := false
		return &denied
	}
	if res.Status == model.StatusAccepted {
		allowed := true
		return &allowed
	}
	return nil
}

func clonePermissions(perms []string) []string {
	if len(perms) == 0 {
		return nil
	}
	cp := make([]string, len(perms))
	copy(cp, perms)
	return cp
}

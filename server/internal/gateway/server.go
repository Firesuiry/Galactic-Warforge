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

	"siliconworld/internal/config"
	"siliconworld/internal/gamecore"
	"siliconworld/internal/model"
	"siliconworld/internal/query"
	"siliconworld/internal/queue"
	"siliconworld/internal/visibility"
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

// Server is the HTTP server wrapping game services
type Server struct {
	cfg    *config.Config
	keyMap map[string]string // bearer key -> player_id
	core   *gamecore.GameCore
	bus    *gamecore.EventBus
	queue  *queue.CommandQueue
	ql     *query.Layer
	vis    *visibility.Engine
	rl     *rateLimiter
}

// New creates and configures the HTTP server
func New(
	cfg *config.Config,
	core *gamecore.GameCore,
	bus *gamecore.EventBus,
	q *queue.CommandQueue,
) *Server {
	vis := visibility.New()
	ql := query.New(vis, core.Maps(), core.Discovery())

	return &Server{
		cfg:    cfg,
		keyMap: cfg.KeyToPlayer(),
		core:   core,
		bus:    bus,
		queue:  q,
		ql:     ql,
		vis:    vis,
		rl:     newRateLimiter(cfg.Server.RateLimit),
	}
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

	// Commands
	mux.HandleFunc("POST /commands", s.auth(s.handleCommands))
	mux.HandleFunc("POST /save", s.auth(s.handleSave))

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

// auth middleware extracts and validates the Bearer token
func (s *Server) auth(next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			writeError(w, http.StatusUnauthorized, "missing or invalid Authorization header")
			return
		}
		key := strings.TrimPrefix(authHeader, "Bearer ")
		playerID, ok := s.keyMap[key]
		if !ok {
			writeError(w, http.StatusUnauthorized, "invalid player key")
			return
		}
		next(w, r, playerID)
	}
}

// handleHealth returns a simple health response
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"tick":   s.core.CurrentTick(),
	})
}

// handleMetrics returns core runtime metrics
func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	m := s.core.GetMetrics()
	snapshot := m.Snapshot()
	if s.bus != nil {
		snapshot["dropped_events"] = s.bus.DroppedCount()
	}
	writeJSON(w, http.StatusOK, snapshot)
}

// handleStateSummary returns GET /state/summary
func (s *Server) handleStateSummary(w http.ResponseWriter, r *http.Request, playerID string) {
	ws := s.core.World()
	sum := s.ql.Summary(ws, playerID, s.core.Victory())
	writeJSON(w, http.StatusOK, sum)
}

// handleStateStats returns GET /state/stats
func (s *Server) handleStateStats(w http.ResponseWriter, r *http.Request, playerID string) {
	ws := s.core.World()
	stats := s.ql.Stats(ws, playerID)
	writeJSON(w, http.StatusOK, stats)
}

// handleAgentBriefing returns GET /state/agent-briefing — one-shot aggregate
// snapshot for agent/GUI bootstrap (self + war + fleets + alerts + commands).
func (s *Server) handleAgentBriefing(w http.ResponseWriter, r *http.Request, playerID string) {
	alertLimit := query.DefaultAgentBriefingAlertLimit
	if v := r.URL.Query().Get("alert_limit"); v != "" {
		parsed, err := strconv.Atoi(v)
		if err != nil || parsed <= 0 {
			writeError(w, http.StatusBadRequest, "alert_limit must be a positive integer")
			return
		}
		alertLimit = parsed
	}
	if max := s.cfg.Server.AlertHistoryLimit; max > 0 && alertLimit > max {
		alertLimit = max
	}

	ws := s.core.World()
	briefing := s.ql.AgentBriefing(
		ws,
		playerID,
		s.core.Victory(),
		s.core.Worlds(),
		s.core.SpaceRuntime(),
		s.core.AlertHistory().All(),
		alertLimit,
	)
	writeJSON(w, http.StatusOK, briefing)
}

// handleGalaxy returns GET /world/galaxy
func (s *Server) handleGalaxy(w http.ResponseWriter, r *http.Request, playerID string) {
	writeJSON(w, http.StatusOK, s.ql.Galaxy(playerID))
}

// handleSystem returns GET /world/systems/{system_id}
func (s *Server) handleSystem(w http.ResponseWriter, r *http.Request, playerID string) {
	systemID := r.PathValue("system_id")
	view, ok := s.ql.System(playerID, systemID)
	if !ok {
		writeError(w, http.StatusNotFound, "system not found")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// handleSystemRuntime returns GET /world/systems/{system_id}/runtime
func (s *Server) handleSystemRuntime(w http.ResponseWriter, r *http.Request, playerID string) {
	systemID := r.PathValue("system_id")
	activePlanetID := s.core.ActivePlanetID()
	view, ok := s.ql.SystemRuntime(
		playerID,
		systemID,
		activePlanetID,
		s.core.WorldForPlanet(activePlanetID),
		s.core.SpaceRuntime(),
	)
	if !ok {
		writeError(w, http.StatusNotFound, "system not found")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// handlePlanet returns GET /world/planets/{planet_id}
func (s *Server) handlePlanet(w http.ResponseWriter, r *http.Request, playerID string) {
	planetID := r.PathValue("planet_id")
	ws := s.core.WorldForPlanet(planetID)
	view, ok := s.ql.PlanetSummary(ws, playerID, planetID)
	if !ok {
		writeError(w, http.StatusNotFound, "planet not found")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// handlePlanetOverview returns GET /world/planets/{planet_id}/overview
func (s *Server) handlePlanetOverview(w http.ResponseWriter, r *http.Request, playerID string) {
	planetID := r.PathValue("planet_id")
	req := query.PlanetOverviewRequest{
		Step: parseQueryInt(r, "step", 0),
	}
	view, ok := s.ql.PlanetOverview(s.core.WorldForPlanet(planetID), playerID, planetID, req)
	if !ok {
		writeError(w, http.StatusNotFound, "planet not found")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// handlePlanetScene returns GET /world/planets/{planet_id}/scene
func (s *Server) handlePlanetScene(w http.ResponseWriter, r *http.Request, playerID string) {
	planetID := r.PathValue("planet_id")
	req := query.PlanetSceneRequest{
		X:      parseQueryInt(r, "x", 0),
		Y:      parseQueryInt(r, "y", 0),
		Width:  parseQueryInt(r, "width", 0),
		Height: parseQueryInt(r, "height", 0),
	}
	view, ok := s.ql.PlanetScene(s.core.WorldForPlanet(planetID), playerID, planetID, req)
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

	ws := s.core.WorldForPlanet(planetID)
	view, ok := s.ql.PlanetInspect(ws, playerID, planetID, query.PlanetInspectRequest{
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
	planetID := r.PathValue("planet_id")
	ws := s.core.WorldForPlanet(planetID)
	view, ok := s.ql.PlanetRuntime(ws, playerID, planetID, s.core.ActivePlanetID())
	if !ok {
		writeError(w, http.StatusNotFound, "planet not found")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// handlePlanetNetworks returns GET /world/planets/{planet_id}/networks
func (s *Server) handlePlanetNetworks(w http.ResponseWriter, r *http.Request, playerID string) {
	planetID := r.PathValue("planet_id")
	ws := s.core.WorldForPlanet(planetID)
	view, ok := s.ql.PlanetNetworks(ws, playerID, planetID, s.core.ActivePlanetID())
	if !ok {
		writeError(w, http.StatusNotFound, "planet not found")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// handleFleets returns GET /world/fleets
func (s *Server) handleFleets(w http.ResponseWriter, r *http.Request, playerID string) {
	writeJSON(w, http.StatusOK, s.ql.Fleets(playerID, s.core.SpaceRuntime()))
}

// handleFleet returns GET /world/fleets/{fleet_id}
func (s *Server) handleFleet(w http.ResponseWriter, r *http.Request, playerID string) {
	fleetID := r.PathValue("fleet_id")
	view, ok := s.ql.Fleet(playerID, fleetID, s.core.SpaceRuntime())
	if !ok {
		writeError(w, http.StatusNotFound, "fleet not found")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// handleCatalog returns GET /catalog
func (s *Server) handleCatalog(w http.ResponseWriter, r *http.Request, playerID string) {
	_ = playerID
	writeJSON(w, http.StatusOK, s.ql.Catalog())
}

// handleWarBlueprints returns GET /world/warfare/blueprints
func (s *Server) handleWarBlueprints(w http.ResponseWriter, r *http.Request, playerID string) {
	writeJSON(w, http.StatusOK, s.ql.WarBlueprints(s.core.World(), playerID))
}

// handleWarBlueprint returns GET /world/warfare/blueprints/{blueprint_id}
func (s *Server) handleWarBlueprint(w http.ResponseWriter, r *http.Request, playerID string) {
	view, ok := s.ql.WarBlueprint(s.core.World(), playerID, r.PathValue("blueprint_id"))
	if !ok {
		writeError(w, http.StatusNotFound, "warfare blueprint not found")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// handleWarIndustry returns GET /world/warfare/industry
func (s *Server) handleWarIndustry(w http.ResponseWriter, r *http.Request, playerID string) {
	view := s.ql.WarIndustry(s.core.World(), playerID)
	writeJSON(w, http.StatusOK, view)
}

// handleWarTaskForces returns GET /world/warfare/task-forces
func (s *Server) handleWarTaskForces(w http.ResponseWriter, r *http.Request, playerID string) {
	view := s.ql.WarTaskForces(s.core.World(), playerID, s.core.Worlds(), s.core.SpaceRuntime())
	writeJSON(w, http.StatusOK, view)
}

// handleWarTheaters returns GET /world/warfare/theaters
func (s *Server) handleWarTheaters(w http.ResponseWriter, r *http.Request, playerID string) {
	view := s.ql.WarTheaters(s.core.World(), playerID)
	writeJSON(w, http.StatusOK, view)
}

// handleCommands handles POST /commands
func (s *Server) handleCommands(w http.ResponseWriter, r *http.Request, playerID string) {
	if !s.rl.Allow(playerID) {
		writeError(w, http.StatusTooManyRequests, "rate limit exceeded")
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
	if s.queue.HasSeen(req.RequestID) {
		ws := s.core.World()
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
			s.recordPrecheckAudit(playerID, qr, results)
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

	ws := s.core.World()
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
		} else if !s.core.CanIssueCommand(playerID, cmd.Type) {
			issue := model.UnauthorizedIssue("permission denied")
			results[i].Status = model.StatusRejected
			results[i].Code = model.CodeUnauthorized
			results[i].Issues = []model.CommandIssue{issue}
			results[i].Message = issue.Message
			allAccepted = false
		} else {
			results[i].Status = model.StatusAccepted
			results[i].Code = model.CodeOK
			results[i].Message = "accepted, will execute at next tick"
		}
	}

	if allAccepted {
		s.queue.Enqueue(qr)
	}
	if !allAccepted {
		s.recordPrecheckAudit(playerID, qr, results)
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

	entries, err := s.core.QueryAudit(filter)
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

// handleSave handles POST /save
func (s *Server) handleSave(w http.ResponseWriter, r *http.Request, playerID string) {
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
	result, err := s.core.Save(trigger)
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
	var req model.ReplayRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := dec.Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid request body: %v", err))
		return
	}
	resp, err := s.core.Replay(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleRollback handles POST /rollback
func (s *Server) handleRollback(w http.ResponseWriter, r *http.Request, playerID string) {
	var req model.RollbackRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := dec.Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid request body: %v", err))
		return
	}
	resp, err := s.core.Rollback(req)
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

// handleEventStream handles GET /events/stream (SSE)
func (s *Server) handleEventStream(w http.ResponseWriter, r *http.Request, playerID string) {
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
	ch := s.bus.Subscribe(subID, eventTypes)
	defer s.bus.Unsubscribe(subID)

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
			if !s.vis.FilterEvent(evt, playerID) {
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

	limit := s.cfg.Server.SnapshotMaxEvents
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
	if max := s.cfg.Server.SnapshotMaxEvents; max > 0 && limit > max {
		limit = max
	}

	afterEventID := q.Get("after_event_id")
	events, nextEventID, hasMore, availableFrom := s.core.EventHistory().Snapshot(eventTypes, afterEventID, sinceTick, limit)

	filtered := make([]*model.GameEvent, 0, len(events))
	for _, evt := range events {
		if s.vis.FilterEvent(evt, playerID) {
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

	limit := s.cfg.Server.AlertHistoryLimit
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
	if max := s.cfg.Server.AlertHistoryLimit; max > 0 && limit > max {
		limit = max
	}

	afterAlertID := q.Get("after_alert_id")
	alerts, nextAlertID, hasMore, availableFrom := s.core.AlertHistory().Snapshot(afterAlertID, sinceTick, limit)

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
func validateCommandStructure(cmd model.Command) []model.CommandIssue {
	var issues []model.CommandIssue
	switch cmd.Type {
	case model.CmdScanGalaxy:
		issues = append(issues, requireTargetGalaxyID(cmd)...)
		issues = append(issues, requireTargetLayer(cmd, "galaxy")...)
	case model.CmdScanSystem:
		issues = append(issues, requireTargetSystemID(cmd)...)
		issues = append(issues, requireTargetLayer(cmd, "system")...)
	case model.CmdScanPlanet:
		issues = append(issues, requireTargetPlanetID(cmd)...)
		issues = append(issues, requireTargetLayer(cmd, "planet")...)
	case model.CmdBuild:
		issues = append(issues, requireTargetPosition(cmd)...)
		issues = append(issues, requirePayload(cmd.Payload, "building_type")...)
		if recipeID, ok := cmd.Payload["recipe_id"]; ok {
			if strings.TrimSpace(fmt.Sprintf("%v", recipeID)) == "" {
				issues = append(issues, model.InvalidValueIssue(
					"payload.recipe_id",
					"payload.recipe_id must be a non-empty string when provided",
					"non-empty string",
					recipeID,
				))
			}
		}
	case model.CmdMove:
		issues = append(issues, requireTargetEntityID(cmd)...)
		issues = append(issues, requireTargetPosition(cmd)...)
	case model.CmdAttack:
		issues = append(issues, requireTargetEntityID(cmd)...)
		issues = append(issues, requirePayload(cmd.Payload, "target_entity_id")...)
	case model.CmdProduce:
		issues = append(issues, requireTargetEntityID(cmd)...)
		issues = append(issues, requirePayload(cmd.Payload, "unit_type")...)
	case model.CmdDeploySquad:
		issues = append(issues, requirePayload(cmd.Payload, "building_id", "blueprint_id", "count")...)
	case model.CmdCommissionFleet:
		issues = append(issues, requirePayload(cmd.Payload, "building_id", "blueprint_id", "count", "system_id")...)
	case model.CmdBlueprintCreate:
		issues = append(issues, requirePayload(cmd.Payload, "blueprint_id", "domain")...)
		_, hasFrame := cmd.Payload["base_frame_id"]
		_, hasHull := cmd.Payload["base_hull_id"]
		if hasFrame == hasHull {
			var actual any
			if hasFrame && hasHull {
				actual = []string{"base_frame_id", "base_hull_id"}
			}
			issues = append(issues, model.InvalidValueIssue(
				"payload.base_frame_id|payload.base_hull_id",
				"blueprint_create requires exactly one of payload.base_frame_id or payload.base_hull_id",
				"exactly one of base_frame_id or base_hull_id",
				actual,
			))
		}
	case model.CmdBlueprintSetComponent:
		issues = append(issues, requirePayload(cmd.Payload, "blueprint_id", "slot_id", "component_id")...)
	case model.CmdBlueprintValidate, model.CmdBlueprintFinalize:
		issues = append(issues, requirePayload(cmd.Payload, "blueprint_id")...)
	case model.CmdBlueprintVariant:
		issues = append(issues, requirePayload(cmd.Payload, "parent_blueprint_id", "blueprint_id", "allowed_slot_ids")...)
	case model.CmdQueueMilitaryProduction:
		issues = append(issues, requirePayload(cmd.Payload, "building_id", "deployment_hub_id", "blueprint_id", "count")...)
	case model.CmdRefitUnit:
		issues = append(issues, requirePayload(cmd.Payload, "building_id", "unit_id", "target_blueprint_id")...)
	case model.CmdFleetAssign:
		issues = append(issues, requirePayload(cmd.Payload, "fleet_id", "formation")...)
	case model.CmdFleetAttack:
		issues = append(issues, requirePayload(cmd.Payload, "fleet_id", "planet_id", "target_id")...)
	case model.CmdFleetMove:
		issues = append(issues, requirePayload(cmd.Payload, "fleet_id", "target_system_id")...)
	case model.CmdFleetDisband:
		issues = append(issues, requirePayload(cmd.Payload, "fleet_id")...)
	case model.CmdTaskForceCreate:
		issues = append(issues, requirePayload(cmd.Payload, "task_force_id")...)
	case model.CmdTaskForceAssign:
		issues = append(issues, requirePayload(cmd.Payload, "task_force_id", "member_kind", "member_ids")...)
	case model.CmdTaskForceSetStance:
		issues = append(issues, requirePayload(cmd.Payload, "task_force_id", "stance")...)
	case model.CmdTaskForceDeploy:
		issues = append(issues, requirePayload(cmd.Payload, "task_force_id")...)
	case model.CmdTheaterCreate:
		issues = append(issues, requirePayload(cmd.Payload, "theater_id")...)
	case model.CmdTheaterDefineZone:
		issues = append(issues, requirePayload(cmd.Payload, "theater_id", "zone_type")...)
	case model.CmdTheaterSetObjective:
		issues = append(issues, requirePayload(cmd.Payload, "theater_id", "objective_type")...)
	case model.CmdBlockadePlanet:
		issues = append(issues, requirePayload(cmd.Payload, "task_force_id", "planet_id")...)
	case model.CmdLandingStart:
		issues = append(issues, requirePayload(cmd.Payload, "task_force_id", "planet_id")...)
	case model.CmdUpgrade, model.CmdDemolish, model.CmdConfigureLogisticsStation:
		issues = append(issues, requireTargetEntityID(cmd)...)
	case model.CmdConfigureLogisticsSlot:
		issues = append(issues, requireTargetEntityID(cmd)...)
		issues = append(issues, requirePayload(cmd.Payload, "scope", "item_id", "mode", "local_storage")...)
	case model.CmdCancelConstruction, model.CmdRestoreConstruction:
		issues = append(issues, requirePayload(cmd.Payload, "task_id")...)
	case model.CmdStartResearch, model.CmdCancelResearch:
		issues = append(issues, requirePayload(cmd.Payload, "tech_id")...)
	case model.CmdTransferItem:
		issues = append(issues, requirePayload(cmd.Payload, "building_id", "item_id", "quantity")...)
	case model.CmdSwitchActivePlanet:
		issues = append(issues, requirePayload(cmd.Payload, "planet_id")...)
	case model.CmdSetRayReceiverMode:
		issues = append(issues, requirePayload(cmd.Payload, "building_id", "mode")...)
	case model.CmdLaunchSolarSail:
		issues = append(issues, requirePayload(cmd.Payload, "building_id")...)
	case model.CmdLaunchRocket:
		issues = append(issues, requirePayload(cmd.Payload, "building_id", "system_id")...)
	case model.CmdBuildDysonNode:
		issues = append(issues, requirePayload(cmd.Payload, "system_id", "layer_index", "latitude", "longitude")...)
	case model.CmdBuildDysonFrame:
		issues = append(issues, requirePayload(cmd.Payload, "system_id", "layer_index", "node_a_id", "node_b_id")...)
	case model.CmdBuildDysonShell:
		issues = append(issues, requirePayload(cmd.Payload, "system_id", "layer_index", "latitude_min", "latitude_max", "coverage")...)
	case model.CmdDemolishDyson:
		issues = append(issues, requirePayload(cmd.Payload, "system_id", "component_type", "component_id")...)
	default:
		issues = append(issues, model.UnknownCommandIssue(string(cmd.Type)))
	}
	return issues
}

func requirePayload(payload map[string]any, fields ...string) []model.CommandIssue {
	if payload == nil {
		payload = map[string]any{}
	}
	var issues []model.CommandIssue
	for _, field := range fields {
		if _, ok := payload[field]; !ok {
			issues = append(issues, model.MissingFieldIssue("payload."+field))
		}
	}
	return issues
}

func requireTargetEntityID(cmd model.Command) []model.CommandIssue {
	if cmd.Target.EntityID == "" {
		return []model.CommandIssue{model.MissingFieldIssue("target.entity_id")}
	}
	return nil
}

func requireTargetPosition(cmd model.Command) []model.CommandIssue {
	if cmd.Target.Position == nil {
		return []model.CommandIssue{model.MissingFieldIssue("target.position")}
	}
	return nil
}

func requireTargetGalaxyID(cmd model.Command) []model.CommandIssue {
	if cmd.Target.GalaxyID == "" {
		return []model.CommandIssue{model.MissingFieldIssue("target.galaxy_id")}
	}
	return nil
}

func requireTargetSystemID(cmd model.Command) []model.CommandIssue {
	if cmd.Target.SystemID == "" {
		return []model.CommandIssue{model.MissingFieldIssue("target.system_id")}
	}
	return nil
}

func requireTargetPlanetID(cmd model.Command) []model.CommandIssue {
	if cmd.Target.PlanetID == "" {
		return []model.CommandIssue{model.MissingFieldIssue("target.planet_id")}
	}
	return nil
}

func requireTargetLayer(cmd model.Command, expected string) []model.CommandIssue {
	if cmd.Target.Layer != "" && cmd.Target.Layer != expected {
		return []model.CommandIssue{model.InvalidValueIssue(
			"target.layer",
			fmt.Sprintf("target.layer must be %s", expected),
			expected,
			cmd.Target.Layer,
		)}
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

func (s *Server) recordPrecheckAudit(playerID string, qr *model.QueuedRequest, results []model.CommandResult) {
	if s == nil || s.core == nil || qr == nil || len(results) == 0 {
		return
	}

	ws := s.core.World()
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
		s.core.AppendAudit(entry)
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

package gateway

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
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
	mu       sync.Mutex
	tokens   map[string]int
	lastRefill map[string]time.Time
	limit    int // max tokens (commands/s)
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
	cfg     *config.Config
	keyMap  map[string]string // bearer key -> player_id
	core    *gamecore.GameCore
	bus     *gamecore.EventBus
	queue   *queue.CommandQueue
	ql      *query.Layer
	vis     *visibility.Engine
	rl      *rateLimiter
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

	// World queries
	mux.HandleFunc("GET /state/summary", s.auth(s.handleStateSummary))
	mux.HandleFunc("GET /world/galaxy", s.auth(s.handleGalaxy))
	mux.HandleFunc("GET /world/systems/{system_id}", s.auth(s.handleSystem))
	mux.HandleFunc("GET /world/planets/{planet_id}", s.auth(s.handlePlanet))
	mux.HandleFunc("GET /world/planets/{planet_id}/fog", s.auth(s.handleFogMap))

	// Commands
	mux.HandleFunc("POST /commands", s.auth(s.handleCommands))

	// SSE event stream
	mux.HandleFunc("GET /events/stream", s.auth(s.handleEventStream))

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
		"tick":   s.core.World().Tick,
	})
}

// handleMetrics returns core runtime metrics
func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	m := s.core.GetMetrics()
	writeJSON(w, http.StatusOK, m.Snapshot())
}

// handleStateSummary returns GET /state/summary
func (s *Server) handleStateSummary(w http.ResponseWriter, r *http.Request, playerID string) {
	ws := s.core.World()
	sum := s.ql.Summary(ws, playerID, s.core.Winner())
	writeJSON(w, http.StatusOK, sum)
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

// handlePlanet returns GET /world/planets/{planet_id}
func (s *Server) handlePlanet(w http.ResponseWriter, r *http.Request, playerID string) {
	planetID := r.PathValue("planet_id")
	ws := s.core.World()
	view, ok := s.ql.Planet(ws, playerID, planetID)
	if !ok {
		writeError(w, http.StatusNotFound, "planet not found")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// handleFogMap returns GET /world/planets/{planet_id}/fog
func (s *Server) handleFogMap(w http.ResponseWriter, r *http.Request, playerID string) {
	planetID := r.PathValue("planet_id")
	ws := s.core.World()
	view, ok := s.ql.FogMap(ws, playerID, planetID)
	if !ok {
		writeError(w, http.StatusNotFound, "planet not found")
		return
	}
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
	if len(req.Commands) == 0 {
		writeError(w, http.StatusBadRequest, "commands array must not be empty")
		return
	}

	// Check for duplicate request
	if s.queue.HasSeen(req.RequestID) {
		resp := model.CommandResponse{
			RequestID: req.RequestID,
			Accepted:  false,
			Results: []model.CommandResult{{
				CommandIndex: 0,
				Status:       model.StatusRejected,
				Code:         model.CodeDuplicate,
				Message:      "duplicate request_id",
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
		if err := validateCommandStructure(cmd); err != nil {
			results[i].Status = model.StatusRejected
			results[i].Code = model.CodeValidationFailed
			results[i].Message = err.Error()
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

	resp := model.CommandResponse{
		RequestID:   req.RequestID,
		Accepted:    allAccepted,
		EnqueueTick: currentTick,
		Results:     results,
	}
	writeJSON(w, http.StatusAccepted, resp)
}

// handleEventStream handles GET /events/stream (SSE)
func (s *Server) handleEventStream(w http.ResponseWriter, r *http.Request, playerID string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	subID := fmt.Sprintf("%s-%d", playerID, time.Now().UnixNano())
	ch := s.bus.Subscribe(subID)
	defer s.bus.Unsubscribe(subID)

	log.Printf("[SSE] player %s connected (sub %s)", playerID, subID)
	defer log.Printf("[SSE] player %s disconnected", playerID)

	// Send a welcome ping
	fmt.Fprintf(w, "event: connected\ndata: {\"player_id\":%q}\n\n", playerID)
	flusher.Flush()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case evt, open := <-ch:
			if !open {
				return
			}
			// Apply visibility filter
			if !s.vis.FilterEvent(s.core.World(), evt, playerID) {
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

// validateCommandStructure does fast structural validation without world access
func validateCommandStructure(cmd model.Command) error {
	switch cmd.Type {
	case model.CmdScanGalaxy:
		if cmd.Target.GalaxyID == "" {
			return fmt.Errorf("scan_galaxy requires target.galaxy_id")
		}
		if cmd.Target.Layer != "" && cmd.Target.Layer != "galaxy" {
			return fmt.Errorf("scan_galaxy target.layer must be galaxy")
		}
	case model.CmdScanSystem:
		if cmd.Target.SystemID == "" {
			return fmt.Errorf("scan_system requires target.system_id")
		}
		if cmd.Target.Layer != "" && cmd.Target.Layer != "system" {
			return fmt.Errorf("scan_system target.layer must be system")
		}
	case model.CmdScanPlanet:
		if cmd.Target.PlanetID == "" {
			return fmt.Errorf("scan_planet requires target.planet_id")
		}
		if cmd.Target.Layer != "" && cmd.Target.Layer != "planet" {
			return fmt.Errorf("scan_planet target.layer must be planet")
		}
	default:
		return fmt.Errorf("unknown command type: %s", cmd.Type)
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

package gateway

import (
	"net/http"
	"siliconworld/internal/model"
	"strconv"
)

func (s *Server) handlePlanetPath(w http.ResponseWriter, r *http.Request, playerID string) {
	x, errX := strconv.Atoi(r.URL.Query().Get("target_x"))
	y, errY := strconv.Atoi(r.URL.Query().Get("target_y"))
	stop := 0
	var errStop error
	if raw := r.URL.Query().Get("stop_range"); raw != "" {
		stop, errStop = strconv.Atoi(raw)
	}
	if errX != nil || errY != nil || errStop != nil {
		writeError(w, http.StatusBadRequest, "target_x, target_y and stop_range must be integers")
		return
	}
	view, err := s.ql.PlanetPath(s.core.WorldForPlanet(r.PathValue("planet_id")), playerID, r.URL.Query().Get("unit_id"), model.Position{X: x, Y: y}, stop)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, view)
}

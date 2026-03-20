package gamecore

import (
	"errors"
	"time"

	"siliconworld/internal/model"
)

// AppendAudit records a single audit entry if persistence is enabled.
func (gc *GameCore) AppendAudit(entry *model.AuditEntry) {
	if gc == nil || gc.snapshotStore == nil || entry == nil {
		return
	}
	if entry.Timestamp.IsZero() {
		entry.Timestamp = time.Now().UTC()
	}
	gc.snapshotStore.AppendAudit(entry)
}

// QueryAudit returns audit entries matching the query.
func (gc *GameCore) QueryAudit(q model.AuditQuery) ([]*model.AuditEntry, error) {
	if gc == nil || gc.snapshotStore == nil {
		return nil, errors.New("audit store not configured")
	}
	return gc.snapshotStore.QueryAudit(q), nil
}

// TrimAuditBeforeTick drops audit entries strictly before the given tick.
func (gc *GameCore) TrimAuditBeforeTick(tick int64) int {
	if gc == nil || gc.snapshotStore == nil {
		return 0
	}
	return gc.snapshotStore.TrimAuditBeforeTick(tick)
}

// TrimAuditAfterTick drops audit entries strictly after the given tick.
func (gc *GameCore) TrimAuditAfterTick(tick int64) int {
	if gc == nil || gc.snapshotStore == nil {
		return 0
	}
	return gc.snapshotStore.TrimAuditAfterTick(tick)
}

func clonePermissions(perms []string) []string {
	if len(perms) == 0 {
		return nil
	}
	cp := make([]string, len(perms))
	copy(cp, perms)
	return cp
}

func boolPtr(v bool) *bool {
	return &v
}

func (gc *GameCore) recordCommandAudit(qr *model.QueuedRequest, cmd model.Command, res model.CommandResult, player *model.PlayerState, stage string, permissionGranted *bool) {
	if gc == nil || gc.snapshotStore == nil || qr == nil {
		return
	}
	role := ""
	perms := []string(nil)
	if player != nil {
		role = player.Role
		perms = clonePermissions(player.Permissions)
	}
	entry := &model.AuditEntry{
		Tick:              gc.world.Tick,
		PlayerID:          qr.PlayerID,
		Role:              role,
		IssuerType:        qr.Request.IssuerType,
		IssuerID:          qr.Request.IssuerID,
		RequestID:         qr.Request.RequestID,
		Action:            "command",
		Permission:        string(cmd.Type),
		PermissionGranted: permissionGranted,
		Permissions:       perms,
		Details: map[string]any{
			"command_index": res.CommandIndex,
			"command":       cmd,
			"status":        res.Status,
			"code":          res.Code,
			"message":       res.Message,
			"stage":         stage,
			"enqueue_tick":  qr.EnqueueTick,
		},
	}
	gc.AppendAudit(entry)
}

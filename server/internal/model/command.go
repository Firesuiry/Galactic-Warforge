package model

// CommandType enumerates the types of commands a player can issue
type CommandType string

const (
	CmdBuild                     CommandType = "build"
	CmdMove                      CommandType = "move"
	CmdAttack                    CommandType = "attack"
	CmdProduce                   CommandType = "produce"
	CmdUpgrade                   CommandType = "upgrade"
	CmdDemolish                  CommandType = "demolish"
	CmdConfigureLogisticsStation CommandType = "configure_logistics_station"
	CmdConfigureLogisticsSlot    CommandType = "configure_logistics_slot"
	CmdScanGalaxy                CommandType = "scan_galaxy"
	CmdScanSystem                CommandType = "scan_system"
	CmdScanPlanet                CommandType = "scan_planet"
	CmdCancelConstruction        CommandType = "cancel_construction"
	CmdRestoreConstruction       CommandType = "restore_construction"
	CmdStartResearch             CommandType = "start_research"
	CmdCancelResearch            CommandType = "cancel_research"
	CmdSwitchActivePlanet        CommandType = "switch_active_planet"
	CmdTransferItem              CommandType = "transfer_item"
	CmdLaunchSolarSail           CommandType = "launch_solar_sail"
	CmdLaunchRocket              CommandType = "launch_rocket"
	CmdSetRayReceiverMode        CommandType = "set_ray_receiver_mode"
	CmdDeploySquad              CommandType = "deploy_squad"
	CmdCommissionFleet          CommandType = "commission_fleet"
	CmdFleetAssign              CommandType = "fleet_assign"
	CmdFleetAttack              CommandType = "fleet_attack"
	CmdFleetDisband             CommandType = "fleet_disband"
	CmdBlueprintCreate          CommandType = "blueprint_create"
	CmdBlueprintSetComponent    CommandType = "blueprint_set_component"
	CmdBlueprintValidate        CommandType = "blueprint_validate"
	CmdBlueprintFinalize        CommandType = "blueprint_finalize"
	CmdBlueprintVariant         CommandType = "blueprint_variant"
	CmdBuildDysonNode            CommandType = "build_dyson_node"
	CmdBuildDysonFrame           CommandType = "build_dyson_frame"
	CmdBuildDysonShell           CommandType = "build_dyson_shell"
	CmdDemolishDyson             CommandType = "demolish_dyson"
)

// CommandTarget specifies what the command targets
type CommandTarget struct {
	Layer    string    `json:"layer"`
	GalaxyID string    `json:"galaxy_id,omitempty"`
	SystemID string    `json:"system_id,omitempty"`
	PlanetID string    `json:"planet_id,omitempty"`
	EntityID string    `json:"entity_id,omitempty"`
	Position *Position `json:"position,omitempty"`
}

// Command is a single game action
type Command struct {
	Type    CommandType    `json:"type"`
	Target  CommandTarget  `json:"target"`
	Payload map[string]any `json:"payload,omitempty"`
}

// CommandRequest is the HTTP request body for POST /commands
type CommandRequest struct {
	RequestID  string    `json:"request_id"`
	IssuerType string    `json:"issuer_type"`
	IssuerID   string    `json:"issuer_id"`
	Commands   []Command `json:"commands"`
}

// CommandStatus tracks the lifecycle of a command
type CommandStatus string

const (
	StatusAccepted CommandStatus = "accepted"
	StatusRejected CommandStatus = "rejected"
	StatusExecuted CommandStatus = "executed"
	StatusFailed   CommandStatus = "failed"
)

// ResultCode is a machine-readable outcome code
type ResultCode string

const (
	CodeOK                   ResultCode = "OK"
	CodeInvalidTarget        ResultCode = "INVALID_TARGET"
	CodeNotOwner             ResultCode = "NOT_OWNER"
	CodeOutOfRange           ResultCode = "OUT_OF_RANGE"
	CodeInsufficientResource ResultCode = "INSUFFICIENT_RESOURCE"
	CodeDuplicate            ResultCode = "DUPLICATE"
	CodeValidationFailed     ResultCode = "VALIDATION_FAILED"
	CodeEntityNotFound       ResultCode = "ENTITY_NOT_FOUND"
	CodePositionOccupied     ResultCode = "POSITION_OCCUPIED"
	CodeUnauthorized         ResultCode = "UNAUTHORIZED"
	CodeExecutorUnavailable  ResultCode = "EXECUTOR_UNAVAILABLE"
	CodeExecutorBusy         ResultCode = "EXECUTOR_BUSY"
)

// CommandResult is the per-command outcome within a response
type CommandResult struct {
	CommandIndex int           `json:"command_index"`
	Status       CommandStatus `json:"status"`
	Code         ResultCode    `json:"code"`
	Message      string        `json:"message"`
	Validation   *WarBlueprintValidationResult `json:"validation,omitempty"`
}

// CommandResponse is the HTTP response for POST /commands
type CommandResponse struct {
	RequestID   string          `json:"request_id"`
	Accepted    bool            `json:"accepted"`
	EnqueueTick int64           `json:"enqueue_tick"`
	Results     []CommandResult `json:"results"`
}

// QueuedRequest is a request stored in the command queue, enriched with auth context
type QueuedRequest struct {
	Request     CommandRequest
	PlayerID    string
	EnqueueTick int64
}

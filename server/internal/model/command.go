package model

// CommandType enumerates the types of commands a player can issue
type CommandType string

const (
	CmdSetRallyPoint             CommandType = "set_rally_point"
	CmdConfigureSorter           CommandType = "configure_sorter"
	CmdConfigureTrafficMonitor   CommandType = "configure_traffic_monitor"
	CmdConfigureSplitter         CommandType = "configure_splitter"
	CmdBuild                     CommandType = "build"
	CmdMove                      CommandType = "move"
	CmdAttack                    CommandType = "attack"
	CmdUnitOrder                 CommandType = "unit_order"
	CmdRefuelMecha               CommandType = "refuel_mecha"
	CmdMineResource              CommandType = "mine_resource"
	CmdCraftItem                 CommandType = "craft_item"
	CmdCancelMechaJob            CommandType = "cancel_mecha_job"
	CmdProduce                   CommandType = "produce"
	CmdUpgrade                   CommandType = "upgrade"
	CmdDemolish                  CommandType = "demolish"
	CmdConfigureDistributor      CommandType = "configure_distributor"
	CmdInstallLogisticsBot       CommandType = "install_logistics_bot"
	CmdUninstallLogisticsBot     CommandType = "uninstall_logistics_bot"
	CmdConfigureMechaLogistics   CommandType = "configure_mecha_logistics"
	CmdInstallLogisticsVehicle   CommandType = "install_logistics_vehicle"
	CmdConfigureLogisticsStation CommandType = "configure_logistics_station"
	CmdConfigureLogisticsSlot    CommandType = "configure_logistics_slot"
	CmdScanGalaxy                CommandType = "scan_galaxy"
	CmdScanSystem                CommandType = "scan_system"
	CmdScanPlanet                CommandType = "scan_planet"
	CmdCancelConstruction        CommandType = "cancel_construction"
	CmdRestoreConstruction       CommandType = "restore_construction"
	CmdStartResearch             CommandType = "start_research"
	CmdCancelResearch            CommandType = "cancel_research"
	CmdSetRecipe                 CommandType = "set_recipe"
	CmdSwitchActivePlanet        CommandType = "switch_active_planet"
	CmdTransferItem              CommandType = "transfer_item"
	CmdLaunchSolarSail           CommandType = "launch_solar_sail"
	CmdLaunchRocket              CommandType = "launch_rocket"
	CmdSetRayReceiverMode        CommandType = "set_ray_receiver_mode"
	CmdSetEnergyExchangerMode    CommandType = "set_energy_exchanger_mode"
	CmdSquadOrder                CommandType = "squad_order"
	CmdDissolveSquad             CommandType = "dissolve_squad"
	CmdFormSquad                 CommandType = "form_squad"
	CmdDeploySquad               CommandType = "deploy_squad"
	CmdCommissionFleet           CommandType = "commission_fleet"
	CmdFleetAssign               CommandType = "fleet_assign"
	CmdFleetAttack               CommandType = "fleet_attack"
	CmdFleetMove                 CommandType = "fleet_move"
	CmdFleetDisband              CommandType = "fleet_disband"
	CmdTaskForceCreate           CommandType = "task_force_create"
	CmdTaskForceAssign           CommandType = "task_force_assign"
	CmdTaskForceSetStance        CommandType = "task_force_set_stance"
	CmdTaskForceDeploy           CommandType = "task_force_deploy"
	CmdTheaterCreate             CommandType = "theater_create"
	CmdTheaterDefineZone         CommandType = "theater_define_zone"
	CmdTheaterSetObjective       CommandType = "theater_set_objective"
	CmdBlockadePlanet            CommandType = "blockade_planet"
	CmdBlueprintCreate           CommandType = "blueprint_create"
	CmdBlueprintSetComponent     CommandType = "blueprint_set_component"
	CmdBlueprintValidate         CommandType = "blueprint_validate"
	CmdBlueprintFinalize         CommandType = "blueprint_finalize"
	CmdBlueprintVariant          CommandType = "blueprint_variant"
	CmdQueueMilitaryProduction   CommandType = "queue_military_production"
	CmdRefitUnit                 CommandType = "refit_unit"
	CmdAssignMecha               CommandType = "assign_mecha"
	CmdDispatchMecha             CommandType = "dispatch_mecha"
	CmdBuildDysonNode            CommandType = "build_dyson_node"
	CmdBuildDysonFrame           CommandType = "build_dyson_frame"
	CmdBuildDysonShell           CommandType = "build_dyson_shell"
	CmdDemolishDyson             CommandType = "demolish_dyson"
)

// CommandTarget specifies what the command targets
type CommandTarget struct {
	Layer    string `json:"layer"`
	GalaxyID string `json:"galaxy_id,omitempty"`
	SystemID string `json:"system_id,omitempty"`
	PlanetID string `json:"planet_id,omitempty"`
	EntityID string `json:"entity_id,omitempty"`
	// EntityIDs 批量指令（框选多单位）的目标实体集合；与 EntityID 二选一或并用，
	// 执行器按稳定顺序逐个处理。
	EntityIDs []string `json:"entity_ids,omitempty"`
	// MechaID 点名由哪台机甲执行本命令（契约 §4）：一个发令者可以绑多台机甲，
	// 缺省时执行器取「本星球上 unit ID 最小的那台」。
	MechaID  string    `json:"mecha_id,omitempty"`
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
	// CodeInvalidElevation 高架层参数不合法（第 19 轮契约 §3.2）：非传送带给了
	// elevation > 0、超出 0–4、高架带没有明确方向、同层占格冲突等。
	CodeInvalidElevation    ResultCode = "INVALID_ELEVATION"
	CodeUnauthorized        ResultCode = "UNAUTHORIZED"
	CodeExecutorUnavailable ResultCode = "EXECUTOR_UNAVAILABLE"
	// CodeNotOperator move/attack/unit_order 里选中了别的发令者绑定的机甲：
	// 该单位逐个拒绝，其余单位照常执行。
	CodeNotOperator  ResultCode = "NOT_OPERATOR"
	CodeExecutorBusy ResultCode = "EXECUTOR_BUSY"
	// CodeGameFinished 终局拒绝（F2）：victory 宣判后对局进入 finished，
	// 常规游戏命令统一以该码拒绝；管理面接口（/save、/games/new、查询类）不受限。
	CodeGameFinished ResultCode = "GAME_FINISHED"
)

// CommandResult is the per-command outcome within a response
type CommandResult struct {
	CommandIndex int                           `json:"command_index"`
	Status       CommandStatus                 `json:"status"`
	Code         ResultCode                    `json:"code"`
	Message      string                        `json:"message"`
	Issues       []CommandIssue                `json:"issues,omitempty"`
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

// AllCommandTypes returns every public CommandType in command catalog order.
// Used by permission surfaces such as GET /state/agent-briefing.
func AllCommandTypes() []CommandType {
	out := make([]CommandType, 0, len(commandSpecs))
	for _, spec := range commandSpecs {
		out = append(out, spec.Type)
	}
	return out
}

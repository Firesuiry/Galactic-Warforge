package model

import "math"

// DysonSphereState 恒星系的戴森球状态
type DysonSphereState struct {
	PlayerID    string       `json:"player_id"`
	SystemID    string       `json:"system_id"`
	Layers      []DysonLayer `json:"layers"`       // 多层壳体
	TotalEnergy int          `json:"total_energy"` // 总能量输出
}

// DysonLayer 单层壳体
type DysonLayer struct {
	LayerIndex        int          `json:"layer_index"`                  // 层索引 (0=最内层)
	OrbitRadius       float64      `json:"orbit_radius"`                 // 轨道半径 (AU)
	Nodes             []DysonNode  `json:"nodes"`                        // 节点列表
	Frames            []DysonFrame `json:"frames"`                       // 框架列表
	Shells            []DysonShell `json:"shells"`                       // 壳体列表
	EnergyOutput      int          `json:"energy_output"`                // 该层能量输出
	RocketLaunches    int          `json:"rocket_launches,omitempty"`    // 发射到该层的火箭总数
	ConstructionBonus float64      `json:"construction_bonus,omitempty"` // 火箭带来的层级建造增益
}

// DysonNode 戴森球节点 - 基本结构单元
type DysonNode struct {
	ID           string  `json:"id"`
	LayerIndex   int     `json:"layer_index"`
	Latitude     float64 `json:"latitude"`      // 纬度 (-90 to 90)
	Longitude    float64 `json:"longitude"`     // 经度 (0 to 360)
	EnergyOutput int     `json:"energy_output"` // 节点能量输出
	Integrity    float64 `json:"integrity"`     // 结构完整性 (0-1)
	Built        bool    `json:"built"`         // 是否已建造
}

// DysonFrame 戴森球框架 - 连接节点形成骨架
type DysonFrame struct {
	ID         string  `json:"id"`
	LayerIndex int     `json:"layer_index"`
	NodeAID    string  `json:"node_a_id"` // 连接的节点A
	NodeBID    string  `json:"node_b_id"` // 连接的节点B
	Integrity  float64 `json:"integrity"` // 结构完整性 (0-1)
	Built      bool    `json:"built"`     // 是否已建造
}

// DysonShell 戴森球壳体 - 覆盖框架形成能量收集表面
type DysonShell struct {
	ID           string  `json:"id"`
	LayerIndex   int     `json:"layer_index"`
	LatitudeMin  float64 `json:"latitude_min"` // 壳体覆盖纬度范围
	LatitudeMax  float64 `json:"latitude_max"`
	Coverage     float64 `json:"coverage"`      // 覆盖率 (0-1)
	EnergyOutput int     `json:"energy_output"` // 该壳体能量输出
	Integrity    float64 `json:"integrity"`     // 结构完整性 (0-1)
	Built        bool    `json:"built"`         // 是否已建造
}

// DysonStressParams 应力系统参数
type DysonStressParams struct {
	BaseStrength       float64 `json:"base_strength"`        // 基础结构强度
	StressPerNode      float64 `json:"stress_per_node"`      // 每节点应力系数
	StressFromCoverage float64 `json:"stress_from_coverage"` // 覆盖率应力系数
	CollapseThreshold  float64 `json:"collapse_threshold"`   // 崩溃阈值
	MaxLatitude        float64 `json:"max_latitude"`         // 最大建造纬度 (受科技影响)
}

// DysonStressResult 应力计算结果
type DysonStressResult struct {
	LayerIndex  int      `json:"layer_index"`
	TotalStress float64  `json:"total_stress"` // 总应力
	StressRatio float64  `json:"stress_ratio"` // 应力比 (stress/strength)
	IsStable    bool     `json:"is_stable"`    // 是否稳定
	WeakPoints  []string `json:"weak_points"`  // 应力集中点ID
}

// 能量输出阶段
const (
	EnergyStageEmpty        = 0.0 // 无结构
	EnergyStageNodesOnly    = 0.1 // 仅节点
	EnergyStageFrames       = 0.3 // 框架完成
	EnergyStagePartialShell = 0.6 // 部分壳体
	EnergyStageFullShell    = 1.0 // 完整壳体
)

// DefaultDysonStressParams 返回默认应力参数
func DefaultDysonStressParams() DysonStressParams {
	return DysonStressParams{
		BaseStrength:       100.0,
		StressPerNode:      1.0,
		StressFromCoverage: 10.0,
		CollapseThreshold:  1.0,
		MaxLatitude:        90.0,
	}
}

// NewDysonSphereState 创建一个新的戴森球状态
func NewDysonSphereState(playerID, systemID string) *DysonSphereState {
	return &DysonSphereState{
		PlayerID: playerID,
		SystemID: systemID,
		Layers:   make([]DysonLayer, 0),
	}
}

// AddLayer 添加一层壳体
func (ds *DysonSphereState) AddLayer(layerIndex int, orbitRadius float64) {
	layer := DysonLayer{
		LayerIndex:  layerIndex,
		OrbitRadius: orbitRadius,
		Nodes:       make([]DysonNode, 0),
		Frames:      make([]DysonFrame, 0),
		Shells:      make([]DysonShell, 0),
	}
	ds.Layers = append(ds.Layers, layer)
}

// FindNodeByID 在指定层中查找节点
func (layer *DysonLayer) FindNodeByID(nodeID string) *DysonNode {
	for i := range layer.Nodes {
		if layer.Nodes[i].ID == nodeID {
			return &layer.Nodes[i]
		}
	}
	return nil
}

// CalculateLayerEnergyOutput 计算单层能量输出
func CalculateLayerEnergyOutput(layer DysonLayer, params DysonStressParams) int {
	baseEnergy := 1000 // 每层基础能量

	// 按完成度计算
	var stageFactor float64
	if len(layer.Shells) == 0 && len(layer.Frames) == 0 && len(layer.Nodes) == 0 {
		stageFactor = EnergyStageEmpty
	} else if len(layer.Shells) == 0 && len(layer.Frames) == 0 {
		stageFactor = EnergyStageNodesOnly
	} else if len(layer.Shells) == 0 {
		stageFactor = EnergyStageFrames
	} else {
		totalCoverage := 0.0
		for _, shell := range layer.Shells {
			if shell.Built {
				totalCoverage += shell.Coverage
			}
		}
		if totalCoverage >= 1.0 {
			stageFactor = EnergyStageFullShell
		} else {
			stageFactor = EnergyStagePartialShell
		}
	}

	// 应力衰减
	stressResult := CalculateLayerStress(layer, params)
	stressFactor := 1.0
	if !stressResult.IsStable {
		stressFactor = 0.5 // 应力不稳定时能量减半
	}

	bonusFactor := 1.0 + maxFloat(0, layer.ConstructionBonus)
	return int(float64(baseEnergy) * stageFactor * stressFactor * bonusFactor)
}

// CalculateLayerStress 计算单层应力
func CalculateLayerStress(layer DysonLayer, params DysonStressParams) DysonStressResult {
	result := DysonStressResult{
		LayerIndex: layer.LayerIndex,
	}

	totalStress := 0.0

	// 节点应力
	for i := range layer.Nodes {
		node := &layer.Nodes[i]
		if !node.Built {
			continue
		}
		// 高纬度节点应力更大
		latitudeFactor := 1.0 + math.Abs(node.Latitude)/90.0*params.StressPerNode
		totalStress += latitudeFactor
	}

	// 框架应力
	for i := range layer.Frames {
		frame := &layer.Frames[i]
		if !frame.Built {
			continue
		}
		// 查找节点计算框架长度
		nodeA := layer.FindNodeByID(frame.NodeAID)
		nodeB := layer.FindNodeByID(frame.NodeBID)
		if nodeA != nil && nodeB != nil {
			// 简化的距离计算
			latDiff := math.Abs(nodeA.Latitude - nodeB.Latitude)
			lonDiff := math.Abs(nodeA.Longitude - nodeB.Longitude)
			if lonDiff > 180 {
				lonDiff = 360 - lonDiff
			}
			length := math.Sqrt(latDiff*latDiff + lonDiff*lonDiff)
			totalStress += length * params.StressPerNode
		}
	}

	// 壳体覆盖率应力
	for i := range layer.Shells {
		shell := &layer.Shells[i]
		if !shell.Built {
			continue
		}
		totalStress += shell.Coverage * params.StressFromCoverage
	}

	strength := params.BaseStrength * (1.0 + maxFloat(0, layer.ConstructionBonus)*0.6)
	if strength <= 0 {
		strength = params.BaseStrength
	}

	result.TotalStress = totalStress
	result.StressRatio = totalStress / strength
	result.IsStable = result.StressRatio <= params.CollapseThreshold

	return result
}

// CalculateTotalEnergy 计算戴森球总能量输出
func (ds *DysonSphereState) CalculateTotalEnergy(params DysonStressParams) int {
	total := 0
	for i := range ds.Layers {
		layer := &ds.Layers[i]
		layer.EnergyOutput = CalculateLayerEnergyOutput(*layer, params)
		total += layer.EnergyOutput
	}
	ds.TotalEnergy = total
	return total
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

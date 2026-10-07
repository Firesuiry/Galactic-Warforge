package model

import "fmt"

// SplitterState controls four mutually exclusive conveyor ports. Items are kept
// in Building.Conveyor; cursors survive snapshots so equal-priority ports rotate.
type SplitterState struct {
	InputDirections  []ConveyorDirection          `json:"input_directions"`
	OutputDirections []ConveyorDirection          `json:"output_directions"`
	InputPriority    ConveyorDirection            `json:"input_priority,omitempty"`
	OutputPriority   ConveyorDirection            `json:"output_priority,omitempty"`
	OutputFilters    map[ConveyorDirection]string `json:"output_filters,omitempty"`
	InputCursor      int                          `json:"input_cursor"`
	OutputCursor     int                          `json:"output_cursor"`
	TransferredItems int64                        `json:"transferred_items"`
	LastTransferTick int64                        `json:"last_transfer_tick"`
}

func NewSplitterState() *SplitterState {
	return &SplitterState{InputDirections: []ConveyorDirection{ConveyorWest}, OutputDirections: []ConveyorDirection{ConveyorEast, ConveyorSouth, ConveyorNorth}}
}

func (s *SplitterState) Clone() *SplitterState {
	if s == nil {
		return nil
	}
	out := *s
	out.InputDirections = append([]ConveyorDirection(nil), s.InputDirections...)
	out.OutputDirections = append([]ConveyorDirection(nil), s.OutputDirections...)
	if s.OutputFilters != nil {
		out.OutputFilters = make(map[ConveyorDirection]string, len(s.OutputFilters))
		for direction, item := range s.OutputFilters {
			out.OutputFilters[direction] = item
		}
	}
	return &out
}

func (s *SplitterState) Validate() error {
	if s == nil || len(s.InputDirections) == 0 || len(s.OutputDirections) == 0 {
		return fmt.Errorf("分流器至少需要一个输入和一个输出")
	}
	if s.InputCursor < 0 || s.InputCursor >= len(s.InputDirections) || s.OutputCursor < 0 || s.OutputCursor >= len(s.OutputDirections) {
		return fmt.Errorf("分流器游标不在已配置端口内")
	}
	if s.TransferredItems < 0 || s.LastTransferTick < 0 {
		return fmt.Errorf("分流器计数不能为负")
	}
	ports := make(map[ConveyorDirection]bool)
	for _, directions := range [][]ConveyorDirection{s.InputDirections, s.OutputDirections} {
		for _, dir := range directions {
			if !dir.Valid() || dir == ConveyorAuto {
				return fmt.Errorf("分流器端口必须是东南西北方向")
			}
			if ports[dir] {
				return fmt.Errorf("分流器端口 %s 重复", dir)
			}
			ports[dir] = true
		}
	}
	if s.InputPriority != "" && !s.IsInput(s.InputPriority) {
		return fmt.Errorf("输入优先级必须指定一个输入端口")
	}
	if s.OutputPriority != "" && !s.IsOutput(s.OutputPriority) {
		return fmt.Errorf("输出优先级必须指定一个输出端口")
	}
	for dir, item := range s.OutputFilters {
		if !s.IsOutput(dir) {
			return fmt.Errorf("过滤器必须指定一个输出端口")
		}
		if _, ok := Item(item); !ok {
			return fmt.Errorf("未知的分流器过滤物品：%s", item)
		}
	}
	return nil
}

func (s *SplitterState) IsInput(dir ConveyorDirection) bool {
	if s == nil {
		return false
	}
	for _, port := range s.InputDirections {
		if port == dir {
			return true
		}
	}
	return false
}
func (s *SplitterState) IsOutput(dir ConveyorDirection) bool {
	if s == nil {
		return false
	}
	for _, port := range s.OutputDirections {
		if port == dir {
			return true
		}
	}
	return false
}
func (s *SplitterState) AllowsOutput(dir ConveyorDirection, itemID string) bool {
	return s.IsOutput(dir) && (s.OutputFilters[dir] == "" || s.OutputFilters[dir] == itemID)
}

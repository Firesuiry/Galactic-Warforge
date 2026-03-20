package model

import (
	"fmt"
	"sort"
)

// StorageNode binds a storage state to a stable identifier.
type StorageNode struct {
	ID      string
	Storage *StorageState
}

// StorageNetwork groups connected storages for IO operations.
type StorageNetwork struct {
	Nodes []StorageNode
}

// Insert attempts to insert items into storages by input priority.
func (sn StorageNetwork) Insert(itemID string, qty int) (int, int, error) {
	if qty <= 0 {
		return 0, qty, fmt.Errorf("quantity must be positive")
	}
	nodes := sn.sortedByInputPriority()
	if len(nodes) == 0 {
		return 0, qty, fmt.Errorf("storage network empty")
	}
	accepted := 0
	remaining := qty
	for _, node := range nodes {
		if remaining <= 0 {
			break
		}
		if node.Storage == nil {
			continue
		}
		take, left, err := node.Storage.Receive(itemID, remaining)
		if err != nil {
			return accepted, remaining, err
		}
		accepted += take
		remaining = left
	}
	return accepted, remaining, nil
}

// Extract attempts to extract items from storages by output priority.
func (sn StorageNetwork) Extract(itemID string, qty int) (int, int, error) {
	if qty <= 0 {
		return 0, qty, fmt.Errorf("quantity must be positive")
	}
	nodes := sn.sortedByOutputPriority()
	if len(nodes) == 0 {
		return 0, qty, fmt.Errorf("storage network empty")
	}
	provided := 0
	remaining := qty
	for _, node := range nodes {
		if remaining <= 0 {
			break
		}
		if node.Storage == nil {
			continue
		}
		take, left, err := node.Storage.Provide(itemID, remaining)
		if err != nil {
			return provided, remaining, err
		}
		provided += take
		remaining = left
	}
	return provided, remaining, nil
}

func (sn StorageNetwork) sortedByInputPriority() []StorageNode {
	if len(sn.Nodes) == 0 {
		return nil
	}
	nodes := append([]StorageNode(nil), sn.Nodes...)
	sort.Slice(nodes, func(i, j int) bool {
		pi := inputPriority(nodes[i])
		pj := inputPriority(nodes[j])
		if pi == pj {
			return nodes[i].ID < nodes[j].ID
		}
		return pi > pj
	})
	return nodes
}

func (sn StorageNetwork) sortedByOutputPriority() []StorageNode {
	if len(sn.Nodes) == 0 {
		return nil
	}
	nodes := append([]StorageNode(nil), sn.Nodes...)
	sort.Slice(nodes, func(i, j int) bool {
		pi := outputPriority(nodes[i])
		pj := outputPriority(nodes[j])
		if pi == pj {
			return nodes[i].ID < nodes[j].ID
		}
		return pi > pj
	})
	return nodes
}

func inputPriority(node StorageNode) int {
	if node.Storage == nil {
		return 0
	}
	return node.Storage.InputPriorityValue()
}

func outputPriority(node StorageNode) int {
	if node.Storage == nil {
		return 0
	}
	return node.Storage.OutputPriorityValue()
}

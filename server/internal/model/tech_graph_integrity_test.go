package model

import "testing"

// 科技图完整性：任何科技的前置都必须指向真实存在的科技。
// 回归背景：universe_matrix 曾引用未定义的 "dyson_sphere_partial"，
// 导致它与后继 mission_complete（胜利科技）永久不可达。
func TestTechPrerequisitesAllResolve(t *testing.T) {
	defs := AllTechDefinitions()
	ids := make(map[string]bool, len(defs))
	for _, def := range defs {
		ids[def.ID] = true
	}
	for _, def := range defs {
		for _, prereq := range def.Prerequisites {
			if !ids[prereq] {
				t.Errorf("tech %s references unknown prerequisite %q", def.ID, prereq)
			}
		}
	}
}

// 胜利科技必须可达：从无前置的起点科技出发，沿前置全部满足的顺序
// 应当能推进到 mission_complete，否则该局无法通过任务完成取胜。
func TestMissionCompleteTechIsReachable(t *testing.T) {
	defs := AllTechDefinitions()
	byID := make(map[string]*TechDefinition, len(defs))
	for _, def := range defs {
		byID[def.ID] = def
	}
	if _, ok := byID["mission_complete"]; !ok {
		t.Fatal("mission_complete tech must exist for the mission_complete victory rule")
	}

	// 迭代放松：反复扫描，把前置已满足的科技标记为可达，直到不再新增。
	reachable := make(map[string]bool, len(defs))
	for {
		grew := false
		for _, def := range defs {
			if reachable[def.ID] {
				continue
			}
			ok := true
			for _, prereq := range def.Prerequisites {
				if !reachable[prereq] {
					ok = false
					break
				}
			}
			if ok {
				reachable[def.ID] = true
				grew = true
			}
		}
		if !grew {
			break
		}
	}

	if !reachable["mission_complete"] {
		var blocked []string
		for _, prereq := range byID["mission_complete"].Prerequisites {
			if !reachable[prereq] {
				blocked = append(blocked, prereq)
			}
		}
		t.Fatalf("mission_complete unreachable; unreachable prerequisites: %v", blocked)
	}

	// 顺带保证整棵树没有孤立不可达的科技（环形前置会在此暴露）。
	for _, def := range defs {
		if !reachable[def.ID] {
			t.Errorf("tech %s is unreachable (circular or unsatisfiable prerequisites: %v)", def.ID, def.Prerequisites)
		}
	}
}

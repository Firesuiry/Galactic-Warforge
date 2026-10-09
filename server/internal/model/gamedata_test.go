package model

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"siliconworld/data"
)

// embeddedDataFS 把内置数据复制到可修改的内存 FS。
func embeddedDataFS(t *testing.T) fstest.MapFS {
	t.Helper()
	out := fstest.MapFS{}
	entries, err := fs.ReadDir(data.FS, ".")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		raw, err := fs.ReadFile(data.FS, e.Name())
		if err != nil {
			t.Fatal(err)
		}
		out[e.Name()] = &fstest.MapFile{Data: raw}
	}
	return out
}

func replaceInFile(t *testing.T, fsys fstest.MapFS, name, old, repl string) {
	t.Helper()
	s := string(fsys[name].Data)
	if !strings.Contains(s, old) {
		t.Fatalf("%s does not contain %q", name, old)
	}
	fsys[name] = &fstest.MapFile{Data: []byte(strings.Replace(s, old, repl, 1))}
}

func TestEmbeddedGameDataLoads(t *testing.T) {
	gd, err := LoadGameData(data.FS)
	if err != nil {
		t.Fatal(err)
	}
	if len(gd.Items.Items) != len(itemCatalog) || len(gd.Recipes.Recipes) != len(recipeCatalog) ||
		len(gd.Techs.Techs) != len(techDefinitions) || len(gd.Buildings.Buildings) != len(AllBuildingDefinitions()) {
		t.Fatal("installed registry does not match embedded data")
	}
}

func TestGameDataValidationRejectsBrokenReferences(t *testing.T) {
	cases := []struct {
		name, file, old, repl, want string
	}{
		{"recipe unknown item", GameDataRecipesFile, "{item_id: iron_ore, quantity: 1}", "{item_id: no_such_ore, quantity: 1}", `unknown item "no_such_ore"`},
		{"recipe unknown building", GameDataRecipesFile, "[arc_smelter, plane_smelter", "[no_such_smelter, plane_smelter", `unknown building "no_such_smelter"`},
		{"recipe unknown tech", GameDataRecipesFile, "tech_unlock: [steel_smelting]", "tech_unlock: [no_such_tech]", `unknown tech "no_such_tech"`},
		{"tech unknown prereq", GameDataTechsFile, "prerequisites: [electromagnetism]", "prerequisites: [no_such_tech]", `prerequisite "no_such_tech" not found`},
		{"tech unknown building", GameDataTechsFile, "{type: building, id: matrix_lab}", "{type: building, id: no_such_lab}", `unknown building "no_such_lab"`},
		{"tech unknown recipe", GameDataTechsFile, "{type: recipe, id: motor}", "{type: recipe, id: no_such_recipe}", `unknown recipe "no_such_recipe"`},
		{"pending recipe exists", GameDataTechsFile, "df_strange_annihilation_fuel_rod: ", "smelt_iron: ", `"smelt_iron" already exists`},
		{"building unknown cost item", GameDataBuildingsFile, "{item_id: circuit_board, quantity: 18}", "{item_id: no_such_board, quantity: 18}", `unknown item "no_such_board"`},
		{"turret without weapon class", GameDataBuildingsFile, "      weapon_class: cannon\n", "", "profile.weapon_class is empty"},
		{"unit bad armor", GameDataUnitsFile, "armor_class: light", "armor_class: paper", `invalid armor_class "paper"`},
		{"combat bad weapon", GameDataCombatFile, "  cannon:", "  railgun:", `invalid weapon class "railgun"`},
		{"war unknown component", GameDataWarFile, "component_id: micro_reactor", "component_id: no_such_reactor", `unknown component "no_such_reactor"`},
		{"unknown field", GameDataItemsFile, "    stack_limit: 20\n", "    stack_limt: 20\n", "stack_limt"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fsys := embeddedDataFS(t)
			replaceInFile(t, fsys, tc.file, tc.old, tc.repl)
			_, err := LoadGameData(fsys)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("want error containing %q, got %v", tc.want, err)
			}
		})
	}
}

func TestLoadGameDataDirOverridesEmbedded(t *testing.T) {
	fsys := embeddedDataFS(t)
	replaceInFile(t, fsys, GameDataUnitsFile, "max_hp: 60", "max_hp: 61")
	dir := t.TempDir()
	for name, f := range fsys {
		if err := os.WriteFile(filepath.Join(dir, name), f.Data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	gd, err := LoadGameDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	embedded, err := LoadGameData(data.FS)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { InstallGameData(embedded) })
	InstallGameData(gd)
	if got := UnitStats(UnitTypeWorker).MaxHP; got != 61 {
		t.Fatalf("worker max hp = %d, want 61 from game data dir", got)
	}
	if _, err := LoadGameDataDir(filepath.Join(dir, "missing")); err == nil {
		t.Fatal("missing dir should fail")
	}
}

func TestGameDataRejectsMultipleDocuments(t *testing.T) {
	fsys := embeddedDataFS(t)
	fsys[GameDataUnitsFile].Data = append(fsys[GameDataUnitsFile].Data, []byte("\n---\nunits: []\n")...)
	if _, err := LoadGameData(fsys); err == nil {
		t.Fatal("additional YAML documents must be rejected")
	}
}

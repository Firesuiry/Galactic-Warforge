package gamecore

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
)

// 命令载荷统一解码为强类型结构体：结构体字段用 json 标签命名载荷字段，
// `payload:"required"` 标记必填（缺失报 "payload.x required"），必填的 string
// 字段同时要求非空（"payload.x must be a non-empty string"），
// `payload:"required,allowempty"` 允许空串。类型不符报 "payload.x must be <kind>"。
// 嵌套结构体（含指针与 map 值）的标签同样生效。

// noPayload 是不读载荷的命令的载荷类型。
type noPayload struct{}

func decodePayload[P any](raw map[string]any) (P, error) {
	var p P
	// 先经 JSON 归一化（Go 类型值 → 与网关解码一致的 map/切片/数字），再按标签校验并解码。
	data, err := json.Marshal(raw)
	if err != nil {
		return p, fmt.Errorf("payload invalid: %v", err)
	}
	var normalized map[string]any
	if err := json.Unmarshal(data, &normalized); err != nil {
		return p, fmt.Errorf("payload invalid: %v", err)
	}
	if err := checkPayloadFields(reflect.TypeOf(p), normalized, "payload"); err != nil {
		return p, err
	}
	if err := json.Unmarshal(data, &p); err != nil {
		var typeErr *json.UnmarshalTypeError
		if errors.As(err, &typeErr) {
			return p, fmt.Errorf("payload.%s must be %s", payloadJSONPath(reflect.TypeOf(p), typeErr.Field), payloadKindName(typeErr.Type))
		}
		return p, fmt.Errorf("payload invalid: %v", err)
	}
	return p, nil
}

// checkPayloadFields 按结构体标签校验原始载荷里的必填与非空字段。
func checkPayloadFields(t reflect.Type, raw map[string]any, path string) error {
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t.Kind() != reflect.Struct {
		return nil
	}
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		if field.Anonymous {
			if err := checkPayloadFields(field.Type, raw, path); err != nil {
				return err
			}
			continue
		}
		name, _, _ := strings.Cut(field.Tag.Get("json"), ",")
		if name == "" || name == "-" {
			continue
		}
		opts := field.Tag.Get("payload")
		value, present := raw[name]
		fieldPath := path + "." + name
		if strings.Contains(opts, "required") {
			if !present || (value == nil && field.Type.Kind() != reflect.String) {
				return fmt.Errorf("%s required", fieldPath)
			}
			if field.Type.Kind() == reflect.String && !strings.Contains(opts, "allowempty") && (value == nil || value == "") {
				return fmt.Errorf("%s must be a non-empty string", fieldPath)
			}
		}
		nested, ok := value.(map[string]any)
		if !ok {
			continue
		}
		elem := field.Type
		for elem.Kind() == reflect.Pointer {
			elem = elem.Elem()
		}
		switch elem.Kind() {
		case reflect.Struct:
			if err := checkPayloadFields(elem, nested, fieldPath); err != nil {
				return err
			}
		case reflect.Map:
			for key, entry := range nested {
				if entryMap, ok := entry.(map[string]any); ok {
					if err := checkPayloadFields(elem.Elem(), entryMap, fieldPath+"."+key); err != nil {
						return err
					}
				}
			}
		}
	}
	return nil
}

// payloadJSONPath 去掉 json 报错路径里内嵌结构体的 Go 类型名（如 buildingRef）。
func payloadJSONPath(t reflect.Type, path string) string {
	embedded := map[string]bool{}
	var collect func(reflect.Type)
	collect = func(t reflect.Type) {
		for t.Kind() == reflect.Pointer || t.Kind() == reflect.Slice || t.Kind() == reflect.Map {
			t = t.Elem()
		}
		if t.Kind() != reflect.Struct {
			return
		}
		for i := 0; i < t.NumField(); i++ {
			if t.Field(i).Anonymous {
				embedded[t.Field(i).Name] = true
			}
			collect(t.Field(i).Type)
		}
	}
	collect(t)
	segments := strings.Split(path, ".")
	out := segments[:0]
	for _, segment := range segments {
		if !embedded[segment] {
			out = append(out, segment)
		}
	}
	return strings.Join(out, ".")
}

func payloadKindName(t reflect.Type) string {
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	switch t.Kind() {
	case reflect.String:
		return "a string"
	case reflect.Bool:
		return "boolean"
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return "integer"
	case reflect.Float32, reflect.Float64:
		return "a number"
	case reflect.Slice, reflect.Array:
		return "an array"
	default:
		return "an object"
	}
}

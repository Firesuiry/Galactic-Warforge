package model

// RotatedFootprint is shared by placement reservations and runtime geometry.
func RotatedFootprint(fp Footprint, rotation PlanRotation) Footprint {
	if rotation == PlanRotation90 || rotation == PlanRotation270 {
		fp.Width, fp.Height = fp.Height, fp.Width
	}
	return fp
}

func RotateDirection(dir ConveyorDirection, rotation PlanRotation) ConveyorDirection {
	dirs := []ConveyorDirection{ConveyorNorth, ConveyorEast, ConveyorSouth, ConveyorWest}
	turns := 0
	switch rotation {
	case PlanRotation90:
		turns = 1
	case PlanRotation180:
		turns = 2
	case PlanRotation270:
		turns = 3
	}
	for i, d := range dirs {
		if d == dir {
			return dirs[(i+turns)%4]
		}
	}
	return dir
}

// ApplyBuildingRotation transforms a freshly initialized building exactly once.
func ApplyBuildingRotation(b *Building, rotation PlanRotation) {
	b.Rotation = normalizePlanRotation(rotation)
	fp := b.Runtime.Params.Footprint
	b.Runtime.Params.Footprint = RotatedFootprint(fp, rotation)
	for i := range b.Runtime.Params.IOPorts {
		p := &b.Runtime.Params.IOPorts[i]
		p.Offset.X, p.Offset.Y = rotateOffset(p.Offset.X, p.Offset.Y, fp.Width, fp.Height, rotation)
	}
	for i := range b.Runtime.Params.ConnectionPoints {
		p := &b.Runtime.Params.ConnectionPoints[i]
		p.Offset.X, p.Offset.Y = rotateOffset(p.Offset.X, p.Offset.Y, fp.Width, fp.Height, rotation)
	}
	if f := b.Fractionation; f != nil {
		f.InputDirection = RotateDirection(f.InputDirection, rotation)
		f.HydrogenDirection = RotateDirection(f.HydrogenDirection, rotation)
		f.DeuteriumDirection = RotateDirection(f.DeuteriumDirection, rotation)
	}
	if c := b.SprayCoater; c != nil {
		c.InputDirection = RotateDirection(c.InputDirection, rotation)
		c.OutputDirection = RotateDirection(c.OutputDirection, rotation)
		c.ReagentDirection = RotateDirection(c.ReagentDirection, rotation)
	}
	if s := b.Sorter; s != nil {
		// 分拣器的取/放端直接由 Rotation 派生（SorterFacingAxis），状态里不再存方向，
		// 旋转时无需改写任何字段。
		s.Normalize()
	}
}

// PlanRotationForDirection 是 SorterFacing 的逆：把「正面朝向」换算成建造 rotation。
func PlanRotationForDirection(dir ConveyorDirection) PlanRotation {
	switch dir {
	case ConveyorEast:
		return PlanRotation90
	case ConveyorSouth:
		return PlanRotation180
	case ConveyorWest:
		return PlanRotation270
	default:
		return PlanRotation0
	}
}

// PlanRotation describes footprint rotation in degrees.
type PlanRotation string

const (
	PlanRotation0   PlanRotation = "0"
	PlanRotation90  PlanRotation = "90"
	PlanRotation180 PlanRotation = "180"
	PlanRotation270 PlanRotation = "270"
)

func normalizePlanRotation(rot PlanRotation) PlanRotation {
	switch rot {
	case PlanRotation90, PlanRotation180, PlanRotation270:
		return rot
	default:
		return PlanRotation0
	}
}

func rotateOffset(x, y, width, height int, rot PlanRotation) (int, int) {
	switch rot {
	case PlanRotation90:
		return height - 1 - y, x
	case PlanRotation180:
		return width - 1 - x, height - 1 - y
	case PlanRotation270:
		return y, width - 1 - x
	default:
		return x, y
	}
}

// BlueprintParams captures per-building parameter payloads.
type BlueprintParams map[string]any

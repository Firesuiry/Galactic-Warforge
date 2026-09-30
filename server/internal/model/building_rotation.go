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
		for i, d := range s.InputDirections {
			s.InputDirections[i] = RotateDirection(d, rotation)
		}
		for i, d := range s.OutputDirections {
			s.OutputDirections[i] = RotateDirection(d, rotation)
		}
	}
}

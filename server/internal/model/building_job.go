package model

// BuildingJobType identifies an in-progress building operation.
type BuildingJobType string

const (
	BuildingJobUpgrade  BuildingJobType = "upgrade"
	BuildingJobDemolish BuildingJobType = "demolish"
)

// BuildingJob tracks an upgrade or demolish operation in progress.
type BuildingJob struct {
	Type           BuildingJobType   `json:"type"`
	RemainingTicks int               `json:"remaining_ticks"`
	TargetLevel    int               `json:"target_level,omitempty"`
	RefundRate     float64           `json:"refund_rate,omitempty"`
	PrevState      BuildingWorkState `json:"-"`
}

// Clone returns a copy of the building job state.
func (j *BuildingJob) Clone() *BuildingJob {
	if j == nil {
		return nil
	}
	out := *j
	return &out
}

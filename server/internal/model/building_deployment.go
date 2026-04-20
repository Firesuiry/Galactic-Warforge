package model

// InitBuildingDeploymentState ensures a deployment-capable building has runtime state.
func InitBuildingDeploymentState(building *Building) {
	if building == nil {
		return
	}
	if building.Runtime.Functions.Deployment == nil {
		building.DeploymentState = nil
		return
	}
	if building.DeploymentState == nil {
		building.DeploymentState = &DeploymentHubState{}
	}
	if building.DeploymentState.PayloadInventory == nil {
		building.DeploymentState.PayloadInventory = make(ItemInventory)
	}
}

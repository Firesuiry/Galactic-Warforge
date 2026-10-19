import type { Command, CommandResponse } from '@shared/types';
import type { ApiClient } from '@shared/api';

/**
 * 需要「发令者绑定机甲」的命令（契约 §3.1）：目标里**不再带** `target.entity_id`，
 * 服务端按发令者绑定的机甲执行、按机甲所在行星路由。
 *
 * shared-client 的 `cmdMineResource(entityId, …)` 等旧方法仍要求传执行体 ID（C1 在
 * `r21/clients` 上改签名）；这里统一走通用的 `sendCommands`，避免与 C1 的分支冲突，
 * 合入后也不影响契约口径。
 */
type MechaCommandType =
  | 'mine_resource'
  | 'craft_item'
  | 'cancel_mecha_job'
  | 'refuel_mecha'
  | 'configure_mecha_logistics'
  | 'assign_mecha';

type CommandSender = Pick<ApiClient, 'sendCommands'>;

export function sendMechaCommand(
  client: CommandSender,
  type: Exclude<MechaCommandType, 'assign_mecha'>,
  planetId: string,
  payload: Record<string, unknown> = {},
): Promise<CommandResponse> {
  return client.sendCommands([{
    type: type as Command['type'],
    target: { layer: 'planet', ...(planetId ? { planet_id: planetId } : {}) },
    ...(Object.keys(payload).length > 0 ? { payload } : {}),
  }]);
}

/** assign_mecha：`target.entity_id` = 机甲单位 ID，payload `{operator}`（"" = 解绑）。 */
export function sendAssignMecha(
  client: CommandSender,
  mechaId: string,
  operator: string,
  planetId?: string,
): Promise<CommandResponse> {
  return client.sendCommands([{
    type: 'assign_mecha' as Command['type'],
    target: { layer: 'planet', entity_id: mechaId, ...(planetId ? { planet_id: planetId } : {}) },
    payload: { operator },
  }]);
}

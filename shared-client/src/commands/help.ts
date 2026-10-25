import chalk from 'chalk';

import type { ApiClient } from '../api.js';
import { fmtError } from './format.js';
import type { CommandContext } from './game-commands.js';

const HELP_ENTRIES: Record<string, { usage?: string; desc: string }> = {
  configure_distributor: { usage: '<id> <item_id|none> <none|supply|demand> <local_storage> [--delivery true|false] [--collection true|false]', desc: '配置仓库配送器；省略开关保留原值' },
  install_logistics_bot: { usage: '<id> <quantity> [--source player|storage]', desc: '消耗背包或绑定仓库的机器人安装至配送器' },
  uninstall_logistics_bot: { usage: '<id> <quantity>', desc: '回收空载停靠的配送机器人至背包' },
  configure_mecha_logistics: { usage: '<item:min:max,...|none>', desc: '替换本发令者机甲（我的机甲）的配送请求，最多 8 项，none 清空' },
  mecha: { usage: '<list|assign <mecha_id> [operator]|assign <mecha_id> --release|dispatch <planet_id> [mecha_id]>', desc: '列出本方机甲（含当前作业；Construction 列 active/pending 中 pending 才是排队/缺料）/ 把机甲绑给发令者（operator 缺省 = 自己；--release 解绑；一个发令者可以绑多台）/ dispatch 把机甲投送到另一颗行星' },
  health: { desc: 'Server status and current tick' },
  metrics: { desc: 'Runtime metrics' },
  summary: { desc: 'Game summary (resources, players, map)' },
  stats: { desc: 'Current player statistics' },
  wait: { usage: '<ticks <n>|job|build|item <物品ID> <数量> [--in <建筑ID>]|running <建筑ID>> [--timeout <秒>]', desc: '等到条件成立（轮询，默认 120s）：ticks=tick 前进 n（n 是 tick 数不是秒，秒 = n ÷ tick 速率；10 tick/s 时 wait ticks 500 = 50 秒）；job=我的机甲作业结束；build=我的机甲施工队列清空（缺料/无进展提前返回）；item=背包，或 --in 建筑的主库存 + 输出缓冲（inventory + output_buffer）合计达到数量（所以 inspect 里 inventory 17 + output 3 时 wait 20 已成立）；running=建筑进入 running' },
  briefing: { usage: '[alert_limit]', desc: 'One-shot agent briefing：我的机甲背包（完整）/ 作业、已完成科技与当前研究、告警（带 alert_type 与 building_id）、fleet/war/commands' },
  catalog: { usage: '<buildings [关键词]|building <id>|recipes [--handcraft] [--building <type>] [关键词]|items [关键词]|techs [--available|--done]|units>', desc: '紧凑目录表：建筑造价/占地/解锁科技、配方、物品堆叠、科技成本、可生产单位（GET /catalog）' },
  catalog_commands: { desc: 'Public command structure catalog (GET /catalog/commands)' },
  galaxy: { desc: 'Galaxy list' },
  system: { usage: '[system_id]', desc: 'System details (default: sys-1)' },
  system_runtime: { usage: '[system_id]', desc: 'System runtime state including fleets, contacts, blockades and battle reports' },
  planet: { usage: '[planet_id]', desc: 'Planet summary (default: planet-1-1)' },
  planet_runtime: { usage: '[planet_id] [--mine]', desc: 'Planet runtime: 施工队列（state/wait_reason/剩余 tick）、物流摘要、contacts / frontlines / ground task forces；--mine 只看自己机甲的施工任务' },
  blueprints: { usage: '[blueprint_id]', desc: 'List player warfare blueprints or inspect one blueprint in detail' },
  war_industry: { desc: 'Military production, refit, deployment hub and supply node status' },
  task_forces: { desc: 'Player-owned task force list with supply and command capacity' },
  theaters: { desc: 'Player-owned theater zones and objectives' },
  scene: { usage: '[planet] [x y width height] [--near_x X --near_y Y --radius R] [--json] [--limit N|all]', desc: '局部场景紧凑文本（建筑/资源汇总/单位）；省略 planet = 我的机甲所在星球，省略窗口 = 机甲居中 48×48；--json 输出原始 JSON' },
  find_space: { usage: '<w> <h> [--count N] [--near X Y] [--radius R] [--spacing N] [--planet <id>] [--json]', desc: '找 w×h 全空矩形（按实际占地排除建筑、地面单位、未落成施工任务，地形须 buildable），按距锚点升序，每行同时给「距锚点」「距机甲」；省略 --near = 我的机甲，半径默认 48 最大 128；--spacing N 让任意两个候选的锚点曼哈顿距离 ≥ N（缺省不过滤，互不重叠至少 max(w,h)+1）；只返回不跨球面缝的矩形' },
  plan: { usage: '<build x y type | upgrade building_id | craft_item recipe batches>... [--planet <id>] [--json]  |  plan -  |  plan need <物品ID> <数量> [--from <配方ID>]', desc: '累计用料表：需要 / 背包 / 占用 / 缺口；craft_item <配方> <批数> 把 inputs×批数 计入需要（不算占用）；plan - 从 stdin 每行一条，; 也分隔；缺口沿可手搓配方递归展开到不可手搓/已有库存（最多 3 层），并给本方建筑取料来源（当前数量 + [够]/[不够，还差 N]）；plan need 按配方递归反推到基础原料（最多 6 层、配方环停止），给现有量与缺口，回答「造 N 个要备多少料」；有缺口时退出码非 0' },
  inspect: { usage: '[planet] [building|unit|resource|sector] <entity_id> [--json]', desc: '单个实体人话摘要（状态+原因、库存/缓冲、活跃告警）；省略 planet 同 scene，省略 kind 按 id 前缀推断；--json 输出原始 JSON。不显示库存容量/占用格数，容量查 catalog building <type>' },
  networks: { usage: '[planet] [--json]', desc: '电网：每个网络的发电/用电/建筑数/缺电，以及未接网与欠电建筑；有管网时列出节点数（GET /world/planets/<id>/networks）' },
  fleet_status: { usage: '[fleet_id]', desc: 'Fleet list or one fleet detail' },
  fog: { usage: '[planet_id] [x y width height]', desc: 'ASCII fog slice via /scene (default: 0 0 32 16)' },
  scan_galaxy: { usage: '[galaxy_id]', desc: '登记星系到星图（不改地表迷雾）' },
  scan_system: { usage: '<system_id>', desc: '登记恒星系到星图（不改地表迷雾）' },
  scan_planet: { usage: '<planet_id>', desc: '登记星球到星图（不改地表迷雾）' },
  build: { usage: '<x> <y> <type> [--z <z>] [--direction <dir>] [--recipe <id>] [--rotation 0|90|180|270] [--elevation 0-4] [--approach]', desc: 'Build any server-side buildable structure。x,y 是**占地左上角**（不是中心）：占地大小查 catalog.buildings[].footprint，rotation 90/270 时宽高互换；传送带可用 --elevation 架高（0-4，缺省 0）' },
  move: { usage: '<entity_id> <x> <y> [--z <z>]', desc: 'Move entity to position' },
  attack: { usage: '<entity_id> <target_id>', desc: 'Attack target entity' },
  order: { usage: '<entity_id[,entity_id...]> <attack_move|patrol|guard|hold|follow|retreat|stop> [x y] [--target <entity_id>] [--planet <planet_id>]', desc: 'R5 部队指令：攻击移动/巡逻/守卫/坚守/跟随/撤退/停止（支持逗号分隔批量；--planet 跨行星同 ID 消歧）' },
  haul: { usage: '<unit_id[,unit_id...]> --from <building_id> --to <building_id> [--item <item_id>] [--planet <planet_id>]', desc: '运输机器人往返搬运：起点建筑 → 终点建筑，--item 锁定单一物品（缺省自动选终点能收的第一种）' },
  auto_haul: { usage: '<unit_id[,unit_id...]> [--planet <planet_id>]', desc: '运输机器人切回全局自动搬运（出厂默认）：每 10 tick 按本行星缺料建筑派单，无需求时原地待命' },
  produce: { usage: '<entity_id> <unit_type> [--planet <planet_id>]', desc: 'Produce a server-public world unit（按建筑所在行星结算）' },
  upgrade: { usage: '<entity_id> [--planet <planet_id>]', desc: 'Upgrade building（按建筑所在行星结算）' },
  demolish: { usage: '<entity_id> [--planet <planet_id>]', desc: 'Demolish building（按建筑所在行星结算）' },
  install_logistics_vehicle: { usage: '<station_id> <logistics_drone|logistics_vessel> <quantity> [--source player|station]', desc: '消耗背包或站内成品安装运输器，受站点槽位上限限制' },
  configure_logistics_station: { usage: '<building_id> [--drone-capacity <n>] [--input-priority <n>] [--output-priority <n>] [--interstellar-enabled <true|false>] [--warp-enabled <true|false>] [--ship-slots <n>] [--belt-ports direction:input|output:item_id,...|none]', desc: 'Configure logistics station capacity, priority and interstellar switches' },
  configure_logistics_slot: { usage: '<building_id> <planetary|interstellar> <item_id> [<none|supply|demand|both> <local_storage> | --remove]', desc: '配置物流物品槽；remove移除无库存、无端口或在途引用的空槽' },
  cancel_construction: { usage: '<task_id>', desc: 'Cancel queued or running construction task' },
  restore_construction: { usage: '<task_id>', desc: 'Restore a cancelled construction task' },
  start_research: { usage: '<tech_id>', desc: 'Start researching a technology' },
  cancel_research: { usage: '<tech_id>', desc: 'Cancel a technology in progress or queue' },
  set_recipe: { usage: '<entity_id> [recipe_id] [--planet <planet_id>]', desc: '原地切换生产建筑/研究站配方；省略 recipe_id 时研究站回研究模式、生产建筑转空闲，切换后进度清零、库存保留' },
  set_energy_exchanger_mode: { usage: '<building_id> <charge|discharge|standby> [--planet <planet_id>]', desc: '切换蓄电器能量枢纽模式：charge 电网盈余充蓄电池，discharge 放电回电网，standby 不转换' },
  blueprint_create: { usage: '<blueprint_id> <ground|space> [--name <name>] (--base-frame <base_frame_id> | --base-hull <base_hull_id>)', desc: 'Create a draft warfare blueprint' },
  blueprint_set_component: { usage: '<blueprint_id> <slot_id> <component_id>', desc: 'Set one component on a draft or validated warfare blueprint' },
  blueprint_validate: { usage: '<blueprint_id>', desc: 'Validate a warfare blueprint and receive structured legality issues' },
  blueprint_finalize: { usage: '<blueprint_id> [--target-state <state>]', desc: 'Advance a warfare blueprint to the next or chosen lifecycle state' },
  blueprint_variant: { usage: '<parent_blueprint_id> <blueprint_id> <allowed_slot_ids_csv> [--name <name>]', desc: 'Create a controlled variant from a preset or player blueprint' },
  queue_military_production: { usage: '<building_id> <deployment_hub_id> <blueprint_id> [--count <n>]', desc: 'Queue military production and deliver ready payloads into a deployment hub' },
  refit_unit: { usage: '<building_id> <unit_id> <target_blueprint_id>', desc: 'Send a squad or fleet into authoritative refit' },
  deploy_squad: { usage: '<building_id> <blueprint_id> [--count <n>] [--planet <planet_id>]', desc: 'Consume a squad payload from a hub and create a combat squad' },
  commission_fleet: { usage: '<building_id> <blueprint_id> <system_id> [--count <n>] [--fleet-id <fleet_id>]', desc: 'Consume a fleet payload from a hub and create or reinforce a fleet' },
  fleet_assign: { usage: '<fleet_id> <line|vee|circle|wedge>', desc: 'Change a fleet formation' },
  fleet_attack: { usage: '<fleet_id> <planet_id> <target_id>', desc: 'Order a fleet to attack a target in the same system' },
  fleet_disband: { usage: '<fleet_id>', desc: 'Disband a fleet and remove it from runtime' },
  fleet_move: { usage: '<fleet_id> <target_system_id>', desc: 'Order a fleet to transit to a connected star system' },
  task_force_create: { usage: '<task_force_id> [--name <name>] [--stance <stance>]', desc: 'Create a task force shell for squads and fleets' },
  task_force_assign: { usage: '<task_force_id> <squad|fleet> <member_ids_csv> [--system <system_id>] [--planet <planet_id>]', desc: 'Assign one or more squads or fleets into a task force' },
  task_force_set_stance: { usage: '<task_force_id> <stance>', desc: 'Change task force doctrine and engagement posture' },
  task_force_deploy: { usage: '<task_force_id> [--theater <theater_id>] [--system <system_id>] [--planet <planet_id>] [--x <x> --y <y> [--z <z>]] [--frontline <frontline_id>] [--ground-order <order>] [--support-mode <mode>]', desc: 'Set task force deployment intent, frontline order and orbital support mode' },
  theater_create: { usage: '<theater_id> [--name <name>]', desc: 'Create a theater container for war zoning and objectives' },
  theater_define_zone: { usage: '<theater_id> <zone_type> [--system <system_id>] [--planet <planet_id>] [--x <x> --y <y> [--z <z>]] [--radius <n>]', desc: 'Define or update one theater zone' },
  theater_set_objective: { usage: '<theater_id> <objective_type> [--system <system_id>] [--planet <planet_id>] [--entity <entity_id>] [--description <text>]', desc: 'Set a theater objective anchor and description' },
  blockade_planet: { usage: '<task_force_id> <planet_id>', desc: 'Issue a blockade intent against one planet' },
  transfer: { usage: '<building_id> <item_id> <quantity> [--take] [--planet <planet_id>]', desc: '装料：默认把机甲背包物品装进建筑本地存储；加 --take 从建筑取进背包（受背包容量限制，按建筑所在行星结算）' },
  feed: { usage: '<建筑ID> <物品ID>[:数量][,物品ID[:数量]…] [--wait] [--fill] [--timeout <秒>] [--planet <行星ID>]', desc: '批量装料：把机甲背包里的多种物品累计装入建筑（数量按**本次命令累计装入量**算，不是建筑里的最终数量）。每轮对每项试一次，装入量以背包减少量为准；省略数量或 --fill = 一次装到当前输入窗口上限；--wait = 窗口满了等建筑消耗（默认 120s 超时），要求每项都写数量；STORAGE_FULL（装不下）才等，参数错误立即失败' },
  drain: { usage: '<建筑ID> [物品ID[:数量][,物品ID[:数量]…]] [--to <目标建筑ID>] [--timeout <秒>] [--planet <行星ID>]', desc: '批量取货/转运：不带物品列表 = 取空建筑 inventory + output_buffer 里所有物品（每轮重读，兼容持续产出）；不带 --to 取进机甲背包（背包满即失败并报已取出/源剩余）；--to = 经背包中转装进目标建筑，目标满（STORAGE_FULL）等消耗后重试，默认 120s 超时' },
  mine_resource: { usage: '<resource_id> <quantity> [--planet <planet_id>]', desc: '用我的机甲手动采集固体资源到机甲背包（按发令者机甲所在行星结算）。resource_id 取自 scene 的 resources[].id（资源节点 id，如 r-12），不是物品 id；矿点须在机甲 6 格内' },
  craft_item: { usage: '<recipe_id> <quantity> [--planet <planet_id>]', desc: '用我的机甲背包原料进行个人制造，quantity为批数（按发令者机甲所在行星结算）；可用配方见 help craft_item（读 /catalog 的 handcraft_allowed）' },
  configure_traffic_monitor: { usage: '<building_id> <belt_id|none> --window <1..600> --minimum <0..60> --alerts <on|off>', desc: '监测相邻皮带真实流出量；none 清绑定，配置重置采样' },
  form_squad: { usage: '<entity_id...> [--name <name>] [--planet <id>]', desc: '选中单位编成军团（可含补给车）' },
  squad_order: { usage: '<squad_id> <attack|defend|retreat|resupply> [<x> <y>] [--planet <id>]', desc: '军团指令；resupply 自动前往最近补给站' },
  dissolve_squad: { usage: '<squad_id> [--planet <id>]', desc: '解散军团，单位保留当前指令' },
  set_rally_point:{usage:'<building_id> <x> <y> [--planet <id>]',desc:'设置出厂单位集结点'},
  configure_sorter: { usage: '<building_id> [--mode allow|deny] [--items iron_ore] [--planet <id>]', desc: '配置分拣器物品过滤（方向由建造朝向决定）' },
  configure_splitter: { usage: '<building_id> --inputs west --outputs east,south,north [--input-priority west] [--output-priority east] [--filters east:iron_ore,south:copper_ore]', desc: '完整替换分流器端口、优先级和物品过滤；省略可选项即清除' },
  cancel_mecha_job: { usage: '[--planet <planet_id>]', desc: '取消我的机甲的作业并返还未完成批次原料' },
  refuel_mecha: { usage: '<fuel_item_id> [count] [--planet <planet_id>]', desc: '给我的机甲补能：烧最多 count 块燃料（缺省 1）直到核心充满' },
  dispatch_mecha: { usage: '<planet_id> [mecha_id]', desc: '把发令者的一台机甲瞬移到目标行星（本轮不做飞行时间）；一个发令者绑了多台机甲时必须点名 mecha_id' },
  switch_active_planet: { usage: '<planet_id>', desc: '切换自己的视图焦点/默认落点行星（不影响其他玩家；所有已加载行星始终结算）' },
  set_ray_receiver_mode: { usage: '<building_id> <power|photon|hybrid> [--planet <planet_id>]', desc: 'Switch ray receiver mode（按建筑所在行星结算）' },
  launch_rocket: { usage: '<building_id> <system_id> [--layer <n>] [--count <n>] [--planet <planet_id>]', desc: 'Launch loaded rockets from a Vertical Launching Silo into a Dyson layer' },
  launch_solar_sail: { usage: '<building_id> [--count <n>] [--orbit-radius <n>] [--inclination <n>] [--planet <planet_id>]', desc: 'Launch loaded solar sails from an EM Rail Ejector' },
  build_dyson_node: { usage: '<system_id> <layer_index> <latitude> <longitude> [--orbit-radius <n>]', desc: 'Build a Dyson sphere node' },
  build_dyson_frame: { usage: '<system_id> <layer_index> <node_a_id> <node_b_id>', desc: 'Build a Dyson sphere frame' },
  build_dyson_shell: { usage: '<system_id> <layer_index> <latitude_min> <latitude_max> <coverage>', desc: 'Build a Dyson sphere shell' },
  demolish_dyson: { usage: '<system_id> <node|frame|shell> <component_id>', desc: 'Demolish a Dyson sphere component' },
  agent_list: { desc: 'List agent-gateway agent profiles' },
  agent_create: { usage: '<name> --provider <provider_id> [--role <worker|manager|director>] [--can-create-agents <true|false>] [--command-categories <csv>] [--planet-ids <csv>] [--dispatch-agent-ids <csv>] [--direct-message-agent-ids <csv>]', desc: 'Create an agent-gateway agent profile bound to the current player key' },
  agent_update: { usage: '<agent_id> [--role <worker|manager|director>] [--can-create-agents <true|false>] [--command-categories <csv>] [--planet-ids <csv>] [--dispatch-agent-ids <csv>] [--direct-message-agent-ids <csv>]', desc: 'Patch agent-gateway agent policy or role' },
  agent_message: { usage: '<agent_id> <content>', desc: 'Send one direct task message to an agent thread' },
  agent_thread: { usage: '<agent_id>', desc: 'Inspect one agent thread including messages, tool calls and logs' },
  raw: { usage: '<json>', desc: 'Send raw /commands request JSON' },
  switch: { usage: '[player_id] [key]', desc: 'Switch player' },
  events: { usage: '[count]', desc: 'Show recent SSE events (default: 10)' },
  status: { desc: 'Current player and connection status' },
  audit: { usage: '[options]', desc: 'Query audit log' },
  event_snapshot: { usage: '[options]', desc: 'Query event snapshot' },
  alert_snapshot: { usage: '[--after-id <id>] [--since-tick <n>] [--active-only] [--limit <n>]', desc: 'Query production alert snapshot（仍成立在前、最新在前；--active-only 只过滤已恢复的告警，不按时间过滤——一直没解决的产线问题会一直挂着，看发生时间用 --since-tick 或行内 tick）' },
  alerts: { usage: '[--after-id <id>] [--since-tick <n>] [--active-only] [--limit <n>]', desc: 'alert_snapshot 的别名：产线告警快照，每行带 alert_type 与 building_id；--active-only 只过滤已恢复的，老告警会一直挂着' },
  save: { usage: '[--reason <text>]', desc: 'Trigger manual save' },
  checkpoint: { usage: '<list|save <name>|load <name>> [--note <text>] [--contract <file.json>] [--replace]', desc: '命名存档点：list 列出（登录即可），save 存当前对局（admin，regression 契约须全过；bug- 前缀只记录），load 热加载（admin）' },
  advance: { usage: '<ticks> [--to <tick>] [--no-stop-attack] [--no-stop-alert] [--no-stop-gameover] [--json]', desc: '狂飙模式：快进到目标 tick（admin）；默认在我方受袭/新出现的关键警报（缺电、缺料停工）/对局结束时提前停下' },
  advance_cancel: { desc: '取消进行中的快进（admin）' },
  replay: { usage: '[options]', desc: 'Replay tick range' },
  rollback: { usage: '[options]', desc: 'Rollback to tick' },
  help: { usage: '[command]', desc: 'Show help' },
  clear: { desc: 'Clear screen' },
  quit: { desc: 'Exit' },
};

const HELP_TEXT = [
  chalk.bold('Commands:'),
  '',
  chalk.bold('  Query:'),
  '    health          Server status and current tick',
  '    metrics         Runtime metrics',
  '    summary         Game summary',
  '    stats           Current player statistics',
  '    briefing [n]    Agent briefing snapshot',
  '    wait <ticks <n>|job|build|item <id> <n> [--in <building_id>]|running <building_id>> [--timeout <s>]  等到条件成立（默认 120s；ticks 的 n 是 tick 数，秒 = n ÷ tick 速率）',
  '    catalog <buildings|building|recipes|items|techs|units>  Compact catalog tables',
  '    catalog_commands  Public command structure catalog',
  '    galaxy          Galaxy list',
  '    system [id]     System details',
  '    system_runtime [id]  System runtime with fleets, contacts and battle reports',
  '    planet [id]     Planet summary',
  '    planet_runtime [id] [--mine]  Planet runtime: 施工队列 / 物流摘要 / contacts / frontlines',
  '    blueprints [id] List warfare blueprints or inspect one blueprint',
  '    war_industry    Military production, refit and supply nodes',
  '    task_forces     Task force status, members and supply',
  '    theaters        Theater zones and objectives',
  '    scene [planet] [x y w h]     Compact local scene (default: around my mecha, 48x48)',
  '    find_space <w> <h> [--count N] [--near X Y] [--radius R] [--spacing N]   找全空矩形（避开建筑占地/单位/施工任务；--spacing 互不重叠至少 max(w,h)+1）',
  '    plan <build x y type|upgrade id|craft_item recipe batches>...   累计用料表（需要/背包/占用/缺口）',
  '    plan need <item_id> <qty> [--from recipe_id]   按配方反推基础原料（现有量/缺口）',
  '    inspect [planet] [kind] <id>  Human-readable entity summary (kind inferred from id)',
  '    networks [planet]             Power/logistics networks',
  '    fleet_status [id]    Fleet list or one fleet detail',
  '    fog [id] [x y w h]  ASCII fog slice',
  '',
  chalk.bold('  Discovery:'),
  '    scan_galaxy [id]   登记星系到星图（不改地表迷雾）',
  '    scan_system <id>   登记恒星系到星图（不改地表迷雾）',
  '    scan_planet <id>   登记星球到星图（不改地表迷雾）',
  '',
  chalk.bold('  Game Actions:'),
  '    configure_distributor <id> <item_id|none> <none|supply|demand> <local_storage> [--delivery true|false] [--collection true|false]',
  '    install_logistics_bot <id> <quantity> [--source player|storage]',
  '    uninstall_logistics_bot <id> <quantity>',
  '    configure_mecha_logistics <item:min:max,...|none> [--planet <id>]',
  '    build <x> <y> <type> [--z <z>] [--direction <dir>] [--rotation 0|90|180|270] [--elevation 0-4] [--approach] [--recipe <id>] [--planet <id>]',
  '    move <entity_id> <x> <y> [--z <z>] [--planet <id>]',
  '    attack <entity_id> <target> [--planet <id>]',
  '    order <entity_id[,id...]> <attack_move|patrol|guard|hold|follow|retreat|stop> [x y] [--target <id>] [--planet <id>]',
  '    haul <unit_id[,id...]> --from <building_id> --to <building_id> [--item <item_id>] [--planet <id>]',
  '    auto_haul <unit_id[,id...]> [--planet <id>]   切回全局自动搬运（出厂默认）',
  '    produce <entity_id> <type> [--planet <id>]',
  '    upgrade <entity_id> [--planet <id>]',
  '    demolish <entity_id> [--planet <id>]',
  '    configure_traffic_monitor <building_id> <belt_id|none> --window <1..600> --minimum <0..60> --alerts <on|off>',
  '    configure_splitter <building_id> --inputs west --outputs east,south [--input-priority west] [--output-priority east] [--filters east:iron_ore]',
  '    configure_logistics_station <building_id> [--drone-capacity <n>] [--input-priority <n>] [--output-priority <n>] [--interstellar-enabled <true|false>] [--warp-enabled <true|false>] [--ship-slots <n>] [--belt-ports direction:input|output:item_id,...|none]',
  '    configure_logistics_slot <building_id> <planetary|interstellar> <item_id> <none|supply|demand|both> <local_storage>',
  '    cancel_construction <task_id>',
  '    restore_construction <task_id>',
  '    start_research <tech_id>',
  '    cancel_research <tech_id>',
  '    set_recipe <entity_id> [recipe_id]',
  '    set_energy_exchanger_mode <building_id> <charge|discharge|standby>',
  '    blueprint_create <blueprint_id> <ground|space> [--name <name>] (--base-frame <base_frame_id> | --base-hull <base_hull_id>)',
  '    blueprint_set_component <blueprint_id> <slot_id> <component_id>',
  '    blueprint_validate <blueprint_id>',
  '    blueprint_finalize <blueprint_id> [--target-state <state>]',
  '    blueprint_variant <parent_blueprint_id> <blueprint_id> <allowed_slot_ids_csv> [--name <name>]',
  '    queue_military_production <building_id> <deployment_hub_id> <blueprint_id> [--count <n>]',
  '    refit_unit <building_id> <unit_id> <target_blueprint_id>',
  '    deploy_squad <building_id> <blueprint_id> [--count <n>] [--planet <planet_id>]',
  '    form_squad <entity_id...> [--name <name>] [--planet <id>]',
  '    squad_order <squad_id> <attack|defend|retreat|resupply> [<x> <y>] [--planet <id>]',
  '    dissolve_squad <squad_id> [--planet <id>]',
  '    commission_fleet <building_id> <blueprint_id> <system_id> [--count <n>] [--fleet-id <fleet_id>]',
  '    fleet_assign <fleet_id> <line|vee|circle|wedge>',
  '    fleet_attack <fleet_id> <planet_id> <target_id>',
  '    fleet_disband <fleet_id>',
  '    fleet_move <fleet_id> <target_system_id>',
  '    task_force_create <task_force_id> [--name <name>] [--stance <stance>]',
  '    task_force_assign <task_force_id> <squad|fleet> <member_ids_csv> [--system <system_id>] [--planet <planet_id>]',
  '    task_force_set_stance <task_force_id> <stance>',
  '    task_force_deploy <task_force_id> [--theater <theater_id>] [--system <system_id>] [--planet <planet_id>] [--x <x> --y <y> [--z <z>]] [--frontline <frontline_id>] [--ground-order <order>] [--support-mode <mode>]',
  '    theater_create <theater_id> [--name <name>]',
  '    theater_define_zone <theater_id> <zone_type> [--system <system_id>] [--planet <planet_id>] [--x <x> --y <y> [--z <z>]] [--radius <n>]',
  '    theater_set_objective <theater_id> <objective_type> [--system <system_id>] [--planet <planet_id>] [--entity <entity_id>] [--description <text>]',
  '    blockade_planet <task_force_id> <planet_id>',
  '    transfer <building_id> <item_id> <quantity> [--take] [--planet <id>]   默认装进建筑；--take 从建筑取进背包',
  '    feed <building_id> <item_id:count,...> [--wait|--fill] [--timeout <秒>]     批量装料（累计口径；窗口满自动等）',
  '    drain <building_id> [item_id[:count],...] [--to <building_id>]              批量取空/转运到另一个建筑',
  '    mecha list | mecha assign <mecha_id> [operator|--release] | mecha dispatch <planet_id> [mecha_id]',
  '    mine_resource <resource_id> <quantity>',
  '    craft_item <recipe_id> <quantity>',
  '    cancel_mecha_job',
  '    refuel_mecha <fuel_item_id> [count]',
  '    dispatch_mecha <planet_id> [mecha_id]',
  '    switch_active_planet <planet_id>',
  '    set_ray_receiver_mode <building_id> <power|photon|hybrid>',
  '    launch_rocket <building_id> <system_id> [--layer <n>] [--count <n>]',
  '    launch_solar_sail <building_id> [--count <n>] [--orbit-radius <n>] [--inclination <n>]',
  '    build_dyson_node <system_id> <layer_index> <latitude> <longitude> [--orbit-radius <n>]',
  '    build_dyson_frame <system_id> <layer_index> <node_a_id> <node_b_id>',
  '    build_dyson_shell <system_id> <layer_index> <latitude_min> <latitude_max> <coverage>',
  '    demolish_dyson <system_id> <node|frame|shell> <component_id>',
  '',
  chalk.bold('  Agent Gateway:'),
  '    agent_list',
  '    agent_create <name> --provider <provider_id> [--role <worker|manager|director>] [--can-create-agents <true|false>] [--command-categories <csv>] [--planet-ids <csv>] [--dispatch-agent-ids <csv>] [--direct-message-agent-ids <csv>]',
  '    agent_update <agent_id> [--role <worker|manager|director>] [--can-create-agents <true|false>] [--command-categories <csv>] [--planet-ids <csv>] [--dispatch-agent-ids <csv>] [--direct-message-agent-ids <csv>]',
  '    agent_message <agent_id> <content>',
  '    agent_thread <agent_id>',
  '',
  chalk.bold('  Admin/Debug:'),
  '    audit [options]             Query audit log',
  '    event_snapshot [options]    Query event snapshot',
  '    alert_snapshot [options]    Query production alert snapshot',
  '    alerts [options]            Alias of alert_snapshot',
  '    save [--reason <text>]     Trigger manual save',
  '    checkpoint <list|save <name>|load <name>>  命名存档点（save/load 仅 admin）',
  '    replay [options]            Replay tick range',
  '    rollback [options]          Rollback to tick',
  '    raw <json>                  Send raw /commands request JSON',
  '',
  chalk.bold('  Util:'),
  '    switch [player_id] [key]  Switch player',
  '    events [count]            Show recent SSE events',
  '    status                    Current player & server',
  '    help [command]            Show help',
  '    clear                     Clear screen',
  '    quit / exit               Exit',
].join('\n');

async function getProduceHelp(api: ApiClient): Promise<string> {
  const usage = '<entity_id> <unit_type>';
  try {
    const catalog = await api.fetchCatalog();
    const units = (catalog.world_units ?? [])
      .filter((entry) => entry.public && entry.production_mode === 'world_produce' && entry.runtime_class === 'world_unit')
      .map((entry) => entry.id);
    if (units.length > 0) {
      return `${chalk.bold('produce')} ${chalk.dim(usage)}\n  Produce a server-public world unit from /catalog.world_units: ${units.join(', ')}`;
    }
  } catch {
    // Fall back to generic help when the server is unavailable.
  }
  return `${chalk.bold('produce')} ${chalk.dim(usage)}\n  Produce a server-public world unit; available ids come from /catalog.world_units when the server is reachable`;
}

/** 可手搓配方从 /catalog.recipes[handcraft_allowed] 动态列（同 help produce 的做法）。 */
async function getCraftItemHelp(api: ApiClient): Promise<string> {
  const usage = '<recipe_id> <quantity> [--planet <planet_id>]';
  const head = `${chalk.bold('craft_item')} ${chalk.dim(usage)}\n  用我的机甲背包原料进行个人制造，quantity 为批数（按发令者机甲所在行星结算）。`;
  try {
    const catalog = await api.fetchCatalog();
    const names = new Map((catalog.items ?? []).map((item) => [item.id, item.name]));
    const recipes = (catalog.recipes ?? []).filter((recipe) => recipe.handcraft_allowed);
    if (recipes.length === 0) {
      return `${head}\n  /catalog 里没有可手搓配方。`;
    }
    const lines = [head, `  可手搓配方（${recipes.length}，来自 /catalog.recipes）：`];
    for (const recipe of recipes) {
      const inputs = (recipe.inputs ?? [])
        .map((item) => `${names.get(item.item_id) ?? item.item_id}×${item.quantity}`)
        .join('+');
      const outputs = (recipe.outputs ?? [])
        .map((item) => `${names.get(item.item_id) ?? item.item_id}×${item.quantity}`)
        .join('+');
      lines.push(`    ${recipe.id}  ${inputs} -> ${outputs}  (${recipe.duration} tick)`);
    }
    return lines.join('\n');
  } catch {
    return `${head}\n  可手搓配方（handcraft_allowed=true）在服务端可达时从 /catalog 动态列出。`;
  }
}

/** tick 速率（tick/秒）：优先 /games/current 的 max_tick_rate，取不到就说明换算方式。 */
async function getTickRate(api: ApiClient): Promise<number | undefined> {
  try {
    const game = await api.fetchCurrentGame();
    return game.max_tick_rate > 0 ? game.max_tick_rate : undefined;
  } catch {
    return undefined;
  }
}

/** `help wait`：N 是 tick 数，按服务端 tick 速率换算成秒，并给例子。 */
async function getWaitHelp(api: ApiClient): Promise<string> {
  const entry = HELP_ENTRIES.wait;
  const rate = await getTickRate(api);
  const rateText = rate
    ? `本服 ${rate} tick/秒（/games/current 的 max_tick_rate）：wait ticks 500 ≈ ${Math.round(500 / rate)} 秒`
    : 'tick 速率取 /games/current 的 max_tick_rate（或 /health 推进速度），秒 = N ÷ 速率';
  return [
    `${chalk.bold('wait')} ${chalk.dim(entry.usage)}`,
    `  ${entry.desc}`,
    '',
    `  ${chalk.bold('ticks')}：N 是 ${chalk.bold('tick 数')}，不是秒。${rateText}。`,
    '  例：',
    '    wait ticks 500 --timeout 90     # 等 500 tick（10 tick/s 时约 50 秒；默认超时 120s 够用）',
    '    wait job                        # 等我的机甲手搓/采矿作业结束',
    '    wait item circuit_board 4 --in b-79   # 等研究站攒够 4 块电路板',
  ].join('\n');
}

function getCommandHelp(cmd: string, api: ApiClient): string | Promise<string> {
  const entry = HELP_ENTRIES[cmd];
  if (!entry) {
    return fmtError(`Unknown command: ${cmd}`);
  }
  if (cmd === 'produce') {
    return getProduceHelp(api);
  }
  if (cmd === 'craft_item') {
    return getCraftItemHelp(api);
  }
  if (cmd === 'wait') {
    return getWaitHelp(api);
  }
  return `${chalk.bold(cmd)} ${chalk.dim(entry.usage ?? '')}\n  ${entry.desc}`;
}

export function cmdHelp(args: string[], { api }: CommandContext): string | Promise<string> {
  if (args[0]) {
    return getCommandHelp(args[0], api);
  }
  return HELP_TEXT;
}

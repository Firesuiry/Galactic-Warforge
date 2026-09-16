/**
 * Real CLI replay on an isolated config-war.yaml + map-war.yaml server.
 * SW_SERVER=http://127.0.0.1:19482 client-cli/node_modules/.bin/tsx scripts/playtest-transport.ts
 * Optional: SW_TRANSPORT_EVIDENCE=/tmp/sw-transport-review
 * The server must use an isolated data_dir; no save/state is edited by this script.
 */
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { dispatch } from '../client-cli/src/commands/index.ts';
import * as api from '../client-cli/src/api.ts';

const evidence = process.env.SW_TRANSPORT_EVIDENCE || '/tmp/sw-transport-review';
const planet = 'planet-1-1';
const bounds = { x: 0, y: 0, width: 24, height: 12 };
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
api.setAuth('p1', 'key_player_1');
mkdirSync(evidence, { recursive: true });

async function scene() { return api.fetchPlanetScene(planet, bounds); }
function at(snapshot: Awaited<ReturnType<typeof scene>>, x: number, y: number) {
  return Object.values(snapshot.buildings).find(b => b.position.x === x && b.position.y === y);
}

async function command(line: string) {
  const before = await api.fetchHealth();
  const output = await dispatch(line, { currentPlayer: 'p1' } as Parameters<typeof dispatch>[1]);
  const requestId = output.match(/request_id=([^\s]+)/)?.[1];
  if (!requestId) throw new Error(output);
  for (let attempt = 0; attempt < 80; attempt++) {
    await pause(150);
    const snapshot = await api.fetchEventSnapshot({ event_types: ['command_result'], since_tick: before.tick, limit: 100 });
    const event = snapshot.events.find(e => e.payload.request_id === requestId);
    if (!event) continue;
    appendFileSync(`${evidence}/commands.jsonl`, `${JSON.stringify({ command: line, output, event })}\n`);
    if (event.payload.code !== 'OK') throw new Error(JSON.stringify(event));
    console.log(line, event.payload.code);
    return;
  }
  throw new Error(`No authoritative command_result: ${line}`);
}

async function build(x: number, y: number, type: string, options = '') {
  const existing = at(await scene(), x, y);
  if (existing && existing.type !== type) throw new Error(`Occupied: ${x},${y}`);
  if (!existing) await command(`build ${x} ${y} ${type} ${options}`.trim());
  for (let attempt = 0; attempt < 200; attempt++) {
    const building = at(await scene(), x, y);
    if (building?.runtime.state === 'running') return building;
    await pause(200);
  }
  throw new Error(`Building did not reach running: ${x},${y}`);
}

async function move(x: number, y: number) {
  const executor = Object.values((await scene()).units).find(unit => unit.type === 'executor' && unit.owner_id === 'p1');
  if (!executor) throw new Error('No p1 executor');
  await command(`move ${executor.id} ${x} ${y}`);
  for (let attempt = 0; attempt < 100; attempt++) {
    const unit = (await scene()).units[executor.id];
    if (unit?.position.x === x && unit.position.y === y && !unit.is_moving) return;
    await pause(100);
  }
  throw new Error(`Executor did not arrive: ${x},${y}`);
}

function measure(snapshot: Awaited<ReturnType<typeof scene>>) {
  const sorter = at(snapshot, 9, 0)!;
  const depot = at(snapshot, 13, 3)!;
  const quantity = Object.values({ inventory: depot.storage?.inventory, input: depot.storage?.input_buffer, output: depot.storage?.output_buffer })
    .reduce((sum, inventory) => sum + (inventory?.iron_ingot || 0), 0);
  return { tick: snapshot.tick, ironIngots: quantity, transfer: sorter.sorter?.last_transfer };
}

async function main() {
  if (!at(await scene(), 13, 3)) {
    // Supply the new line before waiting for its first consumer to run.
    for (let x = 4; x <= 6; x++) await build(x, 1, 'wind_turbine');
    await build(3, 1, 'mining_machine');
    await build(3, 0, 'conveyor_belt_mk1', '--direction east');
    await build(4, 0, 'conveyor_belt_mk1', '--direction east');
    await move(7, 2);
    for (let x = 5; x <= 8; x++) await build(x, 0, 'conveyor_belt_mk1', '--direction east');
    await build(9, 0, 'sorter_mk1');
    await build(10, 0, 'conveyor_belt_mk1', '--direction east');
    await build(10, 2, 'tesla_tower');
    await move(10, 4);
    await move(13, 4);
    for (let x = 11; x <= 12; x++) await build(x, 0, 'conveyor_belt_mk1', '--direction east');
    await build(13, 0, 'conveyor_belt_mk1', '--direction south');
    await build(13, 1, 'arc_smelter', '--recipe smelt_iron');
    await build(13, 2, 'conveyor_belt_mk1', '--direction south');
    await build(13, 3, 'depot_mk1');
    await build(12, 3, 'wind_turbine');
    await build(12, 4, 'wind_turbine');
  }
  const before = await scene();
  writeFileSync(`${evidence}/snapshot-before.json`, JSON.stringify(before, null, 2));
  const first = measure(before);
  for (let attempt = 0; attempt < 45; attempt++) {
    await pause(1000);
    const after = await scene();
    const last = measure(after);
    if (last.ironIngots > first.ironIngots && (last.transfer?.sequence || 0) > (first.transfer?.sequence || 0)) {
      writeFileSync(`${evidence}/snapshot-after.json`, JSON.stringify(after, null, 2));
      writeFileSync(`${evidence}/growth.json`, JSON.stringify({ before: first, after: last }, null, 2));
      console.log(JSON.stringify({ before: first, after: last }, null, 2));
      console.log(await dispatch('save', { currentPlayer: 'p1' } as Parameters<typeof dispatch>[1]));
      return;
    }
  }
  throw new Error('No real sorter transfer and downstream iron ingot growth within 45 seconds');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

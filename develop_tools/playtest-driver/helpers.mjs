// 试玩 1009 页面内 helper（挂到 node 进程 globalThis.G，跨请求复用）。
// 关键点：
//  - 瞄准用 window.__planetThree.lastHover（场景真实 hover 值），比读调试面板 dt 稳定。
//  - 每次点击前把抽屉/调试面板收起，避免布局位移把画布推歪。
//  - 所有建造/取出/手搓都做一次「结果校验」，失败自动换候选点重试。
export function install(page, L) {
  const g = globalThis;
  g.G = g.G || {};
  const G = g.G;

  G.debugOpen = () => page.evaluate(() => !!document.querySelector('.debug-panel--open'));
  G.debugShow = async (want) => {
    if ((await G.debugOpen()) === want) return;
    const b = page.getByRole('button', { name: want ? '展开调试' : '收起调试' }).first();
    if (await b.count()) { await b.click({ force: true }); await L.sleep(650); }
  };
  G.drawerOpen = () => page.evaluate(() => !!document.querySelector('.planet-drawer--open'));
  G.openDrawer = async () => {
    if (!(await G.drawerOpen())) { await page.locator('.planet-drawer__handle').first().click(); await L.sleep(850); }
    return G.drawerOpen();
  };
  G.closeDrawer = async () => {
    if (await G.drawerOpen()) { await page.locator('.planet-drawer__handle').first().click(); await L.sleep(550); }
    return G.drawerOpen();
  };
  G.ensureBar = async () => {
    const cls = await page.evaluate(() => document.querySelector('.planet-build-bar')?.className ?? '');
    if (cls.includes('docked')) { await page.getByRole('button', { name: '建造栏' }).first().click(); await L.sleep(650); }
  };
  G.home = async () => {
    await page.keyboard.press('Escape'); await L.sleep(250);
    await G.closeDrawer(); await G.debugShow(false);
    await page.getByRole('button', { name: '聚焦基地' }).click(); await L.sleep(1400);
    const b = page.locator('button[aria-label="3D 缩小"]');
    let sp = 0;
    for (let i = 0; i < 12; i++) {
      const a = await L.tilePos(page, { x: 18, y: 48 }), c = await L.tilePos(page, { x: 22, y: 48 });
      sp = Math.hypot(a.x - c.x, a.y - c.y) / 4;
      if (sp <= 55) break; await b.click().catch(() => {}); await L.sleep(650);
    }
    return sp;
  };
  G.look = async (tile, px = 44) => {
    await page.keyboard.press('Escape'); await L.sleep(200);
    await G.closeDrawer(); await G.debugShow(false);
    await L.focus(page, tile, false); await L.sleep(1200);
    const b = page.locator('button[aria-label="3D 缩小"]');
    let sp = 0;
    for (let i = 0; i < 14; i++) {
      const a = await L.tilePos(page, tile), c = await L.tilePos(page, { x: tile.x, y: tile.y + 3 });
      sp = Math.hypot(a.x - c.x, a.y - c.y) / 3;
      if (sp <= px) break; await b.click().catch(() => {}); await L.sleep(420);
    }
    return sp;
  };
  G.resetView = async () => {
    await G.debugShow(false); await G.closeDrawer(); await L.sleep(300);
    return page.locator('.planet-three__surface canvas').boundingBox();
  };
  G.aim = async (tile) => {
    const box = await G.resetView();
    const p = await L.tilePos(page, tile);
    const px = await L.tilePos(page, { x: tile.x + 1, y: tile.y });
    const py = await L.tilePos(page, { x: tile.x, y: tile.y + 1 });
    const ex = { x: px.x - p.x, y: px.y - p.y }, ey = { x: py.x - p.x, y: py.y - p.y };
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    let x = p.x, y = p.y;
    for (let i = 0; i < 10; i++) {
      const sx = clamp(box.x + x, box.x + 4, box.x + box.width - 4);
      const sy = clamp(box.y + y, box.y + 4, box.y + box.height - 4);
      await page.mouse.move(box.x + 25, box.y + 25); await L.sleep(80);
      await page.mouse.move(sx, sy); await L.sleep(340);
      const h = await page.evaluate(() => window.__planetThree.lastHover ?? null);
      if (!h) { await L.sleep(220); continue; }
      const dx = tile.x - h.x, dy = tile.y - h.y;
      if (!dx && !dy) return { x: sx, y: sy, ok: true, h };
      if (Math.abs(dx) > 25 || Math.abs(dy) > 25) return { x: sx, y: sy, ok: false, h };
      x += dx * ex.x + dy * ey.x; y += dx * ex.y + dy * ey.y;
    }
    return { x: box.x + x, y: box.y + y, ok: false };
  };
  G.clickTile = async (tile) => { const a = await G.aim(tile); if (!a.ok) return a; await page.mouse.click(a.x, a.y); return a; };
  G.rightClickTile = async (tile) => { const a = await G.aim(tile); if (!a.ok) return a; await page.mouse.click(a.x, a.y, { button: 'right' }); return a; };
  G.fb = async () => (await page.locator('body').innerText()).match(/最新反馈[^\n]*/)?.[0] ?? '';

  G.buildOnce = async (id, x, y, recipe) => {
    await G.debugShow(false); await G.closeDrawer(); await G.ensureBar();
    const card = page.locator(`.planet-build-card[data-building-id="${id}"]`);
    await card.scrollIntoViewIfNeeded(); await L.sleep(150); await card.click(); await L.sleep(600);
    if (recipe) { const sel = page.locator('.planet-build-bar select').first(); if (await sel.count()) { await sel.selectOption(recipe).catch(() => {}); await L.sleep(250); } }
    const a = await G.clickTile({ x, y }); await L.sleep(1500);
    const fb = await G.fb();
    await page.keyboard.press('Escape'); await L.sleep(250);
    return { id, x, y, aimOk: a.ok, h: a.h, fb };
  };
  G.build = async (id, x, y, recipe, alt) => {
    let r = await G.buildOnce(id, x, y, recipe);
    if (/已排队/.test(r.fb)) return r;
    for (const [ax, ay] of (alt || [])) { r = await G.buildOnce(id, ax, ay, recipe); if (/已排队/.test(r.fb)) return r; }
    return r;
  };
  G.buildNear = async (id, cx, cy, recipe, maxD = 10) => {
    const sc = await L.scene(0, 0, 288, 192);
    const t = sc.terrain;
    const rs = new Set((sc.resources || []).map((r) => `${r.position.x},${r.position.y}`));
    const bs = new Set(Object.values(sc.buildings || {}).map((b) => `${b.position.x},${b.position.y}`));
    const cands = [];
    for (let d = 1; d <= maxD && cands.length < 14; d++) {
      for (let dx = -d; dx <= d; dx++) for (let dy = -d; dy <= d; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 1 || y < 1 || x >= 288 || y >= 192) continue;
        if (t[y][x] !== 'buildable' || rs.has(`${x},${y}`) || bs.has(`${x},${y}`)) continue;
        cands.push([x, y]);
      }
    }
    if (!cands.length) return { id, fb: 'no-candidate' };
    return G.build(id, cands[0][0], cands[0][1], recipe, cands.slice(1));
  };

  G.selectBuilding = async (tile) => {
    for (let i = 0; i < 4; i++) {
      await G.closeDrawer();
      const a = await G.clickTile(tile); await L.sleep(900);
      await G.openDrawer();
      const info = await page.evaluate(() => {
        const m = document.body.innerText.match(/建筑详情[\s\S]{0,220}/);
        if (!m) return null;
        const pos = m[0].match(/坐标\n\((\d+), (\d+)/);
        return { x: pos ? Number(pos[1]) : null, y: pos ? Number(pos[2]) : null };
      });
      if (info && info.x === tile.x && info.y === tile.y) return true;
      await L.sleep(400);
    }
    return false;
  };
  G.withdraw = async (tile, itemId, qty) => {
    if (!(await G.selectBuilding(tile))) return 'select-failed';
    const sel = page.getByRole('combobox', { name: '取出物品' });
    if (!(await sel.count())) return 'no-form';
    await sel.selectOption(itemId).catch((e) => String(e));
    await L.sleep(200);
    await page.getByLabel('取出数量').fill(String(qty)); await L.sleep(200);
    // 总览栏(outliner)会拦截 pointer events，用 dispatchEvent 直发点击
    await page.getByRole('button', { name: '取出' }).first().dispatchEvent('click'); await L.sleep(1500);
    return G.fb();
  };
  G.mecha = async () => {
    const sc = await L.scene(0, 0, 288, 192);
    return Object.values(sc.units || {}).find((x) => x.owner_id === 'p1' && x.type === 'executor') || null;
  };
  G.handcraft = async (recipeId, batches) => {
    const u = await G.mecha();
    if (!u) return 'no-mecha';
    if (u.mecha?.job) return 'busy:' + u.mecha.job.recipe_id;
    await G.closeDrawer();
    await G.clickTile({ x: u.position.x, y: u.position.y }); await L.sleep(1000);
    await G.openDrawer();
    const sel = page.getByRole('combobox', { name: '个人制造配方' });
    if (!(await sel.count())) return 'no-select';
    await sel.selectOption(recipeId).catch((e) => String(e)); await L.sleep(300);
    await page.locator('.planet-drawer input[type="number"]').last().fill(String(batches)); await L.sleep(300);
    const btn = page.getByRole('button', { name: /^开始制造$/ }).first();
    if (await btn.isDisabled()) return 'disabled';
    await btn.dispatchEvent('click'); await L.sleep(1300);
    return G.fb();
  };
  G.jobBusy = async () => Boolean((await G.mecha())?.mecha?.job);
  G.jobWait = async (ms = 240000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (!(await G.jobBusy())) return 'done';
      await L.sleep(4000);
    }
    return 'timeout';
  };
  G.state = async () => {
    const s = await L.summary();
    const sc = await L.scene(0, 0, 288, 192);
    return {
      tick: s.tick,
      res: s.players.p1.resources,
      inv: s.players.p1.inventory,
      energy: s.players.p1.stats.energy_stats,
      research: s.players.p1.tech.current_research,
      done: s.players.p1.tech.completed_techs,
      combat: s.players.p1.stats.combat_stats,
      dark: s.players.p1.dark_fog,
      b: Object.values(sc.buildings || {}).filter((b) => b.owner_id === 'p1').map((b) => `${b.type}@${b.position.x},${b.position.y}`),
      b2: Object.values(sc.buildings || {}).filter((b) => b.owner_id === 'p2').map((b) => `${b.type}@${b.position.x},${b.position.y}`),
      u: Object.values(sc.units || {}).filter((u) => u.owner_id === 'p1').map((u) => `${u.type}@${u.position.x},${u.position.y}`),
      u2: Object.values(sc.units || {}).filter((u) => u.owner_id === 'p2').map((u) => `${u.type}@${u.position.x},${u.position.y}:hp${u.hp}`),
    };
  };
  return G;
}

// —— 本轮（1010）新增：可点击区域校验 ——
// 底部建造栏/选中条/抽屉会盖住画布下部，投影点落在这些面板上时点击不会到地图。
// pickTile 会先确认该像素点命中的是画布，否则在目标格附近找一格命中的替代点。
const G = (globalThis.G ??= {});
G.hitCanvas = async (tile) => {
  const box = await page.locator('.planet-three__surface canvas').boundingBox();
  const p = await L.tilePos(page, tile);
  if (!p?.visible) return null;
  const el = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? e.tagName : null; }, [box.x + p.x, box.y + p.y]);
  return el === 'CANVAS' ? { x: box.x + p.x, y: box.y + p.y } : null;
};
// 返回一组「服务端可达 + 投影可见 + 像素命中画布」的候选格
G.freeTiles = async (cx, cy, minD = 12, maxD = 40, want = 4) => {
  const sc = await L.scene(0, 0, 288, 192);
  const mod = await import('./cube.mjs');
  const t = sc.terrain, key = (p) => p.y * 288 + p.x;
  const all = new Set(Object.values(sc.buildings || {}).map((b) => `${b.position.x},${b.position.y}`));
  const w = (p) => p.x >= 0 && p.y >= 0 && p.x < 288 && p.y < 192 && t[p.y][p.x] === 'buildable' && !all.has(`${p.x},${p.y}`);
  const dist = new Map([[key({ x: cx, y: cy }), 0]]); const q = [{ x: cx, y: cy }];
  for (let i = 0; i < q.length; i++) { const c = q[i]; const d = dist.get(key(c)); for (const dir of ['north', 'east', 'south', 'west']) { const n = mod.surfaceStep(c, dir, 96).tile, k = key(n); if (!dist.has(k) && w(n)) { dist.set(k, d + 1); q.push(n); } } }
  const cands = [];
  for (const [k, d] of dist) { const x = k % 288, y = Math.floor(k / 288); if (d >= minD && d <= maxD) cands.push({ x, y, d }); }
  cands.sort((a, b) => b.d - a.d);
  const out = [];
  for (const c of cands) { const h = await G.hitCanvas(c); if (h) { out.push({ ...c, px: h.x, py: h.y }); if (out.length >= want) break; } }
  return out;
};
// 在 move 模式下点击目标格（球面求交，不依赖 hover）
G.moveTo = async (tile) => {
  const u = await G.mecha(); if (!u) return 'no-mecha';
  await G.debugShow(false); await G.closeDrawer();
  await G.look(u.position, 34);
  await G.clickTile(u.position); await L.sleep(1000);
  await page.getByRole('button', { name: /^移动$/ }).first().click(); await L.sleep(500);
  const h = await G.hitCanvas(tile);
  if (!h) { await page.keyboard.press('Escape'); return 'tile-not-clickable'; }
  await page.mouse.click(h.x, h.y);
  await L.sleep(4000);
  await page.keyboard.press('Escape'); await L.sleep(300);
  return G.fb();
};

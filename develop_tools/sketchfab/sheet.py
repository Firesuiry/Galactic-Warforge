"""sheet：候选 → 联系表 PNG（4×2，每格缩略图 + 两行小字）。

用法：
    python3 develop_tools/sketchfab/sheet.py --raw tmp/3a-models/raw.json --out-dir tmp/3a-models

筛选规则（写进报告）：
- 只要 downloadable=true（search 已过滤）；
- 面数 ≤ 300k；
- 许可优先 CC0 > CC-BY > CC-BY-SA；CC-BY-NC* 只在「合格候选不足 8 个」时补入，
  并在图上打红框 + 「NC」角标；
- 名称/tag 命中整栋场景、房间内景、玩具卡通词表的剔除（士兵槽允许写实人形）；
- 同一槽位合并多个关键词的结果去重，按 `点赞数^0.5 × 相关度` 取前 8。

输出：
    <out-dir>/candidates.json
    <out-dir>/sheets/<序号>-<槽位>.png
    <out-dir>/sheets/00-packs-<组名>.png
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
import slots as S  # noqa: E402

THUMB_CACHE = Path("/tmp/sketchfab-cache/thumbs")
FONT_REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
FONT_BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"

CELL_W, CELL_H = 300, 225
COLS, ROWS = 4, 2
PAD = 16
TEXT_H = 52
HEADER_H = 84

# 名称/tag 里出现即剔除（整栋场景、房间内景、玩具卡通）
BAN_WORDS = [
    "interior", "room ", "room-", "indoor", "environment", "diorama", "level design",
    "toy", "cartoon", "chibi", "kawaii", "lego", "minecraft", "roblox", "fnaf",
    "voxel", "low poly asset pack", "street scene", "city block", "museum",
    "church", "cathedral", "restaurant", "kitchen", "bedroom", "living room",
    "toilet", "skibidi", "nft", "college", "school",
    # 与科幻工业无关的「同词不同义」：家具/日用/装饰/生物/武器/历史
    "furniture", "sofa", "couch", "chair", "table", "lamp", "chandelier", "candle",
    "wood shingle", "shingle", "roof tile", "fireplace", "oven", "stove", "cook",
    "game asset", "anime", "fan art", "fanart", "concept art", "sword", "shield ",
    "helmet", "armor set", "armour", "rifle", "pistol", "gun model", "knife", "dagger",
    "medieval", "roman", "greek", "ww1", "ww2", "world war", "historic", "historical",
    "animal", "rat ", "rat_", "insect", "plant", "tree", "flower", "fish", "bird",
    "horror", "backrooms", "creepy", "zombie", "skull", "skeleton",
    # 非工业物件 / 游戏地图 / 品牌周边（同一关键词的误命中）
    "coffee", "memento", "mug", "cup ", "bottle", "food", "cake", "bread",
    "foundry map", "multiplayer", "halo ", "halo3", "level ", "map ",
    "fly trap", "flytrap", "trap", "jimmy", "character ", "figure ", "figurine",
    "plush", "sticker", "poster", "logo", "sign ",
    # 其它 IP 的派生角色 / 影视角色（许可虽可用，但造型与本作世界观冲突）
    "tower of fantasy", "uber soldier", "metro exodus", "clown", "halo", "predator",
    "alien vs", "avp", "star wars", "star trek", "tie ", "x-wing", "starfighter",
    "drop pod", "doom ", "warhammer", "40k", "terminator", "cyberpunk 2077",
    "league of legends", "genshin", "overwatch", "destiny ", "starcraft",
    "tripod", "rice field", "sen goku", "sengoku", "nova solution", "quad thorn",
    "magnetic train", "magnetic vehicle", "battery train", "gravitas",
    "bombed", "ruins", "ruined", "abandoned city", "guest base", "base delta",
    "starbase", "fontana", "first aid", "medkit", "fastener", "bolt kit", "screw kit",
    "health kit", "battletech", "bo t hangar", "hangar bay", "e-walking", "e walking",
    "scout soviet", "bo t", "機庫", "hangar 3d", "battletech",
    "iron ore", "ore chunk", "eotech", "scope ", "tinbot", "automata",
    "hoverboard", "material demo", "clear coat", "screenshot", "render test",
    "car jack", "jack stand", "garage", "halloween", "rom ", "xci", "nsp",
    "simulator", "bus ", "bus lowpoly", "kart", "drill kart", "loader",
    "lincoln", "town car", "gmc ", "vendura", "price car", "bicycle", "car lift",
    "sedan", "hatchback", "civilian car", "passenger car", "pickup truck",
    "optimus", "transformers", "gripen", "jas 39", "pondy", "fighter jet",
    "mule.x4", "logistics walker",
    # 特定载具型号/品牌（军车/民车），与「补给/维修」语义无关
    "lightbody", "ramcharger", "dodge", "ford ", "ural", "boar-53", "boar 53",
    "humvee", "hmmwv", "land rover", "jeep wrangler", "ambulance",
    "grafitti", "graffiti", "soviet btr", "btr-80", "ifv", "fighting vehicle",
    "hangar pipes", "rusted hangar", "military outpost kit",
    "barn", "farmhouse", "farm house", "cabin", "cottage", "shed ", "log house",
    # 手持武器 / 实验室小器材 / 民用加油站（建筑槽误命中）
    "hand railgun", "handrailgun", "uzi", "sniper", "handheld", "hand gun",
    "diybio", "ventilador", "talha", "centrifuga", "compresor",
    "gas pump", "gas station", "petrol station", "fuel dispenser",
    "starship delivery", "uber", "atari", "arcade machine", "starbot",
    "extinguisher", "mercedes", "lamborghini", "porsche", "boeing", "cessna",
    "me262", "fluorite", "limonite", "tractor", "dieselpunk", "steampunk",
    "victorian", "drainage", "sinter", "glassware", "cabinet", "terminal",
]
# 士兵槽（写实人形允许）以外，命中这些 tag 的重罚
HUMAN_WORDS = ["human", "people", "person", "girl", "boy", "woman", "man ", "portrait", "head"]
HUMAN_OK_SLOTS = {"soldier", "worker"}

FACE_LIMIT = 300_000
# 允许「弱相关」补位的槽位（模型名常是代号、名称里没有槽位词）。其余槽位宁缺毋滥。
WEAK_FILL_SLOTS: set[str] = set()
TOP_N = 8


def _slug(model: dict) -> str:
    lic = model.get("license") or {}
    if lic.get("slug"):
        return lic["slug"]
    label = (lic.get("label") or "").lower()
    return {
        "cc0 public domain": "cc0",
        "cc attribution": "by",
        "cc attribution-sharealike": "by-sa",
        "cc attribution-noderivs": "by-nd",
        "cc attribution-noncommercial": "by-nc",
        "cc attribution-noncommercial-sharealike": "by-nc-sa",
        "cc attribution-noncommercial-noderivs": "by-nc-nd",
        "free standard": "free",
    }.get(label, "unknown")


LIC_SHORT = {
    "cc0": "CC0",
    "by": "CC-BY",
    "by-sa": "CC-BY-SA",
    "by-nd": "CC-BY-ND",
    "by-nc": "CC-BY-NC",
    "by-nc-sa": "CC-BY-NC-SA",
    "by-nc-nd": "CC-BY-NC-ND",
    "free": "Free Std",
    "unknown": "?",
}
OK_LIC = {"cc0", "by", "by-sa"}
NC_LIC = {"by-nc", "by-nc-sa", "by-nc-nd"}


def _text_blob(m: dict) -> str:
    tags = " ".join(t.get("name", "") for t in m.get("tags") or [])
    return (m.get("name", "") + " " + tags).lower()


BUILDING_BAD_CATS = {
    "characters-creatures", "music", "furniture-home", "art-abstract",
    "cultural-heritage-history", "food-drink", "people",
}
UNIT_BAD_CATS = {"architecture", "furniture-home", "music", "art-abstract", "cultural-heritage-history"}


def is_building_slot(slot: str) -> bool:
    return slot in S.BUILDING_SLOTS


def reject_reason(m: dict, slot: str) -> str | None:
    if (m.get("faceCount") or 0) > FACE_LIMIT:
        return f"面数 {m['faceCount']}"
    if _slug(m) not in OK_LIC | NC_LIC:
        return f"许可 {LIC_SHORT[_slug(m)]}"
    blob = _text_blob(m)
    for w in BAN_WORDS:
        if w in blob:
            return f"排除词 {w!r}"
    if slot not in HUMAN_OK_SLOTS and any(w in blob for w in HUMAN_WORDS):
        return "写实人形"
    cats = {c["name"] for c in m.get("categories") or []}
    bad = BUILDING_BAD_CATS if is_building_slot(slot) else UNIT_BAD_CATS
    if slot != "pack" and cats & bad:
        return f"类目 {sorted(cats & bad)[0]}"
    return None


STOPWORDS = {
    "sci-fi", "sci", "fi", "the", "a", "of", "and", "pack", "model", "3d",
    "low", "poly", "game", "asset", "free", "downloadable",
}


def _tokens(kws: list[str]) -> set[str]:
    return {t for kw in kws for t in re.split(r"[^a-z0-9-]+", kw.lower()) if t and t not in STOPWORDS}


def score(m: dict, slot_kws: list[str]) -> float:
    """log10(点赞+10)^2 × 相关度。

    相关度 = 1 + 0.6×(命中该槽位关键词数−1) + 0.25×(名称命中实词数) + 0.06×(tag 命中实词数)；
    名称命中权重最高，因为 Sketchfab 的 tag 很杂（「Furnace」会被打上 minecraft 之类）。
    """
    hits = len(set(m.get("_queries") or []))
    name = (m.get("name") or "").lower()
    tags = " ".join(t.get("name", "") for t in m.get("tags") or []).lower()
    tokens = _tokens(slot_kws)
    name_hits = sum(1 for t in tokens if t in name)
    tag_hits = sum(1 for t in tokens if t in tags)
    rel = 1.0 + 0.6 * (hits - 1) + 0.25 * name_hits + 0.06 * min(tag_hits, 6)
    likes = m.get("likeCount") or 0
    base = math.log10(likes + 10) ** 2
    staff = 1.15 if m.get("staffpickedAt") else 1.0
    return base * rel * staff


def _matches_slot(m: dict, kws: list[str], slot: str = "") -> bool:
    """名称/标签是否至少命中一个槽位实词（词干 5 字符前缀匹配，容忍 smeltery/smelter 这类派生）。

    建筑槽要求命中在**名称**里：Sketchfab 的 tag 太杂（「Furnace」会挂 minecraft/character），
    只靠 tag 命中会把无关物件带进来。单位槽允许 tag 命中（模型名常是代号）。
    """
    blob = _text_blob(m)
    name = (m.get("name") or "").lower()
    for t in _tokens(kws):
        if t in name or (len(t) >= 5 and t[:5] in name):
            return True
    if not is_building_slot(slot):
        # 单位槽允许 tag 命中，但要求命中两个以上实词，避免「Eotech 553」这类靠杂 tag 混入
        hits = sum(1 for t in _tokens(kws) if t in blob or (len(t) >= 5 and t[:5] in blob))
        if hits >= 2:
            return True
    return False


def select(models: list[dict], slot: str, kws: list[str]) -> tuple[list[dict], list[tuple[dict, str]]]:
    rejected: list[tuple[dict, str]] = []
    ok: list[dict] = []
    for m in models:
        r = reject_reason(m, slot)
        if r:
            rejected.append((m, r))
        else:
            ok.append(m)
    ok.sort(key=lambda m: score(m, kws), reverse=True)
    matched = [m for m in ok if _matches_slot(m, kws, slot)]
    unmatched = [m for m in ok if not _matches_slot(m, kws, slot)]
    for m in unmatched:
        m["_weak"] = True
    good = [m for m in matched if _slug(m) in OK_LIC][:TOP_N]
    if len(good) < TOP_N:
        nc = [m for m in matched if _slug(m) in NC_LIC][: TOP_N - len(good)]
        good.extend(nc)
    # 相关度门槛后不足 8 个才用「弱相关」补位（图上标 弱相关）；建筑槽不补位——
    # 建筑的名字必须点出功能，只靠 tag 命中的基本是误命中（灭火器、跑车），宁可少给。
    if len(good) < TOP_N and not is_building_slot(slot) and slot in WEAK_FILL_SLOTS:
        for m in unmatched:
            if len(good) >= TOP_N:
                break
            if _slug(m) in OK_LIC | NC_LIC:
                good.append(m)
    return good[:TOP_N], rejected


def _font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def _thumb_path(url: str) -> Path:
    return THUMB_CACHE / (re.sub(r"[^A-Za-z0-9]", "_", url[-80:]) + ".jpg")


def prefetch_thumbs(urls: list[str], workers: int = 120) -> None:
    """并发预取缩略图（media.sketchfab.com 单张可能排队到 60s+，串行会卡死）。"""
    THUMB_CACHE.mkdir(parents=True, exist_ok=True)
    todo = list(dict.fromkeys(u for u in urls if u and not _thumb_path(u).is_file()))

    def one(u: str) -> bool:
        for attempt in range(4):
            try:
                req = urllib.request.Request(u, headers={"User-Agent": "siliconworld-3a-models/1.0"})
                with urllib.request.urlopen(req, timeout=180) as r:
                    _thumb_path(u).write_bytes(r.read())
                return True
            except Exception as e:  # noqa: BLE001
                if attempt == 3:
                    print(f"  ! 缩略图失败 {u[:60]}: {e}", file=sys.stderr)
        return False

    if todo:
        print(f"  预取缩略图 {len(todo)} 张…")
        with ThreadPoolExecutor(workers) as ex:
            list(ex.map(one, todo))


def _thumb(url: str) -> Image.Image | None:
    if not url:
        return None
    THUMB_CACHE.mkdir(parents=True, exist_ok=True)
    cp = _thumb_path(url)
    try:
        if not cp.is_file():
            req = urllib.request.Request(url, headers={"User-Agent": "siliconworld-3a-models/1.0"})
            with urllib.request.urlopen(req, timeout=180) as r:
                cp.write_bytes(r.read())
        im = Image.open(cp).convert("RGB")
        # contain 到 300×225
        im.thumbnail((CELL_W, CELL_H), Image.LANCZOS)
        canvas = Image.new("RGB", (CELL_W, CELL_H), (24, 26, 30))
        canvas.paste(im, ((CELL_W - im.width) // 2, (CELL_H - im.height) // 2))
        return canvas
    except Exception as e:  # noqa: BLE001
        print(f"  ! 缩略图失败 {url[:60]}: {e}", file=sys.stderr)
        return None


def _ellipsis(text: str, font: ImageFont.FreeTypeFont, max_w: int) -> str:
    if font.getlength(text) <= max_w:
        return text
    while text and font.getlength(text + "…") > max_w:
        text = text[:-1]
    return text + "…"


def render_sheet(
    out: Path,
    title: str,
    subtitle: str,
    entries: list[dict],
    *,
    cols: int = COLS,
    rows: int = ROWS,
) -> None:
    f_title = _font(FONT_BOLD, 26)
    f_sub = _font(FONT_REG, 15)
    f_line = _font(FONT_REG, 13)
    f_badge = _font(FONT_BOLD, 15)
    rows = max(1, min(rows, math.ceil(len(entries) / cols)))
    width = PAD + cols * (CELL_W + PAD)
    cell_block = CELL_H + TEXT_H
    height = HEADER_H + rows * (cell_block + PAD) + PAD
    img = Image.new("RGB", (width, height), (18, 20, 24))
    d = ImageDraw.Draw(img)
    d.text((PAD, 14), title, font=f_title, fill=(240, 242, 245))
    d.text((PAD, 50), subtitle, font=f_sub, fill=(150, 158, 168))

    for i, e in enumerate(entries):
        r, c = divmod(i, cols)
        if r >= rows:
            break
        x = PAD + c * (CELL_W + PAD)
        y = HEADER_H + r * (cell_block + PAD)
        thumb = _thumb(e.get("thumbnail", ""))
        if thumb:
            img.paste(thumb, (x, y))
        else:
            d.rectangle([x, y, x + CELL_W, y + CELL_H], outline=(70, 74, 82))
            d.text((x + 8, y + 8), "(no thumbnail)", font=f_line, fill=(150, 158, 168))
        if e.get("nc"):
            # 红框 + NC 角标
            d.rectangle([x, y, x + CELL_W - 1, y + CELL_H - 1], outline=(235, 60, 60), width=3)
            bx, by = x + CELL_W - 44, y + 8
            d.rectangle([bx, by, bx + 34, by + 22], fill=(235, 60, 60))
            d.text((bx + 6, by + 3), "NC", font=f_badge, fill=(255, 255, 255))
        line1 = f"[{e['idx']}] {_ellipsis(e['name'], f_line, CELL_W - 6)}"
        line2 = f"{_ellipsis(e['author'], f_line, 110)} | {e['licenseShort']} | {e['faces']:,} 面 | {'有动画' if e['animated'] else '静态'}"
        if e.get("weak"):
            line2 += " | 弱相关"
        d.text((x, y + CELL_H + 6), line1, font=f_line, fill=(228, 232, 238))
        d.text((x, y + CELL_H + 24), line2, font=f_line, fill=(150, 158, 168))

    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    print(f"  写出 {out}  ({len(entries[: cols * rows])} 个候选)")


def entry(idx: int, m: dict) -> dict:
    slug = _slug(m)
    return {
        "idx": idx,
        "uid": m["uid"],
        "name": m.get("name", ""),
        "author": (m.get("user") or {}).get("username", ""),
        "license": (m.get("license") or {}).get("fullName") or (m.get("license") or {}).get("label", ""),
        "licenseShort": LIC_SHORT.get(slug, slug),
        "licenseSlug": slug,
        "nc": slug in NC_LIC,
        "faces": m.get("faceCount") or 0,
        "vertices": m.get("vertexCount") or 0,
        "animated": (m.get("animationCount") or 0) > 0,
        "likes": m.get("likeCount") or 0,
        "viewerUrl": m.get("viewerUrl", ""),
        "thumbnail": _best_thumb(m),
        "queries": sorted(set(m.get("_queries") or [])),
        "weak": bool(m.get("_weak")),
    }


def _reason_histogram(rejected: list[tuple[dict, str]]) -> dict[str, int]:
    hist: dict[str, int] = {}
    for _, r in rejected:
        key = r.split(" ")[0] if r.split(" ")[0] in {"面数", "许可", "类目"} else "内容排除"
        hist[key] = hist.get(key, 0) + 1
    return hist


def _best_thumb(m: dict) -> str:
    imgs = (m.get("thumbnails") or {}).get("images") or []
    if not imgs:
        return ""
    wider = [i for i in imgs if i["width"] >= 720]
    return (min(wider, key=lambda i: i["width"]) if wider else max(imgs, key=lambda i: i["width"]))["url"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default="tmp/3a-models/raw.json")
    ap.add_argument("--out-dir", default="tmp/3a-models")
    ap.add_argument("--only", action="append", help="只出这些槽位（可多次）")
    args = ap.parse_args()

    raw = json.loads(Path(args.raw).read_text())
    out_dir = Path(args.out_dir)
    sheets_dir = out_dir / "sheets"
    candidates: dict[str, list[dict]] = {}
    summary: dict[str, dict] = {}

    # 先算完所有槽位的入选名单，再并发预取缩略图，最后统一出图
    jobs: list[tuple[Path, str, str, list[dict], int, int]] = []
    for num, slot, purpose, kws in S.SLOTS:
        if args.only and slot not in args.only:
            continue
        models = raw.get(slot, [])
        chosen, rejected = select(models, slot, kws)
        entries = [entry(i + 1, m) for i, m in enumerate(chosen)]
        candidates[slot] = entries
        ok_count = sum(1 for e in entries if not e["nc"])
        summary[slot] = {
            "slot": slot,
            "purpose": purpose,
            "keywords": kws,
            "raw": len(models),
            "rejected": len(rejected),
            "shown": len(entries),
            "ok_licensed": ok_count,
            "nc_used": len(entries) - ok_count,
            "sheet": f"sheets/{num:02d}-{slot}.png",
            "rejected_reasons": _reason_histogram(rejected),
        }
        print(f"[{num:02d}] {slot}: 原始 {len(models)}，剔除 {len(rejected)}，入选 {len(entries)}（NC {len(entries) - ok_count}）")
        jobs.append((
            sheets_dir / f"{num:02d}-{slot}.png",
            f"{num:02d} {slot} — {purpose}",
            " | ".join(kws) + "   ·   取「点赞^0.5 × 相关度」前 8；红框 NC = 非商用许可（本槽合格候选不足才补入）",
            entries, COLS, ROWS,
        ))

    # 套装表：按作者聚合，同一作者多件作品优先
    for i, (key, label, kws) in enumerate(S.PACK_GROUPS, start=1):
        if args.only:
            break
        models = raw.get(f"packs/{key}", [])
        pool = []
        for m in models:
            r = reject_reason(m, "pack")
            if r:
                continue
            pool.append(m)
        by_author: dict[str, list[dict]] = {}
        for m in pool:
            by_author.setdefault((m.get("user") or {}).get("username", "?"), []).append(m)
        ranked = sorted(
            by_author.items(),
            key=lambda kv: (len(kv[1]), sum(score(m, kws) for m in kv[1])),
            reverse=True,
        )
        # 每个作者取点赞最高的一件，作者数不足时用多件作品填充
        entries = []
        for author, ms in ranked:
            ms.sort(key=lambda m: score(m, kws), reverse=True)
            entries.append(entry(len(entries) + 1, ms[0]))
        candidates[f"packs/{key}"] = entries
        print(f"[packs/{key}] 作者 {len(by_author)}，候选 {len(entries)}")
        jobs.append((
            sheets_dir / f"00-packs-{i}-{key}.png",
            f"套装候选 {i}：{label}",
            " | ".join(kws) + "   ·   按作者聚合（同作者一套覆盖多槽位，风格统一价值最高）",
            entries, 5, 3,
        ))

    prefetch_thumbs([e["thumbnail"] for _, _, _, es, _, _ in jobs for e in es])
    for path, title, subtitle, entries, cols, rows in jobs:
        render_sheet(path, title, subtitle, entries, cols=cols, rows=rows)

    (out_dir / "candidates.json").write_text(
        json.dumps(candidates, ensure_ascii=False, indent=1) + "\n"
    )
    (out_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=1) + "\n"
    )
    print(f"写出 {out_dir / 'candidates.json'} 与 summary.json")


if __name__ == "__main__":
    main()

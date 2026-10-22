"""联系表：把画廊里的逐模型三视图拼成一张总图，供主代理一眼扫完所有模型。

用法：
    python3 develop_tools/three_assets/contact.py tmp/3a-models/gallery
输出 `gallery-all.png`（每行一个模型：俯视 / 斜视 / 侧视 × 己方 / 敌方 / 黑雾 = 9 格）。
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

CELL = 200
PAD = 6
LABEL = 26
COLUMNS = [('top', 'own'), ('top', 'enemy'), ('top', 'fog'),
           ('iso', 'own'), ('iso', 'enemy'), ('iso', 'fog'),
           ('side', 'own'), ('side', 'enemy'), ('side', 'fog')]
FACTIONS = {'own': '己方', 'enemy': '敌方', 'fog': '黑雾'}


def main() -> None:
    directory = Path(sys.argv[1] if len(sys.argv) > 1 else 'tmp/3a-models/gallery')
    names = sorted({path.stem.rsplit('-', 2)[0] for path in directory.glob('*-iso-own.png')})
    if not names:
        raise SystemExit(f'{directory} 里没有 *-iso-own.png')
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 16)
    except OSError:
        font = ImageFont.load_default()

    width = PAD + len(COLUMNS) * (CELL + PAD)
    height = PAD + len(names) * (CELL + LABEL + PAD)
    sheet = Image.new('RGB', (width, height), (18, 26, 32))
    draw = ImageDraw.Draw(sheet)
    for row, name in enumerate(names):
        y = PAD + row * (CELL + LABEL + PAD)
        draw.text((PAD + 2, y + 2), name, fill=(220, 232, 240), font=font)
        for column, (view, faction) in enumerate(COLUMNS):
            path = directory / f'{name}-{view}-{faction}.png'
            if not path.is_file():
                continue
            image = Image.open(path).convert('RGB').resize((CELL, CELL), Image.LANCZOS)
            x = PAD + column * (CELL + PAD)
            sheet.paste(image, (x, y + LABEL))
            if row == 0:
                draw.text((x + 4, y + LABEL + 4), FACTIONS[faction], fill=(140, 200, 220), font=font)
    out = directory / 'gallery-all.png'
    sheet.save(out)
    print(f'{out}  ({len(names)} models, {width}×{height})')


if __name__ == '__main__':
    main()

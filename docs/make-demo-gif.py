#!/usr/bin/env python3
"""Regenerate docs/demo.gif from the real output of `node demo.mjs`.

Run from the repo root:  python docs/make-demo-gif.py

The GIF is a recording of the script's stdout, rendered as a terminal window.
Temp paths and ids are shortened for display; nothing else is edited, and the
frame always says SIMULATED HOST because the demo does not call a model.
"""
import os
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "demo.gif"

W, H = 1120, 660
PAD = 22
LINE_H = 20
FONT_PATH = r"C:\Windows\Fonts\consola.ttf"
if not os.path.exists(FONT_PATH):
    FONT_PATH = r"C:\Windows\Fonts\cour.ttf"
FONT = ImageFont.truetype(FONT_PATH, 14)
FONT_TITLE = ImageFont.truetype(FONT_PATH, 15)

BG = "#0d1117"
BAR = "#161b22"
TEXT = "#c9d1d9"
DIM = "#8b949e"
ACCENT = "#58a6ff"
GOOD = "#7ee787"
WARN = "#f0b429"


def demo_output() -> list[str]:
    raw = subprocess.run(
        ["node", "demo.mjs"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8"
    )
    if raw.returncode != 0:
        sys.exit(f"node demo.mjs failed:\n{raw.stderr}")
    text = re.sub(r"\x1b\[[0-9;]*m", "", raw.stdout)
    text = re.sub(r"C:\\Users\\[^\\]+\\.*?\\Temp\\lockstep-demo-ws-[^\\\s]+", "<temp workspace>", text)
    text = re.sub(r"C:\\Users\\[^\\]+\\.*?\\Temp\\lockstep-demo-mem-[^\\\s]+", "<temp memory>", text)
    text = re.sub(r"C:/Users/[^/]+/.*?/Temp/lockstep-demo-ws-[^/\s]+", "<temp workspace>", text)
    text = re.sub(r"C:/Users/[^/]+/.*?/Temp/lockstep-demo-mem-[^/\s]+", "<temp memory>", text)
    lines = []
    for line in text.splitlines():
        line = line.rstrip()
        while len(line) > 118:
            cut = line.rfind(" ", 0, 118)
            cut = cut if cut > 60 else 118
            lines.append(line[:cut])
            line = "      " + line[cut:].lstrip()
        lines.append(line)
    return lines


def style(line: str):
    if line.startswith("Scene "):
        return ACCENT
    if "Done." in line or "partial" in line and "Saved:" in line:
        return GOOD
    if line.startswith("  playbooks") or line.startswith("  agent-"):
        return DIM
    return TEXT


def frame(lines: list[str], up_to: int) -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    # window chrome
    d.rectangle([0, 0, W, 34], fill=BAR)
    for i, c in enumerate(("#ff5f57", "#febc2e", "#28c840")):
        d.ellipse([16 + i * 20, 11, 26 + i * 20, 21], fill=c)
    d.text((W / 2, 17), "LockStep demo — node demo.mjs", font=FONT_TITLE, fill=DIM, anchor="mm")
    # body: last screenful up to the reveal point
    visible = lines[:up_to]
    max_lines = (H - 34 - 34 - PAD) // LINE_H
    visible = visible[-max_lines:]
    y = 34 + PAD
    for line in visible:
        d.text((PAD, y), line, font=FONT, fill=style(line))
        y += LINE_H
    # honesty strip
    d.rectangle([0, H - 34, W, H], fill="#0b0f14")
    d.text((PAD, H - 17), "SIMULATED HOST · scripted agents · no model calls", font=FONT, fill=WARN, anchor="lm")
    d.text((W - PAD, H - 17), "node demo.mjs · ~2 s", font=FONT, fill=DIM, anchor="rm")
    return img


def main() -> None:
    lines = demo_output()
    total = len(lines)
    # reveal in ~14 even chunks, then hold the last full frame
    frames, durations = [], []
    stops = sorted({max(1, round(total * (i + 1) / 12)) for i in range(12)})
    for n, stop in enumerate(stops):
        frames.append(frame(lines, stop))
        durations.append(700 if n < len(stops) - 1 else 3200)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        OUT, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True
    )
    print(f"wrote {OUT}  ({OUT.stat().st_size / 1024:.0f} KB, {len(frames)} frames)")


if __name__ == "__main__":
    main()

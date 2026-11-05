"""Render short demo clips from screenshots with eased zoom and a spotlight highlight.

Usage: python lib/render_clips.py artifacts/manifest.json videos/ [slug ...]

Manifest shape:
{
  "viewport": {"width": 1920, "height": 1080},
  "scenes": [
    {"slug": "01-jira-list", "shots": [
        {"image": "artifacts/shots/01.png", "duration": 6.0,
         "focus": {"x": 10, "y": 20, "w": 300, "h": 40},   # CSS px, optional
         "zoom": true, "maxZoom": 2.2, "label": "optional caption"}
    ]}
  ]
}
"""
from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT_W, OUT_H, FPS = 1920, 1080, 30
ACCENT = (0, 120, 212)  # highlight stroke
GLOW = (80, 190, 255)
DIM_ALPHA = 0.55
CROSSFADE = 0.45

# Timeline for a focused shot (seconds, relative to shot start)
T_ZOOM_START, T_ZOOM_END = 0.6, 2.0
T_HL_START, T_HL_END = 1.4, 2.2


def ease(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t) if t < 1 else 1.0


def ease_out_cubic(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return 1 - (1 - t) ** 3


def progress(t: float, a: float, b: float, fn=ease_out_cubic) -> float:
    return fn((t - a) / (b - a)) if b > a else 1.0


@dataclass
class Rect:
    x: float
    y: float
    w: float
    h: float

    def lerp(self, o: "Rect", k: float) -> "Rect":
        return Rect(*(a + (b - a) * k for a, b in zip((self.x, self.y, self.w, self.h), (o.x, o.y, o.w, o.h))))


def target_view(focus: Rect, vw: float, vh: float, max_zoom: float) -> Rect:
    """16:9 viewport around the focus rect, padded, clamped to the page."""
    pad = 0.18
    w = max(focus.w * (1 + 2 * pad), focus.h * (1 + 2 * pad) * vw / vh, vw / max_zoom)
    w = min(w, vw)
    h = w * vh / vw
    cx, cy = focus.x + focus.w / 2, focus.y + focus.h / 2
    x = min(max(cx - w / 2, 0), vw - w)
    y = min(max(cy - h / 2, 0), vh - h)
    return Rect(x, y, w, h)


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for name in ("SegoeUIVariableDisplay.ttf", "segoeuisb.ttf", "segoeui.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


class ShotRenderer:
    def __init__(self, shot: dict, vw: int, vh: int):
        self.img = Image.open(shot["image"]).convert("RGB")
        self.scale = self.img.width / vw
        self.vw, self.vh = vw, vh
        self.duration = float(shot.get("duration", 6))
        f = shot.get("focus")
        self.focus = Rect(f["x"], f["y"], f["w"], f["h"]) if f else None
        self.zoom = bool(shot.get("zoom", True)) and self.focus is not None
        self.highlight = bool(shot.get("highlight", True)) and self.focus is not None
        self.full = Rect(0, 0, vw, vh)
        self.target = target_view(self.focus, vw, vh, float(shot.get("maxZoom", 2.2))) if self.zoom else self.full
        self.start_zoomed = bool(shot.get("startZoomed", False))
        self.label = shot.get("label")
        self.font = load_font(30)

    def view_at(self, t: float) -> Rect:
        if not self.zoom:
            # gentle Ken Burns drift for context-only shots
            k = t / max(self.duration, 0.1)
            z = 1 + 0.04 * k
            w, h = self.vw / z, self.vh / z
            return Rect((self.vw - w) / 2, (self.vh - h) / 2, w, h)
        if self.start_zoomed:
            return self.target
        return self.full.lerp(self.target, progress(t, T_ZOOM_START, T_ZOOM_END, ease))

    def frame(self, t: float) -> Image.Image:
        v = self.view_at(t)
        s = self.scale
        crop = self.img.crop((round(v.x * s), round(v.y * s), round((v.x + v.w) * s), round((v.y + v.h) * s)))
        frame = crop.resize((OUT_W, OUT_H), Image.LANCZOS)
        if self.highlight:
            a = 1.0 if self.start_zoomed else progress(t, T_HL_START, T_HL_END)
            if a > 0:
                frame = self._draw_highlight(frame, v, a)
        if self.label:
            frame = self._draw_label(frame, progress(t, 0.3, 0.9))
        return frame

    def _draw_highlight(self, frame: Image.Image, v: Rect, a: float) -> Image.Image:
        k = OUT_W / v.w
        pad = 10
        x0 = (self.focus.x - v.x) * k - pad
        y0 = (self.focus.y - v.y) * k - pad
        x1 = (self.focus.x + self.focus.w - v.x) * k + pad
        y1 = (self.focus.y + self.focus.h - v.y) * k + pad
        r = 14
        mask = Image.new("L", frame.size, int(255 * DIM_ALPHA * a))
        ImageDraw.Draw(mask).rounded_rectangle((x0, y0, x1, y1), r, fill=0)
        dark = Image.new("RGB", frame.size, (10, 18, 32))
        out = Image.composite(dark, frame, mask)

        glow = Image.new("RGBA", frame.size, (0, 0, 0, 0))
        ImageDraw.Draw(glow).rounded_rectangle((x0, y0, x1, y1), r, outline=GLOW + (int(200 * a),), width=12)
        glow = glow.filter(ImageFilter.GaussianBlur(10))
        out = Image.alpha_composite(out.convert("RGBA"), glow)
        ImageDraw.Draw(out).rounded_rectangle((x0, y0, x1, y1), r, outline=ACCENT + (int(255 * a),), width=5)
        return out.convert("RGB")

    def _draw_label(self, frame: Image.Image, a: float) -> Image.Image:
        if a <= 0:
            return frame
        img = frame.convert("RGBA")
        layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        tw = d.textlength(self.label, font=self.font)
        x, y, ph, pv = 48, OUT_H - 110, 26, 16
        d.rounded_rectangle((x, y, x + tw + 2 * ph, y + 38 + 2 * pv), 30, fill=(255, 255, 255, int(235 * a)),
                            outline=ACCENT + (int(255 * a),), width=3)
        d.text((x + ph, y + pv), self.label, font=self.font, fill=(26, 26, 26, int(255 * a)))
        return Image.alpha_composite(img, layer).convert("RGB")


def render_scene(scene: dict, vw: int, vh: int, out_dir: str, art_dir: str) -> str:
    shots = [ShotRenderer(s, vw, vh) for s in scene["shots"]]
    total = sum(s.duration for s in shots)
    slug = scene["slug"]
    tmp = os.path.join(art_dir, f"{slug}.render.mkv")
    final = os.path.join(out_dir, f"{slug}.mp4")
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{OUT_W}x{OUT_H}", "-r", str(FPS), "-i", "-",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", tmp,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    try:
        n = math.ceil(total * FPS)
        starts = [sum(s.duration for s in shots[:i]) for i in range(len(shots))]
        for i in range(n):
            t = i / FPS
            idx = max(j for j, st in enumerate(starts) if st <= t + 1e-9)
            cur = shots[idx]
            f = cur.frame(t - starts[idx])
            # crossfade into the next shot
            if idx + 1 < len(shots):
                rem = starts[idx + 1] - t
                if rem < CROSSFADE:
                    nxt = shots[idx + 1].frame(0)
                    f = Image.blend(f, nxt, 1 - rem / CROSSFADE)
            # fade in / out of whole clip
            fade = min(1.0, t / 0.25, (total - t) / 0.25)
            if fade < 1:
                f = Image.blend(Image.new("RGB", f.size, (0, 0, 0)), f, max(fade, 0))
            proc.stdin.write(f.tobytes())
        proc.stdin.close()
        if proc.wait() != 0:
            raise RuntimeError(f"ffmpeg failed rendering {slug}")
    except BaseException:
        proc.kill()
        raise

    staged = final + ".tmp.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-c:v", "libx264", "-preset", "medium", "-crf", "18",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", staged],
        check=True,
    )
    verify(staged, total)
    os.replace(staged, final)
    # poster frame for the deck (mid-highlight)
    poster = os.path.join(out_dir, f"{slug}.poster.png")
    last = shots[-1]
    last.frame(min(last.duration - 0.3, 3.0)).save(poster)
    return final


def verify(path: str, expected: float) -> None:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration",
         "-of", "json", path], capture_output=True, text=True, check=True)
    info = json.loads(out.stdout)
    st = info["streams"][0]
    dur = float(info["format"]["duration"])
    assert (st["width"], st["height"]) == (OUT_W, OUT_H), st
    assert st["r_frame_rate"] == f"{FPS}/1", st
    assert abs(dur - expected) < 0.5, (dur, expected)


def main() -> None:
    manifest_path, out_dir = sys.argv[1], sys.argv[2]
    only = set(sys.argv[3:])
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not found on PATH")
    with open(manifest_path, encoding="utf8") as fh:
        m = json.load(fh)
    vw, vh = m["viewport"]["width"], m["viewport"]["height"]
    os.makedirs(out_dir, exist_ok=True)
    art_dir = os.path.dirname(manifest_path)
    for scene in m["scenes"]:
        if only and scene["slug"] not in only:
            continue
        print("rendered", render_scene(scene, vw, vh, out_dir, art_dir), flush=True)


if __name__ == "__main__":
    main()

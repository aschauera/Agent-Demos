"""Build the demo slide deck from the branded template: one cover + one video slide per scene.

Usage: python lib/build_deck.py <template.pptx> <manifest.json> <videos_dir> <out.pptx>
"""
from __future__ import annotations

import copy
import json
import os
import sys

from lxml import etree
from pptx import Presentation
from pptx.oxml.ns import qn
from pptx.util import Emu

COVER_LAYOUT = "Cover"
SCENE_LAYOUT = "Spotlight + text"
P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"


def layout(prs, name):
    for m in prs.slide_masters:
        for lay in m.slide_layouts:
            if lay.name == name:
                return lay
    raise KeyError(name)


def set_notes(slide, text):
    notes = slide.notes_slide
    if notes.notes_text_frame is None:
        # The template's notes master has no body placeholder; add one so presenter view shows the notes.
        sp = etree.SubElement(notes.shapes._spTree, qn("p:sp"))
        sp.append(etree.fromstring(
            f'<p:nvSpPr xmlns:p="{P_NS}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
            '<p:cNvPr id="99" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>'
            '<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>'))
        sp.append(etree.fromstring(
            f'<p:spPr xmlns:p="{P_NS}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
            '<a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm></p:spPr>'))
        sp.append(etree.fromstring(
            f'<p:txBody xmlns:p="{P_NS}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
            '<a:bodyPr/><a:lstStyle/><a:p/></p:txBody>'))
    notes.notes_text_frame.text = text


def drop_all_slides(prs):
    sld_ids = prs.slides._sldIdLst
    for sld in list(sld_ids):
        prs.part.drop_rel(sld.get(qn("r:id")))
        sld_ids.remove(sld)


def ph(slide, idx):
    for p in slide.placeholders:
        if p.placeholder_format.idx == idx:
            return p
    raise KeyError(idx)


def set_text(shape, text):
    tf = shape.text_frame
    tf.text = text


def set_bullets(shape, lines):
    tf = shape.text_frame
    tf.text = lines[0] if lines else ""
    for line in lines[1:]:
        tf.add_paragraph().text = line


def autoplay(slide, movie_shape):
    """Replace python-pptx's click-to-play timing with play-automatically-with-slide."""
    sld = slide._element
    for t in sld.findall(qn("p:timing")):
        sld.remove(t)
    spid = movie_shape.shape_id
    xml = f"""
<p:timing xmlns:p="{P_NS}">
  <p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>
    <p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>
      <p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst>
        <p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>
          <p:par><p:cTn id="5" presetID="1" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="afterEffect">
            <p:stCondLst><p:cond delay="0"/></p:stCondLst>
            <p:childTnLst><p:cmd type="call" cmd="playFrom(0.0)"><p:cBhvr><p:cTn id="6" dur="1" fill="hold"/><p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl></p:cBhvr></p:cmd></p:childTnLst>
          </p:cTn></p:par>
        </p:childTnLst></p:cTn></p:par>
      </p:childTnLst></p:cTn></p:par>
    </p:childTnLst></p:cTn>
    <p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>
    <p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>
    </p:seq>
    <p:video><p:cMediaNode vol="80000"><p:cTn id="7" fill="hold" display="0"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl></p:cMediaNode></p:video>
  </p:childTnLst></p:cTn></p:par></p:tnLst>
</p:timing>"""
    timing = etree.fromstring(xml)
    ext = sld.find(qn("p:extLst"))
    if ext is not None:
        ext.addprevious(timing)
    else:
        sld.append(timing)


def main():
    template, manifest_path, videos_dir, out = sys.argv[1:5]
    with open(manifest_path, encoding="utf8") as fh:
        m = json.load(fh)
    prs = Presentation(template)
    drop_all_slides(prs)

    cover = prs.slides.add_slide(layout(prs, COVER_LAYOUT))
    deck = m.get("deck", {})
    set_text(ph(cover, 103), deck.get("title", "Demo"))
    set_text(ph(cover, 104), deck.get("subtitle", ""))
    set_text(ph(cover, 107), deck.get("scope", ""))
    for idx in (10, 11):
        try:
            p = ph(cover, idx)
            p._element.getparent().remove(p._element)
        except KeyError:
            pass

    scene_layout = layout(prs, SCENE_LAYOUT)
    for n, scene in enumerate(m["scenes"], start=1):
        video = os.path.join(videos_dir, f"{scene['slug']}.mp4")
        poster = os.path.join(videos_dir, f"{scene['slug']}.poster.png")
        if not os.path.exists(video):
            raise FileNotFoundError(video)
        s = prs.slides.add_slide(scene_layout)
        set_text(ph(s, 103), scene["title"])
        set_text(ph(s, 104), scene["tagline"])
        set_bullets(ph(s, 105), scene.get("bullets", []))
        try:
            set_text(ph(s, 11), deck.get("footer", ""))
        except KeyError:
            pass
        frame = ph(s, 200)
        fx, fy, fw, fh = frame.left, frame.top, frame.width, frame.height
        frame._element.getparent().remove(frame._element)
        w = fw
        h = int(w * 9 / 16)
        if h > fh:
            h = fh
            w = int(h * 16 / 9)
        x = fx + (fw - w) // 2
        y = fy + (fh - h) // 2
        mov = s.shapes.add_movie(video, Emu(x), Emu(y), Emu(w), Emu(h), poster_frame_image=poster, mime_type="video/mp4")
        mov.name = f"Video {scene['slug']}"
        autoplay(s, mov)
        if scene.get("notes"):
            set_notes(s, scene["notes"])

    prs.save(out)
    print("saved", out, len(prs.slides._sldIdLst), "slides")


if __name__ == "__main__":
    main()

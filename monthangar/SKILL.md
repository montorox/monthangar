---
name: monthangar
description: Make a 3D aircraft explainer documentary (16:9, 8 minutes or more, plus a 9:16 Short) from a topic or script and the user's own voice-over. Real licensed 3D aircraft in a night hangar, on a glowing studio stage and in flight over ocean, clouds or land, with 3D maps, timeline boards, archival photos and film, spec and fact cards, labels and dimension lines, an original synthesized score and SFX mixed to -14 LUFS. Every frame is code rendered on the GPU; no image or video generator, no account or API key. Use when the user says MontHangar, or asks for an aviation or aircraft explainer, a "why did this plane have X" video, a 3D aircraft walkaround documentary, or a Short in that style.
---

# MontHangar

A finished aviation documentary from a voice-over: the aircraft is a real 3D model, verified once and kept in a shared library, and every shot is placed on the words that are spoken over it. Works in Claude Code and Codex. `<skill>` is the folder holding this file.

**If `references/pro.md` exists, this is MontHangar Pro: read it now too.** It adds the Short stage, thumbnails, the gear and propeller splitter, the upload packager and VoiceStudio.

**Studio** (node packages, Python venv, `library/`, `projects/<slug>/`): `$MONTHANGAR_HOME` if set, else `~/MontHangarStudio`. First run: `bash <skill>/setup.sh` (Windows: see README), then `mh check`. Below, `mh` means `<skill>/core/tools/mh` (on Windows `python <skill>/core/tools/mh.py`).

**Long commands.** A 10-minute final at 2560x1440 takes 20-30 minutes on a recent Mac GPU. If your shell has a time limit, run it in the background with output to a log. A stopped render resumes when you run the same command again.

**Look at frames.** Open every contact sheet and check sheet yourself (Claude Code: Read the JPEG; Codex: your image viewer). Passing checks is never enough.

## Start: ask only what is missing

1. **Topic and script.** A user's script is used word for word; if a fact looks wrong, keep their words, tell them what you found and change it only when they agree. No script: research it (two sources for every number on screen, kept in `research/ledger.md`) and write one in plain spoken sentences: cold open with the question, the problem, the origin, a walkaround of the 3D model, service history, where it ended up, the answer. Real films are **8+ minutes** (1,300-1,800 words at about 150 words a minute). Shorter is only a test.
2. **Voice.** The user records it. Give them `vo-script (read this).txt` (`mh vo-script <p>`), with numbers spelled the way they should be read. Until the recording exists you may build against a placeholder voice (`say` on a Mac), labelled as a placeholder. Never hand over a placeholder film as finished.
3. **The aircraft.** Find a licensed model (below). Stop and tell the user if none is usable.
4. **Look.** Default `graphite` (night hangar, amber and teal). `daylight` exists but is plainer. Show a few stills before any long render on a new subject.

## Order of work

```bash
mh new <slug> --title "Why Did the ... ?" --subject <aircraft-id>     # projects/<slug>/
mh lint <slug>              # length, chapters, stale phrases, long sentences
mh vo-script <slug>         # the text the user reads
# user records -> projects/<slug>/audio/voice.wav (any format)
mh words <slug>             # word times aligned to script.md; prints every place the reading differs
# write plan/shots.json (below)
mh build <slug>             # resolves shots onto the words, checks everything; fix every ERROR, judge every WARN
mh contact <slug> --every 5 # LOOK at build/contact/sheet-*.jpg, fix, rebuild
mh render <slug> --preview --from 60 --to 120   # optional half-size SILENT check of a stretch
mh finish <slug> --preview  # optional half-size film WITH voice, score and SFX
mh finish <slug>            # score + SFX + mix (-14 LUFS, -1.5 dBTP) + final film in out/
```

**Test runs.** For an engine test shorter than a real film, use `mh lint <slug> --test` (length and chapter rules off), a placeholder voice, and stop after `mh finish <slug> --preview`. Check a placeholder recording plays and has a duration before `mh words` (it refuses silent files).

**Sandboxes.** The renderer starts Chromium on the GPU. Inside an agent sandbox (Codex workspace-write and similar) Chromium and `say` are usually blocked: `mh check` then ends with `render FAILED` and a non-zero exit. Ask the user to approve running the render commands outside the sandbox; do not work around it with estimated timings.

## Project files

- `config.json`: title, pack, look, units (`imperial` or `metric`; the other system is shown second, never first), subjects, size, key, moods, hook, tags, sources, brand
- `script.md`: `# Title`, `## Chapter` headings (they become YouTube chapters), spoken paragraphs; `[notes]` are never read
- `research/sources.md`: one source per line (`- Author, Title, publisher, year`)
- `audio/voice.*`, `audio/words.json`
- `media/` photos and film, with `media/credits.json` (written by `mh media ...`)
- `plan/shots.json`; `build/` (timeline, contact sheets, frames); `out/` films

## The aircraft library

Each aircraft is checked once and reused by every project. Never use a model straight from a download.

1. **Find a model**: Sketchfab (downloadable, licence shown on the page), Smithsonian 3D (CC0), NASA 3D Resources, or the user's own file. **Allowed:** CC0, public domain, CC BY, CC BY-SA, Sketchfab Standard. **Refused:** NonCommercial, NoDerivatives, Editorial, unknown. Record author, page URL and licence.
2. `mh library add <model.glb|scene.gltf> --id f4u --name "Vought F4U Corsair" --length 10.2 --span 12.5 --height 4.5 --engine piston --engines 1 --author NAME --source URL --licence "CC BY 4.0"`
   The doctor finds the heading (nose +Z, up +Y, wheels on the floor), scales to the real length, grades detail (A-D), checks span and height against the real figures, and renders `library/aviation/<id>/check/sheet.jpg`.
3. **Look at the sheet**: front, right side (nose right), top (nose up), on its wheels, flight from below, flight front quarter. Wrong heading: add again with `--rotate x,y,z` (degrees).
4. `mh library verify <id>`. Unverified or changed models are refused by `mh build`.

Grade C models suit distant flight and backgrounds only; plan close-ups around grade A/B. One subject per film is normal; rivals for comparisons go in the library the same way.

## Shots (`plan/shots.json`)

`{"shots": [ {...}, ... ]}` (complete examples of every type: `references/shots.md`). Each shot starts on the first word of its `"at"` phrase (copy the words exactly as in script.md, 3-6 words, unique from the previous shot onward) and runs to the next shot. The first shot takes `"start": 0`. Full parameter list: `references/shots.md`.

| type | what it is |
|---|---|
| `hangar` | the aircraft in the night hangar bay (floor markings, open door, runway lights) |
| `studio` | the aircraft on the black stage with the two-colour glow; portraits, head-on reveals, x-ray |
| `flight` | in the air; `sky` day/golden/dusk/high/overcast, `below` ocean/clouds/land/desert/snow; `mode: "flyby"` |
| `compare` | two or more library aircraft side by side (`subjects`), on the stage or in the bay |
| `map` | 3D by default: raised land with lit coasts under a tilted, drifting camera; cities as light beams, routes as glowing arcs with a moving plane, rings, highlighted countries. `"style": "flat"` for a 2D chart |
| `board` | a dated timeline with pinned photos |
| `archival` | a photo or film clip fitted whole in a framed window over a soft copy of itself, with caption and credit |
| `card` | `chapter`, `fact`, `spec`, `list`, `quote`, `doc`, `title` |

Camera (3D shots): `"cam": {"az": 0-360, "el": deg, "dist": 1, "target": anchor, "fit": part}`, optional `"to": {...}` for a move. az 0 head-on, 90 left side (nose to screen left), -90 right side, 180 from behind. dist 1 fills about 3/4 of the frame side-on; under 0.7 is a close-up. Anchors: `center nose tail top canopy belly wingtip_l wingtip_r ground_nose ground_tail ground_l ground_r` or any part name (`prop_1`, `gear_2`) or `[x,y,z]` metres. `fit` frames a part so it fills the picture.

Overlays (`"add": [...]`, `t` = seconds into the shot or a spoken phrase): `label` (text on a leader line to an anchor; never 3D arrows), `dim` (dimension line between two anchors with the real value and unit), `stat` (big number with unit conversion), `tag`, `note`, `title`. Parts: `highlight`, `xray`, `edges` (outline for dark aircraft).

## House rhythm (the checks warn on timing, runs and repeated cameras; the rest is your judgement)

- A new picture every 4-6 s on average; 3D shots up to 9 s, cards up to 9 s. No five shots of one type in a row; never the same camera twice running.
- About a quarter hangar, a sixth studio, a sixth flight, a fifth archival, the rest maps, boards and cards. A chapter card on each `##`.
- Show what is said: a number gets a card or stat, a place gets a map, a part gets a label or a close-up on it, a person gets their photo.
- Dimension lines and labels state real figures from the sources; never invent a value to fill a label.
- Units follow `config.units`; the checks refuse metric-first on an imperial channel.

## Media (licence-safe only)

- `mh media search "F4U Corsair carrier"` (Wikimedia Commons, with licences)
- `mh media wikimedia <p> "File:Name.jpg" --as name` downloads the original, resizes locally, logs the credit; it waits 20-60 s between files (Wikimedia asks for this; do not remove it).
- `mh media archive <p> <identifier> [--file name.mp4]` (Internet Archive; checks the licence field)
- `mh media add <p> <file> --author A --licence L` for the user's own material
Use public domain (US government, pre-1930), CC0, CC BY, CC BY-SA. Nothing without a licence. Credits are written for you; only required ones go in the description.

## Sound

`mh finish` writes an original score from the script's chapters (mood per chapter: `config.moods`, e.g. `{"Cold Open": "mystery", "In Service": "drive"}`; moods: mystery, tension, drive, wonder, resolve, reflect), engine beds matched to `engine` (piston, turboprop, jet) on flight shots, room tone in the hangar and a few whooshes (at least 14 s apart). Music ducks under the voice. Master: -14 LUFS, -1.5 dBTP.

## Before you hand over

Watch the contact sheets of the whole film, then spot-check the final at three places. Report what was rendered, its length, loudness, anything you could not fix, and every placeholder. Keep the user's personal details out of anything public.

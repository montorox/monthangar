# Shot reference

## A complete plan (copy the shapes)

```json
{"shots": [
 {"start": 0, "type": "studio", "subject": "f4u", "cam": {"az": 0, "el": 3, "dist": 1.0}, "to": {"az": 0, "el": 5, "dist": 0.9}},
 {"at": "a United States Navy fighter", "type": "flight", "subject": "f4u", "sky": "golden", "below": "ocean", "cam": {"az": 150, "el": 8, "dist": 1.3}},
 {"at": "They dip sharply downward", "type": "hangar", "cam": {"az": 12, "el": 4, "dist": 0.75},
  "add": [{"type": "label", "at": "wingtip_l", "text": "Bends up to the tip", "t": "climb back"}]},
 {"at": "It's 10.16 meters long", "type": "hangar", "cam": {"az": -90, "el": 4, "dist": 1.05},
  "add": [{"type": "dim", "from": "nose", "to": "tail", "value": 10.16, "unit": "m", "t": 0.2}]},
 {"at": "It looks like a gull", "type": "archival", "media": "media/photos/nasm_side.jpg", "caption": "F4U-1D, National Air and Space Museum"},
 {"at": "land on the deck of", "type": "archival", "media": "media/footage/trials.mp4", "from": 436, "caption": "Carrier trials, 1943"},
 {"at": "So let's start with", "type": "card", "card": {"style": "chapter", "number": 1, "title": "The problem"}},
 {"at": "It promised around", "type": "card", "card": {"style": "fact", "value": 1800, "unit": "hp", "caption": "Promised by the XR-2800"}},
 {"at": "On internal fuel", "type": "card", "card": {"style": "spec", "title": "Corsair IV", "rows": [["Range", "880 nmi"], ["Crew", "1"]]}},
 {"at": "So the designers faced", "type": "card", "card": {"style": "list", "title": "Three ways out", "items": ["Shrink the propeller", "Lengthen the gear", "Find another way"]}},
 {"at": "The Navy refused", "type": "card", "card": {"style": "quote", "text": "The ensign eliminator", "by": "Nickname among pilots"}},
 {"at": "So the engineers at Vought", "type": "map", "map": {"center": [-73.1, 41.2], "km": 420, "cities": [{"name": "Stratford", "lon": -73.13, "lat": 41.18}, "New York"], "title": "Stratford, Connecticut"}},
 {"at": "But a few months later", "type": "map", "map": {"center": [-72.9, 41.5], "km": 260, "routes": [{"from": {"name": "Stratford", "lon": -73.13, "lat": 41.18}, "to": "Hartford", "t": 0.4, "dur": 3}]}},
 {"at": "Late in 1944", "type": "board", "board": {"title": "Cleared for carriers", "events": [{"year": "1942", "text": "Fails carrier trials", "img": "media/photos/bounce.jpg", "t": 0}, {"year": "Late 1944", "text": "Cleared", "t": 1.5}]}},
 {"at": "The first versions of the F-4", "type": "compare", "subjects": ["f4u", "f4phantom"], "set": "stage", "cam": {"az": 30, "el": 10, "dist": 0.62}, "to": {"az": 20}}
]}
```

`mh build` refuses a card without `"card": {"style": ...}`, a map without `"map": {...}`, a board without `"board": {"events": [...]}`, archival without `media`, compare with fewer than two subjects, and any shot under 0.3 s.

Every shot: `at` (spoken words) or `start` (seconds), `type`, optional `id`, `in` (`cut` default, `fade`, `dissolve`, `wipe`, `flash`), `out: "fade"` on the last shot, `add` (overlays), `sfx: false` or `"whoosh"`.

## 3D shots: hangar, studio, flight

| key | meaning |
|---|---|
| `subject` | library id (defaults to the project's only subject) |
| `cam` | `az`, `el`, `dist`, `target` (anchor, part or `[x,y,z]`), `fit` (part to fill the frame), `fov` (34), `lift` (metres up) |
| `to` | the same keys at the end of the shot; without it the camera drifts a few degrees unless `move: "still"` |
| `ease` | `sine` (default) or `linear` |
| `handheld` | slight hand-held wobble |
| `gear` | `down` / `up` (default down on the ground, up in flight) |
| `spin` | `false` stops the propellers |
| `highlight` | part name(s) glowing in the accent colour; `color` to change it |
| `xray` | part name(s) kept solid while the rest turns to a glass ghost |
| `edges` | outline the aircraft (automatic for very dark paint in the hangar) |
| `people` | `1`-`3` figures for scale beside the nose |
| `reflect` | `false` removes the floor reflection |
| `grade` | `{contrast, sat, lift}` colour grade for this shot (the look and the flight skies set good defaults) |
| studio only | `glowA`, `glowB` (colours), `glow` (strength 1), `silhouette: true` (white on black, for checks) |
| flight only | `sky`, `below`, `bank`, `pitch` (degrees), `speed` (m/s of scenery), `puffs` (cloud count), `cover` (cloud deck 0-1), `mode: "flyby"` with `side` (1/-1), `dist`, `height`, `bloom` |

`compare`: `subjects: [a, b]`, `set: "stage"` or bay, `cam` / `to` with `az el dist`. Labels can point at `"1:nose"` (second aircraft).

## map

Maps are 3D by default: the chart is laid on raised land with lit coastlines, filmed by a tilted camera that drifts; cities are light beams with pulsing rings, routes are glowing arcs that lift off the ground. `"style": "flat"` gives the 2D chart instead (quick inserts). 3D only: `tilt` (degrees above the ground, 46), `az` (0 looks north), `drift: false`, route `height`. `mh build` refuses a place that is not in the built-in data: give it as `{name, lon, lat}`.

`"map": { center: [lon, lat], km: width shown, to: {center, km} (a move), cities: ["Name", "Name, Country", {name, lon, lat}], routes: [{from, to, t, dur}], rings: [{at, km}], highlight: ["Country"], labels: [{at: [lon,lat], text}], states: true, title: "..." }`
Small towns are often missing from the built-in data; give them as `{name, lon, lat}`.

## board

`"board": { title, events: [{year, text, img: "media/photos/x.jpg", t}] }` (3-5 events read well).

## archival

`media` (photo or film path in the project), `caption`, `credit` (looked up from `media/credits.json` if missing), `from` (seconds into the film), `speed`, `crop_px: [x,y,w,h]` (cut a burned-in timecode), `kenburns: false`, `mono: true`.

## card

- `chapter`: `number`, `title`
- `fact`: `value` (number counts up), `unit`, `caption`
- `spec`: `title`, `rows: [["Range", "880 nmi"], ...]`, or with `cols: ["F4U", "F6F"]` and `rows: [["Top speed", "417 mph", "380 mph"]]`, `mark: 0` highlights a column
- `list`: `title`, `items`
- `quote`: `text`, `by`
- `doc`: `kicker`, `title`, `text`, optional `img`
- `title`: `kicker`, `title`

## overlays (`add`)

All take `t` (seconds into the shot or a spoken phrase).
- `label`: `at` (anchor/part/[x,y,z]), `text`
- `dim`: `from`, `to`, `value`, `unit` (the other system is added automatically)
- `stat`: `label`, `value`, `unit`, `pos` (`lower-left`, `lower-right`, `upper-left`, `upper-right`, `upper`, `center`); Shorts must use the upper area
- `tag`: short pill text; `note`: a text block at `x, y`; `title`: big centred text with `y`, `size`

## Units

Lengths m/ft/in/cm, speed kn/mph/km/h, altitude ft/m, power hp/kW, mass kg/lb/t, range nmi/mi/km, volume L/gal. Give the value in the unit the source uses; the engine shows the channel's system first.

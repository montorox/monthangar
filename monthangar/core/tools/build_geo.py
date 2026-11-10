#!/usr/bin/env python3
"""Build the compact map file core/engine/data/geo.json from Natural Earth 1:50m GeoJSON (public domain).
Usage: build_geo.py <folder with ne_50m_*.geojson>"""
import json, sys, os
src = sys.argv[1]
out = os.path.join(os.path.dirname(__file__), '..', 'engine', 'data', 'geo.json')
def load(n): return json.load(open(os.path.join(src, n + '.geojson')))['features']
def r(c): return [round(c[0], 3), round(c[1], 3)]
def polys(g):
    if g['type'] == 'Polygon': return [[[r(p) for p in ring] for ring in g['coordinates']]]
    if g['type'] == 'MultiPolygon': return [[[r(p) for p in ring] for ring in poly] for poly in g['coordinates']]
    return []
def lines(g):
    if g['type'] == 'LineString': return [[r(p) for p in g['coordinates']]]
    if g['type'] == 'MultiLineString': return [[r(p) for p in l] for l in g['coordinates']]
    return []
geo = {'credit': 'Map data: Natural Earth (public domain)', 'land': [], 'countries': [], 'lakes': [], 'states': [], 'rivers': [], 'cities': []}
for f in load('ne_50m_land'): geo['land'] += polys(f['geometry'])
for f in load('ne_50m_admin_0_countries'):
    p = f['properties']
    geo['countries'].append({'name': p.get('NAME'), 'iso': p.get('ISO_A3') if p.get('ISO_A3') != '-99' else p.get('ADM0_A3'),
                             'label': [round(p.get('LABEL_X') or 0, 2), round(p.get('LABEL_Y') or 0, 2)], 'rank': p.get('LABELRANK'), 'polys': polys(f['geometry'])})
for f in load('ne_50m_lakes'):
    geo['lakes'].append({'name': f['properties'].get('name'), 'polys': polys(f['geometry'])})
for f in load('ne_50m_admin_1_states_provinces_lines'): geo['states'] += lines(f['geometry'])
for f in load('ne_50m_rivers_lake_centerlines'):
    if (f['properties'].get('scalerank') or 9) <= 5: geo['rivers'] += lines(f['geometry'])
for f in load('ne_50m_populated_places_simple'):
    p = f['properties']
    geo['cities'].append([p.get('name'), round(p.get('latitude'), 3), round(p.get('longitude'), 3), p.get('adm0name'), int(p.get('pop_max') or 0)])
json.dump(geo, open(out, 'w'), separators=(',', ':'))
print(out, os.path.getsize(out) // 1024, 'KB', {k: len(v) for k, v in geo.items() if isinstance(v, list)})

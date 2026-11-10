/* MontHangar looks. One theme object drives every set, overlay, map, board and card,
   so a channel can change its whole look by name. */
export const THEMES = {
  /* Graphite: a night hangar of dark polished concrete, amber work lamps and an open door onto dusk. */
  graphite: {
    name: 'graphite', bg: '#0d0f12', ink: '#eef2f4', dim: '#9aa6ad', accent: '#ffb23e', accent2: '#39d3c8', glow: '#39d3c8', warn: '#ff6a4d',
    panel: 'rgba(12,15,19,0.78)', panelEdge: 'rgba(255,178,62,0.55)',
    floor: '#24272b', floorRough: 0.42, wall: '#1b1e22', steel: '#2d3237', paint: '#ffb23e', lampColor: '#ffd59a', lampPower: 1.0,
    skyTop: '#0b1830', skyMid: '#24426b', skyLow: '#f29d52', exposure: 1.05, bloom: 0.42, vignette: 0.55, grain: 0.06,
    rimColor: '#7fc8ff', keyColor: '#ffe2b8', fill: 0.35, grade: { contrast: 1.05, sat: 1.06 },
    map: { ocean: '#060d13', ocean2: '#0d1c27', shelf: 'rgba(64,150,180,0.22)', land: '#3a454e', land2: '#4b5862', border: '#6f7f8a', coast: '#9db3bf', lake: '#0b1822', grid: 'rgba(120,160,180,0.10)', label: '#c9d4da', city: '#ffb23e', route: '#ffb23e', hi: 'rgba(255,178,62,0.28)', river: 'rgba(90,140,170,0.55)' },
    map3d: { ocean: '#0b1f2c', ocean2: '#16394c', lake: '#13303f', shelf: 'rgba(90,180,210,0.30)' },
    board: { bg: '#15191d', bg2: '#1c2126', rail: '#ffb23e', paper: '#f3efe6', text: '#1d2226', ink: '#eef2f4', clip: '#8a949b' },
    stage: { top: '#16191d', floor: '#0a0b0d', glowA: '#ffb23e', glowB: '#39d3c8' }
  },
  /* Daylight: the same bay by day, pale concrete and a bright sky through the doors. */
  daylight: {
    name: 'daylight', bg: '#e9ecee', ink: '#14191d', dim: '#56636b', accent: '#e8870e', accent2: '#0f9c92', glow: '#0fb3a6', warn: '#d9452b',
    panel: 'rgba(250,251,252,0.86)', panelEdge: 'rgba(232,135,14,0.7)',
    floor: '#b9bcbd', floorRough: 0.5, wall: '#cfd3d5', steel: '#8d969c', paint: '#f2a516', lampColor: '#ffffff', lampPower: 0.55,
    skyTop: '#4f86c6', skyMid: '#9cc4e8', skyLow: '#e6eef3', exposure: 1.0, bloom: 0.18, vignette: 0.28, grain: 0.04,
    rimColor: '#ffffff', keyColor: '#fff6e8', fill: 0.7,
    map: { ocean: '#bcd6e0', ocean2: '#cfe3ea', shelf: 'rgba(255,255,255,0.45)', land: '#f1efe8', land2: '#e7e4da', border: '#b7b2a6', coast: '#9fb7c0', lake: '#bcd6e0', grid: 'rgba(60,90,110,0.08)', label: '#2b3439', city: '#e8870e', route: '#e8870e', hi: 'rgba(232,135,14,0.25)', river: 'rgba(110,160,185,0.7)' },
    board: { bg: '#d9dcd8', bg2: '#cfd3cf', rail: '#e8870e', paper: '#ffffff', text: '#1d2226', ink: '#14191d', clip: '#6f777c' },
    stage: { top: '#16191d', floor: '#0a0b0d', glowA: '#ffb23e', glowB: '#39d3c8' }
  }
};
export const FONT = { display: 'Barlow', body: 'Inter' };

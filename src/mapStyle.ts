// A game-board map style over free OpenFreeMap (OpenMapTiles schema) vector
// tiles. Terrain classes get bold colours plus small hand-drawn patterns so
// grass, sand, water, forest and parks read at a glance.
import { EAT_CLASSES } from './places.ts';
import type { StyleSpecification, Map as MlMap } from 'maplibre-gl';

type Painter = (g: CanvasRenderingContext2D, s: number) => void;

interface Terrain {
  id: string;
  label: string;
  color: string;
  /** Optional decoration drawn on top of `color` to make a repeating tile. */
  paint?: Painter;
}

const dots = (color: string, pts: [number, number, number][]): Painter => (g, s) => {
  g.fillStyle = color;
  for (const [x, y, r] of pts) {
    g.beginPath();
    g.arc(x * s, y * s, r * s, 0, Math.PI * 2);
    g.fill();
  }
};

const tufts: Painter = (g, s) => {
  g.strokeStyle = '#6cc04a';
  g.lineWidth = 0.05 * s;
  g.lineCap = 'round';
  for (const [x, y] of [[0.2, 0.3], [0.7, 0.15], [0.55, 0.7], [0.1, 0.85]]) {
    for (const dx of [-0.05, 0, 0.05]) {
      g.beginPath();
      g.moveTo(x * s, y * s);
      g.lineTo((x + dx * 1.4) * s, (y - 0.1) * s);
      g.stroke();
    }
  }
};

const waves = (color: string): Painter => (g, s) => {
  g.strokeStyle = color;
  g.lineWidth = 0.045 * s;
  g.lineCap = 'round';
  for (const [x, y] of [[0.1, 0.3], [0.55, 0.75]]) {
    g.beginPath();
    g.moveTo(x * s, y * s);
    g.quadraticCurveTo((x + 0.09) * s, (y - 0.08) * s, (x + 0.18) * s, y * s);
    g.quadraticCurveTo((x + 0.27) * s, (y + 0.08) * s, (x + 0.36) * s, y * s);
    g.stroke();
  }
};

const trees: Painter = (g, s) => {
  for (const [x, y] of [[0.25, 0.3], [0.75, 0.75]]) {
    g.fillStyle = '#2f7d32';
    g.beginPath();
    g.arc(x * s, y * s, 0.17 * s, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#66bb6a';
    g.beginPath();
    g.arc((x - 0.04) * s, (y - 0.05) * s, 0.08 * s, 0, Math.PI * 2);
    g.fill();
  }
};

const flowers: Painter = (g, s) => {
  tufts(g, s);
  dots('#fff59d', [[0.4, 0.45, 0.04], [0.85, 0.5, 0.04]])(g, s);
  dots('#ffffff', [[0.3, 0.9, 0.035]])(g, s);
};

const rows: Painter = (g, s) => {
  g.strokeStyle = '#d6cf7a';
  g.lineWidth = 0.06 * s;
  for (const y of [0.25, 0.75]) {
    g.beginPath();
    g.moveTo(0, y * s);
    g.lineTo(s, y * s);
    g.stroke();
  }
};

/** Single source of truth for terrain colours, patterns and legend labels. */
export const TERRAIN = {
  land: { id: 'land', label: 'Land', color: '#efe7d2' },
  water: { id: 'water', label: 'Water / ocean', color: '#4fb3f6', paint: waves('#9ad8ff') },
  sand: { id: 'sand', label: 'Sand / beach', color: '#ffe08a', paint: dots('#e9be52', [[0.2, 0.2, 0.05], [0.7, 0.4, 0.04], [0.4, 0.8, 0.05], [0.9, 0.9, 0.035]]) },
  grass: { id: 'grass', label: 'Grassland', color: '#a6e57a', paint: tufts },
  park: { id: 'park', label: 'Park', color: '#86dd63', paint: flowers },
  wood: { id: 'wood', label: 'Forest', color: '#58b85c', paint: trees },
  farmland: { id: 'farmland', label: 'Farmland', color: '#eceaa4', paint: rows },
  wetland: { id: 'wetland', label: 'Wetland', color: '#9fdcc3', paint: waves('#6fbfa0') },
  rock: { id: 'rock', label: 'Rock', color: '#cfc8bc', paint: dots('#a99f90', [[0.3, 0.3, 0.08], [0.75, 0.7, 0.06]]) },
  ice: { id: 'ice', label: 'Ice / snow', color: '#f2fbff' },
  town: { id: 'town', label: 'Town', color: '#f6dccb' },
  building: { id: 'building', label: 'Buildings', color: '#fff6ea' },
} satisfies Record<string, Terrain>;

export const LEGEND: Terrain[] = [
  TERRAIN.water, TERRAIN.sand, TERRAIN.grass, TERRAIN.park, TERRAIN.wood,
  TERRAIN.farmland, TERRAIN.wetland, TERRAIN.town, TERRAIN.land,
];

const PATTERN_PX = 28; // CSS pixels per pattern tile

/** Draw a terrain swatch/pattern tile onto a canvas. */
export function drawTerrain(t: Terrain, sizePx: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = sizePx;
  const g = c.getContext('2d')!;
  g.fillStyle = t.color;
  g.fillRect(0, 0, sizePx, sizePx);
  t.paint?.(g, sizePx);
  return c;
}

const patternId = (t: Terrain) => `pat-${t.id}`;

/** Lazily supply pattern images the style asks for. */
export function installPatterns(map: MlMap) {
  map.on('styleimagemissing', (e) => {
    const t = Object.values(TERRAIN).find((x) => patternId(x) === e.id);
    if (!t) return;
    const ratio = 2;
    const c = drawTerrain(t, PATTERN_PX * ratio);
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    map.addImage(e.id, { width: c.width, height: c.height, data: new Uint8Array(data.data.buffer) }, { pixelRatio: ratio });
  });
}

const fill = (t: Terrain) => (t.paint ? { 'fill-pattern': patternId(t) } : { 'fill-color': t.color });
const cls = (...v: string[]) => ['match', ['get', 'class'], v, true, false] as const;
const FONT_BOLD = ['Noto Sans Bold'];
const FONT_REG = ['Noto Sans Regular'];
const FONT_IT = ['Noto Sans Italic'];

const ROAD_COLOURS: [string[], string, string, number][] = [
  // classes, fill, casing, base width
  [['motorway', 'trunk'], '#ffcf5c', '#c98a1e', 2.2],
  [['primary', 'secondary'], '#ffffff', '#c8b99a', 1.8],
  [['tertiary', 'minor', 'service'], '#ffffff', '#d6cab0', 1.2],
];

export function gameStyle(): StyleSpecification {
  const roadW = (base: number, extra = 0) =>
    ['interpolate', ['exponential', 1.6], ['zoom'], 10, base * 0.3 + extra, 14, base * 2 + extra, 18, base * 10 + extra] as unknown as number;

  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      omt: {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
        attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
      ne: {
        type: 'raster',
        tiles: ['https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 6,
      },
      dem: {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 14,
        attribution: 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">Mapzen/AWS Terrain Tiles</a>',
      },
    },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': TERRAIN.land.color } },
      {
        id: 'natural-earth', type: 'raster', source: 'ne', maxzoom: 8,
        paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.9, 8, 0], 'raster-saturation': 0.3 },
      },
      // --- land cover ---------------------------------------------------
      { id: 'farmland', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cls('farmland'), paint: fill(TERRAIN.farmland) },
      { id: 'landuse-town', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: cls('residential', 'suburb', 'neighbourhood', 'quarter'), paint: { 'fill-color': TERRAIN.town.color, 'fill-opacity': 0.8 } },
      { id: 'landuse-busy', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: cls('commercial', 'retail', 'industrial', 'railway', 'garages'), paint: { 'fill-color': '#eed6e4', 'fill-opacity': 0.7 } },
      { id: 'landuse-campus', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: cls('school', 'university', 'college', 'kindergarten', 'hospital'), paint: { 'fill-color': '#fbe7a8', 'fill-opacity': 0.7 } },
      // Parks go under the natural cover so a park's real ground (beach, forest…) still shows.
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { ...fill(TERRAIN.park), 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.4, 10, 1] } },
      { id: 'wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cls('wood', 'forest'), paint: fill(TERRAIN.wood) },
      { id: 'grass', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cls('grass'), paint: fill(TERRAIN.grass) },
      { id: 'wetland', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cls('wetland'), paint: fill(TERRAIN.wetland) },
      { id: 'rock', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cls('rock'), paint: fill(TERRAIN.rock) },
      { id: 'ice', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cls('ice'), paint: fill(TERRAIN.ice) },
      { id: 'sand', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cls('sand', 'beach'), paint: fill(TERRAIN.sand) },
      { id: 'park-edge', type: 'line', source: 'omt', 'source-layer': 'park', minzoom: 11, paint: { 'line-color': '#3f9b3a', 'line-width': 1.5, 'line-dasharray': [3, 2] } },
      { id: 'pitch', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: cls('pitch', 'playground', 'stadium'), paint: { 'fill-color': '#4ccf72', 'fill-outline-color': '#ffffff' } },
      { id: 'cemetery', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: cls('cemetery'), paint: { 'fill-color': '#b9d8a6' } },
      // --- relief ---------------------------------------------------------
      {
        id: 'hillshade', type: 'hillshade', source: 'dem',
        paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#5b4a3a', 'hillshade-highlight-color': '#fffbe8', 'hillshade-accent-color': '#7a6a55' },
      },
      // --- water ----------------------------------------------------------
      { id: 'water-shore', type: 'line', source: 'omt', 'source-layer': 'water', filter: ['!=', ['get', 'brunnel'], 'tunnel'], paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 16, 5], 'line-opacity': 0.9, 'line-blur': 1 } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', filter: ['!=', ['get', 'brunnel'], 'tunnel'], paint: fill(TERRAIN.water) },
      { id: 'water-edge', type: 'line', source: 'omt', 'source-layer': 'water', filter: ['!=', ['get', 'brunnel'], 'tunnel'], paint: { 'line-color': '#1f86d6', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 16, 2] } },
      {
        id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', filter: ['!=', ['get', 'brunnel'], 'tunnel'],
        paint: { 'line-color': TERRAIN.water.color, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['match', ['get', 'class'], 'river', 1.5, 0.5], 17, ['match', ['get', 'class'], 'river', 10, 4]] },
      },
      // --- roads ----------------------------------------------------------
      {
        id: 'path', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 13, filter: cls('path', 'track'),
        paint: { 'line-color': '#b98b5a', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.8, 18, 3], 'line-dasharray': [2, 1.5] },
      },
      ...ROAD_COLOURS.map(([classes, , casing, w]) => ({
        id: `road-case-${classes[0]}`, type: 'line' as const, source: 'omt', 'source-layer': 'transportation',
        filter: ['all', cls(...classes), ['!=', ['get', 'brunnel'], 'tunnel']] as never,
        layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
        paint: { 'line-color': casing, 'line-width': roadW(w, 2) },
      })),
      ...ROAD_COLOURS.map(([classes, colour, , w]) => ({
        id: `road-${classes[0]}`, type: 'line' as const, source: 'omt', 'source-layer': 'transportation',
        filter: ['all', cls(...classes), ['!=', ['get', 'brunnel'], 'tunnel']] as never,
        layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
        paint: { 'line-color': colour, 'line-width': roadW(w) },
      })),
      // --- chunky, toy-like buildings -------------------------------------
      {
        id: 'building', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 14,
        paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#fff6ea', 40, '#ffd9c2', 120, '#e8c3ff'],
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.92,
        },
      },
      // --- labels -----------------------------------------------------------
      ...(['point', 'line'] as const).map((placement) => ({
        id: `water-name-${placement}`, type: 'symbol' as const, source: 'omt', 'source-layer': 'water_name',
        filter: ['==', ['geometry-type'], placement === 'line' ? 'LineString' : 'Point'] as never,
        layout: { 'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']] as never, 'text-font': FONT_IT, 'text-size': 13, 'symbol-placement': placement },
        paint: { 'text-color': '#0b5fa5', 'text-halo-color': '#d9f0ff', 'text-halo-width': 1.5 },
      })),
      {
        id: 'road-name', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 14,
        layout: { 'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']], 'text-font': FONT_REG, 'text-size': 11, 'symbol-placement': 'line' },
        paint: { 'text-color': '#6b5a48', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
      },
      {
        id: 'park-name', type: 'symbol', source: 'omt', 'source-layer': 'park', minzoom: 12,
        filter: ['==', ['geometry-type'], 'Point'],
        layout: { 'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']], 'text-font': FONT_BOLD, 'text-size': 12 },
        paint: { 'text-color': '#226b1f', 'text-halo-color': '#e9ffd9', 'text-halo-width': 1.5 },
      },
      // Somewhere to eat or drink: a gold dot and its name. Tapping one opens its card with a Google Maps link.
      {
        id: 'eat-dot', type: 'circle', source: 'omt', 'source-layer': 'poi', minzoom: 15,
        filter: ['any', ['match', ['get', 'class'], EAT_CLASSES as string[], true, false], ['match', ['get', 'subclass'], EAT_CLASSES as string[], true, false]] as never,
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 4, 18, 8], 'circle-color': '#ffcf4a', 'circle-stroke-color': '#2b1d12', 'circle-stroke-width': 2 },
      },
      {
        id: 'eat-name', type: 'symbol', source: 'omt', 'source-layer': 'poi', minzoom: 16,
        filter: ['any', ['match', ['get', 'class'], EAT_CLASSES as string[], true, false], ['match', ['get', 'subclass'], EAT_CLASSES as string[], true, false]] as never,
        layout: { 'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']], 'text-font': FONT_BOLD, 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 0.9], 'text-max-width': 8 },
        paint: { 'text-color': '#3b2f4a', 'text-halo-color': '#fff6ea', 'text-halo-width': 1.6 },
      },
      {
        id: 'place', type: 'symbol', source: 'omt', 'source-layer': 'place',
        layout: {
          'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
          'text-font': FONT_BOLD,
          'text-size': ['match', ['get', 'class'], ['country', 'state'], 15, ['city'], 16, ['town'], 14, 12],
          'text-transform': ['match', ['get', 'class'], ['country', 'state'], 'uppercase', 'none'] as never,
          'text-letter-spacing': 0.04,
        },
        paint: { 'text-color': '#3b2f4a', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
      },
    ],
  } as StyleSpecification;
}

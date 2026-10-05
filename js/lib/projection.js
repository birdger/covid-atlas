// js/lib/projection.js —— 投影（零依赖）：等距圆柱 / 墨卡托，按包围盒适配画布
// 经纬度 → 画布像素。世界地图常用墨卡托（高纬拉伸），这里两种都提供。
const R = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * R) / 2));

/** 纬度截断：默认切掉南极与北极圈外，得到常见的「矩形世界地图」观感 */
export const DEFAULT_CLIP = [-56, 84];

function rawProject(lon, lat, mode) {
  return mode === 'mercator' ? [lon, -mercY(lat)] : [lon, -lat];
}

/**
 * 造一个投影函数。
 * @param {{bbox:number[], width:number, height:number, mode?:string, clipLat?:number[], padding?:number}} opt
 * @returns {{project:(lon:number,lat:number)=>number[], unproject:(x:number,y:number)=>number[],
 *            scale:number, offset:number[], bbox:number[], mode:string, clipLat:number[]}}
 */
export function makeProjection(opt) {
  const mode = opt.mode || 'mercator';
  const clipLat = opt.clipLat || DEFAULT_CLIP;
  const pad = opt.padding || 0;
  const [minLon, minLat, maxLon, maxLat] = opt.bbox;

  const clampLat = (lat) => Math.min(clipLat[1], Math.max(clipLat[0], lat));
  // 先算出贴图后的四角范围，再求能把整幅图塞进画布的缩放比
  const corners = [];
  for (const lon of [minLon, maxLon]) for (const lat of [clampLat(minLat), clampLat(maxLat)]) {
    corners.push(rawProject(lon, lat, mode));
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of corners) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const w = Math.max(1e-9, x1 - x0), h = Math.max(1e-9, y1 - y0);
  const scale = Math.min((opt.width - pad * 2) / w, (opt.height - pad * 2) / h);
  const offset = [
    (opt.width - w * scale) / 2 - x0 * scale,
    (opt.height - h * scale) / 2 - y0 * scale,
  ];

  const project = (lon, lat) => {
    const [x, y] = rawProject(lon, clampLat(lat), mode);
    return [x * scale + offset[0], y * scale + offset[1]];
  };
  const unproject = (px, py) => {
    const x = (px - offset[0]) / scale;
    const y = (py - offset[1]) / scale;
    const lat = mode === 'mercator'
      ? (2 * Math.atan(Math.exp(-y)) - Math.PI / 2) / R
      : -y;
    return [x, lat];
  };
  return { project, unproject, scale, offset, bbox: opt.bbox, mode, clipLat };
}

/** 一整幅地图的所有环 → 画布点列 */
export function projectGeometry(geoms, proj) {
  return geoms.map((g) => ({
    id: g.id,
    name: g.name,
    polygons: g.polygons.map((poly) => poly.map((ring) => ring.map(([lon, lat]) => proj.project(lon, lat)))),
  }));
}

/** 眼睛在哪个国家上：射线法判断点是否在某环内（含洞的层次规则） */
export function pointInRing(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 点在多边形内：外环在内、任一洞在内 → 判定为不在（洞算外部） */
export function pointInPolygon(pt, polygon) {
  if (!polygon.length || !pointInRing(pt, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i++) if (pointInRing(pt, polygon[i])) return false;
  return true;
}

/** 命中测试：返回第一个命中的几何 id（多边形数不多，线性扫足够） */
export function hitTest(pt, projected) {
  for (const g of projected) for (const poly of g.polygons) if (pointInPolygon(pt, poly)) return g.id;
  return null;
}

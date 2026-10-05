// js/lib/topojson.js —— TopoJSON 解码（零依赖）
// TopoJSON 用「量化 + 增量编码」存弧线：每个点只存与上一个点的整数差，
// 再乘 transform.scale 加 transform.translate 还原成经纬度。
// 这里只解我们需要的部分：GeometryCollection → 多边形环。

/** 把 topo.arcs 里的增量弧还原成经纬度点列 */
export function decodeArcs(topo) {
  const tf = topo.transform;
  return topo.arcs.map((arc) => {
    let x = 0, y = 0;
    const pts = new Array(arc.length);
    for (let i = 0; i < arc.length; i++) {
      x += arc[i][0];
      y += arc[i][1];
      pts[i] = tf ? [x * tf.scale[0] + tf.translate[0], y * tf.scale[1] + tf.translate[1]] : [x, y];
    }
    return pts;
  });
}

/**
 * 拼一条环：arcIdxList 里负数表示「反向引用第 ~i 条弧」（TopoJSON 规范）。
 * 相邻弧共享端点，所以拼接时去掉重复的那个点。
 */
export function ringCoords(arcIdxList, arcs) {
  const out = [];
  for (let k = 0; k < arcIdxList.length; k++) {
    const idx = arcIdxList[k];
    const arc = idx < 0 ? arcs[~idx].slice().reverse() : arcs[idx];
    const start = out.length && arc.length ? 1 : 0;   // 跳过与前一条弧重复的端点
    for (let i = start; i < arc.length; i++) out.push(arc[i]);
  }
  return out;
}

/** 取 objects[name] 下所有几何，统一成 { id, name, polygons: [ [ring, ...], ... ] } */
export function decodeGeometry(topo, objectName = 'countries') {
  const arcs = decodeArcs(topo);
  const obj = topo.objects[objectName];
  if (!obj) throw new Error(`TopoJSON 里没有 objects.${objectName}`);
  return obj.geometries.map((g) => {
    const raw = g.type === 'Polygon' ? [g.arcs] : g.arcs;   // Polygon 少一层
    const polygons = raw.map((poly) => poly.map((ring) => ringCoords(ring, arcs)));
    return { id: String(g.id), name: g.properties?.name ?? '', polygons };
  });
}

/** 几何的经纬度包围盒 [minLon, minLat, maxLon, maxLat] */
export function boundsOf(geoms) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const g of geoms) for (const poly of g.polygons) for (const ring of poly) for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  if (minLon === Infinity) return [0, 0, 0, 0];
  return [minLon, minLat, maxLon, maxLat];
}

/** 环的有向面积（>0 为逆时针）。用于判断外环/内环（洞） */
export function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}

/** 环的经纬度质心（近似，够用于放置标签/连线起点） */
export function ringCentroid(ring) {
  let x = 0, y = 0, n = 0;
  for (const [lon, lat] of ring) { x += lon; y += lat; n++; }
  return n ? [x / n, y / n] : [0, 0];
}

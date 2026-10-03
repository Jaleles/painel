import { esc, fmtN } from './util.js';

/* ════════════════════════════════════════════════════════════
   GRÁFICOS SVG (sem dependências — funciona offline)
════════════════════════════════════════════════════════════ */
function niceStep(range, ticks) {
  const raw = range / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
}

/**
 * drawChart(container, { type: 'line'|'bar', labels, series:[{ name, values, color, dashed, fill }],
 *                        fmt: v => texto do tooltip, axisFmt: v => texto do eixo, tipLabels? })
 */
function drawChart(container, opts) {
  const { type = 'line', labels = [], series = [], fmt = v => fmtN(v), axisFmt = v => fmtN(v, 0), tipLabels } = opts;
  const W = container.clientWidth || 320;
  const H = container.clientHeight || 190;
  const n = labels.length;
  const vals = series.flatMap(s => s.values.filter(v => v !== null && isFinite(v)));
  if (!n || !vals.length) { container.innerHTML = '<div class="empty">Sem dados suficientes ainda.</div>'; return; }

  const padL = 44, padR = 10, padT = 12, padB = 24;
  const pw = W - padL - padR, ph = H - padT - padB;
  let min = opts.yMin !== undefined ? opts.yMin : Math.min(0, ...vals);
  let max = Math.max(...vals);
  if (opts.yMin === undefined && type === 'line' && min > 0) min = 0;
  if (opts.tightMin) { min = Math.min(...vals); }
  if (max === min) { max = min + (max === 0 ? 1 : Math.abs(max) * 0.2); }
  const step = niceStep(max - min, 4);
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;

  const bw = pw / n;
  const x = i => type === 'bar' ? padL + (i + 0.5) * bw : (n === 1 ? padL + pw / 2 : padL + (i * pw) / (n - 1));
  const y = v => padT + (1 - (v - min) / (max - min)) * ph;
  const gid = 'g' + Math.random().toString(36).slice(2, 8);

  let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">`;
  s += '<defs>' + series.map((se, i) =>
    `<linearGradient id="${gid}${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style="stop-color:${se.color};stop-opacity:.28"/><stop offset="100%" style="stop-color:${se.color};stop-opacity:0"/></linearGradient>`).join('') + '</defs>';

  for (let v = min; v <= max + step / 2; v += step) {
    const yy = y(v).toFixed(1);
    s += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" style="stroke:var(--border);stroke-width:1"/>`;
    s += `<text x="${padL - 6}" y="${yy}" text-anchor="end" dominant-baseline="middle" style="fill:var(--faint);font-size:10px">${esc(axisFmt(v))}</text>`;
  }
  const maxLabels = Math.max(2, Math.floor(pw / 46));
  const every = Math.ceil(n / maxLabels);
  labels.forEach((lb, i) => {
    if (i % every !== 0 && i !== n - 1) return;
    if (i !== n - 1 && n > maxLabels && (n - 1 - i) < every * 0.7) return; // evita sobrepor o último rótulo
    s += `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" style="fill:var(--faint);font-size:10px">${esc(lb)}</text>`;
  });

  series.forEach((se, si) => {
    if (se.flat) { // linha horizontal de referência (meta, média)
      const v = se.values.find(v => v !== null && isFinite(v));
      if (v === undefined) return;
      const yy = y(v).toFixed(1);
      s += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" style="stroke:${se.color};stroke-width:1.5;${se.dashed ? 'stroke-dasharray:4 4;' : ''}"/>`;
      return;
    }
    if (type === 'bar' && !se.line) {
      const w = Math.max(3, Math.min(34, bw * 0.62));
      se.values.forEach((v, i) => {
        if (v === null || !isFinite(v) || v === 0) return;
        const y0 = y(Math.max(min, 0)), y1 = y(v);
        const top = Math.min(y0, y1), h = Math.max(1, Math.abs(y0 - y1));
        s += `<rect x="${(x(i) - w / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(6, w / 3).toFixed(1)}" style="fill:${se.colors ? se.colors[i] : se.color};opacity:${se.colors ? .9 : (i === n - 1 ? 1 : .72)}"/>`;
      });
    } else {
      let pts = se.values.map((v, i) => (v === null || !isFinite(v)) ? null : [x(i), y(v)]);
      if (se.connectNulls) pts = pts.filter(Boolean);
      const segs = []; let cur = [];
      pts.forEach(p => { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } });
      if (cur.length) segs.push(cur);
      segs.forEach(seg => {
        const d = seg.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
        if (se.fill && seg.length > 1) {
          s += `<path d="${d} L${seg[seg.length - 1][0].toFixed(1)} ${y(Math.max(min, 0)).toFixed(1)} L${seg[0][0].toFixed(1)} ${y(Math.max(min, 0)).toFixed(1)} Z" style="fill:url(#${gid}${si})"/>`;
        }
        s += `<path d="${d}" style="fill:none;stroke:${se.color};stroke-width:${se.dashed ? 1.5 : 2.2};stroke-linejoin:round;stroke-linecap:round;${se.dashed ? 'stroke-dasharray:4 4;' : ''}"/>`;
        if (!se.dashed && (se.dots || seg.length <= 14)) seg.forEach(p => { s += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.6" style="fill:var(--surface);stroke:${se.color};stroke-width:1.8"/>`; });
      });
    }
  });
  s += `<line class="guide" x1="0" x2="0" y1="${padT}" y2="${padT + ph}" style="stroke:var(--border-strong);stroke-width:1;display:none"/>`;
  s += `<rect class="hit" x="${padL}" y="0" width="${pw}" height="${H}" style="fill:transparent"/>`;
  s += '</svg><div class="tip"></div>';
  container.innerHTML = s;

  const svg = container.querySelector('svg');
  const tip = container.querySelector('.tip');
  const guide = container.querySelector('.guide');
  const showAt = clientX => {
    const r = svg.getBoundingClientRect();
    const px = (clientX - r.left) * (W / r.width);
    let i = type === 'bar' ? Math.floor((px - padL) / bw) : Math.round(((px - padL) / pw) * (n - 1));
    i = Math.max(0, Math.min(n - 1, isNaN(i) ? 0 : i));
    const xx = x(i);
    guide.setAttribute('x1', xx); guide.setAttribute('x2', xx); guide.style.display = '';
    tip.innerHTML = `<b>${esc(tipLabels ? tipLabels[i] : labels[i])}</b>` + series.filter(se => !se.hideTip).map(se => {
      const v = se.values[i];
      return `<div><span style="color:${se.color}">●</span> ${esc(se.name ? se.name + ': ' : '')}${v === null || !isFinite(v) ? '—' : esc((se.fmt || fmt)(v))}</div>`;
    }).join('');
    tip.style.display = 'block';
    const left = (xx / W) * r.width;
    const half = tip.offsetWidth / 2;
    tip.style.left = Math.max(half, Math.min(r.width - half, left)) + 'px';
  };
  const hide = () => { tip.style.display = 'none'; guide.style.display = 'none'; };
  svg.addEventListener('pointermove', e => showAt(e.clientX));
  svg.addEventListener('pointerdown', e => showAt(e.clientX));
  svg.addEventListener('pointerleave', hide);
}

export { drawChart, niceStep };

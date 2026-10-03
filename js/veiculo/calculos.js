import { state } from '../estado.js';
import { sortFuelsAsc } from './vinculo.js';

/* ─── Cálculos ───
   Método "reserva a reserva": o combustível colocado no abastecimento N−1 é o que
   foi queimado até o abastecimento N. Por isso cada trecho (parcial[N]) é atribuído
   ao COMBUSTÍVEL do abastecimento anterior e ao TRAJETO informado em N
   ("como rodou desde o último abastecimento"). */
const TRAJETOS = { cidade: '🏙️ Cidade', estrada: '🛣️ Estrada', misto: '🔀 Misto' };

function calcFuels() {
  const sorted = sortFuelsAsc(state.fuels);
  return sorted.map((f, i) => {
    if (i === 0) return { ...f, consumption: null, prevLiters: null, costPerKm: null, prevTotal: null, burnedFuel: null, prevDate: null };
    const p = sorted[i - 1];
    const consumption = p.liters > 0 && f.partial > 0 ? f.partial / p.liters : null;
    const costPerKm = p.total > 0 && f.partial > 0 ? p.total / f.partial : null;
    return { ...f, consumption, prevLiters: p.liters, costPerKm, prevTotal: p.total, burnedFuel: p.fuelType || 'gas', prevDate: p.date };
  });
}

function aggTrechos(list) {
  const km = list.reduce((a, f) => a + f.partial, 0);
  const liters = list.reduce((a, f) => a + f.prevLiters, 0);
  const cost = list.reduce((a, f) => a + (f.prevTotal || 0), 0);
  return { count: list.length, km, liters, avg: liters > 0 ? km / liters : null, cpk: km > 0 && cost > 0 ? cost / km : null };
}

function vehicleStats(fuels) {
  const trechos = fuels.filter(f => f.consumption !== null);
  const byFuel = {};
  ['gas', 'eth', 'die'].forEach(ft => {
    const list = trechos.filter(f => f.burnedFuel === ft);
    if (!list.length) return;
    const agg = aggTrechos(list);
    agg.recentAvg = aggTrechos(list.slice(-3)).avg;
    agg.byTrajeto = {};
    Object.keys(TRAJETOS).forEach(tj => {
      const l2 = list.filter(f => f.trajeto === tj);
      if (l2.length) agg.byTrajeto[tj] = aggTrechos(l2);
    });
    byFuel[ft] = agg;
  });
  const all = aggTrechos(trechos.filter(f => f.costPerKm !== null));
  const maintCost = state.maintenances.reduce((a, m) => a + m.history.reduce((b, h) => b + (h.cost || 0), 0), 0);
  return {
    byFuel,
    cpk: all.cpk,                                                    // R$/km vale para qualquer combustível
    cpkTotal: all.km > 0 ? (all.km * (all.cpk || 0) + maintCost) / all.km : null,
    totalSpent: state.fuels.reduce((a, f) => a + f.total, 0),
    totalLiters: state.fuels.reduce((a, f) => a + f.liters, 0),
    maintCost
  };
}

function monthlySummary(fuels) {
  const map = {};
  const get = ym => (map[ym] = map[ym] || { ym, spent: 0, liters: 0, km: 0, cKm: 0, cCost: 0, maint: 0, count: 0 });
  fuels.forEach(f => {
    if (!f.date) return;
    const m = get(f.date.slice(0, 7));
    m.spent += f.total; m.liters += f.liters; m.km += f.partial; m.count++;
    if (f.costPerKm !== null) { m.cKm += f.partial; m.cCost += f.prevTotal; }
  });
  state.maintenances.forEach(mt => mt.history.forEach(h => { if (h.date) get(h.date.slice(0, 7)).maint += h.cost || 0; }));
  return Object.values(map).sort((a, b) => a.ym.localeCompare(b.ym)).slice(-12).map(m => ({
    ...m, cpk: m.cKm > 0 && m.cCost > 0 ? m.cCost / m.cKm : null
  }));
}

// Último preço pago por combustível (para o comparador etanol × gasolina)
function lastPrice(ft) {
  const f = sortFuelsAsc(state.fuels).filter(x => x.fuelType === ft && x.pricePerLiter > 0).pop();
  return f ? f.pricePerLiter : null;
}

export { TRAJETOS, aggTrechos, calcFuels, lastPrice, monthlySummary, vehicleStats };

// ============================================================
//  Painel Pessoal — Apps Script UNIFICADO (Gastos + Veículo)
//  Versão: unificado-3
//
//  O QUE MUDOU NA v3
//   • Chave de acesso: a planilha só responde a quem enviar a chave secreta.
//   • Colunas em português, lidas PELO NOME do cabeçalho (pode reordenar ou
//     acrescentar colunas suas — as que o app não conhece são preservadas).
//     Aceita variações: "Valor (R$)", "Valor total", "Data do pagamento"... Os seus
//     cabeçalhos NÃO são renomeados. Se faltar uma coluna essencial numa aba que já
//     tem dados, o script para e diz qual é (em vez de criar uma coluna vazia).
//   • Não formate as abas do app como "Tabela" do Google Sheets (colunas com tipo);
//     use intervalo comum com filtro.
//   • Você pode digitar/colar linhas direto na planilha: ids, ordem, cálculos
//     e a coluna que faltar (valor/litros/preço) são preenchidos sozinhos.
//
//  INSTALAÇÃO (na planilha "Gastos")
//   1. Extensões → Apps Script → apague o código antigo e cole este. Salve.
//   2. Recarregue a planilha. Vai aparecer o menu "Painel Pessoal".
//      Menu Painel Pessoal → "Gerar nova chave de acesso" (autorize na 1ª vez).
//      Copie a chave mostrada — ela vai no app em Ajustes → Google Sheets.
//   3. Apps Script → Implantar → Gerenciar implantações → ✏️ editar →
//      Versão: "Nova versão" → Implantar (a URL continua a mesma).
//      Executar como: Eu | Quem pode acessar: Qualquer pessoa
//      (quem não tiver a chave não consegue ler nem gravar nada).
//
//  ABAS E COLUNAS (abas e colunas que faltarem são criadas; as suas não são renomeadas)
//   Despesas        id | data | descricao | categoria | valor | ciclo | competencia | fixaId | origem
//   Fixas           id | nome | valorReferencia | diaVencimento | inicio | fim
//   Abastecimentos  id | ord | data | km | tipo | trajeto | valorPago | litros | precoLitro | obs | despesa | kmPorLitro | custoPorKm
//   Manutencoes     id | nome | intervaloKm | ultimoHodometro | avisarKm | custoEstimado
//   ManutHistorico  id | manutencaoId | data | hodometro | custo | obs | despesa
//   Config (coluna B) 1 teto cartão | 2 gasto inicial | 3 início ciclo | 4 fim ciclo | 5 Teto Total
//                     6/7 (antigos, sem uso) | 8 hodômetro inicial | 9 fatura do cartão principal
//
//  VALORES ACEITOS AO DIGITAR NA PLANILHA
//   ciclo / despesa : cartão | contas   (despesa vazio = abastecimento não vira despesa)
//   tipo            : gasolina | etanol | diesel
//   trajeto         : cidade | estrada | misto
//   km              : km rodados desde o abastecimento anterior (parcial)
//   competencia     : 2026-09  ou  09/2026 (vazio = mês da data)
// ============================================================

var VERSION = 'unificado-3';

var T = {
  EXP: { name: 'Despesas', fields: [
    { f: 'id', h: 'id', a: ['id'], t: 'text' },
    { f: 'date', h: 'data', a: ['date'], t: 'date' },
    { f: 'desc', h: 'descricao', a: ['desc', 'descricaodespesa'], t: 'text' },
    { f: 'cat', h: 'categoria', a: ['cat'], t: 'text' },
    { f: 'value', h: 'valor', a: ['value', 'valorrs'], t: 'money' },
    { f: 'ciclo', h: 'ciclo', a: [], t: 'text' },
    { f: 'competencia', h: 'competencia', a: ['comp'], t: 'text' },
    { f: 'fixedId', h: 'fixaId', a: ['fixedid', 'idfixa'], t: 'text' },
    { f: 'origem', h: 'origem', a: [], t: 'text' }
  ], legacy: ['id', 'date', 'desc', 'cat', 'value', 'ciclo', 'competencia', 'fixedId', 'origem'] },

  FIX: { name: 'Fixas', fields: [
    { f: 'id', h: 'id', a: [], t: 'text' },
    { f: 'desc', h: 'nome', a: ['desc', 'descricao'], t: 'text' },
    { f: 'refValue', h: 'valorReferencia', a: ['refvalue', 'valorref', 'referencia'], t: 'money' },
    { f: 'dueDay', h: 'diaVencimento', a: ['dueday', 'vencimento', 'dia'], t: 'int' },
    { f: 'inicio', h: 'inicio', a: [], t: 'text' },
    { f: 'fim', h: 'fim', a: [], t: 'text' }
  ], legacy: ['id', 'desc', null, 'refValue', 'dueDay', 'inicio', 'fim'] },

  FUEL: { name: 'Abastecimentos', fields: [
    { f: 'id', h: 'id', a: [], t: 'text' },
    { f: 'ord', h: 'ord', a: ['ordem', 'n', 'seq'], t: 'int' },
    { f: 'date', h: 'data', a: ['date'], t: 'date' },
    { f: 'partial', h: 'km', a: ['partial', 'parcial', 'kmrodados', 'hodometroparcial'], t: 'int' },
    { f: 'fuelType', h: 'tipo', a: ['fueltype', 'combustivel'], t: 'text' },
    { f: 'trajeto', h: 'trajeto', a: [], t: 'text' },
    { f: 'total', h: 'valorPago', a: ['total', 'valor', 'valortotal'], t: 'money' },
    { f: 'liters', h: 'litros', a: ['liters', 'lts'], t: 'num3' },
    { f: 'pricePerLiter', h: 'precoLitro', a: ['priceperliter', 'preco', 'r$/l', 'precoporlitro'], t: 'num3' },
    { f: 'note', h: 'obs', a: ['note', 'observacao'], t: 'text' },
    { f: 'expenseCiclo', h: 'despesa', a: ['despesaciclo', 'expenseciclo', 'lancadoem'], t: 'text' },
    { f: 'kmL', h: 'kmPorLitro', a: ['kml'], t: 'num2' },
    { f: 'cpk', h: 'custoPorKm', a: ['rskm', 'custokm'], t: 'num3' }
  ] },

  MAINT: { name: 'Manutencoes', fields: [
    { f: 'id', h: 'id', a: [], t: 'text' },
    { f: 'name', h: 'nome', a: ['name'], t: 'text' },
    { f: 'interval', h: 'intervaloKm', a: ['interval', 'intervalo'], t: 'int' },
    { f: 'lastOdo', h: 'ultimoHodometro', a: ['lastodo', 'ultimokm'], t: 'int' },
    { f: 'warnKm', h: 'avisarKm', a: ['warnkm', 'aviso'], t: 'int' },
    { f: 'cost', h: 'custoEstimado', a: ['cost', 'custo'], t: 'money' }
  ] },

  MHIST: { name: 'ManutHistorico', fields: [
    { f: 'id', h: 'id', a: [], t: 'text' },
    { f: 'maintId', h: 'manutencaoId', a: ['maintid'], t: 'text' },
    { f: 'date', h: 'data', a: ['date'], t: 'date' },
    { f: 'odo', h: 'hodometro', a: ['odo', 'km'], t: 'int' },
    { f: 'cost', h: 'custo', a: ['cost', 'valor'], t: 'money' },
    { f: 'note', h: 'obs', a: ['note', 'observacao'], t: 'text' },
    { f: 'expenseCiclo', h: 'despesa', a: ['despesaciclo', 'expenseciclo'], t: 'text' }
  ] }
};

var FMT = { text: '@', date: 'dd/MM/yyyy', money: '#,##0.00', int: '0', num2: '0.00', num3: '0.000' };
// Abas convertidas em "Tabela" no Google Sheets têm colunas com tipo definido e recusam
// mudança de formato. Nesses casos o formato é simplesmente pulado (o tipo da coluna manda).
var TYPED_COLS = {};
function setFormatsSafe(sh, row, col, matrix) {
  if (!matrix.length) return;
  var key = sh.getName();
  if (!TYPED_COLS[key]) {
    try { sh.getRange(row, col, matrix.length, matrix[0].length).setNumberFormats(matrix); return; }
    catch (e) { TYPED_COLS[key] = {}; }
  }
  for (var j = 0; j < matrix[0].length; j++) {
    var c = col + j;
    if (TYPED_COLS[key][c]) continue;
    try { sh.getRange(row, c, matrix.length, 1).setNumberFormats(matrix.map(function (r) { return [r[j]]; })); }
    catch (e) { TYPED_COLS[key][c] = true; }
  }
}

var CFG_LABELS = ['Teto Cartão', 'Gasto inicial', 'Início ciclo Cartão', 'Fim ciclo Cartão', 'Teto Total',
                  '(sem uso)', '(sem uso)', 'Hodômetro inicial (antes do 1º abastecimento)', 'Fatura do cartão principal'];

// ------------------------------------------------------------
//  MENU NA PLANILHA
// ------------------------------------------------------------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Painel Pessoal')
    .addItem('🔐 Gerar nova chave de acesso', 'gerarChave')
    .addItem('✏️ Definir chave manualmente', 'definirChave')
    .addSeparator()
    .addItem('🔄 Organizar e recalcular agora', 'organizarPlanilha')
    .addToUi();
}

function gerarChave() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('CHAVE')) {
    var r = ui.alert('Gerar nova chave?', 'A chave atual deixa de funcionar e você terá de colar a nova em cada aparelho.', ui.ButtonSet.OK_CANCEL);
    if (r !== ui.Button.OK) return;
  }
  var key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 32);
  props.setProperty('CHAVE', key);
  ui.alert('Chave de acesso', 'Copie e cole no app (Ajustes → Google Sheets → Chave):\n\n' + key +
    '\n\nGuarde-a num lugar seguro. Quem tiver a URL e esta chave consegue ler e alterar a planilha.', ui.ButtonSet.OK);
}

function definirChave() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Definir chave de acesso', 'Digite a chave (mínimo 16 caracteres):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var key = String(r.getResponseText() || '').trim();
  if (key.length < 16) { ui.alert('A chave precisa ter pelo menos 16 caracteres.'); return; }
  PropertiesService.getScriptProperties().setProperty('CHAVE', key);
  ui.alert('Chave salva.');
}

function organizarPlanilha() {
  var res = organizar(SpreadsheetApp.getActiveSpreadsheet());
  SpreadsheetApp.getActiveSpreadsheet().toast(res.join(' · ') || 'Tudo em ordem.', 'Painel Pessoal', 6);
}

// ------------------------------------------------------------
//  ENTRADAS WEB
// ------------------------------------------------------------
function doGet() {
  // Não devolve dados — só confirma que o script está no ar (os dados vão por POST com a chave)
  return json({
    status: 'success', ok: true, app: 'painel-pessoal', version: VERSION,
    chaveDefinida: !!PropertiesService.getScriptProperties().getProperty('CHAVE')
  });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var c = JSON.parse(e.postData.contents);
    checkKey(c);
    lock.waitLock(25000);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var out = { status: 'success', ok: true, version: VERSION };
    if (c.action === 'batch') {
      var done = 0;
      try {
        (c.ops || []).forEach(function (op) { handleOp(ss, op); done++; });
      } catch (err) {
        var op = (c.ops || [])[done] || {};
        return json({ status: 'error', ok: false, done: done, code: err && err.code,
                      message: errMsg(err) + ' (ao executar "' + op.action + '")' });
      }
      out.done = done;
      return json(out);
    }
    var r = handleOp(ss, c) || {};
    for (var k in r) out[k] = r[k];
    return json(out);
  } catch (err) {
    return json({ status: 'error', ok: false, message: errMsg(err), code: err && err.code });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function checkKey(c) {
  var key = PropertiesService.getScriptProperties().getProperty('CHAVE');
  if (!key) throw { code: 'SEM_CHAVE', message: 'A planilha ainda não tem chave de acesso. Abra a planilha → menu Painel Pessoal → Gerar nova chave de acesso.' };
  if (String(c.chave || '') !== key) throw { code: 'CHAVE_INVALIDA', message: 'Chave de acesso inválida.' };
}

function errMsg(err) {
  var m = (err && err.message) ? err.message : String(err);
  if (/coluna com tipo|typed column|tipo de coluna/i.test(m)) {
    m += ' — Alguma aba do app está formatada como Tabela do Google Sheets. Selecione a tabela → menu da tabela (⋮) → "Reverter para intervalo" e sincronize de novo.';
  }
  return m;
}

function handleOp(ss, c) {
  switch (c.action) {
    case 'ping': return {};
    case 'getAll':
      organizar(ss);
      return loadEverything(ss);
    case 'loadAll': // compatibilidade com o FuelTrack antigo
      return { data: loadEverything(ss).vehicle };

    case 'saveExpense': case 'addExpense': case 'updateExpense': case 'upsertExpense':
      upsert(ss, T.EXP, expToRow(c.item || c.expense)); return;
    case 'deleteExpense': deleteById(openTable(ss, T.EXP), c.id); return;

    case 'saveFixed': upsert(ss, T.FIX, fixToRow(c.item || c.fixed)); return;
    case 'deleteFixed': deleteById(openTable(ss, T.FIX), c.id); return;

    case 'saveFuel': upsert(ss, T.FUEL, fuelToRow(c.item)); return;
    case 'deleteFuel': deleteById(openTable(ss, T.FUEL), c.id); return;

    case 'saveMaint': upsert(ss, T.MAINT, maintToRow(c.item)); return;
    case 'deleteMaint':
      deleteById(openTable(ss, T.MAINT), c.id);
      var th = openTable(ss, T.MHIST);
      readAll(th).filter(function (o) { return idStr(o.maintId) === String(c.id); })
        .map(function (o) { return o._row; }).sort(function (a, b) { return b - a; })
        .forEach(function (r) { th.sh.deleteRow(r); });
      return;
    case 'saveMaintHist': upsert(ss, T.MHIST, histToRow(c.item, c.maintId)); return;
    case 'deleteMaintHist': deleteById(openTable(ss, T.MHIST), c.id); return;

    case 'saveConfig': saveConfig(ss, c.config || c); return;
    case 'saveVehicle': replaceVehicle(ss, c.vehicle || {}); return;
    default:
      throw { code: 'ACAO', message: 'Ação desconhecida: ' + c.action };
  }
}

// ------------------------------------------------------------
//  TABELAS (colunas localizadas pelo nome do cabeçalho)
// ------------------------------------------------------------
// Normaliza cabeçalhos: sem acento, sem maiúsculas, sem espaços e sem o que estiver entre
// parênteses — "Valor (R$)", "valor" e "VALOR" são a mesma coluna.
function norm(h) {
  return String(h || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');
}

// Campos que precisam existir quando a aba já tem dados (senão o app leria tudo zerado)
var REQUIRED = { Despesas: ['date', 'desc', 'value'], Fixas: ['desc'], Abastecimentos: ['date', 'partial'],
                 Manutencoes: ['name'], ManutHistorico: ['maintId', 'date'] };

function openTable(ss, def) {
  var sh = ss.getSheetByName(def.name) || ss.insertSheet(def.name);
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var keys = headers.map(norm);
  var usedCol = {};
  var map = {};
  var names = function (fd) { return [fd.h].concat(fd.a).map(norm).filter(String); };
  // 1ª passada: nome exato (ou apelido). 2ª passada: cabeçalho que começa com o nome
  // ("Valor total", "Data do pagamento"...). Cada coluna só serve a um campo.
  [false, true].forEach(function (prefix) {
    def.fields.forEach(function (fd) {
      if (map[fd.f]) return;
      var ns = names(fd);
      for (var i = 0; i < keys.length; i++) {
        if (usedCol[i] || !keys[i]) continue;
        var ok = ns.some(function (n) { return prefix ? (n.length >= 3 && keys[i].indexOf(n) === 0) : keys[i] === n; });
        if (ok) { map[fd.f] = i + 1; usedCol[i] = true; break; }
      }
    });
  });
  var hasData = sh.getLastRow() > 1;
  // Planilha antiga sem nenhum cabeçalho reconhecível: assume a ordem original das colunas
  if (def.legacy && hasData && Object.keys(map).length === 0) {
    def.legacy.forEach(function (f, i) {
      if (!f) return;
      var fd = def.fields.filter(function (x) { return x.f === f; })[0];
      map[f] = i + 1;
      if (!keys[i]) sh.getRange(1, i + 1).setValue(fd.h);
    });
  }
  // Coluna essencial não encontrada numa aba com dados: para e explica (não cria coluna vazia)
  if (hasData) {
    var missing = (REQUIRED[def.name] || []).filter(function (f) { return !map[f]; });
    if (missing.length) {
      var nomes = missing.map(function (f) { return '"' + def.fields.filter(function (x) { return x.f === f; })[0].h + '"'; });
      throw { code: 'COLUNA', message: 'Aba "' + def.name + '": não encontrei a coluna ' + nomes.join(', ') +
        '. Cabeçalhos atuais: ' + headers.filter(String).join(', ') + '. Renomeie o cabeçalho correspondente e sincronize de novo.' };
    }
  }
  // Colunas opcionais que faltarem são criadas no fim, com o nome padrão
  var used = headers.some(function (h) { return String(h).trim() !== ''; });
  var next = used ? lastCol + 1 : 1;
  def.fields.forEach(function (fd) {
    if (!map[fd.f]) { sh.getRange(1, next).setValue(fd.h); map[fd.f] = next; next++; }
  });
  if (!used) {
    try { sh.getRange(1, 1, 1, next - 1).setFontWeight('bold'); } catch (_) {}
    try { if (sh.getFrozenRows() < 1) sh.setFrozenRows(1); } catch (_) {}
  }
  return { sh: sh, def: def, map: map };
}

function tableWidth(t) {
  var m = 0;
  for (var f in t.map) m = Math.max(m, t.map[f]);
  return Math.max(m, t.sh.getLastColumn());
}

function readAll(t) {
  var last = t.sh.getLastRow();
  if (last < 2) return [];
  var width = tableWidth(t);
  var vals = t.sh.getRange(2, 1, last - 1, width).getValues();
  var out = [];
  vals.forEach(function (r, i) {
    var o = { _row: i + 2, _raw: r };
    var any = false;
    for (var f in t.map) {
      o[f] = r[t.map[f] - 1];
      if (filled(o[f]) && f !== 'kmL' && f !== 'cpk') any = true;
    }
    if (any) out.push(o);
  });
  return out;
}

function fieldType(def, f) {
  for (var i = 0; i < def.fields.length; i++) if (def.fields[i].f === f) return def.fields[i].t;
  return 'text';
}

// Grava só os campos informados, preservando as demais colunas da linha
function writeRow(t, rowIdx, rec) {
  var width = tableWidth(t);
  var range = t.sh.getRange(rowIdx, 1, 1, width);
  var vals = range.getValues()[0];
  var fmts = range.getNumberFormats()[0];
  for (var f in rec) {
    if (!t.map[f]) continue;
    vals[t.map[f] - 1] = rec[f];
    fmts[t.map[f] - 1] = FMT[fieldType(t.def, f)] || 'General';
  }
  setFormatsSafe(t.sh, rowIdx, 1, [fmts]);
  range.setValues([vals]);
}

function findRow(t, id) {
  var last = t.sh.getLastRow();
  if (last < 2 || !id) return -1;
  var ids = t.sh.getRange(2, t.map.id, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (idStr(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

function upsert(ss, def, rec) {
  if (!rec || !rec.id) throw { code: 'SEM_ID', message: 'Registro sem id' };
  var t = openTable(ss, def);
  var idx = findRow(t, rec.id);
  writeRow(t, idx > 0 ? idx : t.sh.getLastRow() + 1, rec);
}

function deleteById(t, id) {
  var idx = findRow(t, id);
  if (idx > 0) t.sh.deleteRow(idx);
}

// Reescreve o bloco de dados inteiro (usado para ordenar/recalcular Abastecimentos e no saveVehicle)
function writeBlock(t, rawRows) {
  var width = tableWidth(t);
  var last = t.sh.getLastRow();
  if (last > 1) t.sh.getRange(2, 1, last - 1, width).clearContent();
  if (!rawRows.length) return;
  var range = t.sh.getRange(2, 1, rawRows.length, width);
  var fmtRow = [];
  for (var c = 0; c < width; c++) fmtRow.push('General');
  t.def.fields.forEach(function (fd) { fmtRow[t.map[fd.f] - 1] = FMT[fd.t] || 'General'; });
  setFormatsSafe(t.sh, 2, 1, rawRows.map(function () { return fmtRow; }));
  range.setValues(rawRows.map(function (r) { while (r.length < width) r.push(''); return r.slice(0, width); }));
}

function rawFrom(t, base, rec) {
  var width = tableWidth(t);
  var r = (base || []).slice(0, width);
  while (r.length < width) r.push('');
  for (var f in rec) if (t.map[f]) r[t.map[f] - 1] = rec[f];
  return r;
}

// ------------------------------------------------------------
//  CONVERSÕES  app (JSON)  ⇄  planilha (português)
// ------------------------------------------------------------
function tz() { return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(); }

function sheetDate(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : '';
}
function outCiclo(v) { return v === 'contas' ? 'contas' : v === 'cartao' ? 'cartão' : ''; }
function inCiclo(v, dflt) {
  var k = norm(v);
  if (!k) return dflt;
  if (k.indexOf('conta') === 0) return 'contas';
  if (k.indexOf('cart') === 0 || k === 'credito') return 'cartao';
  return dflt;
}
function inTipo(v) {
  var k = norm(v);
  if (!k) return 'gas';
  if (k[0] === 'e' || k[0] === 'a') return 'eth'; // etanol / álcool
  if (k[0] === 'd') return 'die';
  return 'gas';
}
var TIPO_OUT = { gas: 'gasolina', eth: 'etanol', die: 'diesel' };
function inTrajeto(v) {
  var k = norm(v);
  if (!k) return '';
  if (k.indexOf('cid') === 0 || k.indexOf('urb') === 0) return 'cidade';
  if (k.indexOf('est') === 0 || k.indexOf('rod') === 0) return 'estrada';
  if (k.indexOf('mis') === 0) return 'misto';
  return '';
}

function expToRow(e) {
  return {
    id: String(e.id), date: sheetDate(e.date), desc: String(e.desc || ''), cat: String(e.cat || 'Outros'),
    value: Number(e.value) || 0, ciclo: outCiclo(e.ciclo === 'contas' ? 'contas' : 'cartao'),
    competencia: String(e.competencia || ''), fixedId: e.fixedId ? String(e.fixedId) : '', origem: String(e.origem || '')
  };
}
function expFromRow(o, z) {
  var d = isoDate(o.date, z);
  return {
    id: idStr(o.id), date: d, desc: String(o.desc || 'Sem descrição'), cat: String(o.cat || 'Outros'),
    value: num(o.value), ciclo: inCiclo(o.ciclo, 'cartao'),
    competencia: isoMonth(o.competencia, z) || d.slice(0, 7), fixedId: idStr(o.fixedId) || null, origem: String(o.origem || '')
  };
}
function fixToRow(f) {
  return { id: String(f.id), desc: String(f.desc || ''), refValue: Number(f.refValue) || 0, dueDay: f.dueDay || '',
           inicio: String(f.inicio || ''), fim: String(f.fim || '') };
}
function fixFromRow(o, z) {
  return { id: idStr(o.id), desc: String(o.desc || ''), cat: String(o.desc || ''), refValue: num(o.refValue),
           dueDay: filled(o.dueDay) ? Number(o.dueDay) || null : null, inicio: isoMonth(o.inicio, z), fim: isoMonth(o.fim, z) };
}
function fuelToRow(f) {
  var r = {
    id: String(f.id), ord: Number(f.ord) || '', date: sheetDate(f.date), partial: Number(f.partial) || 0,
    fuelType: TIPO_OUT[f.fuelType] || 'gasolina', trajeto: String(f.trajeto || ''), total: Number(f.total) || '',
    liters: Number(f.liters) || '', pricePerLiter: Number(f.pricePerLiter) || '', note: String(f.note || ''),
    expenseCiclo: outCiclo(f.expenseCiclo)
  };
  if (f.calcField && r.hasOwnProperty(f.calcField)) r[f.calcField] = ''; // valor calculado não vai para a planilha
  return r;
}
function fuelFromRow(o, z) {
  var p = num(o.pricePerLiter), l = num(o.liters), t = num(o.total);
  // O 3º campo (quando só 2 foram preenchidos) é calculado só como referência:
  // vai para o app marcado em "calcField", mas NUNCA é gravado na planilha.
  var calc = '';
  if (p > 0 && l > 0 && !t) { t = Math.round(p * l * 100) / 100; calc = 'total'; }
  if (p > 0 && t > 0 && !l) { l = Math.round(t / p * 1000) / 1000; calc = 'liters'; }
  if (l > 0 && t > 0 && !p) { p = Math.round(t / l * 1000) / 1000; calc = 'pricePerLiter'; }
  return {
    id: idStr(o.id), ord: num(o.ord) || null, date: isoDate(o.date, z), partial: num(o.partial), calcField: calc,
    fuelType: inTipo(o.fuelType), trajeto: inTrajeto(o.trajeto), total: t, liters: l, pricePerLiter: p,
    note: String(o.note || ''), expenseCiclo: inCiclo(o.expenseCiclo, '')
  };
}
function maintToRow(m) {
  return { id: String(m.id), name: String(m.name || ''), interval: Number(m.interval) || 0, lastOdo: Number(m.lastOdo) || 0,
           warnKm: Number(m.warnKm) || 500, cost: Number(m.cost) || 0 };
}
function maintFromRow(o) {
  return { id: idStr(o.id), name: String(o.name || ''), interval: num(o.interval), lastOdo: num(o.lastOdo),
           warnKm: num(o.warnKm) || 500, cost: num(o.cost), history: [] };
}
function histToRow(h, maintId) {
  return { id: String(h.id), maintId: String(maintId || h.maintId || ''), date: sheetDate(h.date), odo: Number(h.odo) || 0,
           cost: Number(h.cost) || 0, note: String(h.note || ''), expenseCiclo: outCiclo(h.expenseCiclo) };
}
function histFromRow(o, z) {
  return { id: idStr(o.id), maintId: idStr(o.maintId), date: isoDate(o.date, z), odo: num(o.odo), cost: num(o.cost),
           note: String(o.note || ''), expenseCiclo: inCiclo(o.expenseCiclo, '') };
}

// ------------------------------------------------------------
//  ORGANIZAR: completa o que foi digitado à mão na planilha
// ------------------------------------------------------------
function newId(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function organizar(ss) {
  var z = tz();
  var notes = [];

  // Despesas: id, competência e ciclo que faltarem
  var te = openTable(ss, T.EXP);
  var expRows = readAll(te);
  var expIds = {};
  expRows.forEach(function (o) {
    var upd = {};
    if (!filled(o.id)) upd.id = newId('d');
    var d = isoDate(o.date, z);
    if (!filled(o.competencia) && d) upd.competencia = d.slice(0, 7);
    if (!filled(o.ciclo)) upd.ciclo = 'cartão';
    // datas/valores digitados como texto viram data/número de verdade (melhor para filtros e relatórios)
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && !(o.date instanceof Date)) upd.date = sheetDate(d);
    if (typeof o.value === 'string' && o.value.trim() !== '') upd.value = num(o.value);
    if (Object.keys(upd).length) { writeRow(te, o._row, upd); notes.push('despesa completada'); }
    expIds[idStr(upd.id || o.id)] = true;
  });

  // Fixas, manutenções, histórico: ids que faltarem
  [T.FIX, T.MAINT, T.MHIST].forEach(function (def) {
    var t = openTable(ss, def);
    readAll(t).forEach(function (o) {
      if (!filled(o.id)) { writeRow(t, o._row, { id: newId(def.name[0].toLowerCase()) }); notes.push(def.name + ': id criado'); }
    });
  });

  // Abastecimentos: id, 3º campo, ordem por data, km/L e R$/km
  var tf = openTable(ss, T.FUEL);
  var rows = readAll(tf);
  if (rows.length) {
    var items = rows.map(function (o) {
      var f = fuelFromRow(o, z);
      if (!f.id) f.id = newId('a');
      return { o: o, f: f };
    });
    items.sort(function (a, b) {
      if (a.f.date !== b.f.date) return a.f.date < b.f.date ? -1 : 1;
      var ao = a.f.ord || 1e9, bo = b.f.ord || 1e9;
      if (ao !== bo) return ao - bo;
      return a.o._row - b.o._row;
    });
    var before = JSON.stringify(rows.map(function (o) { return o._raw; }));
    var newRaw = items.map(function (it, i) {
      var f = it.f;
      f.ord = i + 1;
      var prev = i > 0 ? items[i - 1].f : null;
      var rec = fuelToRow(f);
      rec.kmL = prev && prev.liters > 0 && f.partial > 0 ? Math.round(f.partial / prev.liters * 100) / 100 : '';
      rec.cpk = prev && prev.total > 0 && f.partial > 0 ? Math.round(prev.total / f.partial * 1000) / 1000 : '';
      return rawFrom(tf, it.o._raw, rec);
    });
    if (JSON.stringify(newRaw) !== before) { writeBlock(tf, newRaw); notes.push('abastecimentos organizados'); }

    // Abastecimento marcado com "despesa" (cartão/contas) e sem a despesa correspondente → cria
    items.forEach(function (it) {
      var f = it.f;
      if (!f.expenseCiclo || expIds['ab_' + f.id]) return;
      var nome = { gas: 'Gasolina', eth: 'Etanol', die: 'Diesel' }[f.fuelType];
      upsert(ss, T.EXP, expToRow({
        id: 'ab_' + f.id, date: f.date, desc: 'Combustível · ' + nome + ' ' + String(Math.round(f.liters * 10) / 10).replace('.', ',') + ' L',
        cat: 'Transporte', value: f.total, ciclo: f.expenseCiclo, competencia: f.date.slice(0, 7), origem: 'abastecimento:' + f.id
      }));
      expIds['ab_' + f.id] = true;
      notes.push('despesa de abastecimento criada');
    });
  }
  migrateConfig(ss);
  return notes.filter(function (v, i, a) { return a.indexOf(v) === i; });
}

// ------------------------------------------------------------
//  LEITURA COMPLETA
// ------------------------------------------------------------
function loadEverything(ss) {
  var z = tz();
  var cfg = configSheet(ss);
  var v = cfg.getRange('B1:B9').getValues().map(function (r) { return r[0]; });
  var config = {
    monthlyLimit: filled(v[0]) ? num(v[0]) : 3000,
    initialSpent: num(v[1]),
    startDate: filled(v[2]) ? isoDate(v[2], z) : '',
    endDate: filled(v[3]) ? isoDate(v[3], z) : '',
    totalLimit: num(v[4]),
    odoBase: num(v[7]),
    cardInvoiceName: filled(v[8]) ? String(v[8]) : ''
  };

  var expenses = readAll(openTable(ss, T.EXP)).map(function (o) { return expFromRow(o, z); }).filter(function (e) { return e.id; });
  var fixedItems = readAll(openTable(ss, T.FIX)).map(function (o) { return fixFromRow(o, z); }).filter(function (f) { return f.id; });
  var fuels = readAll(openTable(ss, T.FUEL)).map(function (o) { return fuelFromRow(o, z); }).filter(function (f) { return f.id; });
  var maints = readAll(openTable(ss, T.MAINT)).map(maintFromRow).filter(function (m) { return m.id; });
  var byId = {};
  maints.forEach(function (m) { byId[m.id] = m; });
  readAll(openTable(ss, T.MHIST)).map(function (o) { return histFromRow(o, z); }).forEach(function (h) {
    if (h.id && byId[h.maintId]) byId[h.maintId].history.push(h);
  });
  maints.forEach(function (m) { m.history.sort(function (a, b) { return a.date < b.date ? 1 : -1; }); });

  return { config: config, expenses: expenses, fixedItems: fixedItems,
           vehicle: { odoBase: config.odoBase, fuels: fuels, maintenances: maints } };
}

// ------------------------------------------------------------
//  CONFIG
// ------------------------------------------------------------
function configSheet(ss) {
  var sh = ss.getSheetByName('Config') || ss.insertSheet('Config');
  var a = sh.getRange('A1:A9').getValues();
  for (var i = 0; i < CFG_LABELS.length; i++) {
    if (!filled(a[i][0])) sh.getRange(i + 1, 1).setValue(CFG_LABELS[i]);
  }
  return sh;
}

// v1/v2 guardavam o hodômetro TOTAL em B8; a v3 guarda o hodômetro INICIAL
// (total = inicial + soma dos km dos abastecimentos — assim linhas digitadas à mão entram na conta)
function migrateConfig(ss) {
  var sh = configSheet(ss);
  var label = String(sh.getRange('A8').getValue());
  if (/total/i.test(label)) {
    var total = num(sh.getRange('B8').getValue());
    var soma = readAll(openTable(ss, T.FUEL)).reduce(function (a, o) { return a + num(o.partial); }, 0);
    sh.getRange('B8').setValue(Math.max(0, total - soma));
    sh.getRange('A8').setValue(CFG_LABELS[7]);
  }
  if (!/inicial/i.test(String(sh.getRange('A8').getValue()))) sh.getRange('A8').setValue(CFG_LABELS[7]);
  if (!filled(sh.getRange('A9').getValue())) sh.getRange('A9').setValue(CFG_LABELS[8]);
}

function saveConfig(ss, c) {
  var sh = configSheet(ss);
  migrateConfig(ss);
  var set = function (cell, val, fmt) {
    if (val === undefined || val === null) return;
    if (fmt) { try { sh.getRange(cell).setNumberFormat(fmt); } catch (_) {} }
    sh.getRange(cell).setValue(val);
  };
  set('B1', c.monthlyLimit, '#,##0.00');
  set('B2', c.initialSpent, '#,##0.00');
  if (c.startDate) set('B3', sheetDate(c.startDate), 'dd/MM/yyyy');
  if (c.endDate) set('B4', sheetDate(c.endDate), 'dd/MM/yyyy');
  set('B5', c.totalLimit, '#,##0.00');
  set('B8', c.odoBase, '0');
  if (c.cardInvoiceName !== undefined) set('B9', String(c.cardInvoiceName || ''), '@');
}

// Substitui todo o veículo (importação do FuelTrack antigo / restauração)
function replaceVehicle(ss, v) {
  var fuels = v.fuels || [];
  var tf = openTable(ss, T.FUEL);
  writeBlock(tf, fuels.map(function (f) { return rawFrom(tf, [], fuelToRow(f)); }));
  var tm = openTable(ss, T.MAINT);
  writeBlock(tm, (v.maintenances || []).map(function (m) { return rawFrom(tm, [], maintToRow(m)); }));
  var th = openTable(ss, T.MHIST);
  var hist = [];
  (v.maintenances || []).forEach(function (m) {
    (m.history || []).forEach(function (h) { hist.push(rawFrom(th, [], histToRow(h, m.id))); });
  });
  writeBlock(th, hist);
  var base = v.odoBase;
  if (base === undefined && v.odometer !== undefined) {
    base = Number(v.odometer) - fuels.reduce(function (a, f) { return a + (Number(f.partial) || 0); }, 0);
  }
  if (base !== undefined) saveConfig(ss, { odoBase: Math.max(0, Number(base) || 0) });
  organizar(ss);
}

// ------------------------------------------------------------
//  UTILITÁRIOS
// ------------------------------------------------------------
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function filled(v) { return v !== '' && v !== null && v !== undefined; }
function idStr(v) {
  if (!filled(v)) return '';
  if (typeof v === 'number') return v.toFixed(0);
  return String(v).trim();
}
function pad(n) { n = String(n).trim(); return n.length === 1 ? '0' + n : n; }

function num(val) {
  if (typeof val === 'number') return isFinite(val) ? val : 0;
  if (!filled(val)) return 0;
  var s = String(val).replace(/R\$/g, '').replace(/\s/g, '');
  if (s.indexOf(',') !== -1) s = s.replace(/\./g, '').replace(',', '.');
  return parseFloat(s) || 0;
}

function isoDate(val, z) {
  if (!filled(val)) return '';
  if (val instanceof Date) return Utilities.formatDate(val, z || tz(), 'yyyy-MM-dd');
  var s = String(val).trim();
  if (s.indexOf('T') !== -1) s = s.split('T')[0];
  var p;
  if (s.indexOf('/') !== -1) {
    p = s.split('/');
    if (p.length === 3 && p[2].length === 4) return p[2] + '-' + pad(p[1]) + '-' + pad(p[0]);
    if (p.length === 3 && p[2].length === 2) return '20' + p[2] + '-' + pad(p[1]) + '-' + pad(p[0]);
    if (p.length === 3 && p[0].length === 4) return p[0] + '-' + pad(p[1]) + '-' + pad(p[2]);
  }
  if (s.indexOf('-') !== -1) {
    p = s.split('-');
    if (p.length === 3 && p[2].length === 4) return p[2] + '-' + pad(p[1]) + '-' + pad(p[0]);
  }
  return s;
}

// Competência sempre "YYYY-MM", mesmo que o Sheets tenha convertido em data
function isoMonth(val, z) {
  if (!filled(val)) return '';
  if (val instanceof Date) return Utilities.formatDate(val, z || tz(), 'yyyy-MM');
  var s = String(val).trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  var m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return m[2] + '-' + pad(m[1]);
  var d = isoDate(s, z);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d.slice(0, 7);
  return s;
}

# Contexto do Projeto — Painel Pessoal (Teto de Gastos + FuelTrack)

Repositório: `github.com/Jaleles/painel` (GitHub Pages). O código é a fonte da
verdade do "como"; este documento explica o "porquê". O `AppsScript_Unificado.gs`
e o `GUIA_PUBLICACAO.md` ainda não estão no repositório.

## O que é

Web app pessoal (PWA instalável, publicado no GitHub Pages) em HTML + CSS + JS puro com **módulos ES nativos**
(**sem nenhuma dependência/CDN e sem etapa de build**, funciona offline), que une os antigos
**Teto de Gastos Pro** (v3) e **FuelTrack** (v5). Sincroniza com **uma única
planilha Google Sheets** via Apps Script (Web App). Dados também ficam no
`localStorage` (chave `painel_pessoal_v1`).

## Estrutura do código

- `index.html` (só a marcação) · `styles.css` · `js/main.js` (entrada: chama `init()` de `app.js`).
- `js/util.js`: constantes, `$`, `store`, formatação, `el`/`esc`, toast. **Não importa nada** (é avaliado primeiro;
  `estado.js` usa `store` já na carga do módulo — manter assim para evitar erro de ordem em importações circulares).
- `js/estado.js` (state, normalização, localStorage, backups) · `js/sync.js` (fila, API, `pullAll`) · `js/graficos.js` · `js/modal.js`.
- `js/gastos/`: `comum` (categorias, duplicatas, linha da lista), `cartao`, `parcelas`, `contas`, `exclusao`, `teto`, `historico`, `fixas`.
- `js/veiculo/`: `vinculo` (despesa ↔ abastecimento/manutenção), `calculos` (reserva a reserva), `abastecer`, `painel`, `historico`, `manutencao`, `tela`.
- `js/app.js` (navegação, tema, eventos, `init`) · `js/ajustes.js` (ajustes, backups, importação do FuelTrack).
- Regra de módulos: uma variável `let` só é reatribuída no próprio módulo; de fora, use funções
  (`setState`, `resetBillsCompetencia`, `cancelOdometer`) ou altere o objeto (`Object.assign(conn, …)`).
- Abrir o `index.html` direto do disco (file://) **não funciona** com módulos: para testar no PC use um servidor local
  (`python -m http.server` na pasta e abrir `http://localhost:8000`).

## Testes

- `npm test` (Node 24, `node:test`, sem dependências). `tests/harness.mjs` importa os módulos num navegador simulado;
  `load({ today })` zera o estado e fixa a data. Cobrem utilidades, Cartão (ciclo por data, meta do dia), Contas
  (projeção, fixas, parcelas), Veículo (reserva a reserva, combustíveis separados) e sincronização (fila, reaplicação).
- `tests/publicacao.test.mjs` falha se algum arquivo de `js/` ou o `styles.css` não estiver no `ARQUIVOS` do `sw.js`.
- Teste de duplicatas documenta o comportamento atual (só data+valor+descrição idênticos); casos reais de 09/2026
  ("Della almoço?", "Etanol dia 6") passaram sem aviso — melhoria planejada.

## Navegação

Barra inferior (estilo app): **💳 Cartão · 🧾 Contas · 🎯 Teto · 🚗 Veículo · 📜 Histórico**.
Botão ⚙️ no cabeçalho abre **Ajustes**. Cor de destaque muda por seção.
Tema claro/escuro (segue o sistema até o usuário escolher). Última tela é lembrada.

- **Cartão / Contas / Teto Total / Histórico**: mesma lógica do Teto de Gastos v3
  (ciclo por datas, competência separada da data, seletor ◀ ▶ de competência,
  duplicatas sinalizadas, lista ordenada por data, desfazer exclusão).
- **Gráfico do Cartão** tem dois modos (lembrado entre sessões): **Diário**
  (barras por dia; dias acima da meta ficam laranja; linha tracejada = meta
  diária = teto ÷ dias do ciclo; linha roxa = sua média real até hoje; resumo
  com dias acima da meta e maior gasto) e **Acumulado** (acumulado × ritmo
  ideal, com quanto está acima/abaixo do ideal hoje).
- **Nome da planilha** no Google Drive é irrelevante (o script usa a planilha
  onde está instalado). Os nomes das **abas** (`Despesas`, `Config`, `Fixas`)
  **não podem mudar**.
- **Veículo** tem sub-abas: Abastecer · Painel · Histórico · Manut.
- **Ajustes**: ciclo Cartão, Contas & Teto Total, Despesas Fixas, preferências do
  veículo, URL do Sheets, importação do FuelTrack antigo, backups (local +
  exportar/importar arquivo JSON).

## Integração Gastos ↔ Veículo (decisão da unificação)

- Ao salvar um abastecimento há um botão **"Lançar como despesa"** (padrão
  configurável em Ajustes) + escolha **Cartão ou Contas**. Cria despesa
  `Combustível · Gasolina 40,0 L`, categoria **Transporte**, competência = mês da data.
- Vínculo: despesa `id = ab_<idAbastecimento>`, campo `origem = "abastecimento:<id>"`.
  Editar o abastecimento atualiza a despesa; desligar o botão ou excluir o
  abastecimento remove a despesa. Excluir a despesa direto no Gastos só
  desfaz o vínculo (o abastecimento permanece).
- **Manutenção realizada** também pode lançar o custo como despesa
  (`id = mn_<idHistórico>`, `origem = "manutencao:<idAlerta>"`).
- **Consertos e serviços avulsos** (farol, escapamento, fluido… sem intervalo de km), na aba Manut.: ficam no
  histórico de uma manutenção especial `id = consertos` com `interval = 0` (reaproveita as abas Manutencoes/
  ManutHistorico, sem mudar o Apps Script; descrição vai em `obs`). `interval = 0` nunca gera alerta
  (`alertMaintenances`). À vista + "Lançar como despesa" → despesa vinculada `mn_<idHistórico>`. Parcelado (2x+) →
  parcelas comuns no Cartão/Contas ("Conserto · X (parc 1/3)"), **sem** vínculo e com `despesa` vazia no histórico
  (evita a planilha recriar a despesa cheia). Excluir usa `deleteMaintHist { id, maintId }`.
- Abastecimentos importados do FuelTrack antigo **não** viram despesas
  (evita duplicar gastos que já tinham sido lançados à mão).
- A aba Teto mostra "Veículo no mês" (combustível, manutenção, km) — só informativo.

## Veículo — lógica de consumo (decisão do usuário, não mudar)

- Método **"reserva a reserva"**: o usuário abastece quando acende a luz da
  reserva, quase nunca enche o tanque. Logo, o combustível do abastecimento
  N−1 é o que foi queimado até N: **km/L[N] = parcial[N] ÷ litros[N−1]**.
- Cada trecho é atribuído ao **combustível do abastecimento anterior** (o que
  estava no tanque) e ao **trajeto** informado em N ("como rodou desde o último
  abastecimento": 🏙️ cidade, 🛣️ estrada ou 🔀 misto).
- **Nunca misturar etanol e gasolina numa média única** (etanol ~7 km/L,
  gasolina 9–11). O painel mostra uma tabela combustível × trajeto.
- **R$/km[N] = total[N−1] ÷ parcial[N]** — esse vale para os dois combustíveis.
- **Etanol ou gasolina?**: usa a razão real do carro (km/L etanol ÷ km/L
  gasolina); sem dados dos dois, usa a regra geral de 70%.
- **Autonomia até a reserva**: litros do último abastecimento × média recente
  (últimos 3 trechos) do combustível que está no tanque. Parcial atual opcional.
- Preview ao digitar a parcial: km/L do combustível anterior e % vs a média dele.
- Resumo mensal: Gasto / Litros / Km / R$/km (sem km/L, que misturaria combustíveis).

## Contas — regras atuais

- A tela abre no **mês corrente**; só avança para o mês seguinte quando todas
  as fixas ativas do mês já foram lançadas. Aviso se o mês anterior ficou com
  fixa sem lançamento. (Os "dias início/fim do ciclo Contas" saíram da tela;
  B6/B7 continuam na planilha só por compatibilidade.)
- **Projeção** = fixas (lançadas, ou estimadas pelo último valor pago) +
  avulsos/parcelas já lançados na competência. O Teto usa o mês corrente.
- **Parcelamento** (Contas e Cartão): lança todas as parcelas de uma vez, uma
  por mês (data e competência avançam), descrição "X (parc 2/4)",
  `origem = "parcela:<grupo>:<n>/<total>"`. Valor pode ser da parcela ou total
  (a última parcela absorve os centavos). Excluir oferece "só esta" ou "esta e
  as seguintes". Não se aplica a lançamentos de fixa.
- **Fatura do cartão principal**: nome configurável em Ajustes (Config B9). Se
  algo com esse nome for lançado em Contas ou cadastrado como fixa, o app avisa
  que contaria em dobro no Teto Total.
- **Fixas têm início e fim** (competência). "Encerrar" (📦) define o fim como a
  última competência lançada; dá para reativar. Fixas antigas recebem como
  início a 1ª competência em que foram lançadas.
- **Ciclo do cartão continua manual** (datas de início/fim): o banco tem fechado
  em datas diferentes a cada mês — decisão do usuário.

## Modelo de dados (state)

Gastos: `startDate, endDate, monthlyLimit, initialSpent, totalLimit, expenses[], fixedItems[]`
- expense: `{ id, date, desc, cat, value, ciclo:'cartao'|'contas', competencia:'YYYY-MM', fixedId?, origem? }`
  (`origem`: `abastecimento:<id>`, `manutencao:<id>` ou `parcela:<grupo>:<n>/<total>`)
- fixedItem: `{ id, desc, cat(=desc), refValue, dueDay, inicio:'YYYY-MM', fim:'YYYY-MM'|'' }`

Veículo: `odoBase, fuels[], maintenances[]`
- **Hodômetro total = odoBase + soma dos km dos abastecimentos** (assim linhas
  digitadas na planilha entram na conta). "Corrigir hodômetro" recalcula o odoBase.
- fuel: `{ id, ord, date, partial, fuelType:'gas'|'eth'|'die', trajeto:''|'cidade'|'estrada'|'misto', pricePerLiter, liters, total, note, expenseCiclo:''|'cartao'|'contas' }`
- maintenance: `{ id, name, interval, lastOdo, warnKm, cost, history:[{ id, date, odo, cost, note, expenseCiclo }] }`

Fila: `outbox: [{ k, action, body }]` (ver Sincronização). Preferências: `fuelLinkDefault, fuelCiclo, cardInvoiceName`.
Conexão (`painel_pessoal_conn` = `{url, chave}`) fica **fora** do state: não vai para backups nem exportações.
UI (tema, tela, parcial atual, último trajeto) em `painel_pessoal_ui`.

## Planilha / Apps Script (`AppsScript_Unificado.gs`, versão `unificado-3`)

- **A planilha é a fonte da verdade** e o usuário **lança/corrige direto nela** (confere e faz relatórios lá).
- **Colunas em português, localizadas pelo nome do cabeçalho**: normaliza (sem acento/maiúsculas/espaços e ignora
  o que está entre parênteses) → 1º nome exato/apelido, depois "começa com" ("Valor (R$)", "Data do pagamento").
  **Não renomeia cabeçalhos do usuário**; só cria no fim as colunas opcionais que faltarem. Se faltar coluna
  essencial (Despesas: data/descrição/valor; Abastecimentos: data/km…) numa aba com dados → erro `COLUNA`
  explicando qual renomear (lição aprendida: antes criava coluna "valor" vazia ao não reconhecer "Valor (R$)").
  Planilha sem nenhum cabeçalho reconhecível cai na ordem original das colunas.
  - Despesas: `id|data|descricao|categoria|valor|ciclo|competencia|fixaId|origem`
  - Fixas: `id|nome|valorReferencia|diaVencimento|inicio|fim`
  - Abastecimentos: `id|ord|data|km|tipo|trajeto|valorPago|litros|precoLitro|obs|despesa|kmPorLitro|custoPorKm`
    **Ordem real na planilha do usuário:** `id|data|km|tipo|precoLitro|litros|valorPago|obs|despesa|trajeto|ord|kmPorLitro|custoPorKm`
    (usar esta ordem ao gerar linhas para ele colar).
  - Manutencoes: `id|nome|intervaloKm|ultimoHodometro|avisarKm|custoEstimado`
  - ManutHistorico: `id|manutencaoId|data|hodometro|custo|obs|despesa`
  - Config coluna B: 1 teto cartão, 2 gasto inicial, 3/4 ciclo, 5 Teto Total, 8 **hodômetro inicial**, 9 fatura do cartão principal (6/7 sem uso).
- **Valor/litros/preço: a planilha guarda só os valores reais do cupom.** Se faltar um dos três, ele é
  calculado apenas como referência (`calcField`, mostrado com "≈" no app) e **nunca é gravado** — arredondamentos
  alterariam a soma (decisão do usuário).
- **Não usar "Tabela" do Google Sheets** nas abas do app (colunas com tipo travaram a gravação na prática;
  o usuário reverteu para intervalo). O script pula formatos recusados (`setFormatsSafe`) e, se o erro de
  "coluna com tipo" aparecer, a mensagem orienta a reverter para intervalo. Erros de lote informam a ação que falhou.
- Valores gravados em português: ciclo/despesa `cartão|contas`, tipo `gasolina|etanol|diesel`; datas como data real (dd/MM/yyyy), valores como número.
- **"Organizar"** roda a cada `getAll` (e no menu): preenche ids vazios, competência/ciclo que faltam, converte datas/valores digitados como texto;
  em Abastecimentos ordena por data+ord, renumera `ord` e grava `kmPorLitro`/`custoPorKm`;
  abastecimento com `despesa` preenchida e sem despesa `ab_<id>` → cria a despesa.
- Ações (POST, sempre com `chave`): `getAll`, `batch{ops}`, `saveExpense/deleteExpense`, `saveFixed/deleteFixed`,
  `saveFuel/deleteFuel`, `saveMaint/deleteMaint` (apaga o histórico junto), `saveMaintHist/deleteMaintHist`,
  `saveConfig`, `saveVehicle` (substitui o veículo inteiro — importação/restauração), `loadAll` (compat.), `ping`.
  `doGet` não devolve dados (só `app`, `version`, `chaveDefinida`).
- Menu na planilha **Painel Pessoal**: Gerar nova chave · Definir chave manualmente · Organizar e recalcular agora.

## Segurança

- Chave secreta em Script Properties (`CHAVE`), gerada pelo menu. Sem chave → `SEM_CHAVE`; errada → `CHAVE_INVALIDA`.
- URL e chave **não ficam no código**; o usuário cola em Ajustes → Google Sheets ("Testar e conectar") em cada aparelho.
- Trocar a chave invalida a antiga na hora.

## Sincronização

- Toda alteração vira uma operação na **fila (outbox)** com chave única (`exp:<id>`, `fuel:<id>`, `maint:<id>`,
  `mhist:<id>`, `fix:<id>`, `config`, `vehicle:full`); a mais recente substitui a anterior de mesma chave.
- Enviada em **lote** (até 40 por requisição); só sai da fila o que a planilha confirmou (`done`).
- `pullAll`: envia a fila → `getAll` → substitui os dados locais pelos da planilha → reaplica o que ainda está na fila.
- Na 1ª sincronização, se a planilha não tem veículo e o aparelho tem, envia o do aparelho (`vehicle:full`).
- Sincroniza ao abrir, ao voltar para o app, ao reconectar a internet e ao tocar no status.
- Backup local automático (a cada 6 h, 5 últimos) + exportar/importar arquivo; restaurar/importar regrava na planilha.

## Publicação (GitHub Pages)

- Raiz do repositório: `index.html`, `styles.css`, `js/`, `manifest.webmanifest`, `sw.js` (offline; rede primeiro
  para a página, nunca faz cache do Apps Script) e `icons/`. `package.json`/`tests/` só servem para os testes.
- Ao publicar versão nova, aumentar `VERSAO` no `sw.js` (o app mostra "Nova versão disponível → Atualizar")
  e, se criar arquivo novo em `js/`, incluí-lo em `ARQUIVOS` (o teste de publicação avisa).
- Passo a passo completo em `GUIA_PUBLICACAO.md`.

## Correções de bugs herdados

- `fixedId` não era salvo na planilha → fixas voltavam a aparecer como pendentes.
- Pendentes nunca eram reenviados.
- Datas do FuelTrack vindas do Sheets como "Tue Sep 01 2026…" quebravam o app.
- XSS em observações/nomes de manutenção do FuelTrack (agora escapados).

## Decisões de produto (não reabrir sem necessidade)

Todas as do Teto de Gastos continuam valendo: nunca "salário" (usar "Teto
Total"); nome da fixa = categoria; Cartão 2 é uma fixa comum; parcelamento
avulso não vira fixa (lançar com "(parc 3/4)" na descrição).

## Estado da planilha real (auditoria de 26/09/2026, cópia .xlsx)

- Despesas: 147 lançamentos (31/07 a 26/09), sem ids duplicados; categorias extras em uso no Cartão
  (Serviços, Vestuário, Pet) → app v3.1 passou a listar categorias usadas (antes, editar trocava para "Outros").
- Lançamentos de Contas de 09/2026 estavam sem `fixaId` → fixas apareciam pendentes; orientado a preencher.
- Fixa "Cartão Visa" (ref. 2500 = Teto Mensal) + lançamento de R$ 3.184,32 em Contas: **perguntado ao usuário se
  Visa é o cartão do ciclo Cartão** (se for, conta em dobro no Teto Total → marcar como fatura principal/encerrar a fixa).
- Abas sem uso pelo app: "Gastos" (só cabeçalho), "Backups" (v2), "Backup Despesas" (Tabela, backup do usuário).

## Pendências / ideias (a analisar depois)

- Relatório por categoria; filtro do Histórico por competência.
- Conflito: se o mesmo registro for editado no app offline e na planilha, vale o do app ao sincronizar.
- Múltiplos veículos; exportar PDF; capacidade do tanque na autonomia.

## Instalação

Ver `GUIA_PUBLICACAO.md` (planilha + chave → GitHub Pages → conectar e instalar no celular).
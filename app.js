/* Finanças da Casa — app do casal (Supabase + PWA) */
'use strict';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const DEF_RECEITAS = ['Salário', 'Renda extra', 'Outros'];
const pad = n => String(n).padStart(2, '0');
const ym = d => d.getFullYear() + '-' + pad(d.getMonth() + 1);
const hoje = () => { const d = new Date(); return ym(d) + '-' + pad(d.getDate()); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const parseVal = v => { v = String(v || '').trim().replace(/[R$\s]/g, ''); if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.'); const n = parseFloat(v); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
const money = v => BRL.format(+v || 0);
const $ = id => document.getElementById(id);

const S = { hh: null, casa: null, cfg: { pessoas: [], categorias: [], receitas: DEF_RECEITAS }, lanc: [], contas: [], metas: [], mes: ym(new Date()), tab: 'lanc', tipo: 'despesa', signup: false };

/* ---------- Supabase ---------- */
const C = window.APP_CONFIG || {};
const configurado = C.supabaseUrl && !/COLE_AQUI/.test(C.supabaseUrl) && C.supabaseAnonKey && !/COLE_AQUI/.test(C.supabaseAnonKey);
const sb = configurado ? window.supabase.createClient(C.supabaseUrl, C.supabaseAnonKey) : null;

function show(view) {
  for (const v of ['vAuth', 'vCasa', 'vApp']) $(v).hidden = v !== view;
  $('fab').hidden = view !== 'vApp';
}
function note(t) { const n = $('note'); n.textContent = t || ''; n.hidden = !t; }
function erroMsg(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (/Invalid login/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/already registered/i.test(m)) return 'Esse e-mail já tem conta. Use "Entrar".';
  if (/Email not confirmed/i.test(m)) return 'Confirme seu e-mail pelo link que chegou na caixa de entrada.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sem conexão. Verifique a internet e tente de novo.';
  return m;
}
async function run(fn) {
  try { const r = await fn(); if (r && r.error) throw r.error; return r; }
  catch (e) { note('Não consegui salvar: ' + erroMsg(e)); throw e; }
}

/* ---------- Início ---------- */
async function iniciar() {
  if (!sb) { show('vAuth'); $('authSub').textContent = 'Falta configurar o Supabase: preencha o arquivo config.js (veja o README).'; $('authForm').hidden = true; $('aToggle').hidden = true; return; }
  const { data } = await sb.auth.getSession();
  sb.auth.onAuthStateChange((ev, sess) => { if (ev === 'SIGNED_OUT') { limparCanais(); S.hh = null; show('vAuth'); } });
  if (!data.session) { show('vAuth'); return; }
  await escolherCasa();
}
async function escolherCasa() {
  const { data, error } = await sb.from('members').select('household_id, nome').limit(1);
  if (error) { show('vCasa'); $('hErr').textContent = erroMsg(error); return; }
  if (!data.length) { show('vCasa'); return; }
  S.hh = data[0].household_id;
  show('vApp'); render();
  await carregarTudo(); assinar();
}

/* ---------- Login ---------- */
$('aToggle').onclick = () => {
  S.signup = !S.signup;
  $('aBtn').textContent = S.signup ? 'Criar conta' : 'Entrar';
  $('aToggle').textContent = S.signup ? 'Já tenho conta. Entrar' : 'Ainda não tenho conta. Criar conta';
  $('aSenha').autocomplete = S.signup ? 'new-password' : 'current-password';
  $('aErr').textContent = '';
};
$('authForm').onsubmit = async e => {
  e.preventDefault(); $('aErr').textContent = ''; $('aBtn').disabled = true;
  const email = $('aEmail').value.trim(), password = $('aSenha').value;
  try {
    const r = S.signup ? await sb.auth.signUp({ email, password }) : await sb.auth.signInWithPassword({ email, password });
    if (r.error) throw r.error;
    if (!r.data.session) { if (S.signup) $('aToggle').click(); $('aErr').textContent = 'Conta criada. Abra o e-mail de confirmação e depois entre aqui.'; return; }
    await escolherCasa();
  } catch (err) { $('aErr').textContent = erroMsg(err); }
  finally { $('aBtn').disabled = false; }
};

/* ---------- Casa ---------- */
$('hCriar').onclick = async () => {
  $('hErr').textContent = '';
  const { error } = await sb.rpc('criar_casa', { meu_nome: $('hNome').value.trim() });
  if (error) { $('hErr').textContent = erroMsg(error); return; }
  S.tab = 'ajustes'; await escolherCasa();
};
$('hEntrar').onclick = async () => {
  $('hErr').textContent = '';
  const cod = $('hCodigo').value.trim();
  if (cod.length < 6) { $('hErr').textContent = 'O código tem 6 caracteres.'; return; }
  const { error } = await sb.rpc('entrar_na_casa', { cod, meu_nome: $('hNome').value.trim() });
  if (error) { $('hErr').textContent = erroMsg(error); return; }
  await escolherCasa();
};
$('hSair').onclick = () => sb.auth.signOut();

/* ---------- Dados ---------- */
const TABELAS = { lancamentos: 'lanc', contas: 'contas', metas: 'metas' };
async function carregar(tabela) {
  if (tabela === 'config') {
    const { data } = await sb.from('config').select('*').eq('household_id', S.hh).maybeSingle();
    if (data) S.cfg = { pessoas: data.pessoas || [], categorias: data.categorias || [], receitas: (data.receitas && data.receitas.length) ? data.receitas : DEF_RECEITAS };
    return;
  }
  if (tabela === 'households') {
    const { data } = await sb.from('households').select('*').eq('id', S.hh).maybeSingle();
    S.casa = data; return;
  }
  const { data, error } = await sb.from(tabela).select('*').eq('household_id', S.hh);
  if (error) { note('Erro ao carregar: ' + erroMsg(error)); return; }
  S[TABELAS[tabela]] = data || [];
}
async function carregarTudo() {
  const t = setTimeout(() => note('Os dados estão demorando para carregar. Confira a internet.'), 10000);
  await Promise.all(['config', 'households', 'lancamentos', 'contas', 'metas'].map(carregar));
  clearTimeout(t); if ($('note').textContent.startsWith('Os dados')) note('');
  render();
}
let canal = null; const timers = {};
function assinar() {
  limparCanais();
  canal = sb.channel('casa-' + S.hh);
  for (const tabela of ['config', 'lancamentos', 'contas', 'metas']) {
    canal.on('postgres_changes', { event: '*', schema: 'public', table: tabela, filter: 'household_id=eq.' + S.hh }, () => {
      clearTimeout(timers[tabela]);
      timers[tabela] = setTimeout(async () => { await carregar(tabela); render(); }, 250);
    });
  }
  canal.subscribe();
}
function limparCanais() { if (canal) { sb.removeChannel(canal); canal = null; } }
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.hh) carregarTudo(); });

async function salvarCfg(next) {
  S.cfg = next; render();
  await run(() => sb.from('config').update({ pessoas: next.pessoas, categorias: next.categorias, receitas: next.receitas }).eq('household_id', S.hh));
}

/* ---------- Cálculos ---------- */
const doMes = m => S.lanc.filter(l => (l.data || '').startsWith(m));
function somas(list) { let e = 0, s = 0; for (const l of list) { if (l.tipo === 'receita') e += +l.valor || 0; else s += +l.valor || 0; } return { e, s }; }
function gastoMedio() {
  const [y, m] = S.mes.split('-').map(Number); const vals = [];
  for (let i = 1; i <= 3; i++) { const t = somas(doMes(ym(new Date(y, m - 1 - i, 1)))).s; if (t > 0) vals.push(t); }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : somas(doMes(S.mes)).s;
}
function porCat(list) { const o = {}; for (const l of list) if (l.tipo !== 'receita') o[l.categoria] = (o[l.categoria] || 0) + (+l.valor || 0); return o; }
function diasNoMes(m) { const [y, mm] = m.split('-').map(Number); return new Date(y, mm, 0).getDate(); }
function statusConta(c) {
  if (c.pagas && c.pagas[S.mes]) return { cls: 'ok', txt: 'Paga' };
  const atual = ym(new Date());
  if (S.mes < atual) return { cls: 'bad', txt: 'Não paga' };
  if (S.mes > atual) return { cls: '', txt: 'Vence dia ' + c.dia };
  const dia = Math.min(+c.dia || 1, diasNoMes(S.mes)); const diff = dia - new Date().getDate();
  if (diff < 0) return { cls: 'bad', txt: 'Atrasada' };
  if (diff <= 3) return { cls: 'warn', txt: diff === 0 ? 'Vence hoje' : 'Vence em ' + diff + (diff === 1 ? ' dia' : ' dias') };
  return { cls: '', txt: 'Vence dia ' + dia };
}

/* ---------- Render ---------- */
function render() {
  if (!S.hh) return;
  const [y, m] = S.mes.split('-').map(Number); $('mesLabel').textContent = MESES[m - 1] + ' ' + y;
  const list = doMes(S.mes); const { e, s } = somas(list); const bal = e - s;
  $('sIn').textContent = money(e); $('sOut').textContent = money(s);
  $('sInSub').textContent = list.filter(l => l.tipo === 'receita').length + ' entradas';
  $('sOutSub').textContent = list.filter(l => l.tipo !== 'receita').length + ' gastos';
  const b = $('sBal'); b.textContent = money(bal); b.className = 'val ' + (bal < 0 ? 'c-out' : 'c-in');
  const rate = e > 0 ? bal / e : null; const r = $('sRate');
  r.textContent = rate == null ? '–' : Math.round(rate * 100) + '%';
  r.className = 'val ' + (rate == null ? '' : rate >= .2 ? 'c-in' : rate >= .1 ? 'c-warn' : 'c-out');
  renderInsights(list, e, s, rate);
  document.querySelectorAll('.tabs button').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === S.tab));
  $('panel').innerHTML = { lanc: pLanc, orc: pOrc, contas: pContas, metas: pMetas, ajustes: pAjustes }[S.tab](list);
}
function renderInsights(list, e, s, rate) {
  const out = []; const g = porCat(list); const cats = S.cfg.categorias;
  if (!list.length) out.push(['', 'Nenhum lançamento neste mês ainda. Registrem cada gasto no dia em que ele acontece; leva 10 segundos e é o que faz o app funcionar.']);
  else if (rate != null) {
    if (rate >= .2) out.push(['', 'Vocês guardaram ' + Math.round(rate * 100) + '% do que entrou. Esse é o ritmo que faz o patrimônio crescer.']);
    else if (rate >= 0) out.push([rate >= .1 ? 'warn' : 'bad', 'Sobraram ' + Math.round(rate * 100) + '% da renda. O objetivo é chegar a 20%: vejam no Orçamento qual categoria dá para apertar.']);
    else out.push(['bad', 'Os gastos passaram a renda em ' + money(s - e) + '. Vale revisar juntos antes do fim do mês.']);
  }
  for (const k of cats.filter(k => k.limite > 0 && (g[k.nome] || 0) > k.limite).slice(0, 2)) out.push(['bad', k.nome + ' passou ' + money(g[k.nome] - k.limite) + ' do limite.']);
  const quase = cats.filter(k => k.limite > 0 && (g[k.nome] || 0) >= .8 * k.limite && (g[k.nome] || 0) <= k.limite);
  if (quase.length) out.push(['warn', quase.map(k => k.nome).join(', ') + (quase.length > 1 ? ' estão' : ' está') + ' perto do limite.']);
  const atr = S.contas.filter(x => statusConta(x).cls === 'bad');
  if (atr.length) out.push(['bad', atr.length + (atr.length > 1 ? ' contas não pagas' : ' conta não paga') + ' neste mês: ' + atr.map(x => x.nome).join(', ') + '.']);
  if (cats.length && !cats.some(k => k.limite > 0)) out.push(['warn', 'Definam limites no Orçamento para receber alertas quando uma categoria estiver perto de estourar.']);
  $('insights').innerHTML = out.slice(0, 4).map(([k, t]) => `<li><span class="dot ${k}"></span><span>${esc(t)}</span></li>`).join('');
}
const delBtn = (tab, id, label = 'Apagar') => `<button class="x" data-del="${tab}" data-id="${esc(id)}">${label}</button>`;

function pLanc(list) {
  if (!list.length) return `<p class="empty">Nada lançado em ${esc($('mesLabel').textContent)}. Toque em <b>+ Lançar</b> para registrar o primeiro gasto ou entrada.</p>`;
  const g = {};
  for (const l of [...list].sort((a, b) => (b.data || '').localeCompare(a.data || '') || (b.criado_em || '').localeCompare(a.criado_em || ''))) (g[l.data] = g[l.data] || []).push(l);
  return Object.entries(g).map(([d, items]) => {
    const lbl = new Date(d + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    return `<div class="daygrp"><div class="dayhd">${esc(lbl)}</div>${items.map(l => `<div class="row"><div class="main"><div class="t">${esc(l.descricao || l.categoria)}</div><div class="m">${esc(l.categoria)} · ${esc(l.quem)}</div></div><span class="v ${l.tipo === 'receita' ? 'c-in' : 'c-out'}">${l.tipo === 'receita' ? '+' : '−'} ${money(l.valor)}</span>${delBtn('lancamentos', l.id)}</div>`).join('')}</div>`;
  }).join('');
}
function pOrc(list) {
  const g = porCat(list); const cats = S.cfg.categorias;
  const totLim = cats.reduce((a, k) => a + (+k.limite || 0), 0); const totG = Object.values(g).reduce((a, b) => a + b, 0);
  const rows = cats.map((k, i) => {
    const v = g[k.nome] || 0, lim = +k.limite || 0, p = lim ? Math.min(100, v / lim * 100) : 0;
    const cls = !lim ? '' : v > lim ? 'bad' : v >= .8 * lim ? 'warn' : '';
    return `<div class="bud"><div class="hd"><b>${esc(k.nome)}</b><span class="num">${money(v)}${lim ? ` <span class="hint">de ${money(lim)}</span>` : ''}</span></div>${lim ? `<div class="bar"><i class="${cls}" style="width:${p}%"></i></div>` : ''}<div class="lim"><span>Limite mensal</span><input type="text" inputmode="decimal" id="lim-${i}" data-lim="${i}" value="${lim ? String(lim).replace('.', ',') : ''}" placeholder="definir"><button class="x" data-delcat="${i}">Remover categoria</button></div></div>`;
  }).join('');
  const fora = Object.keys(g).filter(n => !cats.some(k => k.nome === n));
  return `<p class="hint">Planejado: <b class="num">${money(totLim)}</b> · Gasto: <b class="num">${money(totG)}</b>. Somem os gastos fixos e definam limites para o resto de forma que sobre pelo menos 20% da renda.</p>${rows}
  ${fora.length ? `<p class="hint">Gastos em categorias removidas: ${fora.map(n => esc(n) + ' ' + money(g[n])).join(', ')}</p>` : ''}
  <form class="form" id="addCat"><label>Nova categoria<input type="text" id="newCat" maxlength="30" placeholder="Ex.: Pets"></label><button class="btn">Adicionar</button></form>`;
}
function pContas() {
  const lst = [...S.contas].sort((a, b) => (+a.dia || 0) - (+b.dia || 0));
  const tot = lst.reduce((a, x) => a + (+x.valor || 0), 0);
  const pago = lst.filter(x => x.pagas && x.pagas[S.mes]).reduce((a, x) => a + (+x.valor || 0), 0);
  const rows = lst.length ? lst.map(x => {
    const st = statusConta(x); const on = x.pagas && x.pagas[S.mes];
    return `<div class="row"><div class="main"><div class="t">${esc(x.nome)}</div><div class="m">dia ${esc(x.dia)} · ${esc(x.categoria)} · <span class="pill ${st.cls}">${esc(st.txt)}</span></div></div><span class="v">${money(x.valor)}</span><button class="paybtn ${on ? 'on' : ''}" data-pay="${esc(x.id)}">${on ? 'Paga ✓' : 'Marcar paga'}</button>${delBtn('contas', x.id, '×')}</div>`;
  }).join('') : `<p class="empty">Cadastrem aqui as contas que se repetem todo mês (aluguel, luz, internet, escola). Ao marcar como paga, o gasto entra sozinho nos lançamentos.</p>`;
  return `<p class="hint">Contas fixas do mês: <b class="num">${money(tot)}</b> · já pagas: <b class="num">${money(pago)}</b></p>${rows}
  <form class="form" id="addConta"><label>Conta<input type="text" id="cNome" maxlength="40" placeholder="Ex.: Internet" required></label><label>Valor (R$)<input type="text" inputmode="decimal" id="cValor" placeholder="0,00" required></label><label>Vence dia<input type="text" inputmode="numeric" id="cDia" placeholder="10" required></label><label>Categoria<select id="cCat">${S.cfg.categorias.map(k => `<option>${esc(k.nome)}</option>`).join('')}</select></label><button class="btn">Adicionar conta</button></form>`;
}
function pMetas() {
  const gm = gastoMedio(); const sug = Math.round(gm * 6);
  const rows = S.metas.length ? S.metas.map(x => {
    const alvo = +x.alvo || 0, at = +x.atual || 0, p = alvo ? Math.min(100, at / alvo * 100) : 0;
    const reserva = /reserva/i.test(x.nome || '');
    return `<div class="meta"><div class="row" style="border:0;padding:0"><div class="main"><div class="t">${esc(x.nome)}</div><div class="m num">${money(at)}${alvo ? ' de ' + money(alvo) + ' · ' + Math.round(p) + '%' : ' · defina o valor-alvo'}</div></div>${delBtn('metas', x.id, '×')}</div>
    ${alvo ? `<div class="bar"><i style="width:${p}%"></i></div>` : ''}
    ${reserva && gm > 0 ? `<p class="hint">Com o gasto médio de vocês (${money(gm)}/mês), 6 meses de reserva são ${money(sug)}.${alvo !== sug ? ` <button class="x" data-sug="${esc(x.id)}" data-v="${sug}">Usar esse alvo</button>` : ''}</p>` : ''}
    <div class="acts"><input type="text" inputmode="decimal" id="ap-${esc(x.id)}" placeholder="R$ 0,00"><button class="btn" data-aporte="${esc(x.id)}">Guardar</button><button class="btn ghost" data-retira="${esc(x.id)}">Retirar</button><button class="btn ghost" data-alvo="${esc(x.id)}">Definir alvo</button></div></div>`;
  }).join('') : `<p class="empty">Comecem pela reserva de emergência: de 3 a 6 meses dos gastos da casa, guardados num lugar seguro e com resgate imediato.</p>`;
  return `${rows}<form class="form" id="addMeta"><label>Nova meta<input type="text" id="mNome" maxlength="40" placeholder="Ex.: Viagem de férias" required></label><label>Valor-alvo (R$)<input type="text" inputmode="decimal" id="mAlvo" placeholder="0,00"></label><button class="btn">Criar meta</button></form>
  <div class="habitos"><b>Combinados que funcionam para casais</b><ol><li>Guardar no dia em que o salário cai, não com o que sobrar no fim do mês.</li><li>Uma conversa curta por semana olhando este app juntos, sem culpa e sem cobrança.</li><li>Gasto fora do planejado acima de um valor combinado, só depois de falar com o outro.</li><li>Cada um com uma quantia livre por mês para gastar sem prestar contas.</li></ol></div>`;
}
function pAjustes() {
  const p = S.cfg.pessoas;
  return `<h3>Convide a outra pessoa</h3>
  <p class="hint">Ela cria a própria conta no app, toca em "Entrar com o código" e digita:</p>
  <div><span class="code" id="codigo">${esc(S.casa ? S.casa.codigo : '······')}</span> <button class="btn ghost" id="copiar">Copiar</button></div>
  <h3>Pessoas</h3>
  <form class="form" id="pessoasForm"><label>Pessoa 1<input type="text" id="p0" value="${esc(p[0] || '')}" maxlength="24"></label><label>Pessoa 2<input type="text" id="p1" value="${esc(p[1] || '')}" maxlength="24"></label><button class="btn">Salvar nomes</button></form>
  <h3>Instalar no celular</h3>
  <p class="hint">iPhone: no Safari, toque em Compartilhar e depois em "Adicionar à Tela de Início". Android: no Chrome, toque no menu ⋮ e em "Instalar app".</p>
  <button class="btn ghost" id="sair">Sair da conta</button>`;
}

/* ---------- Eventos ---------- */
$('prev').onclick = () => { const [y, m] = S.mes.split('-').map(Number); S.mes = ym(new Date(y, m - 2, 1)); render(); };
$('next').onclick = () => { const [y, m] = S.mes.split('-').map(Number); S.mes = ym(new Date(y, m, 1)); render(); };
$('btnAjustes').onclick = () => { S.tab = 'ajustes'; render(); };
document.querySelector('.tabs').onclick = e => { const t = e.target.closest('[data-tab]'); if (t) { S.tab = t.dataset.tab; render(); } };

function setTipo(t) {
  S.tipo = t; $('tOut').className = t === 'despesa' ? 'on-out' : ''; $('tIn').className = t === 'receita' ? 'on-in' : '';
  $('fCat').innerHTML = (t === 'receita' ? S.cfg.receitas : S.cfg.categorias.map(k => k.nome)).map(n => `<option>${esc(n)}</option>`).join('');
}
$('fab').onclick = () => {
  $('fQuem').innerHTML = [...S.cfg.pessoas, 'Conjunto'].map(p => `<option>${esc(p)}</option>`).join('');
  $('fData').value = S.mes === ym(new Date()) ? hoje() : S.mes + '-01';
  $('fValor').value = ''; $('fDesc').value = ''; setTipo('despesa');
  $('sheetbg').hidden = false; setTimeout(() => $('fValor').focus(), 50);
};
$('tOut').onclick = () => setTipo('despesa'); $('tIn').onclick = () => setTipo('receita');
$('fCancel').onclick = () => { $('sheetbg').hidden = true; };
$('sheetbg').onclick = e => { if (e.target.id === 'sheetbg') $('sheetbg').hidden = true; };
$('sheet').onsubmit = async e => {
  e.preventDefault(); const v = parseVal($('fValor').value); if (!(v > 0)) { $('fValor').focus(); return; }
  const row = { household_id: S.hh, tipo: S.tipo, valor: v, descricao: $('fDesc').value.trim(), categoria: $('fCat').value, data: $('fData').value || hoje(), quem: $('fQuem').value };
  $('sheetbg').hidden = true;
  const r = await run(() => sb.from('lancamentos').insert(row).select().single());
  if (r && r.data) { S.lanc.push(r.data); render(); }
};

document.addEventListener('click', async e => {
  const d = e.target.closest('[data-del]');
  if (d) {
    if (!d.hasAttribute('data-armed')) { d.setAttribute('data-armed', ''); d.dataset.old = d.textContent; d.textContent = 'Confirmar'; setTimeout(() => { if (d.isConnected) { d.removeAttribute('data-armed'); d.textContent = d.dataset.old; } }, 3000); return; }
    const tab = d.dataset.del, id = d.dataset.id; const key = TABELAS[tab];
    S[key] = S[key].filter(x => x.id !== id); render();
    await run(() => sb.from(tab).delete().eq('id', id)); return;
  }
  const dc = e.target.closest('[data-delcat]');
  if (dc) { salvarCfg({ ...S.cfg, categorias: S.cfg.categorias.filter((_, i) => i !== +dc.dataset.delcat) }); return; }
  const p = e.target.closest('[data-pay]'); if (p) { togglePay(p.dataset.pay); return; }
  const sg = e.target.closest('[data-sug]');
  if (sg) { await run(() => sb.from('metas').update({ alvo: +sg.dataset.v }).eq('id', sg.dataset.sug)); await carregar('metas'); render(); return; }
  for (const k of ['aporte', 'retira', 'alvo']) {
    const bt = e.target.closest('[data-' + k + ']');
    if (bt) {
      const id = bt.dataset[k]; const inp = $('ap-' + id); const v = parseVal(inp && inp.value);
      if (isNaN(v) || v < 0) { inp && inp.focus(); return; }
      const m = S.metas.find(x => x.id === id); if (!m) return;
      const patch = k === 'alvo' ? { alvo: v } : { atual: Math.max(0, Math.round(((+m.atual || 0) + (k === 'aporte' ? v : -v)) * 100) / 100) };
      Object.assign(m, patch); inp.value = ''; render();
      await run(() => sb.from('metas').update(patch).eq('id', id)); return;
    }
  }
  if (e.target.id === 'copiar') {
    const cod = $('codigo').textContent;
    try { await navigator.clipboard.writeText(cod); e.target.textContent = 'Copiado'; } catch { const r = document.createRange(); r.selectNodeContents($('codigo')); getSelection().removeAllRanges(); getSelection().addRange(r); }
    return;
  }
  if (e.target.id === 'sair') { sb.auth.signOut(); }
});
document.addEventListener('change', e => {
  const l = e.target.closest('[data-lim]');
  if (l) { const v = parseVal(l.value); salvarCfg({ ...S.cfg, categorias: S.cfg.categorias.map((k, i) => i === +l.dataset.lim ? { ...k, limite: v > 0 ? v : 0 } : k) }); }
});
document.addEventListener('submit', async e => {
  const f = e.target; if (['sheet', 'authForm'].includes(f.id)) return; e.preventDefault();
  if (f.id === 'addCat') {
    const n = $('newCat').value.trim();
    if (!n || S.cfg.categorias.some(k => k.nome.toLowerCase() === n.toLowerCase())) return;
    salvarCfg({ ...S.cfg, categorias: [...S.cfg.categorias, { nome: n, limite: 0 }] });
  }
  if (f.id === 'pessoasForm') salvarCfg({ ...S.cfg, pessoas: [$('p0').value.trim() || 'Pessoa 1', $('p1').value.trim() || 'Pessoa 2'] });
  if (f.id === 'addConta') {
    const v = parseVal($('cValor').value), dia = Math.min(31, Math.max(1, parseInt($('cDia').value) || 1)); if (!(v > 0)) return;
    const r = await run(() => sb.from('contas').insert({ household_id: S.hh, nome: $('cNome').value.trim(), valor: v, dia, categoria: $('cCat').value }).select().single());
    if (r && r.data) { S.contas.push(r.data); render(); }
  }
  if (f.id === 'addMeta') {
    const v = parseVal($('mAlvo').value);
    const r = await run(() => sb.from('metas').insert({ household_id: S.hh, nome: $('mNome').value.trim(), alvo: v > 0 ? v : 0 }).select().single());
    if (r && r.data) { S.metas.push(r.data); render(); }
  }
});
async function togglePay(id) {
  const x = S.contas.find(c => c.id === id); if (!x) return;
  const pagas = { ...(x.pagas || {}) };
  if (pagas[S.mes]) {
    const lid = pagas[S.mes]; delete pagas[S.mes];
    x.pagas = pagas; S.lanc = S.lanc.filter(l => l.id !== lid); render();
    await run(() => sb.from('contas').update({ pagas }).eq('id', id));
    await run(() => sb.from('lancamentos').delete().eq('id', lid));
  } else {
    const dia = Math.min(+x.dia || 1, diasNoMes(S.mes));
    const data = S.mes === ym(new Date()) ? hoje() : S.mes + '-' + pad(dia);
    const r = await run(() => sb.from('lancamentos').insert({ household_id: S.hh, tipo: 'despesa', valor: +x.valor, descricao: x.nome, categoria: x.categoria, data, quem: 'Conjunto', conta_id: id }).select().single());
    if (!r || !r.data) return;
    pagas[S.mes] = r.data.id; x.pagas = pagas; S.lanc.push(r.data); render();
    await run(() => sb.from('contas').update({ pagas }).eq('id', id));
  }
}

/* ---------- PWA ---------- */
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

iniciar();

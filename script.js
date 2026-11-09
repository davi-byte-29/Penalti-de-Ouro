const $ = s => document.querySelector(s);
const WIN = 5, PREFIX = 'pdo-';
let G = null, peer = null, conn = null, mode = '', pending = null, buf = {}, joinT = null, lastRx = 0;
// STUN + TURN: o TURN permite conectar celular (4G/5G) com computador mesmo atrás de NAT restrito
const ICE = { debug: 0, config: { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' }
] } };

const KITS=[['#ff3d7f','#1a0a14'],['#22e4ff','#04141c'],['#ffcf4a','#2a1c00'],['#b6ff3b','#0c1a00'],['#8b6bff','#0e0820'],['#ff7a2f','#220d00'],['#f2f7ff','#101820']];
const ls=k=>{try{return localStorage.getItem(k)}catch(e){return null}}, lsSet=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}};
let myKit=(+ls('pdo-kit'))%KITS.length||0, kits=[0,1], oppKit=null, powering=null, rec={w:0,s:0};
try{rec=Object.assign(rec,JSON.parse(ls('pdo-rec')||'{}'))}catch(e){}
const okit=()=>{const k=oppKit===null?(myKit+1)%KITS.length:oppKit;return k===myKit?(k+1)%KITS.length:k};
function setKits(){
  kits=G.mode==='online'?(G.me===0?[myKit,okit()]:[okit(),myKit]):[myKit,(myKit+1)%KITS.length];
  const r=document.documentElement.style; r.setProperty('--p0',KITS[kits[0]][0]); r.setProperty('--p1',KITS[kits[1]][0]);
}
const pick=a=>a[Math.random()*a.length|0];
function say(t){const c=$('#cm');c.textContent=t;c.classList.remove('show');void c.offsetWidth;c.classList.add('show')}
const show = id => ['menu','lobby','game'].forEach(s => $('#'+s).classList.toggle('hide', s !== id));
const shooter = () => G.round % 2;
// zonas: 0 esq/cima, 1 esq/baixo, 2 meio, 3 dir/cima, 4 dir/baixo  [x, y] relativos ao gol e [left, top, width, height] em %
const ZC = [[.17,.28],[.17,.72],[.5,.5],[.83,.28],[.83,.72]];
const ZR = [[0,0,33.333,50],[0,50,33.333,50],[33.333,0,33.333,100],[66.667,0,33.333,50],[66.667,50,33.333,50]];
const nm = i => G.mode === 'online' ? (i === G.me ? 'Você' : 'Adversário') : 'Jogador ' + (i + 1);
const send = d => { try { conn && conn.open && conn.send(d); } catch(e){} };

/* ---------- som e efeitos ---------- */
let AC = null, muted = false;
let NB = null;
function noise(d, v, t0 = 0, f = 1200) {
  if (!NB) { NB = AC.createBuffer(1, AC.sampleRate * 3, AC.sampleRate); const a = NB.getChannelData(0); for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1; }
  const s = AC.createBufferSource(), fl = AC.createBiquadFilter(), g = AC.createGain(), t = AC.currentTime + t0;
  s.buffer = NB; fl.type = 'bandpass'; fl.frequency.value = f;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + d * .2); g.gain.linearRampToValueAtTime(0, t + d);
  s.connect(fl); fl.connect(g); g.connect(AC.destination); s.start(t, 0, d);
}
function tone(f1, f2, d, type = 'sine', v = .2, t0 = 0) {
  const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime + t0;
  o.type = type; o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.001, t + d);
  o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + d);
}
function sfx(k) {
  if (muted) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    if (k === 'kick') { noise(.1, .5, 0, 400); tone(180, 50, .15, 'sine', .5); }
    else if (k === 'save') { tone(320, 120, .18, 'square', .15); noise(.15, .4, 0, 300); }
    else if (k === 'goal') { noise(1.6, .5, 0, 900); [523, 659, 784, 1046].forEach((f, i) => tone(f, f, .25, 'triangle', .18, i * .12)); }
    else if (k === 'post') { tone(1500, 900, .6, 'triangle', .25); noise(.12, .35, 0, 2200); }
    else if (k === 'whistle') { tone(2600, 2900, .35, 'sine', .15); tone(2900, 2600, .35, 'sine', .15, .4); }
    else if (k === 'win') { noise(2.2, .5, 0, 900); [523, 659, 784, 659, 784, 1046].forEach((f, i) => tone(f, f, .3, 'triangle', .2, i * .18)); }
  } catch (e) {}
}
$('#bMute').onclick = () => { muted = !muted; $('#bMute').textContent = muted ? '🔇' : '🔊'; };
function confetti(n, c) {
  n = Math.ceil(n * .55); const H = $('#stage').clientHeight * 1.1 + 'px';
  const cols = ['#22e4ff', '#fff', '#ff3d7f', '#b6ff3b', '#8b6bff', c];
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'cf'; d.style.left = Math.random() * 100 + '%';
    d.style.background = cols[i % cols.length];
    d.style.setProperty('--h', H); d.style.setProperty('--x', (Math.random() * 120 - 60) + 'px');
    d.style.animationDelay = Math.random() * .5 + 's'; d.style.animationDuration = 1.8 + Math.random() * 1.2 + 's';
    d.onanimationend = () => d.remove();
    $('#fx').appendChild(d);
  }
}

/* ---------- navegação ---------- */
$('#bLocal').onclick = () => startGame('local', null);
$('#bOnline').onclick = () => { show('lobby'); setStatus(typeof Peer === 'undefined' ? 'Não foi possível carregar o modo online. Verifique sua internet.' : ''); };
$('#bBack1').onclick = $('#bBack2').onclick = toMenu;
function toMenu() {
  try { conn && conn.close(); peer && peer.destroy(); } catch(e){}
  conn = peer = null; G = null; oppKit = null; mode = ''; buf = {}; clearTimeout(joinT);
  $('#roomInfo').classList.add('hide'); $('#bCreate').disabled = false; setStatus('');
  closeOv(); show('menu');
}
const setStatus = t => $('#status').textContent = t;

/* ---------- salas (WebRTC via PeerJS) ---------- */
const rand = () => Array.from({length:5}, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.random()*31|0]).join('');

$('#bCreate').onclick = () => {
  if (typeof Peer === 'undefined') return setStatus('Modo online indisponível sem internet.');
  $('#bCreate').disabled = true;
  makeRoom();
};
function makeRoom() {
  try { peer && peer.destroy(); } catch(e){}
  const code = rand();
  peer = new Peer(PREFIX + code, ICE);
  peer.on('disconnected', () => { try { peer.reconnect(); } catch(e){} });
  peer.on('open', () => { $('#roomCode').textContent = code; $('#roomInfo').classList.remove('hide'); setStatus(''); });
  peer.on('error', e => e.type === 'unavailable-id' ? makeRoom() : setStatus('Erro ao criar sala: ' + e.type));
  peer.on('connection', c => {
    if (conn) return c.close();
    conn = c; bind();
    c.on('open', () => { send({t:'start'}); startGame('online', 0); });
  });
}
$('#bJoin').onclick = () => {
  if (typeof Peer === 'undefined') return setStatus('Modo online indisponível sem internet.');
  const code = $('#codeIn').value.trim().toUpperCase();
  if (code.length < 5) return setStatus('Digite o código de 5 caracteres.');
  setStatus('Entrando na sala…');
  try { peer && peer.destroy(); } catch(e){}
  peer = new Peer(ICE);
  peer.on('disconnected', () => { try { peer.reconnect(); } catch(e){} });
  peer.on('open', () => {
    conn = peer.connect(PREFIX + code, {reliable:true}); bind();
    clearTimeout(joinT);
    joinT = setTimeout(() => { if (!G) { setStatus('Não foi possível conectar. Confira a internet dos dois aparelhos e tente de novo.'); try { conn.close(); } catch(e){} } }, 20000);
  });
  peer.on('error', e => setStatus(e.type === 'peer-unavailable' ? 'Sala não encontrada. Confira o código.' : 'Erro: ' + e.type));
};
function bind() {
  conn.on('data', onData); conn.on('open', () => send({t:'kit', k:myKit}));
  conn.on('close', () => { if (G && !G.over) ov('<div class="big">O adversário saiu</div>', 'Voltar ao menu', toMenu); });
}
function onData(d) {
  lastRx = Date.now();
  if (d.t === 'start') startGame('online', 1);
  else if (d.t === 'again') startGame('online', G ? G.me : 1, d.g);
  else if (d.t === 'kit') { oppKit = d.k; if (G && G.mode === 'online') { setKits(); renderHud(); } }
  else if (d.t === 'pick') { buf[d.g + '|' + d.r + d.k] = d.v; applyBuf(); }
}

/* ---------- jogo ---------- */
function startGame(m, me, g = 0) {
  G = { mode:m, me, gid:g, score:[0,0], round:0, shot:null, keep:null, over:false, hist:[[],[]] };
  G.st = [{s:0,g:0,v:0},{s:0,g:0,v:0}]; G.streak = [0,0]; setKits();
  clearTimeout(joinT); lastRx = Date.now(); closeOv();
  try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {}); } catch(e){} show('game'); sfx('whistle');
  $('#n0').textContent = nm(0); $('#n1').textContent = nm(1);
  nextRound();
}
function renderHud() {
  [0,1].forEach(i => {
    $('#s'+i).textContent = G.score[i];
    $('#d'+i).innerHTML = G.hist[i].map(g => `<i class="d ${g ? 'ok' : 'no'}"></i>`).join('');
  });
  $('#turn').innerHTML = 'Cobrança ' + (G.round + 1) + '<br>Chuta: ' + nm(shooter());
  document.querySelectorAll('.pl').forEach((e, i) => e.classList.toggle('act', i === shooter()));
}
function setMode(m) {
  mode = m; pending = null; if (powering) { cancelAnimationFrame(powering.id); powering = null; } $('#pw').classList.add('hide');
  $('#stage').className = 'stage ' + m;
  $('#mark').style.display = $('#zhl').style.display = 'none';
  $('#bOk').disabled = true;
  $('#bOk').textContent = m === 'shoot' ? 'Chutar!' : 'Defender!';
}
function nextRound() {
  G.shot = G.keep = null;
  $('#ball').className = 'ball'; $('#ball').style.cssText = '';
  $('#keeper').style.cssText = '';
  $('#shadow').style.opacity = ''; $('#goal').classList.remove('ripple');
  const kk = KITS[kits[shooter()]]; $('#kicker').className = 'kicker'; $('#kicker').style.cssText = `--shirt:${kk[0]};--short:${kk[1]};--glow:${kk[0]}`;
  renderHud();
  if (G.mode === 'local') {
    setMode('shoot');
    $('#msg').innerHTML = `<b>${nm(shooter())}</b>, toque no gol para escolher onde chutar.<br><small>${nm(1-shooter())}, vire o rosto!</small>`;
  } else {
    const role = shooter() === G.me ? 'shoot' : 'keep';
    setMode(role);
    $('#msg').textContent = role === 'shoot' ? 'Sua vez de CHUTAR! Toque no gol para mirar.' : 'Sua vez de DEFENDER! Toque em um dos 5 pontos do gol onde vai pular.';
    applyBuf();
  }
}
function selectZone(z) {
  if (!mode || powering) return;
  pending = z; const q = ZR[z];
  $('#zhl').style.cssText = `display:block;left:${q[0]}%;top:${q[1]}%;width:${q[2]}%;height:${q[3]}%`;
  $('#bOk').disabled = false;
}
$('#goal').addEventListener('click', e => {
  const r = $('#goal').getBoundingClientRect();
  const x = Math.min(.999, Math.max(0, (e.clientX - r.left) / r.width)), y = Math.min(.999, Math.max(0, (e.clientY - r.top) / r.height)), c = Math.floor(x * 3);
  selectZone(c === 1 ? 2 : (c === 0 ? 0 : 3) + (y >= .5 ? 1 : 0));
});
function startPower() {
  const t0 = performance.now(), sp = 1.7 + Math.min(G.round, 10) * .08, n = $('#pwn'), o = { p: 0, id: 0 };
  $('#pw').classList.remove('hide'); const H = $('#pw').clientHeight;
  const f = () => { const t = ((performance.now() - t0) / 1000 * sp) % 2; o.p = t < 1 ? t : 2 - t; n.style.transform = `translateY(${-o.p * H}px)`; o.id = requestAnimationFrame(f); };
  f(); return o;
}
addEventListener('keydown', e => {
  if (!G || $('#game').classList.contains('hide') || e.target.tagName === 'INPUT') return;
  if (/^[1-5]$/.test(e.key)) selectZone(+e.key - 1);
  else if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); const b = $('#ov').classList.contains('hide') ? $('#bOk') : $('#ovb'); if (b && !b.disabled) b.click(); }
  else if (e.key === 'm' || e.key === 'M') $('#bMute').click();
});
addEventListener('keyup', e => { if (e.code === 'Space' && G && !$('#game').classList.contains('hide')) e.preventDefault(); });
$('#bOk').onclick = () => {
  if (pending === null || !mode) return;
  if (mode === 'shoot' && !powering) {
    powering = startPower(); $('#bOk').textContent = 'Parar!';
    $('#msg').textContent = 'Pare o ponteiro na faixa verde. Fraco demais o goleiro pega; forte demais vai por cima!';
    return;
  }
  const kind = mode === 'shoot' ? 'shot' : 'keep';
  let v = pending;
  if (kind === 'shot') { const p = powering.p; cancelAnimationFrame(powering.id); powering = null; v = { z: pending, p: +p.toFixed(2), x: +Math.random().toFixed(2) }; }
  G[kind] = v;
  const was = mode; setMode('');
  if (G.mode === 'online') {
    send({t:'pick', g:G.gid, r:G.round, k:kind, v});
    $('#msg').textContent = 'Escolha enviada. Aguardando o adversário…';
    tryResolve();
  } else if (was === 'shoot') {
    ov(`<div class="big">Passe para ${nm(1-shooter())}</div><div>${nm(shooter())} já escolheu. Não vale espiar!</div>`, 'Estou pronto', () => {
      closeOv(); setMode('keep');
      $('#msg').innerHTML = `<b>${nm(1-shooter())}</b>, toque em um dos 5 pontos do gol onde vai pular.`;
    });
  } else tryResolve();
};
function applyBuf() {
  if (!G) return;
  ['shot','keep'].forEach(k => { const key = G.gid + '|' + G.round + k; if (key in buf && G[k] === null) G[k] = buf[key]; });
  tryResolve();
}
function tryResolve() { if (G && G.shot !== null && G.keep !== null && !G.resolving) resolve(); }

const OUT = {
  goal:['Bem no canto!','Sem chance para o goleiro!','Bola na rede!'], power:['PANCADA! O goleiro nem segurou!','Bateu com muita força!'],
  save:['O goleiro leu o chute!','Paredão!'], weak:['Faltou força: o goleiro agarrou!'],
  post:['Explodiu no poste!','Por centímetros!'], over:['Mandou pra arquibancada!','Passou por cima do gol!']
};
function outcome(s, k) {
  if (s.p >= .93) return 'over';
  if (s.p >= .8 && (s.z === 0 || s.z === 3) && s.x < .3) return 'post';
  if (s.z === k) return s.p >= .8 && s.x > .65 ? 'power' : 'save';
  if (s.p < .25 && Math.sign(s.z - 2) === Math.sign(k - 2)) return 'weak';
  return 'goal';
}
function resolve() {
  G.resolving = true; setMode('');
  const s = G.shot, z = G.keep, o = outcome(s, z), sh = shooter(), goal = o === 'goal' || o === 'power', saved = o === 'save' || o === 'weak';
  const dur = Math.round((.85 - .4 * s.p) * 1000);
  $('#msg').textContent = ''; $('#kicker').classList.add('go');
  const b = $('#ball'), k = $('#keeper');
  setTimeout(() => {
    b.style.transitionDuration = dur + 'ms'; b.classList.add('fly'); sfx('kick'); $('#shadow').style.opacity = 0; k.style.animation = 'none';
    let bx = 18 + 64 * ZC[s.z][0] + (s.x - .5) * 6, by = 8 + 30 * ZC[s.z][1];
    if (o === 'over') by = -10;
    if (o === 'post') { bx = s.z < 2 ? 18 : 82; by = 10; }
    b.style.left = bx + '%'; b.style.top = by + '%';
    k.style.left = (18 + 64 * ZC[z][0]) + '%'; k.style.top = (z === 2 ? 21 : ZC[z][1] < .5 ? 14 : 24) + '%';
    k.style.transform = z === 2 ? 'translateX(-50%) scale(1.15)' : `translateX(-50%) rotate(${z < 2 ? -55 : 55}deg)`;
  }, 250);
  setTimeout(() => {
    G.st[sh].s++; if (goal) G.st[sh].g++; if (saved) G.st[1 - sh].v++;
    G.streak[sh] = goal ? G.streak[sh] + 1 : 0;
    if (goal) G.score[sh]++;
    G.hist[sh].push(goal); if (G.hist[sh].length > 5) G.hist[sh].shift();
    renderHud();
    const f = $('#flash');
    f.textContent = goal ? 'GOOOL!' : o === 'post' ? 'NA TRAVE!' : o === 'over' ? 'PRA FORA!' : 'DEFENDEU!';
    f.style.color = goal ? '#b6ff3b' : o === 'post' ? '#ffcf4a' : '#ff6b8f';
    f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
    say(pick(OUT[o]) + (goal && G.streak[sh] > 1 ? ` Sequência de ${G.streak[sh]} gols!` : ''));
    try { navigator.vibrate && navigator.vibrate(goal ? [40, 30, 80] : 40); } catch(e){}
    if (goal) {
      $('#goal').classList.add('ripple'); $('#stage').classList.add('cheer');
      confetti(o === 'power' ? 70 : 45, KITS[kits[sh]][0]); sfx('goal');
      const sc = $('#s' + sh); sc.classList.remove('bump'); void sc.offsetWidth; sc.classList.add('bump');
      if (sh === (G.mode === 'online' ? G.me : 0) && G.streak[sh] > rec.s) { rec.s = G.streak[sh]; lsSet('pdo-rec', JSON.stringify(rec)); }
    } else {
      $('#stage').classList.add('shake'); sfx(o === 'post' ? 'post' : 'save');
      if (o !== 'over') { b.style.transitionDuration = '.5s'; b.style.left = (o === 'post' ? (s.z < 2 ? 6 : 94) : (z < 2 ? 24 : 76)) + '%'; b.style.top = '60%'; }
    }
  }, 250 + dur);
  setTimeout(() => {
    G.resolving = false;
    if (G.score[sh] >= WIN) return endGame(sh);
    G.round++; nextRound();
  }, 250 + dur + 1500);
}
function endGame(w) {
  G.over = true; confetti(130, KITS[kits[w]][0]); sfx('win');
  if (G.mode === 'online' && w === G.me) { rec.w++; lsSet('pdo-rec', JSON.stringify(rec)); }
  renderKits();
  const txt = G.mode === 'online' ? (w === G.me ? 'Você venceu!' : 'Você perdeu!') : nm(w) + ' venceu!';
  const row = i => `<div class="st"><b style="color:${KITS[kits[i]][0]}">${nm(i)}</b>: ${G.st[i].g}/${G.st[i].s} chutes (${Math.round(G.st[i].g / Math.max(1, G.st[i].s) * 100)}%) · ${G.st[i].v} defesas</div>`;
  ov(`<div style="font-size:3.5rem">🏆</div><div class="big">${txt}</div><div>Placar final: ${G.score[0]} × ${G.score[1]}</div>${row(0)}${row(1)}`, 'Jogar de novo', () => {
    const g = G.gid + 1;
    if (G.mode === 'online') send({t:'again', g});
    startGame(G.mode, G.me, g);
  });
}

/* ---------- overlay ---------- */
function ov(html, btn, cb) {
  const o = $('#ov'); o.innerHTML = html + `<button id="ovb">${btn}</button>`;
  o.classList.remove('hide'); $('#ovb').onclick = cb;
}
function closeOv() { $('#ov').classList.add('hide'); $('#ov').innerHTML = ''; }

/* ---------- convite por link, batimento e conexão ---------- */
$('#bShare').onclick = async () => {
  const u = location.href.split(/[?#]/)[0] + '?sala=' + $('#roomCode').textContent, b = $('#bShare');
  try {
    if (navigator.share) await navigator.share({ title: 'Pênalti de Ouro', text: 'Entre na minha sala:', url: u });
    else { await navigator.clipboard.writeText(u); b.textContent = 'Link copiado!'; setTimeout(() => b.textContent = 'Copiar link de convite', 1800); }
  } catch(e){}
};
setInterval(() => {
  if (!conn || !G || G.mode !== 'online' || G.over) return;
  send({t:'p'});
  if (!G.lost && Date.now() - lastRx > 25000) { G.lost = true; ov('<div class="big">Conexão perdida</div><div>Verifique a internet dos dois aparelhos.</div>', 'Voltar ao menu', toMenu); }
}, 4000);
const inviteCode = new URLSearchParams(location.search).get('sala');
if (inviteCode) setTimeout(() => {
  show('lobby'); $('#codeIn').value = inviteCode.toUpperCase().slice(0, 5);
  if (typeof Peer !== 'undefined') $('#bJoin').click(); else setStatus('Não foi possível carregar o modo online. Verifique sua internet.');
}, 0);

/* ---------- uniforme e recordes ---------- */
function renderKits() {
  $('#kits').innerHTML = KITS.map((k, i) => `<button class="kit${i === myKit ? ' on' : ''}" data-k="${i}" style="--c:${k[0]}" aria-label="Uniforme ${i + 1}"></button>`).join('');
  $('#rec').textContent = rec.w || rec.s ? `Vitórias online: ${rec.w} · Maior sequência de gols: ${rec.s}` : '';
}
$('#kits').onclick = e => { const b = e.target.closest('.kit'); if (!b) return; myKit = +b.dataset.k; lsSet('pdo-kit', myKit); renderKits(); };
renderKits();

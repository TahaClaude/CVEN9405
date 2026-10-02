const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const root = path.join(__dirname, 'public');
const levels = {
  time: [20, 35, 50],
  cost: [0, 3, 8],
  reliability: ['High', 'Medium', 'Low']
};
const modes = ['Car', 'Bus', 'Bicycle'];
const state = { round: 0, task: null, responses: {}, connected: new Set(), stream: new Set() };

function randomTask() {
  const pick = a => a[Math.floor(Math.random() * a.length)];
  return {
    id: crypto.randomUUID(),
    alternatives: modes.map(mode => ({ mode, time: pick(levels.time), cost: pick(levels.cost), reliability: pick(levels.reliability) }))
  };
}
function snapshot() {
  const counts = Object.fromEntries(modes.map(m => [m, 0]));
  Object.values(state.responses).forEach(r => { if (counts[r.choice] !== undefined) counts[r.choice]++; });
  return { round: state.round, task: state.task, responses: Object.keys(state.responses).length, counts, connected: state.connected.size };
}
function broadcast() {
  const body = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of state.stream) res.write(body);
}
function nextRound() { state.round++; state.task = randomTask(); state.responses = {}; broadcast(); }

function sendJson(res, obj, code = 200) {
  res.writeHead(code, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify(obj));
}
function body(req) { return new Promise((resolve, reject) => { let b=''; req.on('data', c => b += c); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch(e) { reject(e); } }); }); }
function serve(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/state') return sendJson(res, snapshot());
  if (url.pathname === '/api/events') {
    res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','Access-Control-Allow-Origin':'*'});
    state.stream.add(res); res.write(`data: ${JSON.stringify(snapshot())}\n\n`); req.on('close', () => state.stream.delete(res)); return;
  }
  if (url.pathname === '/api/join' && req.method === 'POST') return body(req).then(({id}) => { state.connected.add(id); broadcast(); sendJson(res, {ok:true}); });
  if (url.pathname === '/api/choice' && req.method === 'POST') return body(req).then(({id, taskId, choice}) => {
    if (!state.task || taskId !== state.task.id || !modes.includes(choice)) return sendJson(res, {error:'This task is no longer active.'}, 400);
    state.responses[id] = {choice}; broadcast(); sendJson(res, {ok:true});
  });
  if (url.pathname === '/api/next' && req.method === 'POST') { nextRound(); return sendJson(res, {ok:true}); }
  const file = url.pathname === '/' ? 'student.html' : url.pathname.slice(1);
  const target = path.join(root, file);
  if (!target.startsWith(root) || !fs.existsSync(target)) return sendJson(res, {error:'Not found'}, 404);
  const ext = path.extname(target); const type = ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'text/css';
  res.writeHead(200, {'Content-Type': type}); fs.createReadStream(target).pipe(res);
}
if (!state.task) nextRound();
http.createServer((req,res) => serve(req,res).catch(() => sendJson(res,{error:'Bad request'},400))).listen(PORT, () => console.log(`Classroom dashboard running on port ${PORT}`));

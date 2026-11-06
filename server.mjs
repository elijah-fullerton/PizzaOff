import http from 'node:http';
import { readFile, writeFile, mkdir, rename, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const projectDir = path.dirname(fileURLToPath(import.meta.url));
const SESSION_MS = 2 * 60 * 60 * 1000;
const MAX_BODY = 64 * 1024;

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function textValue(value, label, max = 80) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new ApiError(400, `${label} must be between 1 and ${max} characters.`);
  }
  return value.trim();
}

function passwordValue(value) {
  if (typeof value !== 'string' || value.trim().length < 4 || value.length > 128) {
    throw new ApiError(400, 'Choose a score password between 4 and 128 characters.');
  }
  return value;
}

const nameKey = value => value.normalize('NFKC').toLocaleLowerCase('en-US');

function publicCompetition(competition, includeScores = false) {
  const { id, name, createdAt, updatedAt, contestants, pizzas, votes } = competition;
  return {
    id, name, createdAt, updatedAt, contestants, pizzas,
    votes: includeScores ? votes : votes.map(({ pizzaId, voterId }) => ({ pizzaId, voterId })),
  };
}

async function makePassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  return { salt, hash };
}

async function checkPassword(password, saved) {
  const candidate = await scrypt(password, saved.salt, 64);
  const expected = Buffer.from(saved.hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

async function openStore(dataDir) {
  await mkdir(dataDir, { recursive: true });
  const file = path.join(dataDir, 'competitions.json');
  let data;
  try {
    data = JSON.parse(await readFile(file, 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.competitions)) throw new Error('Unrecognized data format.');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(`Cannot read saved competitions at ${file}. Your file has not been overwritten. ${error.message}`);
    }
    data = { version: 1, competitions: [] };
  }
  let queue = Promise.resolve();
  return {
    read: () => data,
    change(mutate) {
      const task = queue.then(async () => {
        const next = structuredClone(data);
        const result = mutate(next);
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(next, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
          await rename(temporary, file);
        } catch (error) {
          await unlink(temporary).catch(() => {});
          throw error;
        }
        data = next;
        return result;
      });
      queue = task.catch(() => {});
      return task;
    },
  };
}

function competitionFrom(data, id) {
  const competition = data.competitions.find(item => item.id === id);
  if (!competition) throw new ApiError(404, 'That competition was not found.');
  return competition;
}

async function readJson(request) {
  const type = (request.headers['content-type'] || '').split(';')[0].trim();
  if (type !== 'application/json') throw new ApiError(415, 'Please send JSON data.');
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new ApiError(413, 'That request is too large.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new ApiError(400, 'The request must contain a valid JSON object.');
  }
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

export async function createServer({ dataDir = path.join(projectDir, 'data'), publicDir = path.join(projectDir, 'public'), sessionMs = SESSION_MS } = {}) {
  const store = await openStore(dataDir);
  const sessions = new Map();
  const failedUnlocks = new Map();
  const root = path.resolve(publicDir);

  function authorize(request, id) {
    const token = (request.headers.authorization || '').replace(/^Bearer /, '');
    const session = sessions.get(token);
    if (!session || session.competitionId !== id || session.expiresAt <= Date.now()) {
      if (session && session.expiresAt <= Date.now()) sessions.delete(token);
      throw new ApiError(401, 'The score room is locked. Enter the host password to continue.');
    }
    return token;
  }

  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Cache-Control', 'no-store');
    const send = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(value));
    };
    try {
      const port = server.address()?.port;
      const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
      if (!allowedHosts.has(request.headers.host)) throw new ApiError(403, 'Open PizzaOff using its local address.');
      if (request.headers.origin && ![...allowedHosts].some(host => request.headers.origin === `http://${host}`)) {
        throw new ApiError(403, 'Requests must come from the local PizzaOff app.');
      }
      if (request.headers['sec-fetch-site'] === 'cross-site') throw new ApiError(403, 'Cross-site requests are not allowed.');
      const url = new URL(request.url, `http://${request.headers.host}`);
      const pathname = decodeURIComponent(url.pathname);
      if (pathname === '/api/competitions') {
        if (request.method === 'GET') {
          const competitions = store.read().competitions.map(({ id, name, createdAt, updatedAt, contestants, pizzas, votes }) => ({
            id, name, createdAt, updatedAt, contestantCount: contestants.length, pizzaCount: pizzas.length, voteCount: votes.length,
          })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          return send(200, { competitions });
        }
        if (request.method === 'POST') {
          const body = await readJson(request);
          const name = textValue(body.name, 'Competition name');
          const password = passwordValue(body.password);
          if (!Array.isArray(body.contestants) || body.contestants.length < 1 || body.contestants.length > 200) {
            throw new ApiError(400, 'Add between 1 and 200 contestants.');
          }
          const names = body.contestants.map(value => textValue(value, 'Contestant name'));
          if (new Set(names.map(nameKey)).size !== names.length) throw new ApiError(409, 'Each contestant needs a unique name.');
          const passwordHash = await makePassword(password);
          const now = new Date().toISOString();
          const competition = {
            id: randomUUID(), name, createdAt: now, updatedAt: now, passwordHash,
            contestants: names.map(name => ({ id: randomUUID(), name })), pizzas: [], votes: [],
          };
          await store.change(data => data.competitions.push(competition));
          return send(201, { competition: publicCompetition(competition) });
        }
        throw new ApiError(405, 'That method is not supported.');
      }
      if (pathname.startsWith('/api/')) {
        const match = pathname.match(/^\/api\/competitions\/([^/]+)(?:\/(contestants|pizzas|votes|unlock|results|lock))?$/);
        if (!match) throw new ApiError(404, 'That endpoint was not found.');
        const [, id, action] = match;
        const current = competitionFrom(store.read(), id);
        if (!action && request.method === 'GET') return send(200, { competition: publicCompetition(current) });
        if (action === 'results' && request.method === 'GET') {
          authorize(request, id);
          return send(200, { competition: publicCompetition(current, true) });
        }
        if (request.method !== 'POST' || !action || action === 'results') throw new ApiError(405, 'That method is not supported.');
        if (action === 'lock') {
          sessions.delete(authorize(request, id));
          return send(200, { locked: true });
        }
        const body = await readJson(request);
        if (action === 'unlock') {
          const now = Date.now();
          const failed = failedUnlocks.get(id);
          if (failed && failed.until > now && failed.count >= 5) {
            throw new ApiError(429, 'Too many password attempts. Please wait one minute and try again.');
          }
          const password = passwordValue(body.password);
          if (!await checkPassword(password, current.passwordHash)) {
            const attempt = failed && failed.until > now ? failed : { count: 0, until: now + 60_000 };
            attempt.count += 1;
            failedUnlocks.set(id, attempt);
            throw new ApiError(401, 'That password is not quite right. Try again.');
          }
          failedUnlocks.delete(id);
          for (const [key, session] of sessions) if (session.expiresAt <= now) sessions.delete(key);
          const token = randomBytes(32).toString('hex');
          sessions.set(token, { competitionId: id, expiresAt: now + sessionMs });
          return send(200, { token });
        }
        const competition = await store.change(data => {
          const target = competitionFrom(data, id);
          if (action === 'contestants') {
            const name = textValue(body.name, 'Contestant name');
            if (target.contestants.length >= 200) throw new ApiError(400, 'This competition already has 200 contestants.');
            if (target.contestants.some(person => nameKey(person.name) === nameKey(name))) throw new ApiError(409, 'A contestant with that name is already at the party.');
            target.contestants.push({ id: randomUUID(), name });
          } else if (action === 'pizzas') {
            const name = textValue(body.name, 'Pizza name');
            if (!target.contestants.some(person => person.id === body.contestantId)) throw new ApiError(400, 'Choose a contestant who belongs to this competition.');
            target.pizzas.push({ id: randomUUID(), name, contestantId: body.contestantId });
          } else if (action === 'votes') {
            const pizza = target.pizzas.find(item => item.id === body.pizzaId);
            if (!pizza) throw new ApiError(400, 'Choose a pizza in this competition.');
            if (!target.contestants.some(person => person.id === body.voterId)) throw new ApiError(400, 'Choose a contestant in this competition.');
            if (pizza.contestantId === body.voterId) throw new ApiError(409, 'You cannot vote for your own pizza. Share the love!');
            if (target.votes.some(vote => vote.pizzaId === body.pizzaId && vote.voterId === body.voterId)) throw new ApiError(409, 'This contestant has already voted for that pizza.');
            for (const metric of ['taste', 'texture', 'creativity']) {
              if (!Number.isInteger(body[metric]) || body[metric] < 1 || body[metric] > 5) throw new ApiError(400, 'Taste, Texture, and Creativity must each be a whole number from 1 to 5.');
            }
            target.votes.push({ pizzaId: body.pizzaId, voterId: body.voterId, taste: body.taste, texture: body.texture, creativity: body.creativity, createdAt: new Date().toISOString() });
          }
          target.updatedAt = new Date().toISOString();
          return publicCompetition(target);
        });
        return send(201, { competition });
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw new ApiError(405, 'That method is not supported.');
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep) || relative.includes('\\') || relative.includes('\0')) throw new ApiError(403, 'That file is not available.');
      let fileInfo;
      try { fileInfo = await stat(file); } catch { throw new ApiError(404, 'That page was not found.'); }
      if (!fileInfo.isFile()) throw new ApiError(404, 'That page was not found.');
      response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? undefined : await readFile(file));
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      if (!(error instanceof ApiError)) console.error('PizzaOff request failed:', error.message);
      send(error.status || 500, { error: error.status ? error.message : 'Something went wrong while saving. Please try again; your previous data is safe.' });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}

export async function startServer({ port = Number(process.env.PORT || 3210), ...options } = {}) {
  const server = await createServer(options);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().then(server => {
    console.log(`\n  PizzaOff is fresh out of the oven!\n  Open http://127.0.0.1:${server.address().port}\n  Your competitions are saved in ${path.join(projectDir, 'data')}\n  Press Ctrl+C to stop.\n`);
  }).catch(error => {
    console.error(error.code === 'EADDRINUSE' ? 'Port 3210 is already in use. PizzaOff may already be running at http://127.0.0.1:3210. You can also set PORT to another port.' : error.message);
    process.exitCode = 1;
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startServer } from './server.mjs';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pizzaoff-test-'));
  const publicDir = path.join(directory, 'public');
  await mkdir(publicDir);
  await writeFile(path.join(publicDir, 'index.html'), '<h1>PizzaOff</h1>');
  let server = await startServer({ port: 0, dataDir: directory, publicDir, ...options });
  const fixture = {
    directory,
    get url() { return `http://127.0.0.1:${server.address().port}`; },
    async request(endpoint, { method = 'GET', body, token, headers = {} } = {}) {
      const response = await fetch(`${fixture.url}${endpoint}`, {
        method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, data: await response.json() };
    },
    async restart() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      server = await startServer({ port: 0, dataDir: directory, publicDir, ...options });
    },
  };
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  return fixture;
}

async function create(f, name = 'Friday Pizza Party') {
  const response = await f.request('/api/competitions', { method: 'POST', body: { name, contestants: ['Alex', 'Bea', 'Charlie'], password: 'pizza-password' } });
  assert.equal(response.status, 201);
  return response.data.competition;
}

async function addPizza(f, c) {
  const response = await f.request(`/api/competitions/${c.id}/pizzas`, { method: 'POST', body: { name: 'The Cheesy Champion', contestantId: c.contestants[0].id } });
  assert.equal(response.status, 201);
  return response.data.competition;
}

test('complete competition flow persists data and keeps scores behind scoped passwords', async t => {
  const f = await fixture(t);
  let c = await create(f);
  const base = `/api/competitions/${c.id}`;
  c = await addPizza(f, c);
  const vote = { pizzaId: c.pizzas[0].id, voterId: c.contestants[1].id, taste: 1, texture: 3, creativity: 5 };
  const voted = await f.request(`${base}/votes`, { method: 'POST', body: vote });
  assert.equal(voted.status, 201);
  assert.deepEqual(voted.data.competition.votes, [{ pizzaId: vote.pizzaId, voterId: vote.voterId }]);
  assert.equal(voted.data.competition.passwordHash, undefined);
  const list = await f.request('/api/competitions');
  assert.equal(list.data.competitions[0].voteCount, 1);
  assert.equal(list.data.competitions[0].pizzaCount, 1);
  assert.equal(list.data.competitions[0].contestantCount, 3);
  assert.equal((await f.request(`${base}/results`)).status, 401);
  assert.equal((await f.request(`${base}/unlock`, { method: 'POST', body: { password: 'wrong-password' } })).status, 401);
  const unlocked = await f.request(`${base}/unlock`, { method: 'POST', body: { password: 'pizza-password' } });
  assert.equal(unlocked.status, 200);
  const token = unlocked.data.token;
  const results = await f.request(`${base}/results`, { token });
  assert.equal(results.status, 200);
  assert.equal(results.data.competition.votes[0].taste, 1);
  assert.equal(results.data.competition.votes[0].texture, 3);
  assert.equal(results.data.competition.votes[0].creativity, 5);
  assert.ok(results.data.competition.votes[0].createdAt);
  assert.equal(results.data.competition.passwordHash, undefined);
  const other = await create(f, 'Another Party');
  assert.equal((await f.request(`/api/competitions/${other.id}/results`, { token })).status, 401);
  assert.equal((await f.request(`${base}/lock`, { method: 'POST', token })).status, 200);
  assert.equal((await f.request(`${base}/results`, { token })).status, 401);
  const saved = JSON.parse(await readFile(path.join(f.directory, 'competitions.json'), 'utf8'));
  assert.equal(saved.competitions[0].password, undefined);
  assert.equal(JSON.stringify(saved).includes('pizza-password'), false);
  assert.equal(saved.competitions[0].passwordHash.hash.length, 128);
  await f.restart();
  const resumed = await f.request(base);
  assert.equal(resumed.status, 200);
  assert.equal(resumed.data.competition.votes.length, 1);
  assert.equal((await f.request(`${base}/unlock`, { method: 'POST', body: { password: 'pizza-password' } })).status, 200);
});

test('self voting, duplicate ballots, invalid scores, and foreign IDs are rejected', async t => {
  const f = await fixture(t);
  const c = await addPizza(f, await create(f));
  const base = `/api/competitions/${c.id}`;
  const vote = { pizzaId: c.pizzas[0].id, voterId: c.contestants[1].id, taste: 4, texture: 4, creativity: 5 };
  assert.equal((await f.request(`${base}/votes`, { method: 'POST', body: { ...vote, voterId: c.contestants[0].id } })).status, 409);
  for (const bad of [0, 6, 1.5, '4', null]) {
    assert.equal((await f.request(`${base}/votes`, { method: 'POST', body: { ...vote, texture: bad } })).status, 400);
  }
  assert.equal((await f.request(`${base}/votes`, { method: 'POST', body: { ...vote, voterId: 'foreign-id' } })).status, 400);
  assert.equal((await f.request(`${base}/pizzas`, { method: 'POST', body: { name: 'Alien Pizza', contestantId: 'foreign-id' } })).status, 400);
  const concurrent = await Promise.all([
    f.request(`${base}/votes`, { method: 'POST', body: vote }),
    f.request(`${base}/votes`, { method: 'POST', body: vote }),
  ]);
  assert.deepEqual(concurrent.map(x => x.status).sort(), [201, 409]);
  assert.equal((await f.request(base)).data.competition.votes.length, 1);
});

test('contestants and required names are validated and can be added later', async t => {
  const f = await fixture(t);
  for (const body of [
    { name: '', contestants: ['Alex'], password: 'pizza' },
    { name: 'Party', contestants: [], password: 'pizza' },
    { name: 'Party', contestants: ['Alex'], password: 'a' },
    { name: 'Party', contestants: ['Alex'], password: 'a'.repeat(129) },
  ]) assert.equal((await f.request('/api/competitions', { method: 'POST', body })).status, 400);
  assert.equal((await f.request('/api/competitions', { method: 'POST', body: { name: 'Party', contestants: ['Alex', ' alex '], password: 'pizza' } })).status, 409);
  const c = await create(f);
  const endpoint = `/api/competitions/${c.id}/contestants`;
  assert.equal((await f.request(endpoint, { method: 'POST', body: { name: ' aLeX ' } })).status, 409);
  assert.equal((await f.request(endpoint, { method: 'POST', body: { name: 'Dana' } })).status, 201);
  assert.equal((await f.request(`/api/competitions/${c.id}`)).data.competition.contestants.length, 4);
});

test('wrong-password throttling and session expiry are enforced', async t => {
  const f = await fixture(t, { sessionMs: 25 });
  const c = await create(f);
  const base = `/api/competitions/${c.id}`;
  const unlock = await f.request(`${base}/unlock`, { method: 'POST', body: { password: 'pizza-password' } });
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal((await f.request(`${base}/results`, { token: unlock.data.token })).status, 401);
  for (let i = 0; i < 5; i++) assert.equal((await f.request(`${base}/unlock`, { method: 'POST', body: { password: 'incorrect' } })).status, 401);
  assert.equal((await f.request(`${base}/unlock`, { method: 'POST', body: { password: 'pizza-password' } })).status, 429);
});

test('local-only access, static files, malformed payloads, and path boundaries', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.url)).status, 200);
  assert.equal((await f.request('/api/competitions', { headers: { Origin: 'https://malicious.example' } })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    http.get(`${f.url}/api/competitions`, { headers: { Host: 'malicious.example' } }, response => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(hostStatus, 403);
  assert.equal((await f.request('/api/competitions', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await fetch(`${f.url}/api/competitions`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await fetch(`${f.url}/api/competitions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid' })).status, 400);
  assert.equal((await fetch(`${f.url}/%2e%2e%2fcompetitions.json`)).status, 403);
  assert.equal((await fetch(`${f.url}/data/competitions.json`)).status, 404);
  assert.equal((await f.request('/api/unknown')).status, 404);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { METRICS, summarize, accolades, distribution, voterRows } from './public/stats.mjs';

const ballot = (taste, texture, creativity, pizzaId = 'p1', voterId = 'c2') => ({ taste, texture, creativity, pizzaId, voterId });
const fixture = () => ({
  contestants: [{ id: 'c1', name: 'Alex' }, { id: 'c2', name: 'Sam' }, { id: 'c3', name: 'Jo' }],
  pizzas: [{ id: 'p1', name: 'Margherita', contestantId: 'c1' }, { id: 'p2', name: 'Pepperoni', contestantId: 'c2' }],
  votes: [],
});

test('metrics contain every requested category and the across-category average', () => {
  assert.deepEqual(METRICS.map(metric => metric.key), ['taste', 'texture', 'creativity', 'overall']);
});

test('summary preserves unvoted pizzas and calculates equal-weight averages', () => {
  const competition = fixture();
  competition.votes = [ballot(1, 2, 3), ballot(5, 4, 2, 'p1', 'c3')];
  const [scored, unvoted] = summarize(competition);
  assert.equal(scored.voteCount, 2);
  assert.equal(scored.creatorName, 'Alex');
  assert.equal(scored.taste, 3);
  assert.equal(scored.texture, 3);
  assert.equal(scored.creativity, 2.5);
  assert.equal(scored.overall, 17 / 6);
  assert.equal(unvoted.voteCount, 0);
  for (const { key } of METRICS) assert.equal(unvoted[key], null);
});

test('requested 1,1,1 and 5,5,5 example contributes one vote at each endpoint for all charts', () => {
  const votes = [ballot(1, 1, 1), ballot(5, 5, 5)];
  for (const { key } of METRICS) {
    const bins = distribution(votes, key);
    assert.deepEqual(bins.filter(bin => bin.count), [{ score: 1, count: 1 }, { score: 5, count: 1 }]);
    assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), 2);
  }
});

test('overall charts count ballot averages, preserving thirds without rounding into integer bins', () => {
  const bins = distribution([ballot(1, 1, 2), ballot(1, 2, 1), ballot(3, 4, 4)], 'overall');
  assert.equal(bins.length, 13);
  assert.equal(bins.find(bin => bin.score === 4 / 3).count, 2);
  assert.equal(bins.find(bin => bin.score === 11 / 3).count, 1);
  assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), 3);
});

test('awards include ties, exclude unvoted pizzas, and compare unrounded averages', () => {
  const competition = fixture();
  competition.pizzas.push({ id: 'p3', name: 'Untasted', contestantId: 'c3' });
  competition.votes = [ballot(5, 3, 1), ballot(5, 1, 3, 'p2', 'c1')];
  const awards = accolades(summarize(competition));
  assert.equal(awards.length, 5);
  assert.deepEqual(awards.find(award => award.key === 'taste').winners.map(pizza => pizza.id), ['p1', 'p2']);
  assert.deepEqual(awards.find(award => award.key === 'texture').winners.map(pizza => pizza.id), ['p1']);
  assert.deepEqual(awards.find(award => award.key === 'creativity').winners.map(pizza => pizza.id), ['p2']);
  assert.equal(awards.find(award => award.key === 'honorable').winners.length, 2);
  assert.equal(awards.find(award => award.key === 'dishonorable').winners.length, 2);
  assert.ok(awards.every(award => award.winners.every(pizza => pizza.id !== 'p3')));
  const close = [
    { id: 'a', voteCount: 1000, taste: 4.001, texture: 3, creativity: 3, overall: 4.001 },
    { id: 'b', voteCount: 1000, taste: 4.002, texture: 3, creativity: 3, overall: 4.002 },
  ];
  assert.deepEqual(accolades(close).find(award => award.key === 'taste').winners.map(pizza => pizza.id), ['b']);
});

test('highest and lowest overall are independent of individual category winners', () => {
  const competition = fixture();
  competition.votes = [ballot(5, 1, 1), ballot(3, 3, 3, 'p2', 'c1')];
  const awards = accolades(summarize(competition));
  assert.equal(awards.find(award => award.key === 'honorable').winners[0].id, 'p2');
  assert.equal(awards.find(award => award.key === 'dishonorable').winners[0].id, 'p1');
});

test('empty competitions and no-vote pizzas produce no winners or fabricated scores', () => {
  assert.deepEqual(summarize({ contestants: [], pizzas: [], votes: [] }), []);
  assert.ok(accolades(summarize(fixture())).every(award => award.winners.length === 0));
  for (const { key } of METRICS) assert.ok(distribution([], key).every(bin => bin.count === 0));
  assert.deepEqual(voterRows(fixture(), 'c1'), []);
});

test('voter data filters voters and pairs each ballot with the correct pizza and mean', () => {
  const competition = fixture();
  competition.votes = [ballot(2, 3, 5), ballot(5, 5, 5, 'p2', 'c1'), ballot(4, 4, 4, 'p1', 'c3')];
  assert.deepEqual(voterRows(competition, 'c2'), [{
    pizzaId: 'p1', pizzaName: 'Margherita', creatorName: 'Alex', taste: 2, texture: 3, creativity: 5, overall: 10 / 3,
  }]);
});

test('unknown metrics are rejected and public ballot metadata does not become a score', () => {
  assert.throws(() => distribution([], 'invalid'), RangeError);
  const competition = fixture();
  competition.votes = [{ pizzaId: 'p1', voterId: 'c2' }];
  assert.equal(summarize(competition)[0].overall, null);
  assert.deepEqual(voterRows(competition, 'c2'), []);
  assert.ok(distribution(competition.votes, 'overall').every(bin => bin.count === 0));
});

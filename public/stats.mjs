/** Shared result calculations. Each ballot has equal weight. */
export const METRICS = Object.freeze([
  { key: 'taste', label: 'Taste' },
  { key: 'texture', label: 'Texture' },
  { key: 'creativity', label: 'Creativity' },
  { key: 'overall', label: 'Overall' },
]);

const categoryKeys = ['taste', 'texture', 'creativity'];
const isScore = value => Number.isInteger(value) && value >= 1 && value <= 5;
const isBallot = vote => categoryKeys.every(key => isScore(vote[key]));
const total = vote => vote.taste + vote.texture + vote.creativity;

/** Unvoted pizzas have null averages, never zero. */
export function summarize(competition) {
  const names = new Map(competition.contestants.map(person => [person.id, person.name]));
  return competition.pizzas.map(pizza => {
    const votes = competition.votes.filter(vote => vote.pizzaId === pizza.id && isBallot(vote));
    const result = {
      ...pizza,
      creatorName: names.get(pizza.contestantId) ?? 'Unknown contestant',
      voteCount: votes.length,
    };
    for (const key of categoryKeys) {
      result[key] = votes.length ? votes.reduce((sum, vote) => sum + vote[key], 0) / votes.length : null;
    }
    result.overall = votes.length ? votes.reduce((sum, vote) => sum + total(vote), 0) / (3 * votes.length) : null;
    return result;
  });
}

/** Ties share an award; pizzas with no ballots are not eligible. */
export function accolades(summaries) {
  const definitions = [
    { key: 'taste', label: 'Best Taste', description: 'Highest average Taste score.', metric: 'taste' },
    { key: 'texture', label: 'Best Texture', description: 'Highest average Texture score.', metric: 'texture' },
    { key: 'creativity', label: 'Most Creative', description: 'Highest average Creativity score.', metric: 'creativity' },
    { key: 'honorable', label: 'Honorable Mention', description: 'Highest average across all three categories.', metric: 'overall' },
    { key: 'dishonorable', label: 'Dishonorable Mention', description: 'Lowest average across all three categories.', metric: 'overall', lowest: true },
  ];
  return definitions.map(definition => {
    const eligible = summaries.filter(pizza => pizza.voteCount > 0 && Number.isFinite(pizza[definition.metric]));
    const scores = eligible.map(pizza => pizza[definition.metric]);
    const best = definition.lowest ? Math.min(...scores) : Math.max(...scores);
    return {
      ...definition,
      winners: eligible.filter(pizza => Math.abs(pizza[definition.metric] - best) < 1e-10),
    };
  });
}

/**
 * Frequency distribution over ballots (not a probability density or cumulative
 * distribution). Overall contributes one mean per ballot and keeps thirds exact
 * by counting integer totals before converting the axis values to means.
 */
export function distribution(votes, metric) {
  if (!METRICS.some(item => item.key === metric)) throw new RangeError(`Unknown metric: ${metric}`);
  if (metric === 'overall') {
    const bins = Array.from({ length: 13 }, (_, index) => ({ score: (index + 3) / 3, count: 0 }));
    for (const vote of votes) {
      if (isBallot(vote)) bins[total(vote) - 3].count += 1;
    }
    return bins;
  }
  const bins = Array.from({ length: 5 }, (_, index) => ({ score: index + 1, count: 0 }));
  for (const vote of votes) {
    if (isScore(vote[metric])) bins[vote[metric] - 1].count += 1;
  }
  return bins;
}

/** Rows retain ballot entry order and show only this contestant's votes. */
export function voterRows(competition, voterId) {
  const pizzas = new Map(competition.pizzas.map(pizza => [pizza.id, pizza]));
  const names = new Map(competition.contestants.map(person => [person.id, person.name]));
  return competition.votes.filter(vote => vote.voterId === voterId && isBallot(vote)).map(vote => {
    const pizza = pizzas.get(vote.pizzaId);
    return {
      pizzaId: vote.pizzaId,
      pizzaName: pizza?.name ?? 'Unknown pizza',
      creatorName: names.get(pizza?.contestantId) ?? 'Unknown contestant',
      taste: vote.taste,
      texture: vote.texture,
      creativity: vote.creativity,
      overall: total(vote) / 3,
    };
  });
}

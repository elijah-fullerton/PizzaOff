import { METRICS, summarize, accolades, distribution, voterRows } from './stats.mjs';

const main = document.querySelector('#main');
const state = { competition: null, token: null, tokenCompetition: null, resultCompetition: null, route: '', sequence: 0 };
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const average = value => value == null ? '—' : value.toFixed(2);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const competitionPath = (suffix = '') => `#competition/${state.competition.id}${suffix ? '/' + suffix : ''}`;
const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>', arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  back: '<path d="m14 6-6 6 6 6"/>', lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  pizza: '<path d="m4 7 7 14a1 1 0 0 0 2 0l7-14M3 6q9-7 18 0l-1 3Q12 4 4 9Z"/><circle cx="10" cy="11" r="1"/><circle cx="14" cy="14" r="1"/>',
  vote: '<path d="M5 6h14v15H5zM9 3h6v5H9zM8 14l3 3 5-6"/>', people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>',
  trophy: '<path d="M8 3h8v7a4 4 0 0 1-8 0ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v6m-4 1h8"/>',
  chart: '<path d="M4 3v17h17M8 16v-5m5 5V6m5 10v-8"/>', table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16m6-10v10M3 15h18"/>',
  check: '<path d="m5 12 4 4L19 6"/>', heart: '<path d="M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-4 4 1 9 8 15 7-6 12-11 8-15Z"/>', spark: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Zm7 1v4m-2-2h4"/>',
  leaf: '<path d="M19 3C6 2 2 10 6 15c5 6 14 0 13-12ZM5 21 15 9"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.pizza}</svg>`;
const date = value => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
const back = (href, label) => `<a class="back-link" href="${href}">${icon('back')}${label}</a>`;
const heading = (eyebrow, title, description = '', right = '') => `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${description ? `<p class="lede">${description}</p>` : ''}</div>${right}</div>`;
const errorSlot = () => '<div class="form-error" role="alert" hidden></div>';
const empty = (title, description, action = '') => `<div class="empty-state"><img src="/assets/pizza-slice.svg" alt="" width="100" height="100"><h3>${title}</h3><p>${description}</p>${action}</div>`;

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const response = await fetch('/api' + path, { signal: AbortSignal.timeout(15000), ...options, headers });
  const data = await response.json().catch(() => ({ error: 'The oven isn’t responding. Please try again.' }));
  if (!response.ok) { const error = new Error(data.error || 'Something went wrong. Please try again.'); error.status = response.status; throw error; }
  return data;
}
const post = (path, body, headers = {}) => api(path, { method: 'POST', body: JSON.stringify(body), headers });
function notify(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(notify.timer); notify.timer = setTimeout(() => el.classList.remove('visible'), 4200); }
function navigate(hash) { if (location.hash === hash) render(); else location.hash = hash; }
function showError(form, message) { const slot = form.querySelector('.form-error'); slot.textContent = message; slot.hidden = false; slot.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
function lockResults() {
  const token = state.token; const id = state.tokenCompetition;
  state.token = null; state.tokenCompetition = null; state.resultCompetition = null;
  if (token) main.innerHTML = '<div class="loading">Putting the scores away…</div>';
  if (token && id) void post(`/competitions/${id}/lock`, {}, { Authorization: `Bearer ${token}` }).catch(() => {});
}

function home(competitions) {
  return `<section class="home-hero"><div class="hero-copy"><div class="eyebrow"><span class="tiny-star">✦</span> BRING YOUR BEST SLICE</div><h1>A little friendly<br><em>crust-petition.</em></h1><p>Gather your people. Bake something brilliant.<br>Let the pizza party find its champion.</p><div class="hero-actions"><a class="button primary" href="#new">${icon('plus')}New competition</a><a class="button secondary" href="#resume">Resume a party ${icon('arrow')}</a></div><div class="hero-note">${icon('heart')} Good food. Honest votes. Bragging rights.</div></div><div class="hero-art"><div class="art-halo"></div><img class="party-illustration" src="/assets/pizza-party.svg" alt="Two happy, rosy-cheeked pizza slices cheering at a pizza party"><span class="art-label">EVERY SLICE HAS ITS MOMENT</span><span class="art-spark spark-one">✧</span><span class="art-spark spark-two">✳</span></div></section>
  <section class="how-it-works"><div class="section-heading"><h2>From first bite to bragging rights.</h2><span>THE RECIPE FOR A GOOD TIME</span></div><div class="steps"><article><span class="step-number">01</span><div><h3>Gather the pizza people</h3><p>Name your party and add your home chefs.</p></div>${icon('people')}</article><article><span class="step-number">02</span><div><h3>Slice, savor & score</h3><p>Vote on taste, texture, and a little creativity.</p></div>${icon('pizza')}</article><article><span class="step-number">03</span><div><h3>Crown the crust</h3><p>Unlock the results. Celebrate every slice.</p></div>${icon('trophy')}</article></div></section>
  ${competitions.length ? `<section class="recent-section"><div class="section-heading"><h2>Still warm from the oven</h2><a href="#resume">All competitions ${icon('arrow')}</a></div><div class="competition-grid">${competitions.slice(0, 3).map(competitionCard).join('')}</div></section>` : '<div class="home-bottom"><span>✦</span> Your table. Your traditions. Your pizza champions. <span>✦</span></div>'}`;
}
function competitionCard(c) { return `<a class="competition-card" href="#competition/${c.id}"><span class="card-icon">${icon('pizza')}</span><div class="competition-card-copy"><span class="small-label">${date(c.createdAt)}</span><h3>${esc(c.name)}</h3><p>${plural(c.contestantCount, 'contestant')} <span>·</span> ${plural(c.pizzaCount, 'pizza')} <span>·</span> ${plural(c.voteCount, 'vote')}</p></div>${icon('arrow')}</a>`; }

function setup() {
  return `${back('#home', 'Back to the table')}<div class="form-layout"><section>${heading('A FRESH START', 'Let’s get this<br><em>pizza party started.</em>', 'A name, your favorite people, and a little healthy competition.')}<div class="setup-art"><img src="/assets/pizza-party.svg" alt="Happy pizza friends" width="420" height="299"></div><div class="tip-note">${icon('lock')}<p><strong>Keep the big reveal a surprise.</strong><br>Your host password keeps scores tucked away while everyone votes.</p></div></section><form id="setup-form" class="panel form-panel">${errorSlot()}<label class="field-label" for="competition-name">Competition name</label><input id="competition-name" name="name" placeholder="e.g. The Great Friday Pizza-Off" required maxlength="80" autocomplete="off"><div class="field-heading"><label class="field-label" for="contestant-1">Who’s at the table?</label><span>One name per person</span></div><div id="contestant-inputs">${[1, 2, 3].map(i => contestantInput(i)).join('')}</div><button class="text-button add-name" type="button" data-action="add-name">${icon('plus')}Add another contestant</button><div class="form-divider"></div><label class="field-label" for="host-password">Score password ${icon('lock')}</label><div class="password-field"><input id="host-password" type="password" name="password" placeholder="A secret for the host" required minlength="4" maxlength="128" autocomplete="new-password"><button type="button" class="password-toggle" data-action="toggle-password" aria-label="Show password">Show</button></div><p class="field-help">At least 4 characters. You’ll need it to reveal the results.</p><button class="button primary full" type="submit">Let’s make pizza ${icon('arrow')}</button><p class="form-footnote">${icon('check')} Your party saves automatically on this computer.</p></form></div>`;
}
function contestantInput(i) { return `<div class="contestant-input-row"><span class="input-number">${String(i).padStart(2, '0')}</span><input id="contestant-${i}" name="contestant" aria-label="Contestant ${i}" placeholder="Contestant’s name" maxlength="80" autocomplete="off" ${i === 1 ? 'required' : ''}><button type="button" class="icon-button" data-action="remove-name" aria-label="Remove contestant ${i}">${icon('close')}</button></div>`; }
function resume(competitions) { return `${back('#home', 'Back to the table')}${heading('SAVED FOR SECONDS', 'Your pizza parties.', 'Pick up right where your table left off.', '<a class="button primary" href="#new">' + icon('plus') + 'New competition</a>')}<div class="competition-grid resume-grid">${competitions.length ? competitions.map(competitionCard).join('') : empty('Your first party is waiting.', 'Start a competition and it will be saved here for next time.', '<a class="button primary" href="#new">Create a competition</a>')}</div>`; }

function actionCard(href, symbol, title, subtitle, color = '') { return `<a class="action-card ${color}" href="${href}"><span class="action-icon">${icon(symbol)}</span><h3>${title}</h3><p>${subtitle}</p><span class="action-arrow">${icon('arrow')}</span></a>`; }
function hub(c) {
  const possible = c.pizzas.length * Math.max(c.contestants.length - 1, 0);
  return `${back('#resume', 'All competitions')}${heading('THE TABLE IS SET', esc(c.name), 'Good company. Great pizza. May the best slice win.', '<span class="saved-badge">' + icon('check') + 'Automatically saved</span>')}<div class="party-summary"><span>${icon('people')}<strong>${c.contestants.length}</strong> contestants</span><span>${icon('pizza')}<strong>${c.pizzas.length}</strong> pizzas</span><span>${icon('vote')}<strong>${c.votes.length}${possible ? ' / ' + possible : ''}</strong> votes cast</span><span class="summary-note">A delicious work in progress</span></div><div class="action-grid">${actionCard(competitionPath('pizza'), 'pizza', 'Add a pizza', 'Give your creation its moment.', 'peach')}${actionCard(competitionPath('vote'), 'vote', 'Cast a vote', 'Taste it. Think it. Score it.', 'sage')}${actionCard(competitionPath('unlock'), 'trophy', 'View the scores', 'The delicious truth, under wraps.', 'butter')}${actionCard(competitionPath('contestant'), 'people', 'Add a contestant', 'There’s room at this table.', 'pink')}</div><section class="pizza-section"><div class="section-heading"><h2>The pizza lineup <span class="count-badge">${c.pizzas.length}</span></h2><a href="${competitionPath('pizza')}">${icon('plus')} Add pizza</a></div>${c.pizzas.length ? `<div class="pizza-grid">${c.pizzas.map((p, i) => `<article class="pizza-card"><div class="pizza-card-art art-${i % 3}"><span class="entry-number">PIZZA NO. ${String(i + 1).padStart(2, '0')}</span><img src="/assets/pizza-slice.svg" alt="" width="120" height="120"></div><div class="pizza-card-body"><h3>${esc(p.name)}</h3><p>By ${esc(c.contestants.find(x => x.id === p.contestantId)?.name)}</p><div class="pizza-card-bottom"><span>${plural(c.votes.filter(v => v.pizzaId === p.id).length, 'vote')} cast</span><a class="small-button" href="${competitionPath('vote')}?pizza=${p.id}">Vote ${icon('arrow')}</a></div></div></article>`).join('')}</div>` : empty('Every great party starts with a pizza.', 'Add your first creation to open the voting.', `<a class="button primary" href="${competitionPath('pizza')}">${icon('plus')}Add the first pizza</a>`)}</section><section class="contestants-section"><div class="section-heading"><h2>The pizza people</h2><span>${plural(c.contestants.length, 'CONTESTANT')}</span></div><div class="people-list">${c.contestants.map((p, i) => `<span class="person-chip"><span class="avatar avatar-${i % 4}">${esc(p.name.slice(0, 1).toUpperCase())}</span>${esc(p.name)}</span>`).join('')}</div></section>`;
}

function formShell(eyebrow, title, description, body, symbol = 'pizza') { return `<div class="narrow-page">${back(competitionPath(), 'Back to the party')}<div class="form-page-icon">${icon(symbol)}</div>${heading(eyebrow, title, description)}<form class="panel form-panel" id="${symbol === 'people' ? 'contestant' : symbol === 'lock' ? 'unlock' : 'pizza'}-form">${errorSlot()}${body}</form></div>`; }
function newPizza(c) { return formShell('FRESH FROM THE OVEN', 'Meet the next contender.', 'Every masterpiece deserves a name.', `<label class="field-label" for="pizza-name">Pizza name</label><input id="pizza-name" name="name" required maxlength="80" placeholder="e.g. The Truffle Shuffle" autocomplete="off"><label class="field-label spaced" for="pizza-creator">Who made this pizza?</label><select id="pizza-creator" name="contestantId" required><option value="">Choose its chef</option>${c.contestants.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><p class="field-help">The chef can’t vote for their own creation.</p><button type="submit" class="button primary full">${icon('plus')}Add to the lineup</button>`); }
function newContestant() { return formShell('PULL UP A CHAIR', 'One more pizza person.', 'Add a chef, a judge, or an enthusiastic taste-tester.', '<label class="field-label" for="new-contestant-name">Contestant name</label><input id="new-contestant-name" name="name" required maxlength="80" placeholder="Their name at the table" autocomplete="off"><p class="field-help">Each contestant needs a unique name.</p><button type="submit" class="button primary full">' + icon('plus') + 'Add to the party</button>', 'people'); }
function unlock(c) { return formShell('FOR THE HOST’S EYES', 'The big reveal awaits.', `Enter the score password for <strong>${esc(c.name)}</strong>.`, '<label class="field-label" for="unlock-password">Score password</label><div class="password-field"><input id="unlock-password" type="password" name="password" required maxlength="128" autocomplete="current-password" placeholder="Your party’s little secret"><button class="password-toggle" type="button" data-action="toggle-password" aria-label="Show password">Show</button></div><p class="field-help">Results lock again when you return to the party.</p><button class="button primary full" type="submit">' + icon('lock') + 'Unlock the scores</button>', 'lock'); }

function vote(c, query) {
  if (!c.pizzas.length) return `${back(competitionPath(), 'Back to the party')}${empty('The oven’s still warming up.', 'Add a pizza before casting the first vote.', `<a class="button primary" href="${competitionPath('pizza')}">Add a pizza</a>`)}`;
  if (c.contestants.length < 2) return `${back(competitionPath(), 'Back to the party')}${empty('Pizza tastes better with company.', 'Add another contestant. A chef can’t vote for their own pizza.', `<a class="button primary" href="${competitionPath('contestant')}">Add a contestant</a>`)}`;
  const preselect = new URLSearchParams(query).get('pizza');
  return `<div class="vote-page">${back(competitionPath(), 'Back to the party')}${heading('TRUST YOUR TASTEBUDS', 'Give this slice some love.', 'Three little scores. One very important opinion.')}<form id="vote-form" class="panel form-panel">${errorSlot()}<div class="vote-selects"><div><label class="field-label" for="voter">Who’s voting?</label><select id="voter" name="voterId" required><option value="">Choose your name</option>${c.contestants.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div><div><label class="field-label" for="vote-pizza">Which pizza?</label><select id="vote-pizza" name="pizzaId" required><option value="">Choose a pizza</option>${c.pizzas.map(p => `<option value="${p.id}" ${p.id === preselect ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div></div><p id="vote-eligibility" class="field-help vote-eligibility" aria-live="polite">One honest vote per pizza. Your own creation sits this one out.</p><div class="rating-fields">${[{ key: 'taste', title: 'Taste', desc: 'That first-bite feeling.', icon: 'heart' }, { key: 'texture', title: 'Texture', desc: 'The crunch. The chew. The crust.', icon: 'leaf' }, { key: 'creativity', title: 'Creativity', desc: 'A little outside the pizza box.', icon: 'spark' }].map(m => `<fieldset class="rating-field"><legend><span class="rating-symbol ${m.key}">${icon(m.icon)}</span><span><strong>${m.title}</strong><span class="rating-description">${m.desc}</span></span></legend><div class="rating-options">${[1, 2, 3, 4, 5].map(n => `<label class="rating-option"><input type="radio" name="${m.key}" value="${n}" required aria-label="${m.title}: ${n} out of 5"><span>${n}</span></label>`).join('')}</div><div class="rating-scale"><span>Needs a little love</span><span>Pizza perfection</span></div></fieldset>`).join('')}</div><div class="vote-submit-row"><p>${icon('lock')} Your scores stay secret<br>until the host reveals them.</p><button class="button primary" type="submit">Submit my vote ${icon('check')}</button></div><p class="vote-final-note">Give your scores a quick check. Submitted votes are final.</p></form></div>`;
}

const resultTabs = [{ key: 'accolades', title: 'Accolades', icon: 'trophy', text: 'A toast to the standout slices.' }, { key: 'totals', title: 'Score Totals', icon: 'table', text: 'Every pizza, every average.' }, { key: 'distributions', title: 'Score Distributions', icon: 'chart', text: 'See how the table voted.' }, { key: 'voters', title: 'Voter Data', icon: 'people', text: 'Every judge’s tasting notes.' }];
function results(c, tab) {
  const scores = summarize(c);
  return `${back(competitionPath(), 'Lock scores & return to party')}${heading('THE DELICIOUS TRUTH', esc(c.name), 'The votes are in. Let’s give these pizzas their moment.', '<button class="button secondary" type="button" data-action="lock">' + icon('lock') + 'Lock scores</button>')}<div class="results-banner"><span>${icon('trophy')} The results table</span><p>${plural(c.pizzas.length, 'pizza')} <span>·</span> ${plural(c.votes.length, 'vote')} <span>·</span> Averages out of 5</p></div>${!tab ? `<div class="results-menu">${resultTabs.map((t, i) => actionCard(competitionPath('results/' + t.key), t.icon, t.title, t.text, ['butter', 'sage', 'peach', 'pink'][i])).join('')}</div><div class="results-menu-art"><img src="/assets/pizza-party.svg" width="350" height="249" alt="Happy pizza champions"><p>Small slices. Big feelings.</p></div>` : `<nav class="result-tabs" aria-label="Result views">${resultTabs.map(t => `<a href="${competitionPath('results/' + t.key)}" ${tab === t.key ? 'aria-current="page"' : ''}>${icon(t.icon)}${t.title}</a>`).join('')}</nav><section class="results-content">${tab === 'accolades' ? accoladeView(scores) : tab === 'totals' ? totalsView(scores) : tab === 'distributions' ? distributionView(c) : votersView(c)}</section>`}`;
}
function accoladeView(scores) {
  const awards = accolades(scores);
  const symbols = ['heart', 'leaf', 'spark', 'trophy', 'pizza'];
  return `<div class="section-intro"><h2>A round of a-pizza-use.</h2><p>Ties share the spotlight. Pizzas need at least one vote to earn an accolade.</p></div><div class="accolade-grid">${awards.map((a, i) => `<article class="award-card award-${i}"><span class="award-icon">${icon(symbols[i])}</span><span class="eyebrow">${i === 3 ? 'THE TABLE’S FAVORITE' : i === 4 ? 'A LOVABLE UNDERDOG' : 'A SLICE ABOVE'}</span><h3>${esc(a.label)}</h3><div class="award-winners">${a.winners.length ? a.winners.map(w => `<div><h4>${esc(w.name)}</h4><p>by ${esc(w.creatorName)}</p></div>`).join('') : '<h4>Still in the oven…</h4><p>Waiting for the first vote.</p>'}</div>${a.winners.length ? `<span class="award-score">${average(a.winners[0][['taste', 'texture', 'creativity', 'overall', 'overall'][i]])} <small>/ 5</small></span>` : ''}<p class="award-explanation">${esc(a.description)}${a.winners.length > 1 ? ' · Shared award' : ''}</p></article>`).join('')}</div><p class="results-note">${icon('heart')} Dishonorable Mention is served with love. There’s always a next pizza.</p>`;
}
function totalsView(scores) {
  const sorted = [...scores].sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));
  return `<div class="section-intro"><h2>Every slice, by the numbers.</h2><p>Overall is the average of Taste, Texture, and Creativity. Each vote counts equally.</p></div>${scores.length ? `<div class="panel table-wrap"><table class="scores-table"><thead><tr><th scope="col">Pizza / Chef</th><th scope="col">Votes</th>${METRICS.map(m => `<th scope="col" ${m.key === 'overall' ? 'class="overall-column"' : ''}>${esc(m.label)}</th>`).join('')}</tr></thead><tbody>${sorted.map(p => `<tr><th scope="row"><span class="table-pizza-name">${esc(p.name)}</span><span class="table-subtitle">${esc(p.creatorName)}</span></th><td>${p.voteCount}</td>${METRICS.map(m => `<td ${m.key === 'overall' ? 'class="overall-column"' : ''}>${average(p[m.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="results-note">— means no votes yet. Unscored pizzas aren’t ranked or awarded. Averages are displayed to two decimal places.</p>` : empty('No pizzas on the table yet.', 'Return to the party to add your first pizza.')}`;
}
function histogram(votes, metric, id) {
  const bins = distribution(votes, metric.key);
  const max = Math.max(1, ...bins.map(b => b.count));
  const step = Math.max(1, Math.ceil(max / 4));
  const ceiling = Math.ceil(max / step) * step;
  const left = 34, top = 22, bottom = 158, width = 300, band = width / bins.length;
  const description = bins.filter(b => b.count).map(b => `${Number(b.score.toFixed(2))}: ${plural(b.count, 'vote')}`).join('; ') || 'No votes yet';
  let grid = '';
  for (let n = 0; n <= ceiling; n += step) { const y = bottom - (bottom - top) * n / ceiling; grid += `<line x1="${left}" x2="${left + width}" y1="${y}" y2="${y}" class="chart-grid"/><text x="${left - 9}" y="${y + 3}" text-anchor="end" class="chart-tick">${n}</text>`; }
  return `<figure class="histogram"><figcaption><strong>${metric.label}</strong><span>${metric.key === 'overall' ? 'Average per vote' : 'Score per vote'}</span></figcaption><svg viewBox="0 0 350 205" role="img" aria-labelledby="chart-${id}-${metric.key}"><title id="chart-${id}-${metric.key}">${metric.label} distribution. ${esc(description)}. Horizontal axis: score. Vertical axis: number of votes.</title>${grid}${bins.map((b, i) => { const height = (bottom - top) * b.count / ceiling; const x = left + i * band + band * .16; const cx = left + (i + .5) * band; return `<rect class="bar bar-${metric.key}" x="${x}" y="${bottom - height}" width="${band * .68}" height="${height}" rx="3"><title>Score ${Number(b.score.toFixed(2))}: ${plural(b.count, 'vote')}</title></rect>${b.count ? `<text x="${cx}" y="${bottom - height - 6}" text-anchor="middle" class="bar-count">${b.count}</text>` : ''}<text x="${cx}" y="174" text-anchor="${bins.length > 5 ? 'end' : 'middle'}" ${bins.length > 5 ? `transform="rotate(-40 ${cx} 174)"` : ''} class="chart-tick">${Number(b.score.toFixed(2))}</text>`; }).join('')}<text x="8" y="12" class="chart-axis">Votes</text><text x="334" y="201" text-anchor="end" class="chart-axis">Score</text></svg></figure>`;
}
function distributionView(c) {
  return `<div class="section-intro"><h2>A taste for the details.</h2><p>Each bar counts votes at that score. Overall uses each voter’s three-category average, so every ballot contributes exactly once.</p></div>${c.pizzas.length ? `<div class="filter-row"><label for="pizza-filter">Show pizza</label><select id="pizza-filter"><option value="all">All pizzas</option>${c.pizzas.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div><div class="distribution-list">${c.pizzas.map(p => { const votes = c.votes.filter(v => v.pizzaId === p.id); return `<article class="panel distribution-card" data-pizza-chart="${p.id}"><div class="distribution-heading"><div><h3>${esc(p.name)}</h3><p>by ${esc(c.contestants.find(x => x.id === p.contestantId)?.name)}</p></div><span class="count-badge">${plural(votes.length, 'vote')}</span></div>${votes.length ? `<div class="chart-grid-layout">${METRICS.map(m => histogram(votes, m, p.id)).join('')}</div>` : '<div class="chart-empty">No votes yet — this pizza’s story is still being written.</div>'}</article>`; }).join('')}</div><p class="results-note">Overall scores occur in thirds (for example, 3.33 = 10 ÷ 3). Axis labels are rounded; votes are grouped using their exact total.</p>` : empty('A little quiet in the kitchen.', 'Add pizzas and cast votes to see their distributions.')}`;
}
function votersView(c) { return `<div class="section-intro"><h2>Notes from around the table.</h2><p>Every contestant’s submitted votes, with their average across all three categories.</p></div><div class="voter-list">${c.contestants.map((v, i) => { const rows = voterRows(c, v.id); return `<article class="panel voter-card"><div class="voter-heading"><span class="avatar avatar-${i % 4}">${esc(v.name.slice(0, 1).toUpperCase())}</span><h3>${esc(v.name)}</h3><span class="count-badge">${plural(rows.length, 'vote')}</span></div>${rows.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">Pizza</th>${METRICS.map(m => `<th scope="col">${m.label}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr><th scope="row">${esc(r.pizzaName)}</th><td>${r.taste}</td><td>${r.texture}</td><td>${r.creativity}</td><td class="overall-column">${average(r.overall)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="no-votes">No votes cast yet. There’s still tasting to do!</p>'}</article>`; }).join('')}</div>`; }

async function render() {
  const sequence = ++state.sequence;
  const hash = location.hash.slice(1) || 'home';
  if (hash === 'main') { navigate('#home'); return; }
  const [path, query = ''] = hash.split('?'); const segments = path.split('/');
  const isResults = segments[0] === 'competition' && segments[2] === 'results';
  if (state.token && (!isResults || segments[1] !== state.tokenCompetition)) lockResults();
  state.route = path;
  try {
    let content;
    if (path === 'home' || path === 'resume') { const { competitions } = await api('/competitions'); if (sequence !== state.sequence) return; content = path === 'home' ? home(competitions) : resume(competitions); }
    else if (path === 'new') content = setup();
    else if (segments[0] === 'competition' && segments[1]) {
      const { competition } = await api(`/competitions/${segments[1]}`); if (sequence !== state.sequence) return; state.competition = competition;
      const screen = segments[2] || '';
      if (screen === 'results') {
        if (!state.token || state.tokenCompetition !== competition.id) { navigate(competitionPath('unlock')); return; }
        try { const data = await api(`/competitions/${competition.id}/results`, { headers: { Authorization: `Bearer ${state.token}` } }); if (sequence !== state.sequence) return; state.resultCompetition = data.competition; content = results(data.competition, segments[3]); }
        catch (error) { if (error.status === 401 || error.status === 403) { await lockResults(); notify('Your results session has locked. Enter the password to continue.'); navigate(competitionPath('unlock')); return; } throw error; }
      } else content = screen === 'pizza' ? newPizza(competition) : screen === 'contestant' ? newContestant() : screen === 'unlock' ? unlock(competition) : screen === 'vote' ? vote(competition, query) : hub(competition);
    } else { navigate('#home'); return; }
    if (sequence !== state.sequence) return;
    main.innerHTML = content; main.className = path === 'home' ? 'home-main' : '';
    document.title = `${state.competition && segments[0] === 'competition' ? state.competition.name + ' · ' : ''}PizzaOff`;
    window.scrollTo({ top: 0, behavior: 'instant' }); main.focus({ preventScroll: true });
    if (document.querySelector('#vote-form')) updateVoteEligibility();
  } catch (error) { if (sequence !== state.sequence) return; main.innerHTML = `${back('#home', 'Back home')}<div class="error-page">${icon('pizza')}<h1>The oven hit a little snag.</h1><p>${esc(error.message)}</p><button class="button primary" data-action="retry">Try again</button></div>`; }
}

function updateVoteEligibility() {
  const form = document.querySelector('#vote-form'); if (!form) return;
  const c = state.competition, voterId = form.elements.voterId.value, select = form.elements.pizzaId;
  let eligible = 0;
  for (const option of select.options) {
    if (!option.value) continue;
    const p = c.pizzas.find(x => x.id === option.value);
    const own = p.contestantId === voterId, voted = c.votes.some(v => v.pizzaId === p.id && v.voterId === voterId);
    option.disabled = !!voterId && (own || voted); if (!option.disabled) eligible++;
    option.textContent = p.name + (own ? ' — your pizza' : voted ? ' — already voted' : '');
  }
  if (select.selectedOptions[0]?.disabled) select.value = '';
  const help = document.querySelector('#vote-eligibility');
  help.textContent = !voterId ? 'One honest vote per pizza. Your own creation sits this one out.' : eligible ? `${plural(eligible, 'pizza')} available for your vote. Your pizzas and completed votes are unavailable.` : 'You’re all caught up! You’ve voted on every eligible pizza.';
  form.querySelector('[type="submit"]').disabled = !!voterId && eligible === 0;
}

main.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action;
  if (action === 'add-name') { const container = document.querySelector('#contestant-inputs'); const next = Math.max(...[...container.querySelectorAll('input')].map(x => Number(x.id.split('-').pop())), 0) + 1; container.insertAdjacentHTML('beforeend', contestantInput(next)); container.lastElementChild.querySelector('input').focus(); }
  else if (action === 'remove-name') { const rows = document.querySelectorAll('.contestant-input-row'); if (rows.length === 1) { rows[0].querySelector('input').value = ''; rows[0].querySelector('input').focus(); } else { button.closest('.contestant-input-row').remove(); const first = document.querySelector('.contestant-input-row input'); first.required = true; document.querySelector('.field-heading label').htmlFor = first.id; first.focus(); } }
  else if (action === 'toggle-password') { const input = button.parentElement.querySelector('input'); input.type = input.type === 'password' ? 'text' : 'password'; button.textContent = input.type === 'password' ? 'Show' : 'Hide'; button.setAttribute('aria-label', input.type === 'password' ? 'Show password' : 'Hide password'); }
  else if (action === 'lock') { await lockResults(); navigate(competitionPath()); }
  else if (action === 'retry') render();
});
main.addEventListener('change', event => {
  if (event.target.id === 'voter') updateVoteEligibility();
  if (event.target.id === 'pizza-filter') document.querySelectorAll('[data-pizza-chart]').forEach(el => { el.hidden = event.target.value !== 'all' && el.dataset.pizzaChart !== event.target.value; });
});
main.addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target; const data = new FormData(form); const submit = form.querySelector('[type="submit"]'); if (submit.disabled) return;
  const competitionId = state.competition?.id, sequence = state.sequence, submittedHash = location.hash;
  const stillCurrent = () => sequence === state.sequence && submittedHash === location.hash && form.isConnected;
  submit.disabled = true; const oldText = submit.innerHTML; submit.textContent = 'Just a moment…';
  form.querySelector('.form-error').hidden = true;
  try {
    if (form.id === 'setup-form') {
      const contestants = data.getAll('contestant').map(x => x.trim()).filter(Boolean);
      const { competition } = await post('/competitions', { name: data.get('name').trim(), contestants, password: data.get('password') }); if (!stillCurrent()) return; state.competition = competition; notify('Your party is ready. Let the pizza-off begin!'); navigate(competitionPath());
    } else if (form.id === 'unlock-form') {
      const { token } = await post(`/competitions/${competitionId}/unlock`, { password: data.get('password') }); if (!stillCurrent()) { void post(`/competitions/${competitionId}/lock`, {}, { Authorization: `Bearer ${token}` }).catch(() => {}); return; } state.token = token; state.tokenCompetition = competitionId; navigate(competitionPath('results'));
    } else {
      const endpoint = form.id === 'pizza-form' ? 'pizzas' : form.id === 'contestant-form' ? 'contestants' : 'votes';
      const body = endpoint === 'pizzas' ? { name: data.get('name').trim(), contestantId: data.get('contestantId') } : endpoint === 'contestants' ? { name: data.get('name').trim() } : { pizzaId: data.get('pizzaId'), voterId: data.get('voterId'), ...Object.fromEntries(['taste', 'texture', 'creativity'].map(key => [key, Number(data.get(key))])) };
      const { competition } = await post(`/competitions/${competitionId}/${endpoint}`, body); if (!stillCurrent()) return; state.competition = competition;
      notify(endpoint === 'pizzas' ? 'Fresh from the oven! Your pizza is in the lineup.' : endpoint === 'contestants' ? 'A new face at the table. Welcome!' : 'Vote saved. A little love for a little slice.'); navigate(competitionPath());
    }
  } catch (error) { if (stillCurrent()) showError(form, error.name === 'TimeoutError' ? 'The oven took too long to respond. Please try again.' : error.message); }
  finally { submit.disabled = false; submit.innerHTML = oldText; }
});
window.addEventListener('hashchange', render);
document.querySelector('.skip-link').addEventListener('click', event => { event.preventDefault(); main.focus(); });
render();

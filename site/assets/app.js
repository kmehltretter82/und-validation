import {normalizeIndex, filterItems, choices} from './model.js';

const $ = id => document.getElementById(id);
const tabs = [...document.querySelectorAll('[role="tab"]')];
let index = null, view = 'tasks';
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
const link = (label, href, cls) => { const a = el('a', cls, label); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };

function date(value) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toLocaleString(undefined, {dateStyle:'medium', timeStyle:'short'});
}

function selectOptions(select, values, first, emptyLabel) {
  const previous = select.value;
  select.replaceChildren(new Option(first, ''));
  for (const v of values) select.add(new Option(v === '__none__' ? emptyLabel : v, v));
  if (values.includes(previous)) select.value = previous;
}

function renderCard(item) {
  const card = el('article', 'result-card');
  const meta = el('div', 'result-meta');
  if (item.status) meta.append(el('span', item.status === 'Proved' ? 'pill pill-green' : 'pill', item.status));
  for (const topic of item.topics) meta.append(el('span', 'topic', topic));
  card.append(meta);
  const title = el('h3', 'result-title'); title.append(link(item.title, item.url)); card.append(title);
  if (item.description) card.append(el('p', 'result-description', item.description));
  if (item.statement) card.append(el('pre', 'statement', item.statement));
  if (view === 'results') card.append(el('p', 'result-description', `Source: ${item.citation}`));
  const bottom = el('div', 'result-bottom');
  if (view === 'results') {
    bottom.append(el('span', 'dependencies', item.axioms.length ? `Axioms: ${item.axioms.join(', ')}` : 'No axiom dependencies'));
    if (item.contributor) bottom.append(el('span', 'contributor', `By ${item.contributor}`));
    bottom.append(link('Lean source ↗', item.url, 'evidence-link'));
    bottom.append(link('Verification evidence ↗', item.auditUrl, 'evidence-link'));
  } else bottom.append(link('View task ↗', item.url, 'evidence-link'));
  card.append(bottom); return card;
}

function render() {
  const panel = $('explore-results');
  $('axiom').hidden = view !== 'results';
  if (!index) return;
  panel.replaceChildren();
  const sectionStatus = view === 'tasks' ? index.taskStatus : index.resultStatus;
  if (sectionStatus !== 'ok') {
    const label = view === 'tasks' ? 'Task snapshot' : 'Verification evidence';
    $('index-status').textContent = `${label} ${sectionStatus === 'not-generated' ? 'has not been generated yet' : 'is unavailable'}.`;
    const empty = el('div', 'empty-state');
    empty.append(el('span', 'empty-symbol', view === 'tasks' ? '∅' : '∴'));
    empty.append(el('h3', null, `${label} ${sectionStatus === 'not-generated' ? 'is not available yet' : 'is unavailable'}`));
    empty.append(el('p', null, 'Visit the library on GitHub for the latest project activity.'));
    empty.append(link('Visit tndlib ↗', 'https://github.com/kmehltretter82/tnd-validation', 'inline-link'));
    panel.append(empty); return;
  }
  const items = index[view];
  selectOptions($('topic'), choices(items, 'topics'), 'All topics');
  selectOptions($('status'), choices(items, 'status'), 'All states');
  const axiomValues = choices(items, 'axioms');
  if (items.some(x => !x.axioms.length)) axiomValues.unshift('__none__');
  selectOptions($('axiom'), axiomValues, 'All dependencies', 'No axiom dependencies');
  const filtered = filterItems(items, $('search').value, $('topic').value, $('status').value, $('axiom').value);
  if (filtered.length) filtered.forEach(item => panel.append(renderCard(item)));
  else {
    const empty = el('div', 'empty-state');
    empty.append(el('span', 'empty-symbol', view === 'tasks' ? '∅' : '∴'));
    const hasFilter = $('search').value || $('topic').value || $('status').value || (view === 'results' && $('axiom').value);
    empty.append(el('h3', null, hasFilter ? 'No matching entries' : view === 'tasks' ? 'No tasks in the index yet' : 'No verified results in the index yet'));
    empty.append(el('p', null, hasFilter ? 'Try a different search or filter.' : view === 'tasks' ? 'Check GitHub for the latest project activity or propose a result.' : 'Results will appear here once their verification evidence is available.'));
    if (!hasFilter && view === 'tasks') empty.append(link('Explore GitHub issues ↗', 'https://github.com/kmehltretter82/tnd-validation/issues', 'inline-link'));
    panel.append(empty);
  }
  $('index-status').textContent = `${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'} shown`;
}

tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => {
    view = tab.dataset.view; tabs.forEach(t => { const active = t === tab; t.classList.toggle('is-active', active); t.setAttribute('aria-selected', String(active)); t.tabIndex = active ? 0 : -1; });
    $('explore-results').setAttribute('aria-labelledby', tab.id);
    $('search').value = ''; $('topic').value = ''; $('status').value = ''; $('axiom').value = ''; render();
  });
  tab.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus(); tabs[next].click();
  });
});
for (const id of ['search','topic','status','axiom']) $(id).addEventListener(id === 'search' ? 'input' : 'change', render);

try {
  const response = await fetch(new URL('../data/index.json', import.meta.url), {cache:'no-cache'});
  if (!response.ok) throw new Error('Index unavailable');
  index = normalizeIndex(await response.json());
  $('tasks-count').textContent = index.taskStatus === 'ok' ? index.tasks.length : '—';
  $('results-count').textContent = index.resultStatus === 'ok' ? index.results.length : '—';
  const updated = date(index.generatedAt), taskTime = date(index.taskGeneratedAt);
  $('index-time').textContent = updated ? `Index generated ${updated}${taskTime ? ` · Tasks as of ${taskTime}` : ''}` : 'Index has not been generated yet';
  render();
} catch {
  $('index-status').textContent = 'The public index is unavailable.';
  const empty = el('div', 'empty-state'); empty.append(el('h3', null, 'We could not load the library index.'), el('p', null, 'You can still explore the project on GitHub.'), link('Visit tndlib ↗', 'https://github.com/kmehltretter82/tnd-validation', 'inline-link'));
  $('explore-results').replaceChildren(empty); $('index-time').textContent = 'Index unavailable';
}

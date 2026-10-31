import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boot} from './dom-harness.js';

const revision = 'a'.repeat(40);
const provenance = () => ({toolchain:'leanprover/lean4:v4.35.0',comparator_revision:'e3dcf3083fc53d44b27a4431fabf7d43181583f5',
  exporter_revision:'5a9a355dc6c5fd82b69058d433e2ae2e8dfbf8fe',build_image:'ubuntu@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac',
  resource_boundary:'host-tmpfs-v1',resource_limits:{schema_version:1,build_bytes:2*1024**3,build_inodes:200000,export_bytes:256*1024**2,export_inodes:4096},
  evidence_profile:'production-evidence-v1',source_binding_validated:true,resource_boundary_validated:true,
  inventory_sha256:'b'.repeat(64),checker_sha256:'c'.repeat(64),exporter_sha256:'d'.repeat(64),
  export_sha256:{base:'e'.repeat(64),head:'e'.repeat(64)},admission_policy_sha256:'f'.repeat(64),admission_parser_sha256:'1'.repeat(64),
  admission_parser_isolation:'native-linux-validated-v1',checker_isolation:'native-linux-validated-v1',source_blob_sha256:'2'.repeat(64)});
const task = (title, number, topics = ['Logic'], status = 'available') => ({
  title, url:`https://github.com/kmehltretter82/tnd-validation/issues/${number}`, topics, status,
  statement:'P → P', description:'A constructive task'
});
const result = (name = 'TNDLib.identity', axioms = []) => ({
  name, statement:'P → P', description:'An audited result', topics:['Logic'], contributor:'Ada', citation:'Original constructive identity proof.', axioms,
  source_url:`https://github.com/kmehltretter82/tnd-validation/blob/${revision}/TNDLib/Logic.lean`,
  evidence:{verified:true, source_commit:revision, audit_commit:revision,
    url:'https://github.com/kmehltretter82/tnd-validation/actions/runs/123',...provenance()}
});
const data = () => ({schema_version:1, generated_at:'2026-10-29T00:00:00Z',
  library:{repository:'kmehltretter82/tnd-validation',revision},
  tasks:{status:'ok',generated_at:'2026-10-29T01:00:00Z',items:[task('Identity',1), task('List split',2,['Lists'],'claimed')]},
  results:{status:'ok',items:[result(), result('TNDLib.extensionality',['propext'])]}
});

test('loads relative index and applies search, topic, and state filters', async () => {
  const app = await boot(data());
  try {
    assert.match(app.requested[0], /\/site\/data\/index\.json$/);
    assert.equal(app.get('tasks-count').textContent, '2');
    assert.equal(app.get('index-status').getAttribute('role'), 'status');
    assert.match(app.get('explore-results').textContent, /Identity/);
    app.get('search').value = 'split'; app.get('search').dispatch('input');
    assert.equal(app.get('index-status').textContent, '1 entry shown');
    assert.doesNotMatch(app.get('explore-results').textContent, /Identity/);
    app.get('search').value = ''; app.get('search').dispatch('input');
    app.get('topic').value = 'Logic'; app.get('topic').dispatch('change');
    app.get('status').value = 'claimed'; app.get('status').dispatch('change');
    assert.match(app.get('explore-results').textContent, /No matching entries/);
    assert.equal(app.get('topic').value, 'Logic');
  } finally { app.restore(); }
});

test('tabs implement arrow, Home, End, active focus, and axiom filtering', async () => {
  const app = await boot(data());
  try {
    assert.equal(app.get('axiom').hidden, true);
    assert.equal(app.get('tab-tasks').dispatch('keydown',{key:'ArrowRight'}).defaultPrevented, true);
    assert.equal(app.document.activeElement, app.get('tab-results'));
    assert.equal(app.get('tab-results').getAttribute('aria-selected'), 'true');
    assert.equal(app.get('tab-tasks').tabIndex, -1);
    assert.equal(app.get('tab-results').tabIndex, 0);
    assert.equal(app.get('explore-results').getAttribute('aria-labelledby'), 'tab-results');
    assert.equal(app.get('axiom').hidden, false);
    app.get('axiom').value = '__none__'; app.get('axiom').dispatch('change');
    assert.equal(app.get('index-status').textContent, '1 entry shown');
    assert.match(app.get('explore-results').textContent, /No axiom dependencies/);
    app.get('tab-results').dispatch('keydown',{key:'Home'});
    assert.equal(app.document.activeElement, app.get('tab-tasks'));
    assert.equal(app.get('axiom').value, '');
    app.get('tab-tasks').dispatch('keydown',{key:'End'});
    assert.equal(app.document.activeElement, app.get('tab-results'));
    app.get('tab-results').dispatch('keydown',{key:'ArrowRight'});
    assert.equal(app.document.activeElement, app.get('tab-tasks'));
  } finally { app.restore(); }
});

test('result cards explain and attribute the result and separate exact Lean source from audit evidence', async () => {
  const raw = data(); raw.results.items = [result()];
  const app = await boot(raw);
  try {
    app.get('tab-results').click();
    const panel = app.get('explore-results');
    assert.match(panel.textContent, /An audited result/);
    assert.match(panel.textContent, /By Ada/);
    assert.match(panel.textContent, /Source: Original constructive identity proof\./);
    assert.match(panel.textContent, /P → P/);
    const anchors = app.nodes(panel).filter(x => x.tagName === 'A');
    const source = anchors.find(x => x.textContent === 'Lean source ↗');
    const evidence = anchors.find(x => x.textContent === 'Verification evidence ↗');
    assert.ok(source); assert.ok(evidence);
    assert.equal(source.href, raw.results.items[0].source_url);
    assert.equal(evidence.href, raw.results.items[0].evidence.url);
    assert.notEqual(source.href, evidence.href);
    assert.equal(source.rel, 'noopener noreferrer');
  } finally { app.restore(); }
});

test('result explanation, attribution, and citation remain text', async () => {
  const raw = data(), payload = '<img src=x onerror="alert(1)">';
  const safe = result(); safe.description = payload; safe.contributor = payload; safe.citation = payload;
  raw.results.items = [safe];
  const app = await boot(raw);
  try {
    app.get('tab-results').click();
    const panel = app.get('explore-results'), nodes = app.nodes(panel);
    assert.equal(app.get('results-count').textContent, '1');
    assert.match(panel.textContent, /By <img src=x/);
    assert.match(panel.textContent, /Source: <img src=x/);
    assert.doesNotMatch(panel.textContent, /no-description|no-contributor|no-citation/);
    assert.equal(nodes.filter(x => x.tagName === 'IMG' || x.tagName === 'SCRIPT').length, 0);
    assert.equal(nodes.filter(x => x.tagName === 'ARTICLE').length, 1);
  } finally { app.restore(); }
});

test('malformed result metadata makes evidence unavailable rather than apparently empty', async () => {
  const raw = data();
  const noDescription = result('no-description'); delete noDescription.description;
  const noContributor = result('no-contributor'); noContributor.contributor = '  ';
  const noCitation = result('no-citation'); delete noCitation.citation;
  raw.results.items = [result('otherwise-valid'), noDescription, noContributor, noCitation];
  const app = await boot(raw);
  try {
    app.get('tab-results').click();
    assert.equal(app.get('results-count').textContent, '—');
    assert.match(app.get('index-status').textContent, /unavailable/);
    assert.doesNotMatch(app.get('explore-results').textContent, /No verified results/);
    assert.equal(app.nodes(app.get('explore-results')).filter(x => x.tagName === 'ARTICLE').length, 0);
  } finally { app.restore(); }
});

test('a valid empty index distinguishes empty tasks from unverified results', async () => {
  const raw = data(); raw.tasks.items = []; raw.results.items = [];
  const app = await boot(raw);
  try {
    assert.match(app.get('explore-results').textContent, /No tasks in the index yet/);
    app.get('tab-results').click();
    assert.match(app.get('explore-results').textContent, /No verified results in the index yet/);
    assert.equal(app.get('results-count').textContent, '0');
    assert.doesNotMatch(app.get('explore-results').textContent, /Verification evidence/);
  } finally { app.restore(); }
});

for (const [name, raw, options] of [
  ['network failure', data(), {failure:true}],
  ['HTTP failure', data(), {status:503}],
  ['invalid schema', {}, {}]
]) test(`${name} retains recovery guidance after tab and filter interaction`, async () => {
  const app = await boot(raw, options);
  try {
    for (const action of [() => {}, () => app.get('tab-results').click(),
      () => { app.get('search').value='something'; app.get('search').dispatch('input'); },
      () => app.get('topic').dispatch('change')]) {
      action();
      assert.match(app.get('explore-results').textContent, /Visit tndlib/);
      assert.match(app.get('index-status').textContent, /unavailable/);
      assert.doesNotMatch(app.get('explore-results').textContent, /Verification evidence/);
    }
  } finally { app.restore(); }
});

test('untrusted content renders as text and generated links remain safe', async () => {
  const raw = data(), payload = '<img src=x onerror="alert(1)">';
  raw.tasks.items = [task(payload, 1, [payload])];
  raw.tasks.items[0].description = payload; raw.tasks.items[0].statement = payload;
  const app = await boot(raw);
  try {
    assert.match(app.get('explore-results').textContent, /<img src=x/);
    const nodes = app.nodes(app.get('explore-results'));
    assert.equal(nodes.filter(x => x.tagName === 'IMG' || x.tagName === 'SCRIPT').length, 0);
    for (const a of nodes.filter(x => x.tagName === 'A')) {
      assert.equal(new URL(a.href).hostname, 'github.com');
      assert.equal(new URL(a.href).protocol, 'https:');
      assert.equal(a.rel, 'noopener noreferrer');
    }
  } finally { app.restore(); }
});

test('a partial task snapshot failure is distinguished from a verified empty snapshot', async () => {
  const raw = data(); raw.tasks = {status:'unavailable',generated_at:null,items:[]};
  const app = await boot(raw);
  try {
    assert.equal(app.get('tasks-count').textContent, '—');
    assert.match(app.get('explore-results').textContent, /unavailable/i);
    assert.doesNotMatch(app.get('explore-results').textContent, /No tasks in the index yet/);
    app.get('tab-results').click();
    assert.equal(app.nodes(app.get('explore-results')).filter(x => x.tagName === 'ARTICLE').length, 2);
  } finally { app.restore(); }
});

test('a partial results failure does not claim that the results snapshot is empty', async () => {
  const raw = data(); raw.results = {status:'unavailable',items:[]};
  const app = await boot(raw);
  try {
    assert.equal(app.get('results-count').textContent, '—');
    app.get('tab-results').click();
    assert.match(app.get('explore-results').textContent, /unavailable/i);
    assert.equal(app.nodes(app.get('explore-results')).filter(x => x.className === 'evidence-link').length, 0);
    app.get('tab-tasks').click();
    assert.equal(app.nodes(app.get('explore-results')).filter(x => x.tagName === 'ARTICLE').length, 2);
  } finally { app.restore(); }
});

test('bootstrap sections are not-generated rather than empty or verified', async () => {
  const raw = data(); raw.generated_at = null; raw.library.revision = null;
  raw.tasks = {status:'not-generated',generated_at:null,items:[]};
  raw.results = {status:'not-generated',items:[]};
  const app = await boot(raw);
  try {
    assert.equal(app.get('tasks-count').textContent, '—');
    assert.equal(app.get('results-count').textContent, '—');
    assert.match(app.get('index-time').textContent, /not been generated yet/);
    for (const tab of ['tab-tasks','tab-results']) {
      app.get(tab).click();
      assert.match(app.get('index-status').textContent, /not been generated yet/);
      assert.match(app.get('explore-results').textContent, /not available yet/);
      assert.match(app.get('explore-results').textContent, /Visit tndlib/);
      assert.equal(app.nodes(app.get('explore-results')).filter(x => x.tagName === 'ARTICLE').length, 0);
    }
  } finally { app.restore(); }
});

test('unverified, stale, or prohibited-axiom records make evidence unavailable', async () => {
  const raw = data();
  const unverified = result('unverified'); unverified.evidence.verified = false;
  const stale = result('stale'); stale.evidence.audit_commit = 'b'.repeat(40);
  const missing = result('missing'); delete missing.evidence;
  raw.results.items = [result('accepted'),unverified,stale,missing,result('classical',['Classical.choice'])];
  const app = await boot(raw);
  try {
    app.get('tab-results').click();
    assert.equal(app.get('results-count').textContent, '—');
    assert.match(app.get('explore-results').textContent, /unavailable/);
    assert.doesNotMatch(app.get('explore-results').textContent, /accepted|unverified|stale|missing|classical/);
    assert.equal(app.nodes(app.get('explore-results')).filter(x => x.tagName === 'ARTICLE').length, 0);
  } finally { app.restore(); }
});

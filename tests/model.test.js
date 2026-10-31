import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeIndex, filterItems} from '../site/assets/model.js';

const sha = 'a'.repeat(40);
const provenance = () => ({toolchain:'leanprover/lean4:v4.35.0',comparator_revision:'e3dcf3083fc53d44b27a4431fabf7d43181583f5',
  exporter_revision:'5a9a355dc6c5fd82b69058d433e2ae2e8dfbf8fe',build_image:'ubuntu@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac',
  resource_boundary:'host-tmpfs-v1',resource_limits:{schema_version:1,build_bytes:2*1024**3,build_inodes:200000,export_bytes:256*1024**2,export_inodes:4096},
  evidence_profile:'production-evidence-v1',source_binding_validated:true,resource_boundary_validated:true,
  inventory_sha256:'b'.repeat(64),checker_sha256:'c'.repeat(64),exporter_sha256:'d'.repeat(64),
  export_sha256:{base:'e'.repeat(64),head:'e'.repeat(64)},admission_policy_sha256:'f'.repeat(64),admission_parser_sha256:'1'.repeat(64),
  admission_parser_isolation:'native-linux-validated-v1',checker_isolation:'native-linux-validated-v1',source_blob_sha256:'2'.repeat(64)});
const base = () => ({schema_version:1,generated_at:'2026-10-29T00:00:00Z',library:{repository:'kmehltretter82/tnd-validation',revision:sha},tasks:{generated_at:null,items:[]},results:{items:[]}});
const result = () => ({name:'TNDLib.example',statement:'True',description:'Truth holds constructively.',contributor:'Ada',citation:'Original formalization of constructive truth.',axioms:[],topics:['Logic'],source_url:`https://github.com/kmehltretter82/tnd-validation/blob/${sha}/TNDLib/Logic.lean`,evidence:{verified:true,source_commit:sha,audit_commit:sha,url:'https://github.com/kmehltretter82/tnd-validation/actions/runs/123',...provenance()}});

test('requires a well-formed versioned index for the expected repository', () => {
  assert.throws(() => normalizeIndex(null));
  const index = base(); index.library.repository = 'someone/else';
  assert.throws(() => normalizeIndex(index));
});

test('preserves unavailable section states separately from empty results', () => {
  const value = base();
  value.tasks.status = 'unavailable'; value.results.status = 'not-generated';
  const actual = normalizeIndex(value);
  assert.equal(actual.taskStatus, 'unavailable');
  assert.equal(actual.resultStatus, 'not-generated');
});

test('accepts only evidence and source tied to the exact indexed revision', () => {
  const index = base(); index.results.items.push(result());
  assert.equal(normalizeIndex(index).results.length, 1);
  index.results.items[0].evidence.audit_commit = 'b'.repeat(40);
  assert.equal(normalizeIndex(index).resultStatus, 'unavailable');
  index.results.items[0].evidence.audit_commit = sha;
  index.results.items[0].source_url = `https://github.com/kmehltretter82/tnd-validation/blob/${'b'.repeat(40)}/TNDLib/Logic.lean`;
  assert.equal(normalizeIndex(index).resultStatus, 'unavailable');
});

test('requires complete production audit provenance for every public result', () => {
  const fields = ['toolchain','comparator_revision','exporter_revision','build_image','resource_boundary',
    'resource_limits','inventory_sha256','checker_sha256','exporter_sha256','export_sha256',
    'evidence_profile','source_binding_validated','resource_boundary_validated',
    'admission_policy_sha256','admission_parser_sha256','admission_parser_isolation','checker_isolation','source_blob_sha256'];
  for (const field of fields) {
    const index = base(); const item = result(); delete item.evidence[field]; index.results.items.push(item);
    assert.equal(normalizeIndex(index).resultStatus, 'unavailable', field);
  }
  for (const mutate of [
    e => { e.exporter_revision = '0'.repeat(40); },
    e => { e.build_image = 'ubuntu:latest'; },
    e => { e.resource_boundary = 'ordinary-directory'; },
    e => { e.resource_limits.build_bytes = true; },
    e => { e.resource_limits.extra = 1; },
    e => { e.inventory_sha256 = 'not-a-digest'; },
    e => { e.export_sha256.head = '9'.repeat(64); },
    e => { e.evidence_profile = 'development-evidence'; },
    e => { e.source_binding_validated = false; },
    e => { e.admission_parser_isolation = 'development-docker'; },
    e => { e.checker_isolation = 'development-docker'; }
  ]) {
    const index = base(); const item = result(); mutate(item.evidence); index.results.items.push(item);
    assert.equal(normalizeIndex(index).resultStatus, 'unavailable');
  }
});

test('development-only audit evidence cannot create displayed results', () => {
  const index = base(); const item = result();
  delete item.evidence.evidence_profile;
  item.evidence.admission_parser_isolation = 'development-docker';
  item.evidence.checker_isolation = 'development-docker';
  index.results.items.push(item);
  const actual = normalizeIndex(index);
  assert.equal(actual.resultStatus, 'unavailable');
  assert.deepEqual(actual.results, []);
});

test('requires explanation, contributor attribution, and mathematical citation for every displayed result', () => {
  for (const field of ['description', 'contributor', 'citation']) {
    for (const value of [undefined, null, '', ' \n\t ', 42, {}, []]) {
      const index = base(); index.results.items.push({...result(), [field]:value});
      assert.equal(normalizeIndex(index).resultStatus, 'unavailable', `${field}: ${String(value)}`);
    }
  }
  const index = base(); index.results.items.push({...result(), description:'  Explanation  ', contributor:'  Ada  ', citation:'  Original work.  '});
  const actual = normalizeIndex(index).results[0];
  assert.equal(actual.description, 'Explanation');
  assert.equal(actual.contributor, 'Ada');
  assert.equal(actual.citation, 'Original work.');
});

test('rejects unsafe and off-repository task and evidence links', () => {
  const index = base(); index.results.items.push(result());
  index.tasks.status = 'ok'; index.tasks.generated_at = '2026-10-29T00:00:00Z';
  index.results.items[0].evidence.url = 'https://github.com.evil.test/kmehltretter82/tnd-validation/actions/runs/123';
  index.tasks.items.push({title:'unsafe',url:'javascript:alert(1)'});
  index.tasks.items.push({title:'wrong repo',url:'https://github.com/other/repo/issues/7'});
  index.tasks.items.push({title:'valid',url:'https://github.com/kmehltretter82/tnd-validation/issues/7',topics:['logic']});
  const actual = normalizeIndex(index);
  assert.equal(actual.resultStatus, 'unavailable');
  assert.equal(actual.taskStatus, 'unavailable');
  assert.deepEqual(actual.tasks, []);

  const valid = base(); valid.tasks.generated_at = '2026-10-29T00:00:00Z';
  valid.tasks.items.push({title:'valid',url:'https://github.com/kmehltretter82/tnd-validation/issues/7',topics:['logic']});
  assert.deepEqual(normalizeIndex(valid).tasks.map(x => x.title), ['valid']);
});

test('marks the evidence section unavailable if any record has prohibited axioms', () => {
  const index = base();
  index.results.items.push({...result(), axioms:['Classical.choice']});
  index.results.items.push({...result(), axioms:['sorryAx']});
  index.results.items.push({...result(), axioms:['propext','Quot.sound']});
  const actual = normalizeIndex(index);
  assert.equal(actual.resultStatus, 'unavailable');
  assert.deepEqual(actual.results, []);
});

test('requires a nonempty statement and an exact TNDLib Lean source path', () => {
  for (const change of [
    {statement:'  '},
    {source_url:`https://github.com/kmehltretter82/tnd-validation/blob/${sha}/README.md`},
    {source_url:`https://github.com/kmehltretter82/tnd-validation/blob/${sha}/TNDLib/Logic.txt`},
    {source_url:`https://github.com/kmehltretter82/tnd-validation/blob/${sha}/TNDLib/%2e%2e/README.lean`}
  ]) {
    const index = base(); index.results.items.push({...result(), ...change});
    assert.equal(normalizeIndex(index).resultStatus, 'unavailable');
  }
});

test('an ok section requires its exact generation timestamp and revision', () => {
  const noTaskTime = base(); noTaskTime.tasks.status = 'ok';
  assert.equal(normalizeIndex(noTaskTime).taskStatus, 'unavailable');
  const noRevision = base(); noRevision.results.status = 'ok'; noRevision.library.revision = null;
  assert.equal(normalizeIndex(noRevision).resultStatus, 'unavailable');
  const invalidTime = base(); invalidTime.generated_at = '2026-02-30T00:00:00Z';
  assert.throws(() => normalizeIndex(invalidTime), /timestamp/);
});

test('filters by content, topic, state, and axiom dependency', () => {
  const index = base();
  index.results.items.push(result(), {...result(), name:'TNDLib.example2', topics:['Algebra'], axioms:['propext']});
  const items = normalizeIndex(index).results;
  assert.equal(filterItems(items,'example','Logic','Proved','__none__').length, 1);
  assert.equal(filterItems(items,'','Algebra','','propext').length, 1);
  assert.equal(filterItems(items,'missing','','','').length, 0);
});

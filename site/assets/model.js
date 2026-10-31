const REPOSITORY = 'kmehltretter82/tnd-validation';
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ALLOWED_AXIOMS = new Set(['propext', 'Quot.sound']);
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const TOOLCHAIN = 'leanprover/lean4:v4.35.0';
const COMPARATOR = 'e3dcf3083fc53d44b27a4431fabf7d43181583f5';
const EXPORTER = '5a9a355dc6c5fd82b69058d433e2ae2e8dfbf8fe';
const BUILD_IMAGE = 'ubuntu@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac';
const RESOURCE_BOUNDARY = 'host-tmpfs-v1';
// These reserved values deliberately reject today's development-only upstream report.
const EVIDENCE_PROFILE = 'production-evidence-v1';
const PRODUCTION_ISOLATION = 'native-linux-validated-v1';

function strings(value) {
  return Array.isArray(value) ? [...new Set(value.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()))] : [];
}

function githubLink(value, suffix) {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.hostname !== 'github.com' || u.username || u.password || u.port || u.search || u.hash) return null;
    return new RegExp(`^/${REPOSITORY}/${suffix}$`, 'i').test(u.pathname) ? u.href : null;
  } catch { return null; }
}

function itemText(value) { return typeof value === 'string' ? value.trim() : ''; }

function timestamp(value) {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return '';
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value.replace(/Z$/, '.000Z') ? value : '';
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function resourceLimits(value) {
  const keys = ['schema_version','build_bytes','build_inodes','export_bytes','export_inodes'];
  if (!exactKeys(value, keys) || value.schema_version !== 1) return false;
  return ['build_bytes','export_bytes'].every(key => Number.isInteger(value[key]) && value[key] >= 4096 && value[key] <= 4 * 1024 ** 3) &&
    ['build_inodes','export_inodes'].every(key => Number.isInteger(value[key]) && value[key] >= 16 && value[key] <= 1_000_000);
}

function provenance(evidence) {
  const exports = evidence?.export_sha256;
  return evidence?.toolchain === TOOLCHAIN && evidence?.comparator_revision === COMPARATOR &&
    evidence?.exporter_revision === EXPORTER && evidence?.build_image === BUILD_IMAGE &&
    evidence?.resource_boundary === RESOURCE_BOUNDARY && resourceLimits(evidence?.resource_limits) &&
    evidence?.evidence_profile === EVIDENCE_PROFILE &&
    evidence?.source_binding_validated === true && evidence?.resource_boundary_validated === true &&
    evidence?.admission_parser_isolation === PRODUCTION_ISOLATION &&
    evidence?.checker_isolation === PRODUCTION_ISOLATION &&
    [evidence?.inventory_sha256, evidence?.checker_sha256, evidence?.exporter_sha256,
      evidence?.admission_policy_sha256, evidence?.admission_parser_sha256,
      evidence?.source_blob_sha256].every(x => typeof x === 'string' && DIGEST.test(x)) &&
    exactKeys(exports, ['base','head']) && typeof exports.base === 'string' && DIGEST.test(exports.base) &&
    exports.head === exports.base;
}

export function normalizeIndex(raw) {
  if (!raw || raw.schema_version !== 1 || raw.library?.repository !== REPOSITORY || !Array.isArray(raw.tasks?.items) || !Array.isArray(raw.results?.items)) throw new Error('Invalid index');
  const statuses = ['ok', 'unavailable', 'not-generated'];
  let taskStatus = raw.tasks.status ?? (raw.tasks.generated_at ? 'ok' : 'not-generated');
  let resultStatus = raw.results.status ?? (raw.generated_at ? 'ok' : 'not-generated');
  if (!statuses.includes(taskStatus) || !statuses.includes(resultStatus)) throw new Error('Invalid section status');
  const generatedAt = raw.generated_at == null ? '' : timestamp(raw.generated_at);
  const taskGeneratedAt = raw.tasks.generated_at == null ? '' : timestamp(raw.tasks.generated_at);
  if ((raw.generated_at != null && !generatedAt) || (raw.tasks.generated_at != null && !taskGeneratedAt)) throw new Error('Invalid index timestamp');
  const revision = typeof raw.library.revision === 'string' && SHA.test(raw.library.revision) ? raw.library.revision : null;
  const tasks = raw.tasks.items.flatMap(t => {
    if (!t || typeof t !== 'object') return [];
    const title = itemText(t.title), url = githubLink(t.url, 'issues/\\d+');
    if (!title || !url) return [];
    return [{title, url, description:itemText(t.description), topics:strings(t.topics), status:itemText(t.status), statement:itemText(t.statement), axioms:[]}];
  });
  const results = raw.results.items.flatMap(r => {
    if (!r || typeof r !== 'object' || !revision) return [];
    const title = itemText(r.name), evidence = r.evidence;
    const statement = itemText(r.statement);
    const description = itemText(r.description), contributor = itemText(r.contributor), citation = itemText(r.citation);
    // A badge requires evidence bound to the exact indexed library revision.
    if (!title || !statement || !description || !contributor || !citation || !evidence || evidence.verified !== true || evidence.source_commit !== revision || evidence.audit_commit !== revision || !provenance(evidence)) return [];
    const pathPart = '[A-Za-z0-9_-][A-Za-z0-9_.-]*';
    const sourceUrl = githubLink(r.source_url, `blob/${revision}/TNDLib/(?:${pathPart}/)*${pathPart}\\.lean`);
    const auditUrl = githubLink(evidence.url, 'actions/runs/\\d+(?:/job/\\d+)?');
    if (!sourceUrl || !auditUrl || !Array.isArray(r.axioms) || !r.axioms.every(x => typeof x === 'string' && ALLOWED_AXIOMS.has(x))) return [];
    return [{title, url:sourceUrl, auditUrl, statement, description, contributor, citation, topics:strings(r.topics), status:'Proved', axioms:strings(r.axioms)}];
  });
  if (taskStatus === 'ok' && (!taskGeneratedAt || tasks.length !== raw.tasks.items.length)) taskStatus = 'unavailable';
  if (resultStatus === 'ok' && (!generatedAt || !revision || results.length !== raw.results.items.length)) resultStatus = 'unavailable';
  return {generatedAt, taskGeneratedAt, taskStatus, resultStatus, revision,
    tasks:taskStatus === 'ok' ? tasks : [], results:resultStatus === 'ok' ? results : []};
}

export function filterItems(items, query, topic, status, axiom) {
  const q = query.toLocaleLowerCase().trim();
  return items.filter(item => (!q || [item.title,item.description,item.statement,...item.topics].join(' ').toLocaleLowerCase().includes(q)) && (!topic || item.topics.includes(topic)) && (!status || item.status === status) && (!axiom || (axiom === '__none__' ? item.axioms.length === 0 : item.axioms.includes(axiom))));
}

export function choices(items, field) {
  return [...new Set(items.flatMap(item => Array.isArray(item[field]) ? item[field] : [item[field]]).filter(Boolean))].sort((a,b) => a.localeCompare(b));
}

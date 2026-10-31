// Drive the static site in real browser engines; development evidence only.
//
// Not part of `npm test`, because it needs downloaded browsers. Run it from a
// directory holding `playwright` and `axe-core`, passing this repository's site:
//
//   node /path/to/tests/browser-check.mjs /path/to/site
//
// Every external request is blocked and recorded, and `data/index.json` is
// replaced per scenario, so no GitHub state or live pagination is exercised.
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {extname, join, normalize} from 'node:path';

const require = createRequire(`${process.cwd()}/`);
const {chromium, webkit} = require('playwright');
const axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');

const site = process.argv[2];
const TYPES = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json'};
const WIDTHS = [320, 390, 768, 1280];
const REPO = 'https://github.com/kmehltretter82/tnd-validation';
const sha = 'a'.repeat(40);

const evidence = () => ({verified:true, source_commit:sha, audit_commit:sha, url:`${REPO}/actions/runs/1`,
  toolchain:'leanprover/lean4:v4.35.0', comparator_revision:'e3dcf3083fc53d44b27a4431fabf7d43181583f5',
  exporter_revision:'5a9a355dc6c5fd82b69058d433e2ae2e8dfbf8fe',
  build_image:'ubuntu@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac',
  resource_boundary:'host-tmpfs-v1', resource_limits:{schema_version:1, build_bytes:2**31, build_inodes:200000, export_bytes:2**28, export_inodes:4096},
  evidence_profile:'production-evidence-v1', source_binding_validated:true, resource_boundary_validated:true,
  inventory_sha256:'b'.repeat(64), checker_sha256:'c'.repeat(64), exporter_sha256:'d'.repeat(64),
  export_sha256:{base:'e'.repeat(64), head:'e'.repeat(64)}, admission_policy_sha256:'f'.repeat(64),
  admission_parser_sha256:'1'.repeat(64), admission_parser_isolation:'native-linux-validated-v1',
  checker_isolation:'native-linux-validated-v1', source_blob_sha256:'2'.repeat(64)});
const result = (name, topic, axioms) => ({name, statement:`theorem ${name} : True`, description:`About ${name}.`, contributor:'Ada',
  citation:'Original formalization.', axioms, topics:[topic], source_url:`${REPO}/blob/${sha}/TNDLib/Logic.lean`, evidence:evidence()});
const task = (n, title, topic, status, extra = {}) => ({title, url:`${REPO}/issues/${n}`, description:`About ${title}.`, topics:[topic], status, statement:`theorem t${n} : True`, ...extra});
const index = (tasks, results, overrides = {}) => ({schema_version:1, generated_at:'2026-10-29T00:00:00Z',
  library:{repository:'kmehltretter82/tnd-validation', revision:sha},
  tasks:{status:'ok', generated_at:'2026-10-29T00:00:00Z', items:tasks}, results:{status:'ok', items:results}, ...overrides});
const LONG = 'x'.repeat(400);
const populated = () => index(
  [task(1, 'Excluded middle for decidables', 'Logic', 'Available'), task(2, 'Reverse length', 'Lists', 'Claimed')],
  [result('TNDLib.first', 'Logic', []), result('TNDLib.second', 'Algebra', ['propext'])]);

const SCENARIOS = {
  bootstrap: null,
  populated: {json:populated()},
  emptyLists: {json:index([], [])},
  many: {json:index(Array.from({length:150}, (_, n) => task(n + 1, `Task ${n + 1}`, `Topic ${n % 7}`, 'Available')), [])},
  longContent: {json:index([task(1, LONG, LONG, LONG, {statement:LONG, description:LONG})], [])},
  hostile: {json:index([task(1, '<img src=x onerror="window.__xss=1">', '<script>window.__xss=1</script>', 'Available')], [])},
  rejectedLink: {json:index([task(1, 'Bad link', 'Logic', 'Available', {url:'javascript:window.__xss=1'})], [])},
  sectionsUnavailable: {json:index([], [], {tasks:{status:'unavailable', generated_at:null, items:[]}, results:{status:'unavailable', items:[]}})},
  notFound: {status:404, body:'missing'},
  malformed: {body:'{not json'},
  wrongRepository: {json:index([], [], {library:{repository:'someone/else', revision:sha}})},
};

function serve(prefix) {
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    if (!path.startsWith(prefix)) { response.writeHead(404).end(); return; }
    const local = normalize(path.slice(prefix.length) || 'index.html');
    try {
      const body = await readFile(join(site, local.endsWith('/') ? `${local}index.html` : local));
      response.writeHead(200, {'content-type':TYPES[extname(local)] ?? 'text/plain'}).end(body);
    } catch { response.writeHead(404).end(); }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const failures = [], notes = [];
let checks = 0;
const check = (label, ok, detail = '') => { checks += 1; if (!ok) failures.push(detail ? `${label}: ${detail}` : label); };

async function open(context, base, scenario) {
  const page = await context.newPage();
  const problems = {console:[], errors:[], external:[], failed:[]};
  page.on('console', m => { if (m.type() === 'error') problems.console.push(m.text()); });
  page.on('pageerror', e => problems.errors.push(String(e)));
  page.on('response', r => { if (r.status() >= 400) problems.failed.push(`${r.status()} ${r.url()}`); });
  await page.route('**/*', route => {
    const url = route.request().url();
    if (!url.startsWith(base)) { problems.external.push(url); return route.abort(); }
    return route.continue();
  });
  const fixture = SCENARIOS[scenario];
  if (fixture) {
    await page.route('**/data/index.json', route => route.fulfill({
      status:fixture.status ?? 200, contentType:'application/json',
      body:fixture.json ? JSON.stringify(fixture.json) : fixture.body,
    }));
  }
  await page.goto(base, {waitUntil:'load'});
  await page.waitForFunction(() => !document.getElementById('index-status').textContent.startsWith('Loading'));
  return {page, problems};
}

const overflow = page => page.evaluate(() => {
  const root = document.documentElement, width = root.clientWidth;
  const offenders = [...document.body.querySelectorAll('*')].filter(n => {
    const box = n.getBoundingClientRect();
    if (!box.width || !box.height || box.right <= width + 1) return false;
    for (let a = n.parentElement; a; a = a.parentElement) {
      if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(a).overflowX)) return false;
    }
    return true;
  }).slice(0, 4).map(n => `${n.tagName}.${n.className}`);
  return {scroll:root.scrollWidth, width, offenders};
});

async function axe(page, label, engine) {
  await page.evaluate(axeSource);
  const {violations} = await page.evaluate(() => window.axe.run(document, {runOnly:['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']}));
  check(`${engine} ${label} axe`, violations.length === 0,
    violations.map(v => `${v.id}[${v.impact}] ${v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | ')}`).join('; '));
}

async function keyboard(page, engine) {
  const key = engine === 'webkit' ? 'Alt+Tab' : 'Tab';
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  const seen = [];
  for (let i = 0; i < 60; i += 1) {
    await page.keyboard.press(key);
    const focus = await page.evaluate(() => {
      const n = document.activeElement;
      if (!n || n === document.body) return null;
      const s = getComputedStyle(n), box = n.getBoundingClientRect();
      return {id:n.id || n.textContent.trim().slice(0, 30), tag:n.tagName,
        visible:(s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none',
        onScreen:box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight};
    });
    if (!focus) break;
    seen.push(focus);
  }
  check(`${engine} first tab stop is the skip link`, seen[0]?.id === 'Skip to content', seen[0]?.id);
  const ids = seen.map(f => f.id);
  for (const expected of ['tab-tasks', 'search', 'topic', 'status', 'explore-results']) {
    check(`${engine} keyboard reaches ${expected}`, ids.includes(expected), ids.join(','));
  }
  check(`${engine} inactive tab is out of tab order`, !ids.includes('tab-results'));
  for (const f of seen) {
    check(`${engine} focus indicator on ${f.id}`, f.visible);
    check(`${engine} focused ${f.id} is scrolled into view`, f.onScreen);
  }
  notes.push(`${engine}: ${seen.length} tab stops`);
  await page.focus('#tab-tasks');
  await page.keyboard.press('ArrowRight');
  check(`${engine} ArrowRight selects the results tab`, await page.evaluate(() =>
    document.activeElement.id === 'tab-results' && document.activeElement.getAttribute('aria-selected') === 'true'));
  await page.keyboard.press('Home');
  check(`${engine} Home selects the tasks tab`, await page.evaluate(() => document.activeElement.id === 'tab-tasks'));
}

async function behavior(page, engine) {
  const cards = () => page.locator('.result-card').count();
  check(`${engine} populated tasks render`, await cards() === 2);
  check(`${engine} count badges`, await page.textContent('#tasks-count') === '2' && await page.textContent('#results-count') === '2');
  await page.fill('#search', 'reverse');
  check(`${engine} search filters`, await cards() === 1);
  await page.fill('#search', 'nothing-matches');
  check(`${engine} no-match state`, (await page.textContent('#explore-results')).includes('No matching entries'));
  await page.fill('#search', '');
  await page.selectOption('#topic', 'Logic');
  check(`${engine} topic filter`, await cards() === 1);
  await page.selectOption('#topic', '');
  await page.selectOption('#status', 'Claimed');
  check(`${engine} status filter`, await cards() === 1);
  await page.selectOption('#status', '');
  check(`${engine} axiom filter hidden for tasks`, await page.locator('#axiom').isHidden());
  await page.click('#tab-results');
  check(`${engine} results render`, await cards() === 2);
  check(`${engine} axiom filter shown for results`, await page.locator('#axiom').isVisible());
  await page.selectOption('#axiom', '__none__');
  check(`${engine} no-axiom filter`, await cards() === 1 && (await page.textContent('.dependencies')) === 'No axiom dependencies');
  await page.selectOption('#axiom', 'propext');
  check(`${engine} named-axiom filter`, await cards() === 1 && (await page.textContent('.dependencies')).includes('propext'));
  const links = await page.locator('.evidence-link').evaluateAll(nodes => nodes.map(n => [n.href, n.target, n.rel]));
  check(`${engine} evidence links open safely on GitHub`, links.length === 2 &&
    links.every(([href, target, rel]) => href.startsWith(`${REPO}/`) && target === '_blank' && rel.includes('noopener')));
  await page.click('#tab-tasks');
  check(`${engine} switching tabs clears filters`, await page.inputValue('#axiom') === '' && await cards() === 2);
}

async function runEngine(name, type) {
  const browser = await type.launch();
  for (const prefix of ['/und/', '/']) {
    const server = await serve(prefix);
    const base = `http://127.0.0.1:${server.address().port}${prefix}`;
    const context = await browser.newContext({viewport:{width:1280, height:800}});
    for (const scenario of Object.keys(SCENARIOS)) {
      const {page, problems} = await open(context, base, scenario);
      const label = `${name} ${prefix} ${scenario}`;
      const expectedFailure = scenario === 'notFound';
      check(`${label} no page errors`, problems.errors.length === 0, problems.errors.join(' | '));
      check(`${label} no console errors`, expectedFailure || problems.console.length === 0, problems.console.join(' | '));
      check(`${label} no failed requests`, expectedFailure || problems.failed.length === 0, problems.failed.join(' | '));
      check(`${label} no external requests`, problems.external.length === 0, problems.external.join(' | '));
      check(`${label} no script injection`, !(await page.evaluate(() => window.__xss)));
      for (const width of WIDTHS) {
        await page.setViewportSize({width, height:800});
        const o = await overflow(page);
        check(`${label} no page overflow at ${width}`, o.scroll <= o.width && o.offenders.length === 0, JSON.stringify(o));
      }
      await page.setViewportSize({width:1280, height:800});
      await page.close();
    }
    if (prefix === '/und/') {
      for (const scenario of ['bootstrap', 'populated', 'notFound']) {
        for (const width of [320, 1280]) {
          const {page} = await open(context, base, scenario);
          await page.setViewportSize({width, height:800});
          await axe(page, `${scenario} ${width}`, name);
          if (scenario === 'populated') {
            await page.click('#tab-results');
            await axe(page, `${scenario} results ${width}`, name);
          }
          await page.close();
        }
      }
      const expectText = async (scenario, text) => {
        const {page} = await open(context, base, scenario);
        const shown = await page.textContent('#explore-panel, .explore-panel');
        check(`${name} ${scenario} states "${text}"`, shown.includes(text), shown.slice(0, 200));
        return page;
      };
      await (await expectText('bootstrap', 'not available yet')).close();
      await (await expectText('emptyLists', 'No tasks in the index yet')).close();
      await (await expectText('sectionsUnavailable', 'is unavailable')).close();
      for (const scenario of ['notFound', 'malformed', 'wrongRepository']) {
        await (await expectText(scenario, 'could not load the library index')).close();
      }
      const rejected = await expectText('rejectedLink', 'is unavailable');
      check(`${name} rejected link is not rendered`, await rejected.locator('a[href^="javascript"]').count() === 0);
      await rejected.close();
      const hostile = await open(context, base, 'hostile');
      check(`${name} hostile title is inert text`, (await hostile.page.textContent('.result-title')).includes('<img') &&
        await hostile.page.locator('.result-card img').count() === 0);
      await hostile.page.close();
      const many = await open(context, base, 'many');
      check(`${name} renders all 150 tasks`, await many.page.locator('.result-card').count() === 150);
      await many.page.close();
      const populatedPage = await open(context, base, 'populated');
      await behavior(populatedPage.page, name);
      await populatedPage.page.close();
      // The site disables smooth scrolling for this preference, so positions
      // measured right after a key press are final rather than mid-animation.
      const motionless = await browser.newContext({viewport:{width:1280, height:800}, reducedMotion:'reduce'});
      const keys = await open(motionless, base, 'populated');
      await keyboard(keys.page, name);
      await keys.page.close();
      await motionless.close();
      const fonts = await open(context, base, 'bootstrap');
      await fonts.page.evaluate(() => document.fonts.ready);
      const loaded = await fonts.page.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => `${f.family} ${f.style}`));
      for (const face of ['"DM Sans" normal', '"DM Serif Display" normal', '"DM Serif Display" italic']) {
        check(`${name} self-hosted ${face} loads`, loaded.some(f => f.replaceAll("'", '"') === face || f === face.replaceAll('"', '')), loaded.join(','));
      }
      await fonts.page.close();
      const skip = await open(context, base, 'bootstrap');
      await skip.page.focus('.skip-link');
      await skip.page.keyboard.press('Enter');
      check(`${name} skip link moves to main`, skip.page.url().endsWith('#main'));
      await skip.page.close();
      const shot = await open(context, base, 'populated');
      await shot.page.setViewportSize({width:390, height:800});
      await shot.page.screenshot({path:`browser-${name}-390.png`, fullPage:true});
      await shot.page.setViewportSize({width:1280, height:800});
      await shot.page.screenshot({path:`browser-${name}-1280.png`, fullPage:true});
      await shot.page.close();
    }
    await context.close();
    server.close();
  }
  await browser.close();
}

await runEngine('chromium', chromium);
await runEngine('webkit', webkit);
console.log(JSON.stringify({development_only:true, checks, failed:failures.length, notes, failures}, null, 1));
process.exit(failures.length ? 1 : 0);

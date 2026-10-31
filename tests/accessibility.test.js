import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {boot} from './dom-harness.js';

test('HTML connects labels, tabs, headings, and fragment destinations to existing IDs', async () => {
  const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(x => x[1]);
  assert.equal(new Set(ids).size, ids.length, 'duplicate IDs break label relationships');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta name="viewport"/);
  for (const target of html.matchAll(/(?:href="#|aria-controls="|aria-labelledby=")([^"]+)"/g)) {
    for (const id of target[1].split(/\s+/)) assert.ok(ids.includes(id), `missing target ${id}`);
  }
  const app = await boot({}, {failure:true});
  try {
    const nodes = app.nodes(app.document.root);
    for (const control of nodes.filter(x => x.tagName === 'INPUT' || x.tagName === 'SELECT')) {
      assert.ok(nodes.some(x => x.tagName === 'LABEL' && x.getAttribute('for') === control.id),
        `missing explicit label for ${control.id}`);
    }
    assert.equal(nodes.filter(x => x.tagName === 'MAIN').length, 1);
    assert.equal(nodes.filter(x => x.tagName === 'H1').length, 1);
  } finally { app.restore(); }
});

test('local site assets use project-relative URLs', async () => {
  const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
  assert.match(html, /<link rel="stylesheet" href="\.\/assets\/site\.css">/);
  assert.match(html, /<script type="module" src="\.\/assets\/app\.js"><\/script>/);
  assert.doesNotMatch(html, /(?:href|src)="\/(?!\/)/, 'root-relative assets break project Pages');
});

test('contribution section links directly to proposals and the Choir workflow', async () => {
  const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
  assert.match(html, /https:\/\/github\.com\/kmehltretter82\/tnd-validation\/issues\/new\?template=request\.yml/);
  assert.match(html, /https:\/\/github\.com\/kmehltretter82\/tnd-validation\/blob\/main\/CONTRIBUTING\.md#join-and-claim-a-task/);
  assert.match(html, /Human and agent-assisted contributors should read the Choir workflow/);
});

test('Pages writer is main-guarded, credential-isolated, and commit-pinned', async () => {
  const pages = await readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  const checks = await readFile(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(pages + checks, /pull_request_target/);
  assert.match(pages, /^permissions:\n  contents: read$/m);
  const build = pages.match(/\n  build:\n([\s\S]*?)\n  deploy:\n/)?.[1];
  const deploy = pages.match(/\n  deploy:\n([\s\S]*)/)?.[1];
  assert.ok(build && deploy, 'expected separate build and deploy jobs');
  assert.match(build, /^    if: github\.ref == 'refs\/heads\/main'$/m,
    'workflow_dispatch must not let branch-selected code produce a Pages artifact');
  assert.match(build, /permissions:\n      contents: read/);
  assert.doesNotMatch(build, /pages: write|id-token: write/);
  assert.match(deploy, /permissions:\n      pages: write\n      id-token: write/);
  assert.match(deploy, /^    needs: build$/m,
    'the Pages writer must consume only the main-guarded build job');
  assert.doesNotMatch(deploy, /contents: write/);
  for (const workflow of [pages, checks]) {
    for (const use of workflow.matchAll(/uses:\s+([^\s#]+)/g)) {
      assert.match(use[1], /@[0-9a-f]{40}$/, `action is not pinned by commit: ${use[1]}`);
    }
  }
});

function luminance(hex) {
  const channels = hex.replace('#','').match(/../g).map(x => {
    const c = parseInt(x,16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return channels.reduce((sum, value, i) => sum + value * [0.2126,0.7152,0.0722][i], 0);
}

test('selected small-text styles retain at least 4.5:1 contrast on their declared surfaces', async () => {
  const css = await readFile(new URL('../site/assets/site.css', import.meta.url), 'utf8');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  for (const [selector, background] of [
    ['.index-status','#ffffff'], ['.tab','#ffffff'], ['.empty-state p','#ffffff'],
    ['.result-description','#ffffff'], ['.hero-note','#f8f7f1'],
    ['.proof-caption','#fafbf6'], ['.figure-note','#e5eadb']
  ]) {
    let foreground;
    for (const [, selectors, declarations] of rules) {
      if (selectors.trim().split(',').map(x => x.trim()).includes(selector)) {
        const match = declarations.match(/(?:^|;)\s*color:(#[0-9a-f]{6})(?:;|$)/i);
        if (match) foreground = match[1];
      }
    }
    assert.ok(foreground, `missing directly specified color for ${selector}`);
    const values = [luminance(foreground),luminance(background)].sort((a,b) => a-b);
    const contrast = (values[1]+0.05)/(values[0]+0.05);
    assert.ok(contrast >= 4.5, `${selector}: ${contrast.toFixed(2)}:1 contrast`);
  }
});

test('the page loads nothing from a third party', async () => {
  const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../site/assets/site.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /@import|url\(\s*['"]?(?:https?:)?\/\//);
  assert.match(css, /(?:^|\n):root\{[^}]*--serif:/, 'custom properties must parse as their own rule');
  for (const tag of html.matchAll(/<(?:link|script|img|iframe)\b[^>]*>/g)) {
    assert.doesNotMatch(tag[0], /(?:href|src)="(?:https?:)?\/\//, tag[0]);
  }
});

test('every font the stylesheet names ships beside its licence', async () => {
  const css = await readFile(new URL('../site/assets/site.css', import.meta.url), 'utf8');
  const fonts = [...css.matchAll(/url\('(\.\/fonts\/[^']+)'\)/g)].map(x => x[1]);
  assert.equal(fonts.length, 3);
  for (const font of fonts) await readFile(new URL(font, new URL('../site/assets/', import.meta.url)));
  for (const licence of ['OFL-DM-Sans.txt', 'OFL-DM-Serif-Display.txt']) {
    const text = await readFile(new URL(`../site/assets/fonts/${licence}`, import.meta.url), 'utf8');
    assert.match(text, /SIL Open Font License/);
  }
});

// Minimal DOM model for exercising app.js without a browser or third-party packages.
// It models the operations the app uses, not browser layout, focus navigation, or ARIA.
import {readFile} from 'node:fs/promises';

class TextNode {
  constructor(text) { this.textContent = text; }
}

class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.document = document; this.children = [];
    this.attributes = {}; this.dataset = {}; this.listeners = new Map();
    this.className = ''; this.value = ''; this.hidden = false; this.tabIndex = 0;
    this.classList = {toggle: (name, active) => {
      const names = new Set(this.className.split(/\s+/).filter(Boolean));
      if (active) names.add(name); else names.delete(name);
      this.className = [...names].join(' ');
    }};
  }
  get textContent() { return this.children.map(x => x.textContent).join(''); }
  set textContent(value) { this.children = [new TextNode(String(value))]; }
  set innerHTML(_) { throw new Error('Unexpected HTML sink in application rendering'); }
  append(...nodes) {
    this.children.push(...nodes.map(n => typeof n === 'string' ? new TextNode(n) : n));
  }
  replaceChildren(...nodes) {
    this.children = []; this.append(...nodes);
    if (this.tagName === 'SELECT') this.value = nodes[0]?.value ?? '';
  }
  add(option) { this.append(option); }
  setAttribute(name, value) {
    value = String(value); this.attributes[name] = value;
    if (name === 'id') { this.id = value; this.document.ids.set(value, this); }
    if (name === 'class') this.className = value;
    if (name === 'value') this.value = value;
    if (name === 'tabindex') this.tabIndex = Number(value);
    if (name === 'hidden') this.hidden = true;
    if (name.startsWith('data-')) this.dataset[name.slice(5)] = value;
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, callback) {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(callback); this.listeners.set(name, listeners);
  }
  dispatch(name, fields = {}) {
    const event = {defaultPrevented:false, preventDefault() { this.defaultPrevented = true; }, ...fields};
    for (const listener of this.listeners.get(name) ?? []) listener(event);
    return event;
  }
  click() { this.dispatch('click'); }
  focus() { this.document.activeElement = this; }
}

function descendants(node) {
  return node.children.flatMap(child => child instanceof Element ? [child, ...descendants(child)] : []);
}

function parseDocument(html) {
  const document = {
    ids: new Map(), activeElement:null,
    createElement(tag) { return new Element(tag, this); },
    getElementById(id) { return this.ids.get(id) ?? null; },
    querySelectorAll(selector) {
      if (selector !== '[role="tab"]') throw new Error(`Unsupported selector ${selector}`);
      return descendants(this.root).filter(x => x.getAttribute('role') === 'tab');
    }
  };
  document.root = document.createElement('document');
  const stack = [document.root], voids = new Set(['meta','link','input','br','hr','img']);
  for (const token of html.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[^>]+>|[^<]+/g)) {
    if (token.startsWith('<!')) continue;
    if (token.startsWith('</')) { stack.pop(); continue; }
    if (!token.startsWith('<')) { stack.at(-1).append(token); continue; }
    const tag = token.match(/^<([\w-]+)/)[1];
    const element = document.createElement(tag);
    for (const match of token.slice(tag.length + 1, -1).matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
      element.setAttribute(match[1], match[2] ?? '');
    }
    stack.at(-1).append(element);
    if (!voids.has(tag)) stack.push(element);
  }
  return document;
}

let sequence = 0;
export async function boot(raw, {failure = false, status = 200} = {}) {
  const document = parseDocument(await readFile(new URL('../site/index.html', import.meta.url), 'utf8'));
  const requested = [];
  const previous = {document:globalThis.document, Option:globalThis.Option, fetch:globalThis.fetch};
  globalThis.document = document;
  globalThis.Option = class extends Element {
    constructor(text, value) { super('option', document); this.textContent = text; this.value = value; }
  };
  globalThis.fetch = async url => {
    requested.push(String(url));
    if (failure) throw new Error('Simulated network failure');
    return {ok:status >= 200 && status < 300, json:async () => raw};
  };
  try {
    await import(new URL(`../site/assets/app.js?test=${sequence++}`, import.meta.url));
    return {
      document, requested, get:id => document.getElementById(id),
      nodes:node => descendants(node),
      restore() { Object.assign(globalThis, previous); }
    };
  } catch (error) { Object.assign(globalThis, previous); throw error; }
}

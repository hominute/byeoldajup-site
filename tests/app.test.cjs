"use strict";

// No package install or browser is required: run `node --test tests/app.test.cjs`.
// This small DOM adapter runs the real application without changing its source.
// Layout, responsive presentation and real browser behavior need separate browser QA.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
const productionData = JSON.parse(fs.readFileSync(path.join(root, "data/items.json"), "utf8"));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/items-two.json"), "utf8"));
const plain = value => JSON.parse(JSON.stringify(value));

class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.className = "";
    this._text = "";
    this.disabled = false;
    this.hidden = false;
    this.value = "";
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: name => { if (!this.classList.contains(name)) this.className = (this.className + " " + name).trim(); },
      remove: name => { this.className = this.className.split(/\s+/).filter(item => item !== name).join(" "); },
      toggle: (name, force) => {
        const add = force === undefined ? !this.classList.contains(name) : Boolean(force);
        this.classList[add ? "add" : "remove"](name);
        return add;
      }
    };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  set innerHTML(_) { throw new Error("The app must not inject product data with innerHTML."); }
  append(...children) { children.forEach(child => { child.parentElement = this; this.children.push(child); }); }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { this._text = ""; this.children = []; this.append(...children); }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "id") this.id = String(value);
    if (name === "class") this.className = String(value);
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
  }
  getAttribute(name) {
    if (name === "id") return this.id || null;
    if (name === "class") return this.className || null;
    if (name.startsWith("data-")) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] ?? null;
    return this.attributes[name] ?? null;
  }
  hasAttribute(name) { return this.getAttribute(name) !== null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  dispatch(type, extra = {}) {
    const event = { target: this, preventDefault() { this.defaultPrevented = true; }, ...extra };
    for (const listener of this.listeners[type] || []) listener(event);
    return event;
  }
  click() { if (!this.disabled) this.dispatch("click"); }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView(options) { this.scrollOptions = options; }
  showModal() { this.open = true; this.setAttribute("open", ""); }
  close() { this.open = false; this.removeAttribute("open"); }
  querySelectorAll(selector) {
    const descendants = [];
    const visit = node => node.children.forEach(child => { descendants.push(child); visit(child); });
    visit(this);
    return descendants.filter(element => selector.split(",").some(part => matchesSelector(element, part.trim())));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function matchesSelector(element, selector) {
  if (selector.includes(":not([disabled])")) {
    if (element.disabled) return false;
    selector = selector.replace(":not([disabled])", "");
  }
  const tag = selector.match(/^[a-z]+/i);
  if (tag && element.tagName !== tag[0].toUpperCase()) return false;
  for (const match of selector.matchAll(/\.([a-z0-9_-]+)/gi)) if (!element.classList.contains(match[1])) return false;
  for (const match of selector.matchAll(/\[([^=\]]+)(?:=["']?([^\]"']+)["']?)?\]/g)) {
    const value = element.getAttribute(match[1]) ?? element[match[1]];
    if (value == null || (match[2] !== undefined && String(value) !== match[2])) return false;
  }
  return true;
}

async function boot(data = fixture, options = {}) {
  const document = {
    listeners: {},
    createElement(tag) { return new Element(tag, this); },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    dispatch(type, extra) {
      const event = { preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (const fn of this.listeners[type] || []) fn(event);
      return event;
    }
  };
  document.body = new Element("body", document);
  document.head = new Element("head", document);
  document.querySelectorAll = selector => [...document.head.querySelectorAll(selector), ...document.body.querySelectorAll(selector)];
  document.querySelector = selector => document.querySelectorAll(selector)[0] || null;
  document.getElementById = id => {
    const all = [document.head, document.body];
    for (let i = 0; i < all.length; i++) {
      if (all[i].id === id) return all[i];
      all.push(...all[i].children);
    }
    return null;
  };
  const ids = {};
  for (const [id, tag] of Object.entries({
    "theme-stylesheet": "link", "results-title": "h2", "theme-dialog": "dialog",
    "theme-picker": "button", "close-theme-dialog": "button", "theme-choices": "div",
    "item-search": "input", "random-pick": "button", "item-list": "div", "category-list": "div",
    "result-count": "p", "status-message": "div", "action-status": "p"
  })) {
    ids[id] = document.createElement(tag);
    ids[id].id = id;
    (tag === "link" ? document.head : document.body).appendChild(ids[id]);
  }
  // Nest the dialog controls so focus handling can be exercised too.
  document.body.children = document.body.children.filter(child => child !== ids["theme-choices"] && child !== ids["close-theme-dialog"]);
  ids["theme-dialog"].append(ids["close-theme-dialog"], ids["theme-choices"]);
  const meta = document.createElement("meta"); meta.setAttribute("name", "theme-color"); document.head.appendChild(meta);
  const character = document.createElement("img"); character.className = "hero-character"; document.body.appendChild(character);
  const storageCalls = [];
  const values = new Map(Object.entries(options.storedTheme ? { "byeoldajup-theme": options.storedTheme } : {}));
  const fetches = [];
  const windowEvents = {};
  const window = {
    location: { href: "https://example.test/" + (options.hash || ""), hash: options.hash || "" },
    localStorage: {
      getItem(key) { storageCalls.push(["get", key]); if (options.storageBlocked) throw Error("Storage blocked"); return values.get(key) ?? null; },
      setItem(key, value) { storageCalls.push(["set", key, value]); if (options.storageBlocked) throw Error("Storage blocked"); values.set(key, value); }
    },
    fetch: async (url, init) => {
      fetches.push({ url, init });
      if (options.fetchError) throw Error("Offline");
      return { ok: true, json: async () => plain(data) };
    },
    addEventListener(type, fn) { (windowEvents[type] ||= []).push(fn); },
    requestAnimationFrame(fn) { fn(); },
    setTimeout() { return 1; }, clearTimeout() {}, matchMedia() { return { matches: true }; }
  };
  window.history = { replaceState(_state, _title, url) { window.location.href = url; window.location.hash = new URL(url).hash; } };
  const sandbox = { window, document, URL, console };
  vm.runInNewContext(source, sandbox, { filename: "js/app.js" });
  await window.ByulApp.ready;
  return {
    api: window.ByulApp, document, window, ids, storageCalls, fetches, values,
    input(value) { ids["item-search"].value = value; ids["item-search"].dispatch("input"); },
    category(value) {
      const button = ids["category-list"].children.find(child => child.dataset.category === value);
      assert.ok(button, "Expected a rendered category button: " + value); button.click();
    },
    theme(value) {
      const button = ids["theme-choices"].children.find(child => child.dataset.theme === value);
      assert.ok(button); button.click();
    },
    hash(value) { window.location.hash = value; for (const fn of windowEvents.hashchange || []) fn(); }
  };
}

test("production data stays one real product; the extra category is test-only", () => {
  assert.equal(productionData.length, 1);
  assert.equal(fixture.length, 2);
  assert.deepEqual(fixture[0], productionData[0]);
  assert.deepEqual(fixture[1], {
    no: "002", category: "검수전용", name: "검수용 두 번째 상품", hook: "데이터 연결 확인용",
    facts: ["검수 전용"], proof: "", checkedAt: "", image: "", url: ""
  });
});

test("the unmodified app fetches JSON and renders its new category and product", async () => {
  const app = await boot();
  assert.equal(app.fetches.length, 1);
  assert.equal(app.fetches[0].url, "data/items.json");
  assert.deepEqual(plain(app.api.getState().categories), ["겨울템", "검수전용"]);
  assert.deepEqual(app.ids["category-list"].children.map(child => child.textContent), ["전체", "겨울템", "검수전용"]);
  assert.equal(app.ids["item-list"].children.length, 2);
  assert.equal(app.document.getElementById("no002").querySelector(".item-name").textContent, fixture[1].name);
  assert.equal(app.document.getElementById("no001").querySelector(".item-number").textContent, "영상 #001");
  assert.equal(app.document.getElementById("no002").querySelector(".image-fallback").textContent, "상품 이미지 준비 중");
  assert.equal(app.document.getElementById("no002").querySelector(".item-cta").disabled, true);
  const link = app.document.getElementById("no001").querySelector(".item-cta");
  assert.equal(link.href, productionData[0].url);
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener sponsored");
  assert.equal(app.ids["result-count"].textContent, "2개의 발견");
  assert.ok(Object.isFrozen(app.api));
});

test("all required exact number forms and supplied-name search work through input events", async () => {
  const app = await boot();
  for (const query of ["001", "1", "No.1", "#001", "영상#001", "영상 #001"]) {
    app.input(query);
    assert.deepEqual(plain(app.api.getState().visibleNumbers), ["1"], query);
  }
  app.input("검수용 두 번째");
  assert.deepEqual(plain(app.api.getState().visibleNumbers), ["2"]);
  app.input("없는 상품");
  assert.equal(app.api.getState().count, 0);
  assert.equal(app.ids["random-pick"].disabled, true);
  assert.equal(app.ids["status-message"].hidden, false);
  assert.match(app.ids["status-message"].textContent, /찾는 상품이 없어요/);
});

test("category filtering constrains random picks; theme changes preserve that view", async () => {
  const app = await boot();
  app.category("검수전용");
  assert.deepEqual(plain(app.api.getState().visibleNumbers), ["2"]);
  for (let i = 0; i < 10; i++) {
    app.ids["random-pick"].click();
    assert.equal(app.window.location.hash, "#no002");
    assert.ok(app.document.getElementById("no002").classList.contains("is-highlighted"));
  }
  app.theme("D");
  assert.equal(app.api.getState().theme, "D");
  assert.equal(app.api.getState().category, "검수전용");
  assert.deepEqual(plain(app.api.getState().visibleNumbers), ["2"]);
  assert.equal(app.values.get("byeoldajup-theme"), "D");
  assert.deepEqual([...new Set(app.storageCalls.map(call => call[1]))], ["byeoldajup-theme"]);
  assert.doesNotMatch(source, /indexedDB|openDatabase|sqlite|sql\.js|favorite|favourite|saved-panel|saved-toggle/i);
});

test("valid hash links reveal filtered-out products and malformed hashes are harmless", async () => {
  const app = await boot(fixture, { hash: "#no002" });
  assert.ok(app.document.getElementById("no002").scrollOptions);
  app.category("검수전용");
  app.input("두 번째");
  app.hash("#no001");
  assert.equal(app.api.getState().category, "전체");
  assert.equal(app.api.getState().query, "");
  assert.equal(app.ids["item-search"].value, "");
  assert.ok(app.document.getElementById("no001").classList.contains("is-highlighted"));
  for (const malformed of ["#no%ZZ", "#no0", "#no-1", "#no001<script>"]) assert.doesNotThrow(() => app.hash(malformed));
});

test("URL and image guards allow safe values and reject executable or ambiguous input", async () => {
  const { api } = await boot();
  assert.equal(api.safeURL(" https://link.coupang.com/a/example "), "https://link.coupang.com/a/example");
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "http://example.com", "//example.com", "https://user:pass@example.com", "not a URL", null]) {
    assert.equal(api.safeURL(bad), "", String(bad));
  }
  for (const good of ["assets/items/001.webp", "./assets/items/001.png?v=1", "https://example.com/product.jpg"]) assert.equal(api.safeImageURL(good), good);
  for (const bad of ["../secret.png", "assets/%2e%2e/secret.jpg", "javascript:alert(1)", "data:image/svg+xml,x", "//example.com/x.png", "assets/x.html", "assets/x\\y.png", "assets/<x>.png", "%ZZ.png"]) {
    assert.equal(api.safeImageURL(bad), "", bad);
  }
  assert.equal(api.parseHash("#no001"), "1");
  assert.equal(api.parseHash("#no%ZZ"), "");
  assert.throws(() => api.normalizeItems({ items: fixture }));
  assert.throws(() => api.normalizeItems([fixture[0], { ...fixture[1], no: "1" }]));
  assert.throws(() => api.normalizeItems([{ ...fixture[0], facts: [true] }]));
});

test("blocked storage silently defaults to A and never stores product or search data", async () => {
  const app = await boot(fixture, { storageBlocked: true, storedTheme: "E" });
  assert.equal(app.api.getState().theme, "A");
  assert.equal(app.ids["theme-stylesheet"].href, "themes/a.css");
  app.input("검수"); app.category("검수전용"); app.theme("E");
  assert.equal(app.api.getState().theme, "A");
  assert.deepEqual(app.storageCalls, [["get", "byeoldajup-theme"], ["set", "byeoldajup-theme", "E"]]);
  const previews = app.ids["theme-choices"].querySelectorAll("img");
  assert.equal(previews.length, 10);
  for (const image of previews) assert.match(image.src, /^assets\/themes\/[a-e]\/(background\.webp|character\.png)$/);
});

test("theme dialog closes with Escape and returns focus to its opener", async () => {
  const app = await boot(fixture, { storedTheme: "C" });
  app.ids["theme-picker"].focus();
  app.ids["theme-picker"].click();
  assert.equal(app.ids["theme-dialog"].open, true);
  assert.equal(app.document.activeElement.dataset.theme, "C");
  const event = app.document.dispatch("keydown", { key: "Escape" });
  assert.equal(event.defaultPrevented, true);
  assert.equal(app.ids["theme-dialog"].open, false);
  assert.equal(app.document.activeElement, app.ids["theme-picker"]);
});

test("empty and failed JSON loads give clear states without invented cards", async () => {
  const empty = await boot([]);
  assert.equal(empty.ids["item-list"].children.length, 0);
  assert.equal(empty.ids["random-pick"].disabled, true);
  assert.match(empty.ids["status-message"].textContent, /아직 소개된 상품이 없어요/);
  const failed = await boot(fixture, { fetchError: true });
  assert.equal(failed.ids["item-list"].children.length, 0);
  assert.equal(failed.ids["item-search"].disabled, true);
  assert.equal(failed.ids["status-message"].getAttribute("role"), "alert");
  assert.ok(failed.ids["status-message"].querySelector(".retry-load"));
});

test("untrusted supplied strings remain text and unsafe links stay disabled", async () => {
  const malicious = { ...fixture[1], name: '<img src=x onerror="alert(1)">', hook: "<script>alert(1)</script>", image: "javascript:alert(1)", url: "javascript:alert(1)" };
  const app = await boot([malicious]);
  const card = app.document.getElementById("no002");
  assert.equal(card.querySelector(".item-name").textContent, malicious.name);
  assert.equal(card.querySelector(".item-hook").textContent, malicious.hook);
  assert.equal(card.querySelectorAll("script").length, 0);
  assert.equal(card.querySelectorAll("img").length, 0);
  assert.equal(card.querySelector(".item-cta").disabled, true);
});

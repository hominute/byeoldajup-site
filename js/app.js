(function () {
  "use strict";

  var THEME_KEY = "byeoldajup-theme";
  var THEME_OPTIONS = {
    A: { name: "동네 줍줍상점", description: "따뜻한 크림빛의 작은 가게", section: "방금 주워온 것", color: "#fff7e8" },
    B: { name: "줍줍 오락실", description: "톡톡 누르는 즐거운 발견", section: "오늘의 발견", color: "#214dff" },
    C: { name: "발견 스크랩북", description: "종이와 스티커로 남긴 발견", section: "방금 붙인 발견", color: "#f8f6ed" },
    D: { name: "별 주운 밤", description: "작은 별빛이 모이는 밤", section: "오늘 주운 별", color: "#101331" },
    E: { name: "별다줍 인벤토리", description: "일상 속 쓸모를 찾는 작은 모험", section: "발견한 아이템", color: "#dcebd9" }
  };
  var items = [];
  var filtered = [];
  var categories = [];
  var state = { query: "", category: "전체", theme: "A", loading: false, error: false };
  var loadSequence = 0;
  var highlightTimer;
  var dialogOpener = null;
  var $ = function (id) { return document.getElementById(id); };

  function validTheme(value) {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(THEME_OPTIONS, value);
  }
  function readTheme() {
    try {
      var value = window.localStorage.getItem(THEME_KEY);
      return validTheme(value) ? value : "A";
    } catch (_) { return "A"; }
  }
  function storeTheme(value) {
    try { window.localStorage.setItem(THEME_KEY, value); return true; }
    catch (_) { return false; }
  }
  function normalizeNumber(value) {
    var text = String(value == null ? "" : value).normalize("NFKC").trim();
    var match = text.match(/^(?:(?:no[.\s]*)|(?:영상\s*#?\s*)|#)?0*(\d+)$/i);
    if (!match) return "";
    var no = Number(match[1]);
    return Number.isSafeInteger(no) && no > 0 ? String(no) : "";
  }
  function normalizeText(value) {
    return String(value == null ? "" : value).normalize("NFKC").toLocaleLowerCase("ko").trim();
  }
  function safeURL(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      var url = new URL(value.trim());
      return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
    } catch (_) { return ""; }
  }
  function safeImageURL(value) {
    if (typeof value !== "string") return "";
    var text = value.trim();
    if (/^https:\/\//i.test(text)) return safeURL(text);
    if (!text || /[\\<>\x00-\x1f]/.test(text) || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(text)) return "";
    try {
      var pathname = decodeURIComponent(text.split(/[?#]/)[0]);
      if (pathname.split("/").some(function (part) { return part === ".."; })) return "";
    } catch (_) { return ""; }
    return /\.(?:png|jpe?g|webp|avif|gif|svg)(?:[?#].*)?$/i.test(text) ? text : "";
  }
  function normalizeItems(value) {
    if (!Array.isArray(value)) throw new Error("상품 목록 형식이 올바르지 않습니다.");
    var seen = new Set();
    return value.map(function (raw) {
      if (!raw || typeof raw !== "object") throw new Error("상품 정보 형식이 올바르지 않습니다.");
      var no = normalizeNumber(raw.no);
      if (!no || seen.has(no) || typeof raw.name !== "string" || !raw.name.trim() || typeof raw.category !== "string" || !raw.category.trim()) throw new Error("상품 번호·이름·분류를 확인해 주세요.");
      if (!Array.isArray(raw.facts) || raw.facts.some(function (fact) { return typeof fact !== "string"; })) throw new Error("상품 확인 정보 형식을 확인해 주세요.");
      seen.add(no);
      return Object.freeze({
        no: no,
        category: raw.category.trim(),
        name: raw.name.trim(),
        hook: typeof raw.hook === "string" ? raw.hook : "",
        facts: Object.freeze(raw.facts.slice()),
        proof: typeof raw.proof === "string" ? raw.proof : "",
        checkedAt: typeof raw.checkedAt === "string" ? raw.checkedAt : "",
        image: typeof raw.image === "string" ? raw.image : "",
        url: typeof raw.url === "string" ? raw.url : ""
      });
    });
  }
  function matches(item, query, category) {
    if (category && category !== "전체" && item.category !== category) return false;
    var text = normalizeText(query);
    if (!text) return true;
    var no = normalizeNumber(text);
    if (no) return item.no === no;
    // Name search stays grounded in the supplied name; numeric searches use the item number.
    return normalizeText(item.name).indexOf(text) !== -1;
  }
  function parseHash(hash) {
    try {
      var match = decodeURIComponent(String(hash || "")).match(/^#no(\d+)$/i);
      return match ? normalizeNumber(match[1]) : "";
    } catch (_) { return ""; }
  }
  function itemId(no) { return "no" + String(no).padStart(3, "0"); }
  function node(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }
  function motionAllowed() {
    return !window.matchMedia || !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function announce(text) { $("action-status").textContent = text; }
  function updateThemeChoices() {
    document.querySelectorAll("[data-theme]").forEach(function (choice) {
      if (choice.classList.contains("theme-choice")) choice.setAttribute("aria-pressed", String(choice.dataset.theme === state.theme));
    });
  }
  function applyTheme(value, persist) {
    var next = validTheme(value) ? value : "A";
    // A blocked preference store must never prevent the page from loading.
    if (persist && !storeTheme(next)) next = "A";
    state.theme = next;
    document.body.dataset.theme = next;
    $("theme-stylesheet").href = "themes/" + next.toLowerCase() + ".css";
    document.querySelector('meta[name="theme-color"]').content = THEME_OPTIONS[next].color;
    var character = document.querySelector(".hero-character");
    character.src = "assets/themes/" + next.toLowerCase() + "/character.png";
    $("results-title").textContent = THEME_OPTIONS[next].section;
    updateThemeChoices();
  }
  function buildThemeChoices() {
    var choices = $("theme-choices");
    Object.keys(THEME_OPTIONS).forEach(function (key) {
      var option = THEME_OPTIONS[key];
      var button = node("button", "theme-choice");
      button.type = "button";
      button.dataset.theme = key;
      button.setAttribute("aria-pressed", String(key === state.theme));
      var preview = node("span", "theme-preview");
      var background = node("img", "theme-preview-background");
      background.src = "assets/themes/" + key.toLowerCase() + "/background.webp";
      background.alt = ""; background.loading = "lazy";
      var character = node("img", "theme-preview-character");
      character.src = "assets/themes/" + key.toLowerCase() + "/character.png";
      character.alt = ""; character.loading = "lazy";
      preview.append(background, character);
      var copy = node("span", "theme-choice-copy");
      copy.append(node("strong", "theme-choice-name", key + " · " + option.name), node("span", "theme-choice-description", option.description));
      button.append(preview, copy);
      button.addEventListener("click", function () {
        applyTheme(key, true);
        closeThemeDialog();
        announce(THEME_OPTIONS[state.theme].name + " 테마를 적용했어요.");
      });
      choices.appendChild(button);
    });
  }
  function openThemeDialog() {
    var dialog = $("theme-dialog");
    dialogOpener = document.activeElement;
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", ""); dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-modal", "true");
    }
    var active = dialog.querySelector('.theme-choice[aria-pressed="true"]');
    if (active) active.focus();
  }
  function closeThemeDialog() {
    var dialog = $("theme-dialog");
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
    if (dialogOpener && typeof dialogOpener.focus === "function") dialogOpener.focus();
    dialogOpener = null;
  }
  function themeDialogIsOpen() {
    var dialog = $("theme-dialog");
    return Boolean(dialog.open || dialog.hasAttribute("open"));
  }
  function renderCategories() {
    var host = $("category-list");
    host.replaceChildren();
    ["전체"].concat(categories).forEach(function (category) {
      var button = node("button", "category-pill", category);
      button.type = "button"; button.dataset.category = category;
      button.setAttribute("aria-pressed", String(category === state.category));
      button.classList.toggle("is-active", category === state.category);
      button.addEventListener("click", function () { state.category = category; renderCategories(); renderItems(); });
      host.appendChild(button);
    });
  }
  function imageElement(item) {
    var wrap = node("div", "item-image");
    var url = safeImageURL(item.image);
    if (url) {
      var image = node("img");
      image.src = url; image.alt = item.name; image.loading = "lazy"; image.decoding = "async";
      image.addEventListener("error", function () { wrap.replaceChildren(node("span", "image-fallback", "상품 이미지 준비 중")); });
      wrap.appendChild(image);
    } else wrap.appendChild(node("span", "image-fallback", "상품 이미지 준비 중"));
    return wrap;
  }
  function itemCard(item) {
    var article = node("article", "item-card");
    article.id = itemId(item.no); article.dataset.no = item.no;
    var content = node("div", "item-content");
    var meta = node("div", "item-meta");
    meta.append(node("span", "item-number", "영상 #" + item.no.padStart(3, "0")), node("span", "item-category", item.category));
    var title = node("h3", "item-name", item.name);
    content.appendChild(meta);
    if (item.hook) content.appendChild(node("p", "item-hook", item.hook));
    content.appendChild(title);
    if (item.facts.length) {
      var facts = node("ul", "item-facts");
      item.facts.forEach(function (fact) { if (fact) facts.appendChild(node("li", "", fact)); });
      content.appendChild(facts);
    }
    if (item.proof) content.appendChild(node("p", "item-proof", "확인 근거 · " + item.proof));
    if (item.checkedAt) content.appendChild(node("p", "item-checked", "확인일 · " + item.checkedAt));
    var url = safeURL(item.url);
    if (url) {
      var link = node("a", "item-cta", "쿠팡에서 구경하기");
      link.href = url; link.target = "_blank"; link.rel = "noopener sponsored";
      var arrow = node("span", "cta-arrow", "↗"); arrow.setAttribute("aria-hidden", "true"); link.appendChild(arrow);
      content.appendChild(link);
    } else {
      var disabled = node("button", "item-cta is-unavailable", "쿠팡에서 구경하기");
      disabled.type = "button"; disabled.disabled = true; disabled.setAttribute("aria-label", "상품 링크를 연결하기 전이에요.");
      content.appendChild(disabled);
    }
    article.append(imageElement(item), content);
    return article;
  }
  function setStatus(message, isError) {
    var host = $("status-message");
    host.replaceChildren();
    host.hidden = !message;
    host.setAttribute("role", isError ? "alert" : "status");
    if (message) host.appendChild(node("p", "", message));
    if (isError) {
      var button = node("button", "retry-load", "다시 불러오기"); button.type = "button";
      button.addEventListener("click", loadItems); host.appendChild(button);
    }
  }
  function renderItems() {
    filtered = items.filter(function (item) { return matches(item, state.query, state.category); });
    var list = $("item-list");
    list.replaceChildren();
    filtered.forEach(function (item) { list.appendChild(itemCard(item)); });
    $("result-count").textContent = filtered.length + "개의 발견";
    $("random-pick").disabled = state.loading || filtered.length === 0;
    if (!state.loading && !state.error) setStatus(filtered.length ? "" : (items.length ? "찾는 상품이 없어요. 이름이나 번호를 바꿔서 찾아보세요." : "아직 소개된 상품이 없어요."), false);
  }
  function highlight(no, shouldScroll) {
    var card = $(itemId(no));
    if (!card) return false;
    document.querySelectorAll(".item-card.is-highlighted").forEach(function (other) { other.classList.remove("is-highlighted"); });
    window.clearTimeout(highlightTimer);
    card.classList.add("is-highlighted");
    if (shouldScroll) card.scrollIntoView({ behavior: motionAllowed() ? "smooth" : "auto", block: "center" });
    highlightTimer = window.setTimeout(function () { card.classList.remove("is-highlighted"); }, 3500);
    return true;
  }
  function jumpToHash() {
    var no = parseHash(window.location.hash);
    if (!no || state.loading || state.error) return;
    var item = items.find(function (entry) { return entry.no === no; });
    if (!item) { announce("해당 번호의 상품이 없어요."); return; }
    if (!filtered.some(function (entry) { return entry.no === no; })) {
      state.query = ""; state.category = "전체"; $("item-search").value = "";
      renderCategories(); renderItems();
    }
    window.requestAnimationFrame(function () { highlight(no, true); });
  }
  function randomPick() {
    if (!filtered.length || state.loading) return;
    var item = filtered[Math.floor(Math.random() * filtered.length)];
    highlight(item.no, true);
    announce("No." + item.no.padStart(3, "0") + " " + item.name + "을 골랐어요.");
    try {
      var url = new URL(window.location.href); url.hash = itemId(item.no);
      window.history.replaceState(null, "", url.href);
    } catch (_) { /* Highlighting works even when URL changes are blocked. */ }
  }
  function loadItems() {
    var sequence = ++loadSequence;
    state.loading = true; state.error = false;
    $("item-list").setAttribute("aria-busy", "true");
    $("item-search").disabled = true; $("random-pick").disabled = true;
    setStatus("상품을 불러오는 중이에요.", false);
    return window.fetch("data/items.json", { credentials: "same-origin" }).then(function (response) {
      if (!response.ok) throw new Error("상품 목록을 불러오지 못했습니다.");
      return response.json();
    }).then(function (value) {
      if (sequence !== loadSequence) return;
      items = normalizeItems(value);
      categories = Array.from(new Set(items.map(function (item) { return item.category; }))).filter(function (category) { return category !== "전체"; });
      if (state.category !== "전체" && categories.indexOf(state.category) === -1) state.category = "전체";
      state.loading = false;
      $("item-search").disabled = false;
      $("item-list").setAttribute("aria-busy", "false");
      renderCategories(); renderItems(); jumpToHash();
    }).catch(function () {
      if (sequence !== loadSequence) return;
      state.loading = false; state.error = true; items = []; filtered = []; categories = [];
      $("item-list").replaceChildren(); $("item-list").setAttribute("aria-busy", "false");
      $("result-count").textContent = ""; $("random-pick").disabled = true;
      $("item-search").disabled = true; $("category-list").replaceChildren();
      setStatus("상품 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.", true);
    });
  }

  applyTheme(readTheme(), false);
  buildThemeChoices();
  $("theme-picker").addEventListener("click", openThemeDialog);
  $("close-theme-dialog").addEventListener("click", closeThemeDialog);
  $("theme-dialog").addEventListener("cancel", function (event) { event.preventDefault(); closeThemeDialog(); });
  $("theme-dialog").addEventListener("click", function (event) { if (event.target === $("theme-dialog")) closeThemeDialog(); });
  document.addEventListener("keydown", function (event) {
    var dialog = $("theme-dialog");
    if (!themeDialogIsOpen()) return;
    if (event.key === "Escape") { event.preventDefault(); closeThemeDialog(); return; }
    if (event.key === "Tab") {
      var controls = Array.from(dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled])'));
      if (!controls.length) return;
      var first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  $("item-search").addEventListener("input", function (event) { state.query = event.target.value; renderItems(); });
  $("random-pick").addEventListener("click", randomPick);
  window.addEventListener("hashchange", jumpToHash);
  var ready = loadItems();
  window.ByulApp = Object.freeze({
    normalizeNumber: normalizeNumber,
    normalizeText: normalizeText,
    normalizeItems: normalizeItems,
    matches: matches,
    parseHash: parseHash,
    safeURL: safeURL,
    safeImageURL: safeImageURL,
    ready: ready,
    getState: function () { return Object.freeze({ theme: state.theme, query: state.query, category: state.category, count: filtered.length, categories: Object.freeze(categories.slice()), visibleNumbers: Object.freeze(filtered.map(function (item) { return item.no; })) }); }
  });
})();

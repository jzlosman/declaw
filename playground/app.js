(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const data = globalThis.PLAIN_DEMO;
  if (!data?.cases?.length) { $("#fatal-error").hidden = false; return; }
  const mobile = matchMedia("(max-width: 900px)");
  const copyTimers = new WeakMap();
  const COPY_FEEDBACK_MS = 1600;
  let caseId = data.defaultCaseId, modeId = "plain", side = "rewrite", showChanges = false;
  let positions = { original: 0, rewrite: 0, changes: 0 };
  const currentCase = () => data.cases.find(c => c.id === caseId);
  const currentVariant = () => currentCase().variants.find(v => v.mode === modeId);
  const announce = text => { $("#announcer").textContent = text; };
  const viewKey = () => showChanges ? "changes" : side;

  function syncView() {
    document.body.dataset.view = showChanges ? "changes" : "reading";
    document.body.dataset.side = side;
    $(".documents").hidden = showChanges;
    $("#unified-panel").hidden = !showChanges;
    $(".mobile-tabs").hidden = showChanges;
    $('[data-diff]').setAttribute("aria-pressed", String(showChanges));
    $("#diff-label").textContent = showChanges ? "Hide changes" : "Show changes";
    $$('[role="tab"]').forEach(tab => {
      const selected = tab.dataset.side === side;
      tab.setAttribute("aria-selected", String(selected)); tab.tabIndex = selected ? 0 : -1;
    });
    ["original", "rewrite"].forEach(name => {
      const panel = $(`#${name}-panel`);
      if (mobile.matches) { panel.setAttribute("role", "tabpanel"); panel.setAttribute("aria-labelledby", `tab-${name}`); }
      else { panel.removeAttribute("role"); panel.setAttribute("aria-labelledby", `${name}-label`); }
    });
    // Phones scroll the document, not a nested focusable scroll region.
    $$('.reading-scroll').forEach(region => mobile.matches ? region.removeAttribute("tabindex") : region.setAttribute("tabindex", "0"));
  }
  function switchView(change) {
    if (mobile.matches) positions[viewKey()] = window.scrollY;
    change(); syncView();
    if (mobile.matches) window.scrollTo({ top: positions[viewKey()], behavior: "auto" });
  }
  function setChanges(next) {
    switchView(() => { showChanges = next; });
    announce(showChanges ? currentVariant().visibleChanged ? "Removals and additions shown together." : "No wording changes." : "Reading view.");
  }
  function writeHash() {
    try { history.replaceState(null, "", `#${new URLSearchParams({ example: caseId, mode: modeId })}`); }
    catch { /* Reading does not depend on local-file history support. */ }
  }
  function render(changedCase = false) {
    const sample = currentCase(), variant = currentVariant();
    const originalScroll = $("#original-scroll").scrollTop;
    $("#original-content").innerHTML = variant.beforeHtml;
    $("#rewrite-content").innerHTML = variant.afterHtml;
    $("#unified-content").innerHTML = variant.unifiedHtml;
    $("#case-label").textContent = sample.label;
    $("#rewrite-label").textContent = data.modes.find(m => m.id === modeId).label;
    $("#source-attribution").innerHTML = variant.attributionHtml;
    $("#unchanged-note").hidden = variant.visibleChanged;
    $("#no-changes").hidden = variant.visibleChanged;
    $(".diff-legend").hidden = !variant.visibleChanged;
    $("#example-select").value = caseId; $("#mode-select").value = modeId;
    $$('[data-case]').forEach(button => button.setAttribute("aria-pressed", String(button.dataset.case === caseId)));
    $$('[data-mode]').forEach(button => button.setAttribute("aria-pressed", String(button.dataset.mode === modeId)));
    $("#original-scroll").scrollTop = changedCase ? 0 : originalScroll;
    $("#rewrite-scroll").scrollTop = 0; $("#unified-scroll").scrollTop = 0;
    positions.rewrite = positions.changes = 0;
    if (changedCase) positions.original = 0;
    syncView();
    if (mobile.matches && (changedCase || showChanges || side === "rewrite")) window.scrollTo({ top: 0, behavior: "auto" });
  }
  function choose(kind, id) {
    const changedCase = kind === "case" && id !== caseId;
    if (kind === "case" && data.cases.some(c => c.id === id)) caseId = id;
    else if (kind === "mode" && data.modes.some(m => m.id === id)) modeId = id;
    else return;
    render(changedCase); writeHash();
    announce(`${currentCase().label}. ${data.modes.find(m => m.id === modeId).label}.`);
  }
  function readHash() {
    if (location.hash === "#workspace") return;
    const params = new URLSearchParams(location.hash.slice(1));
    const nextCase = params.get("example"), nextMode = params.get("mode");
    const oldCase = caseId;
    caseId = data.cases.some(c => c.id === nextCase) ? nextCase : data.defaultCaseId;
    modeId = data.modes.some(m => m.id === nextMode) ? nextMode : "plain";
    render(oldCase !== caseId);
  }
  for (const [selector, items] of [["#example-select", data.cases], ["#mode-select", data.modes]]) {
    $(selector).replaceChildren(...items.map(item => { const option = document.createElement("option"); option.value = item.id; option.textContent = item.label; return option; }));
  }
  $('[data-diff]').addEventListener("click", () => setChanges(!showChanges));
  $$('[data-case]').forEach(button => button.addEventListener("click", () => choose("case", button.dataset.case)));
  $$('[data-mode]').forEach(button => button.addEventListener("click", () => choose("mode", button.dataset.mode)));
  $("#example-select").addEventListener("change", event => choose("case", event.target.value));
  $("#mode-select").addEventListener("change", event => choose("mode", event.target.value));
  $$('[role="tab"]').forEach(tab => tab.addEventListener("click", () => switchView(() => { side = tab.dataset.side; })));
  document.addEventListener("keydown", event => {
    const tab = event.target?.closest?.('[role="tab"]');
    if (tab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      switchView(() => { side = event.key === "Home" ? "original" : event.key === "End" ? "rewrite" : side === "original" ? "rewrite" : "original"; });
      $(`#tab-${side}`).focus({ preventScroll: true });
    }
    const group = event.target?.closest?.('[data-picker-group]');
    if (group && ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      const buttons = [...group.querySelectorAll("button")], at = buttons.indexOf(document.activeElement);
      if (at >= 0) { event.preventDefault(); buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (at + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length].focus(); }
    }
  });
  $$('[data-copy]').forEach(button => button.addEventListener("click", async () => {
    const text = button.dataset.copy === "original" ? currentCase().original : currentVariant().text;
    try {
      await navigator.clipboard.writeText(text);
      announce("Copied."); clearTimeout(copyTimers.get(button)); button.dataset.copied = "true";
      copyTimers.set(button, setTimeout(() => { delete button.dataset.copied; }, COPY_FEEDBACK_MS));
    } catch { announce("Copy unavailable. Select the text to copy it."); }
  }));
  window.addEventListener("hashchange", readHash);
  mobile.addEventListener("change", () => { positions = { original: 0, rewrite: 0, changes: 0 }; syncView(); });
  $$('[data-interactive]').forEach(control => { control.disabled = false; });
  render(); readHash();
})();

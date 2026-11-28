"use strict";

const ui = Object.fromEntries(Array.from(document.querySelectorAll("[id]"), (node) => [node.id, node]));
const native = window.__TAURI__;
const files = new Map();
const { t } = i18n;
const selectControls = enhanceSelects(document.querySelectorAll("[data-custom-select]"));
const views = ["conversion", "history", "settings", "updates"];
const formatNames = { hls: "HLS", mp4: "MP4", webm: "WebM" };

let preferences;
let loaded = false;
let inspecting = false;
let choosing = false;
let active = null;
let lastBatch = null;
let editing = null;
let saveSequence = Promise.resolve();
let previewRevision = 0;
let previewTimer;
let previewPending = false;
let currentView = "conversion";
let historyRequest = 0;
let historyTimer;
let historyDeleteTarget = null;
let deletingHistory = false;
let installingUpdate = false;

function invoke(command, args) {
  return native.core.invoke(command, args);
}

function basename(path) {
  return path.split(/[\\/]/).at(-1);
}

function parentPath(path) {
  const separator = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  if (separator < 0) return "";
  return path.slice(0, separator === 2 && path[1] === ":" ? 3 : separator);
}

function pathKey(path) {
  return path.replaceAll("/", "\\").toLocaleLowerCase("en-US");
}

function displayName(path) {
  const name = basename(path);
  return /^playlist\.m3u8$/i.test(name) ? `${basename(parentPath(path))}/${name}` : name;
}

function currentSelection() {
  return Array.from(files.values()).filter((item) => item.status !== "done");
}

function requestItems(items) {
  return items.map(({ path, stem }) => ({ path, stem }));
}

function requestPreviews(items) {
  return items.map(({ path, stem, bytes, duration, width, height, frameRate, videoBitrate, hasAudio }) => ({
    path, stem, bytes, video: { duration, width, height, frameRate, videoBitrate, hasAudio },
  }));
}

function showAlert(message) {
  ui["app-alert"].querySelector(".alert-text").textContent = message;
  ui["app-alert"].hidden = false;
}

function showError(message, error) {
  showAlert(`${message}\n${typeof error === "string" ? error : error?.message ?? String(error)}`);
}

function dismissAlert() {
  ui["app-alert"].hidden = true;
}

function sizeUnit(bytes) {
  if (bytes >= 1024 ** 3) return [1024 ** 3, t("gb")];
  if (bytes >= 1024 ** 2) return [1024 ** 2, t("mb")];
  if (bytes >= 1024) return [1024, t("kb")];
  return [1, t("bytes")];
}

function displayDuration(duration) {
  if (!Number.isFinite(duration) || duration <= 0) return "";
  const seconds = Math.round(duration);
  const hours = Math.floor(seconds / 3600);
  const minutes = String(Math.floor(seconds / 60) % 60).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${hours ? `${hours}:` : ""}${minutes}:${remainder}`;
}

function updateSizeEstimate(item) {
  const band = item.row.querySelector(".size-band");
  const amount = band.querySelector(".size-number");
  const unitLabel = band.querySelector(".size-unit");
  if (!item.estimate) {
    amount.textContent = t(previewPending ? "estimating" : "unknown");
    unitLabel.textContent = "";
    band.removeAttribute("title");
    return;
  }
  const { minimumBytes, maximumBytes } = item.estimate;
  const [divisor, unit] = sizeUnit(maximumBytes);
  const decimal = i18n.formats.decimal;
  const lower = decimal.format(minimumBytes / divisor);
  const upper = decimal.format(maximumBytes / divisor);
  amount.textContent = lower === upper ? lower : t("sizeRange", { lower, upper });
  unitLabel.textContent = unit;
  band.title = t("approximateSize", { size: amount.textContent, unit });
}

function updateRow(item) {
  const row = item.row;
  const outputPath = item.output || item.preview;
  const output = row.querySelector(".output-name");
  const status = row.querySelector(".queue-status");
  const progress = row.querySelector(".queue-progress");
  const error = row.querySelector(".queue-error");
  const { integer, decimal, percent } = i18n.formats;
  row.dataset.status = item.status;
  output.textContent = outputPath ? displayName(outputPath)
    : t(previewPending ? "calculating" : "noOutputName");
  output.title = outputPath || "";
  status.textContent = item.status === "running"
    ? t("runningProgress", { percent: percent.format(item.progress / 100) }) : t(`status_${item.status}`);
  const meta = row.querySelector(".file-meta");
  meta.title = t("inputResolution", { width: integer.format(item.width), height: integer.format(item.height) });
  const [sizeScale, unit] = sizeUnit(item.bytes);
  meta.querySelector(".meta-size").textContent = `${decimal.format(item.bytes / sizeScale)} ${unit}`;
  progress.setAttribute("aria-label", t("itemProgress", { name: item.name }));
  row.querySelector(".play-output").hidden = !item.output || !window.playConvertedOutput;
  row.querySelector(".show-file").hidden = !item.output;
  row.querySelector(".remove-file").disabled = active !== null;
  row.querySelector(".rename-file").hidden = item.status === "done";
  row.querySelector(".rename-file").disabled = active !== null;
  progress.hidden = item.status !== "running";
  progress.value = item.progress;
  error.hidden = !item.error;
  error.querySelector(".queue-error-text").textContent = item.error || "";
  updateSizeEstimate(item);
}

function addRow(item) {
  const row = ui["queue-template"].content.firstElementChild.cloneNode(true);
  item.row = row;
  const filename = row.querySelector(".file-name");
  filename.textContent = item.name;
  filename.title = item.path;
  const meta = row.querySelector(".file-meta");
  const duration = displayDuration(item.duration);
  meta.querySelector(".meta-duration").hidden = !duration;
  meta.querySelector(".meta-duration bdi").textContent = duration;
  row.querySelector(".remove-file").addEventListener("click", () => {
    files.delete(item.path);
    row.remove();
    updateChrome();
    schedulePreview();
  });
  row.querySelector(".rename-file").addEventListener("click", () => editName(item));
  row.querySelector(".play-output").addEventListener("click", () => playOutput(item.output));
  row.querySelector(".show-file").addEventListener("click", () => reveal(item.output, "show_in_explorer"));
  ui["queue-list"].append(row);
  updateRow(item);
}

function updateChrome() {
  const { integer, percent: percentFormat } = i18n.formats;
  const canAdd = loaded && active === null && !inspecting && !choosing && !installingUpdate;
  const waiting = currentSelection();
  const completed = Array.from(files.values()).filter((item) => item.output);
  const retryOnly = waiting.length > 0 && waiting.every((item) => item.status !== "ready");
  ui["add-files"].disabled = !canAdd;
  ui["drop-choose"].disabled = !canAdd;
  ui["drop-zone"].setAttribute("aria-disabled", String(!canAdd));
  ui["settings-controls"].disabled = !loaded || active !== null || installingUpdate;
  if (ui["settings-controls"].disabled) selectControls.close();
  ui["action-bar"].hidden = currentView !== "conversion" && active === null;
  ui["clear-files"].disabled = files.size === 0 || active !== null || inspecting || installingUpdate;
  ui["start-batch"].disabled = !canAdd || waiting.length === 0 || previewPending;
  const startLabel = t(retryOnly ? "retry" : "startConversion");
  ui["start-batch"].setAttribute("aria-label", startLabel);
  ui["start-batch"].title = startLabel;
  ui["start-batch"].firstElementChild.className = `icon icon-${retryOnly ? "refresh" : "play"}`;
  ui["open-output"].hidden = completed.length === 0;
  ui["cancel-batch"].hidden = active === null;
  ui["cancel-batch"].disabled = Boolean(active?.cancelling);
  const stopLabel = t(active?.cancelling ? "stopping" : "stopConversion");
  ui["cancel-batch"].setAttribute("aria-label", stopLabel);
  ui["cancel-batch"].title = stopLabel;
  ui["file-count"].textContent = integer.format(files.size);
  ui["empty-queue"].hidden = files.size > 0;
  ui["queue-scroll"].hidden = files.size === 0;
  ui["batch-indicator"].classList.toggle("is-busy", active !== null || inspecting);

  let title = t("readyForVideos");
  let caption = t("startHint");
  ui["batch-progress"].hidden = active === null;
  if (active) {
    const percent = Math.floor(active.items.reduce((sum, item) => sum + item.progress, 0) / active.items.length);
    const done = active.items.filter((item) => item.status === "done").length;
    ui["batch-progress"].value = percent;
    title = active.cancelling ? t("stoppingQueue") : t("runningProgress", { percent: percentFormat.format(percent / 100) });
    caption = t("batchCount", { done: integer.format(done), total: integer.format(active.items.length) });
  } else if (inspecting) {
    title = t("inspectingFiles");
    caption = t("inspectingHint");
  } else if (lastBatch) {
    const { done, errors, cancelled } = lastBatch;
    title = t(cancelled > 0 ? "queueStopped" : "batchFinished");
    const parts = [t("outputsReady", { count: integer.format(done) })];
    if (errors > 0) parts.push(t("errorsCount", { count: integer.format(errors) }));
    if (cancelled > 0) parts.push(t("stoppedCount", { count: integer.format(cancelled) }));
    caption = parts.join(t("listSeparator"));
  } else if (waiting.length > 0) {
    title = t(waiting.length === 1 ? "videoReady" : "videosReady", { count: integer.format(waiting.length) });
    caption = t("reviewOutputs");
  }
  ui["status-title"].textContent = title;
  ui["status-caption"].textContent = caption;
}

function renderPreferences() {
  const { settings, finglish, outputDirectory, language } = preferences;
  i18n.setLanguage(language);
  ui.language.value = language === "en" ? "en" : "fa";
  ui.format.value = settings.format;
  ui.quality.value = settings.quality;
  ui.resolution.value = settings.maxWidth ? `width-${settings.maxWidth}` : settings.maxHeight ?? "";
  ui["segment-seconds"].value = settings.segmentSeconds;
  ui["segment-minus"].disabled = settings.segmentSeconds <= 2;
  ui["segment-plus"].disabled = settings.segmentSeconds >= 30;
  ui.encrypt.checked = settings.encrypt;
  ui.finglish.checked = finglish;
  ui["format-help"].textContent = t(`format_${settings.format}`);
  ui["hls-settings"].hidden = settings.format !== "hls";
  selectControls.sync();

  const destination = ui["destination-path"];
  destination.textContent = outputDirectory || t("besideInputs");
  destination.title = outputDirectory || "";
  ui["reset-destination"].hidden = !outputDirectory;
  const help = ui["destination-help"];
  const folder = settings.format === "hls" ? "output_hls" : "output_video";
  help.textContent = outputDirectory ? t("customDestination") : t("defaultDestination", { folder });
}

function changePreferences(change, affectsOutput = false) {
  change(preferences);
  renderPreferences();
  const snapshot = structuredClone(preferences);
  saveSequence = saveSequence.then(() => invoke("save_preferences", { preferences: snapshot })).catch((error) => {
    showError(t("savePreferencesError"), error);
  });
  if (affectsOutput) schedulePreview();
}

function schedulePreview() {
  clearTimeout(previewTimer);
  const revision = ++previewRevision;
  const items = currentSelection();
  previewPending = items.length > 0 && active === null;
  updateChrome();
  if (!previewPending) return;
  for (const item of items) {
    item.preview = null;
    item.estimate = null;
    updateRow(item);
  }
  previewTimer = setTimeout(async () => {
    try {
      const outputs = await invoke("preview_outputs", { items: requestPreviews(items), preferences });
      if (revision !== previewRevision || active) return;
      for (const [index, item] of items.entries()) {
        item.preview = outputs[index].path;
        item.estimate = outputs[index].estimate;
        updateRow(item);
      }
    } catch (error) {
      if (revision === previewRevision) showError(t("previewError"), error);
    } finally {
      if (revision === previewRevision) {
        previewPending = false;
        for (const item of items) updateRow(item);
        updateChrome();
      }
    }
  }, 90);
}

async function addFiles(paths) {
  if (!loaded || active || inspecting || installingUpdate || !paths?.length) return;
  const existing = new Set(Array.from(files.keys(), pathKey));
  const unique = [];
  for (const path of paths) {
    const key = pathKey(path);
    if (existing.has(key)) continue;
    existing.add(key);
    unique.push(path);
  }
  if (!unique.length) return;

  inspecting = true;
  dismissAlert();
  updateChrome();
  try {
    await saveSequence;
    const { items, errors } = await invoke("inspect_files", { paths: unique });
    if (items.length) lastBatch = null;
    for (const metadata of items) {
      if (files.has(metadata.path)) continue;
      const item = { ...metadata, stem: null, status: "ready", progress: 0 };
      files.set(item.path, item);
      addRow(item);
    }
    if (errors.length) {
      const reasons = errors.map(({ path, error }) => `\u2068${basename(path)}\u2069 − ${error}`);
      showAlert(`${t("someFilesError")}\n${reasons.join("\n")}`);
    }
  } catch (error) {
    showError(t("inspectError"), error);
  } finally {
    inspecting = false;
    updateChrome();
    schedulePreview();
  }
}

async function chooseFiles() {
  if (choosing || inspecting || active || installingUpdate) return;
  choosing = true;
  updateChrome();
  try {
    await saveSequence;
    await addFiles(await invoke("choose_files"));
  } catch (error) {
    showError(t("fileDialogError"), error);
  } finally {
    choosing = false;
    updateChrome();
  }
}

async function chooseDestination() {
  if (choosing || active || installingUpdate) return;
  choosing = true;
  updateChrome();
  try {
    await saveSequence;
    const outputDirectory = await invoke("choose_output_directory");
    if (outputDirectory) changePreferences((value) => { value.outputDirectory = outputDirectory; }, true);
  } catch (error) {
    showError(t("folderDialogError"), error);
  } finally {
    choosing = false;
    updateChrome();
  }
}

function editName(item) {
  editing = item;
  ui["rename-original"].textContent = item.name;
  ui["rename-input"].value = item.stem || "";
  const outputPath = item.preview;
  if (outputPath) {
    const name = basename(outputPath);
    ui["rename-input"].placeholder = /^playlist\.m3u8$/i.test(name)
      ? basename(parentPath(outputPath)) : name.replace(/\.[^.]*$/, "");
  } else {
    ui["rename-input"].placeholder = item.name.replace(/\.[^.]*$/, "");
  }
  ui["rename-dialog"].showModal();
}

function applyName(stem) {
  if (!editing) return;
  editing.stem = stem;
  ui["rename-dialog"].close();
  schedulePreview();
}

async function reveal(path, command) {
  if (!path) return;
  try {
    await invoke(command, { path });
  } catch (error) {
    showError(t("explorerError"), error);
  }
}

async function playOutput(path) {
  try {
    await window.playConvertedOutput(path);
  } catch (error) {
    showError(t("playOutputError"), error);
  }
}

function renderHistory(entries) {
  const { day: dayFormat, time: timeFormat, integer } = i18n.formats;
  const groups = document.createDocumentFragment();
  let currentDay;
  let list;
  for (const item of entries) {
    const time = new Date(item.finishedAt);
    const validTime = Number.isFinite(time.getTime());
    const day = validTime ? dayFormat.format(time) : t("unknownHistoryTime");
    if (day !== currentDay) {
      currentDay = day;
      const group = document.createElement("section");
      group.className = "history-group";
      const heading = document.createElement("h2");
      heading.textContent = day;
      list = document.createElement("ul");
      group.append(heading, list);
      groups.append(group);
    }
    const row = ui["history-template"].content.firstElementChild.cloneNode(true);
    row.dataset.status = item.status;
    const input = row.querySelector(".file-name");
    input.textContent = basename(item.source);
    input.title = item.source;
    const output = row.querySelector(".history-output");
    if (item.output) {
      output.textContent = displayName(item.output);
      output.title = item.output;
      output.hidden = false;
      const play = row.querySelector(".history-play");
      const revealFile = row.querySelector(".history-show");
      play.hidden = false;
      revealFile.hidden = false;
      play.addEventListener("click", () => playOutput(item.output));
      revealFile.addEventListener("click", () => reveal(item.output, "show_in_explorer"));
    }
    row.querySelector(".history-remove").addEventListener("click", () => confirmHistoryDelete(item.id));
    const meta = row.querySelector(".history-meta");
    const format = document.createElement("bdi");
    format.textContent = formatNames[item.settings.format];
    const quality = document.createElement("span");
    quality.textContent = t(`quality_${item.settings.quality}`);
    meta.append(format, quality);
    row.querySelector(".queue-status").textContent = t(`status_${item.status}`);
    if (validTime) {
      const stamp = row.querySelector("time");
      stamp.dateTime = time.toISOString();
      stamp.textContent = timeFormat.format(time);
    }
    if (item.error) {
      const error = row.querySelector(".history-error");
      error.hidden = false;
      error.querySelector(".queue-error-text").textContent = item.error;
    }
    list.append(row);
  }
  ui["history-list"].replaceChildren(groups);
  ui["history-count"].textContent = t("historyCount", { count: integer.format(entries.length) });
  ui["history-count"].hidden = entries.length === 0;
  ui["history-clear"].hidden = entries.length === 0;
  ui["history-empty"].hidden = entries.length > 0;
  ui["history-state-title"].textContent = t("emptyHistory");
  ui["history-state-detail"].textContent = t("emptyHistoryHelp");
  ui["history-convert"].hidden = false;
}

async function refreshHistory() {
  const request = ++historyRequest;
  const list = ui["history-list"];
  list.setAttribute("aria-busy", "true");
  try {
    const entries = await invoke("get_history");
    if (request === historyRequest) renderHistory(entries);
  } catch (error) {
    if (request !== historyRequest) return;
    if (!list.childElementCount) {
      ui["history-clear"].hidden = true;
      ui["history-empty"].hidden = false;
      ui["history-state-title"].textContent = t("historyLoadFailed");
      ui["history-state-detail"].textContent = t("historyTryAgain");
      ui["history-convert"].hidden = true;
    }
    showError(t("readHistoryError"), error);
  } finally {
    if (request === historyRequest) list.setAttribute("aria-busy", "false");
  }
}

function historyChanged({ payload }) {
  if (payload) showError(t("writeHistoryError"), payload);
  if (currentView !== "history") return;
  clearTimeout(historyTimer);
  historyTimer = setTimeout(refreshHistory, 120);
}

function confirmHistoryDelete(id) {
  if (deletingHistory || installingUpdate) return;
  const dialog = ui["history-delete-dialog"];
  historyDeleteTarget = id;
  ui["history-delete-title"].textContent = t(id === null ? "confirmClearHistory" : "confirmRemoveHistory");
  dialog.returnValue = "cancel";
  dialog.showModal();
}

async function deleteHistory(id) {
  deletingHistory = true;
  ui["history-clear"].disabled = true;
  try {
    await invoke("delete_history", { id });
  } catch (error) {
    showError(t("deleteHistoryError"), error);
  } finally {
    deletingHistory = false;
    ui["history-clear"].disabled = false;
    if (currentView === "history") await refreshHistory();
  }
}

function showView(view) {
  currentView = view;
  selectControls.close();
  ui["drop-zone"].classList.remove("drag-active");
  for (const name of views) {
    ui[`${name}-view`].hidden = name !== view;
    if (name === view) ui[`${name}-nav`].setAttribute("aria-current", "page");
    else ui[`${name}-nav`].removeAttribute("aria-current");
  }
  updateChrome();
  window.scrollTo(0, 0);
  if (view === "history") void refreshHistory();
}

function setSidebarCollapsed(collapsed) {
  const label = t(collapsed ? "expandSidebar" : "collapseSidebar");
  ui["app-sidebar"].classList.toggle("is-collapsed", collapsed);
  ui["sidebar-toggle"].setAttribute("aria-expanded", String(!collapsed));
  ui["sidebar-toggle"].setAttribute("aria-label", label);
  ui["sidebar-toggle"].title = label;
  ui["sidebar-toggle-label"].textContent = label;
}

async function startBatch() {
  if (active || choosing || inspecting || previewPending || installingUpdate) return;
  const items = currentSelection();
  if (!items.length) return;
  dismissAlert();
  ++previewRevision;
  clearTimeout(previewTimer);
  const previous = items.map(({ status, progress, error }) => ({ status, progress, error }));
  const batch = { items, cancelling: false };
  active = batch;
  lastBatch = null;
  for (const item of items) Object.assign(item, { status: "queued", progress: 0, error: null });
  for (const item of files.values()) updateRow(item);
  updateChrome();

  try {
    await invoke("start_batch", { items: requestItems(items), preferences });
  } catch (error) {
    if (active !== batch) return;
    active = null;
    for (const [index, item] of items.entries()) Object.assign(item, previous[index]);
    for (const item of files.values()) updateRow(item);
    updateChrome();
    showError(t("startError"), error);
    if (items.some((item) => !item.preview)) schedulePreview();
  }
}

async function cancelBatch() {
  if (!active || active.cancelling) return;
  const batch = active;
  batch.cancelling = true;
  updateChrome();
  try {
    await invoke("cancel_batch");
  } catch (error) {
    if (active === batch) {
      batch.cancelling = false;
      updateChrome();
      showError(t("stopError"), error);
    }
  }
}

function jobUpdate({ payload }) {
  const item = files.get(payload.path);
  if (!active || !item || !active.items.includes(item)) return;
  item.status = payload.status;
  item.progress = payload.progress ?? 0;
  item.output = payload.output || null;
  item.error = payload.error || null;
  updateRow(item);
  updateChrome();
}

function batchFinished() {
  if (!active) return;
  for (const item of active.items) {
    if (item.status === "queued" || item.status === "running") {
      item.status = active.cancelling ? "cancelled" : "error";
      item.error = active.cancelling ? null : t("missingFinalStatus");
    }
  }
  lastBatch = {
    done: active.items.filter((item) => item.status === "done").length,
    errors: active.items.filter((item) => item.status === "error").length,
    cancelled: active.items.filter((item) => item.status === "cancelled").length,
  };
  active = null;
  for (const item of files.values()) updateRow(item);
  updateChrome();
  if (lastBatch.done > 0 || currentSelection().some((item) => !item.preview)) schedulePreview();
}

function handleDrop({ payload }) {
  const available = currentView === "conversion" && loaded && !active && !inspecting && !choosing && !installingUpdate;
  ui["drop-zone"].classList.toggle("drag-active", available && (payload.type === "enter" || payload.type === "over"));
  if (available && payload.type === "drop") void addFiles(payload.paths);
}

function attachControls() {
  for (const view of views) ui[`${view}-nav`].addEventListener("click", () => showView(view));
  const sidebarPreference = localStorage.getItem("sidebar-collapsed");
  setSidebarCollapsed(sidebarPreference === null ? matchMedia("(max-width: 760px)").matches : sidebarPreference === "true");
  ui["sidebar-toggle"].addEventListener("click", () => {
    const collapsed = !ui["app-sidebar"].classList.contains("is-collapsed");
    setSidebarCollapsed(collapsed);
    localStorage.setItem("sidebar-collapsed", String(collapsed));
  });
  ui.language.addEventListener("change", () => changePreferences((value) => { value.language = ui.language.value; }));
  document.addEventListener("language-changed", () => {
    setSidebarCollapsed(ui["app-sidebar"].classList.contains("is-collapsed"));
    for (const item of files.values()) updateRow(item);
    dismissAlert();
    updateChrome();
  });
  ui["history-clear"].addEventListener("click", () => confirmHistoryDelete(null));
  ui["history-delete-dialog"].addEventListener("close", ({ target }) => {
    if (target.returnValue === "delete") void deleteHistory(historyDeleteTarget);
    historyDeleteTarget = null;
  });
  ui["history-convert"].addEventListener("click", () => {
    showView("conversion");
    (ui["add-files"].disabled ? ui["conversion-nav"] : ui["add-files"]).focus();
  });
  ui["dismiss-alert"].addEventListener("click", dismissAlert);
  ui["add-files"].addEventListener("click", chooseFiles);
  ui["drop-choose"].addEventListener("click", chooseFiles);
  ui["choose-destination"].addEventListener("click", chooseDestination);
  ui["reset-destination"].addEventListener("click", () => changePreferences((value) => { value.outputDirectory = null; }, true));
  ui.finglish.addEventListener("change", ({ target }) => changePreferences((value) => { value.finglish = target.checked; }, true));
  const settingControls = {
    format: ["format", (node) => node.value],
    quality: ["quality", (node) => node.value],
    "segment-seconds": ["segmentSeconds", (node) => node.checkValidity() && node.value ? node.valueAsNumber : preferences.settings.segmentSeconds],
    encrypt: ["encrypt", (node) => node.checked],
  };
  for (const [control, [key, read]] of Object.entries(settingControls)) {
    ui[control].addEventListener("change", ({ target }) => {
      changePreferences(({ settings }) => { settings[key] = read(target); }, key === "format" || key === "quality");
    });
  }
  ui.resolution.addEventListener("change", ({ target }) => {
    changePreferences(({ settings }) => {
      settings.maxWidth = target.value === "width-1024" ? 1024 : null;
      settings.maxHeight = settings.maxWidth ? null : Number(target.value) || null;
    }, true);
  });
  for (const [id, direction] of [["segment-minus", -1], ["segment-plus", 1]]) {
    ui[id].addEventListener("click", () => {
      const input = ui["segment-seconds"];
      input.value = Math.max(Number(input.min), Math.min(Number(input.max), preferences.settings.segmentSeconds + direction));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  ui["clear-files"].addEventListener("click", () => {
    files.clear();
    lastBatch = null;
    ui["queue-list"].replaceChildren();
    updateChrome();
    schedulePreview();
  });
  ui["start-batch"].addEventListener("click", startBatch);
  ui["cancel-batch"].addEventListener("click", cancelBatch);
  ui["open-output"].addEventListener("click", () => {
    const item = Array.from(files.values()).findLast((file) => file.output);
    if (item) void reveal(parentPath(item.output), "open_folder");
  });
  ui["close-rename"].addEventListener("click", () => ui["rename-dialog"].close());
  ui["rename-dialog"].addEventListener("close", () => { editing = null; });
  ui["reset-rename"].addEventListener("click", () => applyName(null));
  ui["rename-form"].addEventListener("submit", (event) => {
    event.preventDefault();
    applyName(ui["rename-input"].value.trim() || null);
  });
}

async function initialize() {
  const localIcon = new Image();
  localIcon.addEventListener("load", () => document.documentElement.classList.remove("text-actions"), { once: true });
  localIcon.src = "vendor/iconly/video.svg";
  attachControls();
  try {
    const [saved] = await Promise.all([
      invoke("get_preferences"),
      native.event.listen("job-update", jobUpdate),
      native.event.listen("batch-finished", batchFinished),
      native.event.listen("history-changed", historyChanged),
      native.webview.getCurrentWebview().onDragDropEvent(handleDrop),
    ]);
    preferences = saved;
    renderPreferences();
    loaded = true;
    updateChrome();
    void initializeUpdates({
      invoke,
      listen: native.event.listen,
      canInstall: () => !active && !inspecting && !choosing && !editing && !deletingHistory
        && !ui["history-delete-dialog"].open && !currentSelection().length && !window.isOutputPlaybackBusy(),
      finishSaving: () => saveSequence,
      onInstalling: (value) => { installingUpdate = value; updateChrome(); },
    });
  } catch (error) {
    showError(t("engineConnectionError"), error);
  }
}

void initialize();

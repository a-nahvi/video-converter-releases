"use strict";

const ui = Object.fromEntries(Array.from(document.querySelectorAll("[id]"), (node) => [node.id, node]));
const native = window.__TAURI__;
const files = new Map();
const number = new Intl.NumberFormat("fa-IR");
const decimal = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 });
const historyDay = new Intl.DateTimeFormat("fa-IR", { dateStyle: "full" });
const historyTime = new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit" });
const selectControls = enhanceSelects(document.querySelectorAll("[data-custom-select]"));
const views = ["conversion", "history", "settings", "updates"];
const statusLabels = {
  ready: "در انتظار",
  queued: "در صف",
  running: "در حال تبدیل",
  done: "تبدیل شد",
  error: "خطا",
  cancelled: "متوقف شد",
};
const formatHelp = {
  hls: "یک ZIP شامل فهرست پخش و قطعه‌های HLS",
  mp4: "فایل MP4 با ویدیوی H.264 و صدای AAC، داخل ZIP",
  webm: "فایل WebM با ویدیوی VP9 و صدای Opus، داخل ZIP",
};
const formatNames = { hls: "HLS", mp4: "MP4", webm: "WebM" };
const qualityNames = { high: "کیفیت بالا", balanced: "کیفیت متعادل", compact: "کم‌حجم" };

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
  if (bytes >= 1024 ** 3) return [1024 ** 3, "گیگابایت"];
  if (bytes >= 1024 ** 2) return [1024 ** 2, "مگابایت"];
  if (bytes >= 1024) return [1024, "کیلوبایت"];
  return [1, "بایت"];
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
    amount.textContent = previewPending ? "در حال برآورد" : "نامشخص";
    amount.dir = "rtl";
    unitLabel.textContent = "";
    band.removeAttribute("title");
    return;
  }
  const { minimumBytes, maximumBytes } = item.estimate;
  const [divisor, unit] = sizeUnit(maximumBytes);
  const lower = decimal.format(minimumBytes / divisor);
  const upper = decimal.format(maximumBytes / divisor);
  amount.dir = "rtl";
  amount.textContent = lower === upper ? lower : `${lower} تا ${upper}`;
  unitLabel.textContent = unit;
  band.title = `حدود ${amount.textContent} ${unit}`;
}

function updateRow(item) {
  const row = item.row;
  const outputPath = item.output || item.preview;
  const output = row.querySelector(".output-name");
  const status = row.querySelector(".queue-status");
  const progress = row.querySelector(".queue-progress");
  const error = row.querySelector(".queue-error");
  row.dataset.status = item.status;
  output.textContent = outputPath ? displayName(outputPath)
    : previewPending ? "در حال محاسبه…" : "نام خروجی در دسترس نیست";
  output.title = outputPath || "";
  status.textContent = item.status === "running"
    ? `${statusLabels.running} ${number.format(item.progress)}٪` : statusLabels[item.status];
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
  meta.title = `وضوح ورودی ${item.width} در ${item.height} پیکسل`;
  const duration = displayDuration(item.duration);
  meta.querySelector(".meta-duration").hidden = !duration;
  meta.querySelector(".meta-duration bdi").textContent = duration;
  const [sizeScale, unit] = sizeUnit(item.bytes);
  meta.querySelector(".meta-size").textContent = `${decimal.format(item.bytes / sizeScale)} ${unit}`;
  row.querySelector(".queue-progress").setAttribute("aria-label", `پیشرفت تبدیل ${item.name}`);
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
  const startLabel = retryOnly ? "تلاش دوباره" : "شروع تبدیل";
  ui["start-batch"].setAttribute("aria-label", startLabel);
  ui["start-batch"].title = startLabel;
  ui["start-batch"].firstElementChild.className = `icon icon-${retryOnly ? "refresh" : "play"}`;
  ui["open-output"].hidden = completed.length === 0;
  ui["cancel-batch"].hidden = active === null;
  ui["cancel-batch"].disabled = Boolean(active?.cancelling);
  const stopLabel = active?.cancelling ? "در حال توقف…" : "توقف تبدیل";
  ui["cancel-batch"].setAttribute("aria-label", stopLabel);
  ui["cancel-batch"].title = stopLabel;
  ui["file-count"].textContent = number.format(files.size);
  ui["empty-queue"].hidden = files.size > 0;
  ui["queue-scroll"].hidden = files.size === 0;
  ui["batch-indicator"].classList.toggle("is-busy", active !== null || inspecting);

  let title = "آماده برای افزودن ویدیو";
  let caption = "برای شروع، یک ویدیو به صف اضافه کنید.";
  ui["batch-progress"].hidden = active === null;
  if (active) {
    const percent = Math.floor(active.items.reduce((sum, item) => sum + item.progress, 0) / active.items.length);
    const done = active.items.filter((item) => item.status === "done").length;
    ui["batch-progress"].value = percent;
    title = active.cancelling ? "در حال توقف صف" : `در حال تبدیل، ${number.format(percent)}٪`;
    caption = `${number.format(done)} از ${number.format(active.items.length)} فایل تبدیل شد.`;
  } else if (inspecting) {
    title = "در حال بررسی فایل‌ها";
    caption = "مشخصات ویدیوها در حال خواندن است.";
  } else if (lastBatch) {
    const { done, errors, cancelled } = lastBatch;
    title = cancelled > 0 ? "صف متوقف شد" : "تبدیل به پایان رسید";
    const parts = [`${number.format(done)} خروجی آماده`];
    if (errors > 0) parts.push(`${number.format(errors)} خطا`);
    if (cancelled > 0) parts.push(`${number.format(cancelled)} متوقف`);
    caption = parts.join("، ");
  } else if (waiting.length > 0) {
    title = `${number.format(waiting.length)} ویدیو آمادهٔ تبدیل`;
    caption = "تنظیمات و نام خروجی‌ها را بررسی کنید.";
  }
  ui["status-title"].textContent = title;
  ui["status-caption"].textContent = caption;
}

function renderPreferences() {
  const { settings, finglish, outputDirectory } = preferences;
  ui.format.value = settings.format;
  ui.quality.value = settings.quality;
  ui.resolution.value = settings.maxWidth ? `width-${settings.maxWidth}` : settings.maxHeight ?? "";
  ui["segment-seconds"].value = settings.segmentSeconds;
  ui["segment-minus"].disabled = settings.segmentSeconds <= 2;
  ui["segment-plus"].disabled = settings.segmentSeconds >= 30;
  ui.encrypt.checked = settings.encrypt;
  ui.finglish.checked = finglish;
  ui["format-help"].textContent = formatHelp[settings.format];
  ui["hls-settings"].hidden = settings.format !== "hls";
  selectControls.sync();

  const destination = ui["destination-path"];
  destination.textContent = outputDirectory || "کنار فایل‌های ورودی";
  destination.title = outputDirectory || "";
  ui["reset-destination"].hidden = !outputDirectory;
  const help = ui["destination-help"];
  help.replaceChildren();
  if (outputDirectory) {
    help.textContent = "همهٔ خروجی‌ها در این پوشه ذخیره می‌شوند.";
  } else {
    const name = document.createElement("bdi");
    name.textContent = settings.format === "hls" ? "output_hls" : "output_video";
    help.append("در پوشهٔ ", name, " کنار هر ویدیو");
  }
}

function changePreferences(change, affectsOutput = false) {
  change(preferences);
  renderPreferences();
  const snapshot = structuredClone(preferences);
  saveSequence = saveSequence.then(() => invoke("save_preferences", { preferences: snapshot })).catch((error) => {
    showError("ذخیرهٔ تنظیمات انجام نشد.", error);
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
      if (revision === previewRevision) showError("پیش‌نمایش نام خروجی آماده نشد.", error);
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
      showAlert(`برخی فایل‌ها به صف اضافه نشدند.\n${reasons.join("\n")}`);
    }
  } catch (error) {
    showError("بررسی فایل‌ها انجام نشد.", error);
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
    await addFiles(await invoke("choose_files"));
  } catch (error) {
    showError("پنجرهٔ انتخاب فایل باز نشد.", error);
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
    const outputDirectory = await invoke("choose_output_directory");
    if (outputDirectory) changePreferences((value) => { value.outputDirectory = outputDirectory; }, true);
  } catch (error) {
    showError("پنجرهٔ انتخاب پوشه باز نشد.", error);
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
    showError("پوشه در فایل اکسپلورر باز نشد.", error);
  }
}

async function playOutput(path) {
  try {
    await window.playConvertedOutput(path);
  } catch (error) {
    showError("خروجی پخش نشد.", error);
  }
}

function renderHistory(entries) {
  const groups = document.createDocumentFragment();
  let currentDay;
  let list;
  for (const item of entries) {
    const time = new Date(item.finishedAt);
    const validTime = Number.isFinite(time.getTime());
    const day = validTime ? historyDay.format(time) : "زمان ثبت نامشخص";
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
    quality.textContent = qualityNames[item.settings.quality];
    meta.append(format, quality);
    row.querySelector(".queue-status").textContent = statusLabels[item.status] || "نامشخص";
    if (validTime) {
      const stamp = row.querySelector("time");
      stamp.dateTime = time.toISOString();
      stamp.textContent = historyTime.format(time);
    }
    if (item.error) {
      const error = row.querySelector(".history-error");
      error.hidden = false;
      error.querySelector(".queue-error-text").textContent = item.error;
    }
    list.append(row);
  }
  ui["history-list"].replaceChildren(groups);
  ui["history-count"].textContent = `${number.format(entries.length)} نتیجهٔ ثبت‌شده`;
  ui["history-count"].hidden = entries.length === 0;
  ui["history-clear"].hidden = entries.length === 0;
  ui["history-empty"].hidden = entries.length > 0;
  ui["history-state-title"].textContent = "هنوز تبدیلی ثبت نشده است";
  ui["history-state-detail"].textContent = "پس از تبدیل اولین ویدیو، نتیجه در اینجا نمایش داده می‌شود.";
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
      ui["history-state-title"].textContent = "تاریخچه بارگذاری نشد";
      ui["history-state-detail"].textContent = "برای بازخوانی، دوباره تاریخچه را باز کنید.";
      ui["history-convert"].hidden = true;
    }
    showError("خواندن تاریخچه انجام نشد.", error);
  } finally {
    if (request === historyRequest) list.setAttribute("aria-busy", "false");
  }
}

function historyChanged({ payload }) {
  if (payload) showError("ذخیرهٔ نتیجه در تاریخچه انجام نشد.", payload);
  if (currentView !== "history") return;
  clearTimeout(historyTimer);
  historyTimer = setTimeout(refreshHistory, 120);
}

function confirmHistoryDelete(id) {
  if (deletingHistory || installingUpdate) return;
  const dialog = ui["history-delete-dialog"];
  historyDeleteTarget = id;
  ui["history-delete-title"].textContent = id === null ? "کل تاریخچه پاک شود؟" : "این تبدیل از تاریخچه حذف شود؟";
  dialog.returnValue = "cancel";
  dialog.showModal();
}

async function deleteHistory(id) {
  deletingHistory = true;
  ui["history-clear"].disabled = true;
  try {
    await invoke("delete_history", { id });
  } catch (error) {
    showError("حذف تاریخچه انجام نشد.", error);
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
  const label = collapsed ? "باز کردن منو" : "جمع کردن منو";
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
    showError("تبدیل شروع نشد.", error);
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
      showError("توقف تبدیل انجام نشد.", error);
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
      item.error = active.cancelling ? null : "وضعیت نهایی این فایل از موتور تبدیل دریافت نشد.";
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
    showError("ارتباط با موتور تبدیل برقرار نشد. برنامه را دوباره باز کنید.", error);
  }
}

void initialize();

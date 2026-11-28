"use strict";

async function initializeUpdates({ invoke, listen, canInstall, finishSaving, onInstalling }) {
  const check = document.getElementById("check-update-now");
  const indicator = document.getElementById("update-indicator");
  const version = document.getElementById("installed-version");
  const message = document.getElementById("update-message");
  const progress = document.getElementById("update-progress");
  const error = document.getElementById("update-error");
  const repository = document.getElementById("update-repository");
  let status = { phase: "idle" };
  let installTimer;
  let requestingInstall = false;

  function render() {
    message.textContent = i18n.t(`update_${status.phase}`, { version: status.availableVersion ?? "" });
    check.disabled = ["checking", "downloading", "ready", "installing"].includes(status.phase);
    indicator.hidden = !["downloading", "ready", "installing"].includes(status.phase);
    progress.hidden = status.phase !== "downloading";
    if (status.total > 0) {
      const percent = Math.min(100, 100 * status.downloaded / status.total);
      progress.value = percent;
      progress.title = i18n.formats.percent.format(percent / 100);
    } else {
      progress.removeAttribute("value");
      progress.removeAttribute("title");
    }
    error.hidden = !status.error;
    error.textContent = status.error || "";
  }

  function queueInstall() {
    clearTimeout(installTimer);
    if (status.phase === "ready" && !requestingInstall) installTimer = setTimeout(installIfIdle, 1100);
  }

  async function installIfIdle() {
    if (status.phase !== "ready" || requestingInstall) return;
    if (!canInstall()) { queueInstall(); return; }
    requestingInstall = true;
    try {
      await finishSaving();
      if (status.phase !== "ready" || !canInstall()) return;
      onInstalling(true);
      await invoke("install_prepared_update");
    } catch (details) {
      status = { phase: "error", error: String(details) };
      render();
    } finally {
      requestingInstall = false;
      onInstalling(false);
      queueInstall();
    }
  }

  async function checkNow() {
    try {
      await invoke("check_for_updates");
    } catch (details) {
      status = { phase: "error", error: String(details) };
      render();
    }
  }

  check.addEventListener("click", checkNow);
  document.addEventListener("language-changed", render);
  render();
  try {
    await listen("update-status", ({ payload }) => {
      status = payload;
      render();
      queueInstall();
    });
    const current = await invoke("get_update_status");
    version.textContent = current.version;
    repository.textContent = current.repository;
    status = current.status;
    render();
    queueInstall();
    setTimeout(checkNow, 3800);
    setInterval(checkNow, 6 * 60 * 60 * 1000);
  } catch (details) {
    status = { phase: "error", error: String(details) };
    render();
  }
}

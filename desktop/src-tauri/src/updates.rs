use crate::{AppState, lock};
use serde::Serialize;
use std::{sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager, async_runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

fn repository() -> &'static str {
    include_str!("../../installer/github-repository.txt").trim()
}

#[derive(Clone, Copy, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Phase {
    #[default]
    Idle,
    Checking,
    Current,
    Downloading,
    Ready,
    Installing,
    Error,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStatus {
    phase: Phase,
    available_version: Option<String>,
    downloaded: u64,
    total: Option<u64>,
    error: Option<String>,
}

#[derive(Default)]
pub(crate) struct Updates {
    inner: Mutex<UpdateState>,
}

#[derive(Default)]
struct UpdateState {
    status: UpdateStatus,
    prepared: Option<(Update, Vec<u8>)>,
}

impl Updates {
    fn change(&self, app: &AppHandle, apply: impl FnOnce(&mut UpdateState)) {
        let status = {
            let mut state = lock(&self.inner);
            apply(&mut state);
            state.status.clone()
        };
        let _ = app.emit_to("main", "update-status", status);
    }

    fn failure(&self, app: &AppHandle, error: String) {
        self.change(app, |state| {
            state.status.phase = Phase::Error;
            state.status.error = Some(error);
        });
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateView {
    version: String,
    status: UpdateStatus,
    repository: &'static str,
}

#[tauri::command]
pub(crate) fn get_update_status(app: AppHandle) -> UpdateView {
    let updates = app.state::<Updates>();
    UpdateView {
        version: app.package_info().version.to_string(),
        status: lock(&updates.inner).status.clone(),
        repository: repository(),
    }
}

#[tauri::command]
pub(crate) async fn check_for_updates(app: AppHandle) {
    let updates = app.state::<Updates>();
    let initial_status = {
        let mut state = lock(&updates.inner);
        if matches!(
            state.status.phase,
            Phase::Checking | Phase::Downloading | Phase::Ready | Phase::Installing
        ) {
            return;
        }
        state.status = UpdateStatus {
            phase: Phase::Checking,
            ..UpdateStatus::default()
        };
        state.status.clone()
    };
    let _ = app.emit_to("main", "update-status", initial_status);
    if let Err(error) = check_and_download(&app, &updates).await {
        updates.failure(&app, error);
    }
}

async fn check_and_download(app: &AppHandle, updates: &Updates) -> Result<(), String> {
    let language = || app.state::<AppState>().language();
    let releases = format!("https://github.com/{}/releases", repository());
    let manifest = format!("{releases}/latest/download/latest.json")
        .parse()
        .map_err(|_| {
            language().text(
                "نشانی انتشار GitHub معتبر نیست.",
                "The GitHub release URL is invalid.",
            )
        })?;
    let updater = app
        .updater_builder()
        .endpoints(vec![manifest])
        .map_err(|_| {
            language().text(
                "نشانی مانیفست GitHub معتبر نیست.",
                "The GitHub update manifest URL is invalid.",
            )
        })?
        .configure_client(|client| client.https_only(true).referer(false))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;
    let Some(mut update) = updater.check().await.map_err(|_| {
        language().text(
            "اطلاعات آخرین نسخه از GitHub دریافت نشد.",
            "Could not read the latest release from GitHub.",
        )
    })?
    else {
        updates.change(app, |state| state.status.phase = Phase::Current);
        return Ok(());
    };
    let version = &update.version;
    let expected_installer =
        format!("{releases}/download/v{version}/VideoConverter-{version}-windows-x64-setup.exe");
    if update.download_url.as_str() != expected_installer {
        return Err(language()
            .text(
                "مانیفست با برچسب و بستهٔ همان انتشار GitHub هم‌خوانی ندارد.",
                "The update manifest does not match the GitHub release and installer.",
            )
            .into());
    }
    update.timeout = Some(Duration::from_secs(900));
    updates.change(app, |state| {
        state.status.phase = Phase::Downloading;
        state.status.available_version = Some(update.version.clone());
    });
    let mut downloaded = 0u64;
    let mut last_report = 0u64;
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                if last_report == 0
                    || downloaded - last_report >= 1024 * 1024
                    || Some(downloaded) == total
                {
                    last_report = downloaded;
                    updates.change(app, |state| {
                        state.status.downloaded = downloaded;
                        state.status.total = total;
                    });
                }
            },
            || {},
        )
        .await
        .map_err(|_| {
            language().text(
                "دانلود یا تأیید امضای بستهٔ GitHub انجام نشد.",
                "Could not download or verify the GitHub installer.",
            )
        })?;
    updates.change(app, |state| {
        let length = bytes.len() as u64;
        state.status.downloaded = length;
        state.status.total = Some(length);
        state.status.phase = Phase::Ready;
        state.prepared = Some((update, bytes));
    });
    Ok(())
}

#[tauri::command]
pub(crate) async fn install_prepared_update(app: AppHandle) -> Result<bool, String> {
    async_runtime::spawn_blocking(move || {
        let app_state = app.state::<AppState>();
        let updates = app.state::<Updates>();
        let (update, bytes, status) = {
            let mut batch = lock(&app_state.batch);
            if batch.cancel.is_some() || batch.closing || batch.updating {
                return Ok(false);
            }
            let mut state = lock(&updates.inner);
            let Some((update, bytes)) = state.prepared.take() else {
                return Ok(false);
            };
            batch.updating = true;
            state.status.phase = Phase::Installing;
            (update, bytes, state.status.clone())
        };
        let _ = app.emit_to("main", "update-status", status);
        if let Err(error) = update.install(bytes) {
            lock(&app_state.batch).updating = false;
            updates.failure(
                &app,
                app_state.language().detail(
                    "اجرای نصب‌کننده انجام نشد.",
                    "Could not start the installer.",
                    error,
                ),
            );
            return Ok(false);
        }
        Ok(true)
    })
    .await
    .map_err(|error| error.to_string())?
}

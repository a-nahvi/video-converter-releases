#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod archive;
mod engine;
mod history;
mod naming;
mod updates;
#[cfg(windows)]
mod window_brand;

use engine::{Format, Settings};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    env, fs, io,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        Arc, Mutex, MutexGuard,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, WindowEvent, async_runtime};

#[derive(Clone, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct Preferences {
    settings: Settings,
    output_directory: Option<PathBuf>,
    finglish: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            settings: Settings::default(),
            output_directory: None,
            finglish: true,
        }
    }
}

const PREFERENCES_SCHEMA: u8 = 2;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedPreferences {
    #[serde(default)]
    schema_version: u8,
    #[serde(flatten)]
    preferences: Preferences,
}

fn decode_preferences(bytes: &[u8]) -> Result<(Preferences, bool), serde_json::Error> {
    let mut saved: SavedPreferences = serde_json::from_slice(bytes)?;
    let migrate = saved.schema_version < PREFERENCES_SCHEMA;
    if saved.schema_version == 0 {
        saved.preferences.finglish = true;
        if saved.preferences.settings.segment_seconds == 6 {
            saved.preferences.settings.segment_seconds = Settings::default().segment_seconds;
        }
    }
    if migrate {
        saved.preferences.settings.encrypt = true;
        if saved.preferences.settings.max_height.is_none() {
            saved.preferences.settings.max_width = Some(engine::DEFAULT_MAX_WIDTH);
        }
    }
    Ok((saved.preferences, migrate))
}

fn write_preferences(path: &Path, preferences: &Preferences) -> std::io::Result<()> {
    write_json(
        path,
        &SavedPreferences {
            schema_version: PREFERENCES_SCHEMA,
            preferences: preferences.clone(),
        },
    )
}

fn write_json(path: &Path, data: &impl Serialize) -> std::io::Result<()> {
    write_atomic(path, |file| Ok(serde_json::to_writer_pretty(file, data)?))
}

fn write_atomic(
    path: &Path,
    write: impl FnOnce(&mut fs::File) -> io::Result<()>,
) -> io::Result<()> {
    let tempfile = path.with_extension(format!("{}.tmp", std::process::id()));
    let result = (|| {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = fs::File::create(&tempfile)?;
        write(&mut file)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tempfile, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(tempfile);
    }
    result
}

#[derive(Deserialize)]
struct InputItem {
    path: PathBuf,
    stem: Option<String>,
}

#[derive(Serialize)]
struct InspectedItem {
    path: PathBuf,
    name: String,
    bytes: u64,
    #[serde(flatten)]
    video: engine::VideoInfo,
}

#[derive(Deserialize)]
struct PreviewItem {
    #[serde(flatten)]
    input: InputItem,
    bytes: u64,
    video: engine::VideoInfo,
}

#[derive(Serialize)]
struct OutputPreview {
    path: PathBuf,
    estimate: Option<engine::SizeEstimate>,
}

#[derive(Serialize)]
struct InspectionError {
    path: PathBuf,
    error: String,
}

#[derive(Serialize)]
struct Inspection {
    items: Vec<InspectedItem>,
    errors: Vec<InspectionError>,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum JobStatus {
    Running,
    Done,
    Error,
    Cancelled,
}

#[derive(Clone, Serialize)]
struct JobUpdate<'a> {
    path: &'a Path,
    status: JobStatus,
    progress: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    output: Option<&'a Path>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'a str>,
}

#[derive(Default)]
struct BatchState {
    cancel: Option<Arc<AtomicBool>>,
    closing: bool,
    updating: bool,
}

struct AppState {
    preferences_file: PathBuf,
    history_file: PathBuf,
    preferences: Mutex<Preferences>,
    batch: Mutex<BatchState>,
    outputs: Mutex<HashSet<PathBuf>>,
    playback_directories: Mutex<HashMap<PathBuf, engine::StagingDirectory>>,
}

fn lock<T>(value: &Mutex<T>) -> MutexGuard<'_, T> {
    value.lock().unwrap_or_else(|error| error.into_inner())
}

#[tauri::command]
fn get_preferences(state: State<'_, AppState>) -> Preferences {
    lock(&state.preferences).clone()
}

#[tauri::command]
async fn save_preferences(app: AppHandle, preferences: Preferences) -> Result<(), String> {
    async_runtime::spawn_blocking(move || {
        validate_preferences(&preferences)?;
        let state = app.state::<AppState>();
        let mut current = lock(&state.preferences);
        write_preferences(&state.preferences_file, &preferences)
            .map_err(|error| format!("ذخیرهٔ تنظیمات انجام نشد. {error}"))?;
        *current = preferences;
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_history(app: AppHandle) -> Result<Vec<history::Entry>, String> {
    async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let entries = history::list(&state.history_file)
            .map_err(|error| format!("خواندن تاریخچه ممکن نبود. {error}"))?;
        lock(&state.outputs).extend(entries.iter().filter_map(|entry| entry.output.clone()));
        Ok(entries)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn delete_history(app: AppHandle, id: Option<String>) -> Result<(), String> {
    async_runtime::spawn_blocking(move || {
        history::delete(&app.state::<AppState>().history_file, id.as_deref())
            .map_err(|error| format!("حذف تاریخچه انجام نشد. {error}"))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn choose_files(window: WebviewWindow) -> Vec<PathBuf> {
    let dialog = rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .set_title("انتخاب ویدیوها")
        .add_filter(
            "ویدیوها",
            &[
                "mp4", "m4v", "mov", "mkv", "webm", "avi", "wmv", "flv", "mpeg", "mpg", "ts",
                "mts", "m2ts", "3gp", "ogv", "mxf", "vob", "m3u8",
            ],
        )
        .add_filter("همهٔ فایل‌ها", &["*"]);
    dialog
        .pick_files()
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|file| file.path().to_path_buf())
        .collect()
}

#[tauri::command]
async fn choose_output_directory(window: WebviewWindow) -> Option<PathBuf> {
    rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .set_title("انتخاب پوشهٔ خروجی")
        .pick_folder()
        .await
        .map(|folder| folder.path().to_path_buf())
}

fn encoder_tools(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("ffmpeg"));
    }
    if cfg!(debug_assertions) {
        candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("ffmpeg"));
    }
    if let Some(path) = env::var_os("PATH") {
        candidates.extend(env::split_paths(&path).filter(|directory| directory.is_absolute()));
    }
    for directory in candidates {
        let ffmpeg = directory.join("ffmpeg.exe");
        let ffprobe = directory.join("ffprobe.exe");
        if ffmpeg.is_file() && ffprobe.is_file() {
            return Ok((ffmpeg, ffprobe));
        }
    }
    Err("موتور تبدیل پیدا نشد. نسخهٔ نصب‌شده را دوباره نصب کنید یا FFmpeg و FFprobe را به PATH ویندوز اضافه کنید.".into())
}

fn validate_input(path: &Path) -> Result<fs::Metadata, String> {
    if !path.is_absolute() {
        return Err("مسیر ویدیو باید کامل باشد.".into());
    }
    let metadata = fs::metadata(path).map_err(|error| format!("فایل در دسترس نیست. {error}"))?;
    if !metadata.is_file() {
        return Err("یک فایل ویدیو انتخاب کنید.".into());
    }
    Ok(metadata)
}

#[tauri::command]
async fn inspect_files(app: AppHandle, paths: Vec<PathBuf>) -> Result<Inspection, String> {
    async_runtime::spawn_blocking(move || {
        let (_, ffprobe) = encoder_tools(&app)?;
        let mut result = Inspection {
            items: Vec::new(),
            errors: Vec::new(),
        };
        let mut seen = HashSet::new();
        for path in paths {
            if !seen.insert(windows_path_key(&path)) {
                continue;
            }
            let info = validate_input(&path).and_then(|metadata| {
                let info = engine::probe(&ffprobe, &path)?;
                Ok((metadata.len(), info))
            });
            match info {
                Ok((bytes, info)) => result.items.push(InspectedItem {
                    name: path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned(),
                    path,
                    bytes,
                    video: info,
                }),
                Err(error) => result.errors.push(InspectionError { path, error }),
            }
        }
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn validate_preferences(preferences: &Preferences) -> Result<(), String> {
    if let Some(directory) = &preferences.output_directory
        && !directory.is_absolute()
    {
        return Err("مسیر پوشهٔ خروجی باید کامل باشد.".into());
    }
    let settings = &preferences.settings;
    if !matches!(settings.max_height, None | Some(480 | 720 | 1080))
        || !matches!(settings.max_width, None | Some(engine::DEFAULT_MAX_WIDTH))
        || (settings.max_width.is_some() && settings.max_height.is_some())
    {
        return Err("اندازهٔ تصویر انتخاب‌شده پشتیبانی نمی‌شود.".into());
    }
    if matches!(preferences.settings.format, Format::Hls)
        && !(2..=30).contains(&preferences.settings.segment_seconds)
    {
        return Err("مدت هر قطعهٔ HLS باید بین ۲ تا ۳۰ ثانیه باشد.".into());
    }
    Ok(())
}

fn destination(item: &InputItem, preferences: &Preferences) -> Result<(PathBuf, String), String> {
    if !item.path.is_absolute() {
        return Err("مسیر ویدیو باید کامل باشد.".into());
    }
    let base = match &preferences.output_directory {
        Some(directory) => directory.clone(),
        None => {
            let parent = item.path.parent().ok_or("پوشهٔ فایل ورودی پیدا نشد.")?;
            let folder = if matches!(preferences.settings.format, Format::Hls) {
                "output_hls"
            } else {
                "output_video"
            };
            parent.join(folder)
        }
    };
    let mut stem = match item
        .stem
        .as_deref()
        .map(str::trim)
        .filter(|stem| !stem.is_empty())
    {
        Some(stem) => naming::output_stem(stem, false),
        None => naming::output_stem(
            &item.path.file_stem().unwrap_or_default().to_string_lossy(),
            preferences.finglish,
        ),
    };
    if preferences.settings.format == Format::Hls {
        // These characters have special meaning in a relative HLS key URI.
        stem = stem.replace(['#', '%'], "-");
    }
    Ok((base, stem))
}

fn windows_path_key(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\").to_lowercase()
}

#[tauri::command]
async fn preview_outputs(
    items: Vec<PreviewItem>,
    preferences: Preferences,
) -> Result<Vec<OutputPreview>, String> {
    async_runtime::spawn_blocking(move || {
        validate_preferences(&preferences)?;
        let mut reserved = HashSet::new();
        items
            .iter()
            .map(|item| {
                let (base, stem) = destination(&item.input, &preferences)?;
                let output =
                    engine::preview_reserved(&base, &stem, preferences.settings.format, |path| {
                        reserved.contains(&windows_path_key(path))
                    });
                reserved.insert(windows_path_key(&output));
                Ok(OutputPreview {
                    path: output,
                    estimate: engine::estimate_output_size(
                        &item.video,
                        item.bytes,
                        &preferences.settings,
                    ),
                })
            })
            .collect()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn start_batch(
    app: AppHandle,
    items: Vec<InputItem>,
    preferences: Preferences,
) -> Result<(), String> {
    validate_preferences(&preferences)?;
    if items.is_empty() {
        return Err("ابتدا ویدیو اضافه کنید.".into());
    }
    let mut seen = HashSet::new();
    let work = items
        .into_iter()
        .filter(|item| seen.insert(windows_path_key(&item.path)))
        .map(|item| destination(&item, &preferences).map(|dest| (item.path, dest)))
        .collect::<Result<Vec<_>, _>>()?;
    let (ffmpeg, ffprobe) = encoder_tools(&app)?;
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let state = app.state::<AppState>();
        let mut batch = lock(&state.batch);
        if batch.updating {
            return Err("نسخهٔ جدید در حال نصب است.".into());
        }
        if batch.cancel.is_some() || batch.closing {
            return Err("یک صف تبدیل در حال اجراست.".into());
        }
        batch.cancel = Some(Arc::clone(&cancel));
    }

    async_runtime::spawn_blocking(move || {
        let settings = &preferences.settings;
        let state = app.state::<AppState>();
        for (path, (base, stem)) in work {
            let event = |status, progress, output: Option<&Path>, error: Option<&str>| {
                let _ = app.emit_to(
                    "main",
                    "job-update",
                    JobUpdate {
                        path: &path,
                        status,
                        progress,
                        output,
                        error,
                    },
                );
            };
            let finish = |status, output: Option<&Path>, error: Option<&str>| {
                if let Some(output) = output {
                    lock(&state.outputs).insert(output.to_owned());
                }
                let progress = if output.is_some() { 100 } else { 0 };
                event(status, progress, output, error);
                let storage_error =
                    history::record(&state.history_file, &path, settings, status, output, error)
                        .err()
                        .map(|error| error.to_string());
                let _ = app.emit_to("main", "history-changed", storage_error);
            };
            if cancel.load(Ordering::Relaxed) {
                finish(JobStatus::Cancelled, None, None);
                continue;
            }
            event(JobStatus::Running, 0, None, None);
            let result = validate_input(&path).and_then(|_| {
                let info = engine::probe_cancellable(&ffprobe, &path, &cancel)?;
                engine::convert(
                    &ffmpeg,
                    &path,
                    &base,
                    &stem,
                    settings,
                    info.duration,
                    &cancel,
                    |progress| {
                        event(JobStatus::Running, progress, None, None);
                    },
                )
            });
            match result.as_ref() {
                Ok(output) => finish(JobStatus::Done, Some(output), None),
                Err(_) if cancel.load(Ordering::Relaxed) => {
                    finish(JobStatus::Cancelled, None, None)
                }
                Err(error) => finish(JobStatus::Error, None, Some(error)),
            }
        }

        let closing = {
            let state = app.state::<AppState>();
            let mut batch = lock(&state.batch);
            batch.cancel = None;
            batch.closing
        };
        let _ = app.emit_to("main", "batch-finished", ());
        if closing && let Some(window) = app.get_webview_window("main") {
            let _ = window.close();
        }
    });
    Ok(())
}

#[tauri::command]
fn cancel_batch(state: State<'_, AppState>) {
    if let Some(cancel) = &lock(&state.batch).cancel {
        cancel.store(true, Ordering::Relaxed);
    }
}

fn explorer() -> Command {
    let windows = env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("C:\\Windows"));
    Command::new(windows.join("explorer.exe"))
}

#[tauri::command]
fn open_folder(path: PathBuf) -> Result<(), String> {
    if !path.is_absolute() || !path.is_dir() {
        return Err("پوشه در دسترس نیست.".into());
    }
    explorer()
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn show_in_explorer(path: PathBuf) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    if !path.is_absolute() || !path.is_file() {
        return Err("فایل خروجی در دسترس نیست.".into());
    }
    let mut argument = std::ffi::OsString::from("/select,\"");
    argument.push(&path);
    argument.push("\"");
    explorer()
        .raw_arg(argument)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn prepare_player(app: AppHandle, path: PathBuf) -> Result<PathBuf, String> {
    async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        if !lock(&state.outputs).contains(&path) || !path.is_file() {
            return Err("فایل خروجی برای پخش در دسترس نیست.".into());
        }
        let scope = app.asset_protocol_scope();
        if path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
        {
            let directory = engine::StagingDirectory::create(&env::temp_dir())?;
            let media = archive::unpack_for_player(&path, directory.path())
                .map_err(|error| format!("آماده‌سازی ZIP برای پخش انجام نشد. {error}"))?;
            scope
                .allow_directory(directory.path(), false)
                .map_err(|error| format!("آماده‌سازی پخش انجام نشد. {error}"))?;
            lock(&state.playback_directories).insert(media.clone(), directory);
            return Ok(media);
        }
        let allow = |path: &Path| {
            scope
                .allow_file(path)
                .map_err(|error| format!("آماده‌سازی پخش انجام نشد. {error}"))
        };
        allow(&path)?;
        if path
            .extension()
            .is_some_and(|extension| extension == "m3u8")
            && let Some(directory) = path.parent()
        {
            for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
                let entry = entry.map_err(|error| error.to_string())?;
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if (name == engine::STAGED_KEY || engine::is_hls_segment(&name))
                    && entry.file_type().is_ok_and(|kind| kind.is_file())
                {
                    allow(&entry.path())?;
                }
            }
        }
        Ok(path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn release_player(app: AppHandle, path: PathBuf) -> Result<(), String> {
    async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let directory = lock(&state.playback_directories).remove(&path);
        drop(directory);
    })
    .await
    .map_err(|error| error.to_string())
}

fn main() {
    let context = tauri::generate_context!();
    #[cfg(windows)]
    window_brand::set_app_id(&context.config().identifier);
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::Updates::default())
        .setup(|app| {
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main")
                && let Ok(handle) = window.hwnd()
            {
                window_brand::set_taskbar_icon(handle.0);
            }
            let config_directory = app.path().app_config_dir()?;
            let preferences_file = config_directory.join("preferences.json");
            let preferences = fs::read(&preferences_file)
                .ok()
                .and_then(|bytes| decode_preferences(&bytes).ok())
                .filter(|(preferences, _)| validate_preferences(preferences).is_ok());
            let preferences = match preferences {
                Some((preferences, migrate)) => {
                    if migrate {
                        let _ = write_preferences(&preferences_file, &preferences);
                    }
                    preferences
                }
                None => Preferences::default(),
            };
            app.manage(AppState {
                preferences_file,
                history_file: config_directory.join("history.jsonl"),
                preferences: Mutex::new(preferences),
                batch: Mutex::new(BatchState::default()),
                outputs: Mutex::new(HashSet::new()),
                playback_directories: Mutex::new(HashMap::new()),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                let mut batch = lock(&state.batch);
                if let Some(cancel) = &batch.cancel {
                    api.prevent_close();
                    cancel.store(true, Ordering::Relaxed);
                    batch.closing = true;
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_preferences,
            save_preferences,
            get_history,
            delete_history,
            choose_files,
            choose_output_directory,
            inspect_files,
            preview_outputs,
            start_batch,
            cancel_batch,
            open_folder,
            show_in_explorer,
            prepare_player,
            release_player,
            updates::get_update_status,
            updates::check_for_updates,
            updates::install_prepared_update,
        ])
        .run(context)
        .expect("the video converter could not start");
}

#[cfg(test)]
mod preferences_tests {
    use super::*;

    #[test]
    fn new_preferences_match_the_visible_defaults() {
        let preferences = Preferences::default();
        assert!(preferences.finglish);
        assert_eq!(preferences.settings.segment_seconds, 10);
        assert_eq!(preferences.settings.format, Format::Hls);
        assert_eq!(preferences.settings.max_width, Some(1024));
        assert!(preferences.settings.encrypt);
    }

    #[test]
    fn only_legacy_defaults_are_migrated_and_only_once() {
        let (old, migrated) =
            decode_preferences(br#"{"finglish":false,"settings":{"segmentSeconds":6}}"#).unwrap();
        assert!(migrated && old.finglish);
        assert_eq!(old.settings.segment_seconds, 10);

        let (custom, migrated) =
            decode_preferences(br#"{"settings":{"format":"webm","segmentSeconds":14}}"#).unwrap();
        assert!(migrated);
        assert_eq!(custom.settings.format, Format::Webm);
        assert_eq!(custom.settings.segment_seconds, 14);

        let (legacy, migrated) = decode_preferences(
            br#"{"schemaVersion":1,"settings":{"maxHeight":720,"encrypt":false,"mute":true}}"#,
        )
        .unwrap();
        assert!(migrated && legacy.settings.encrypt);
        assert_eq!(legacy.settings.max_height, Some(720));
        assert_eq!(legacy.settings.max_width, None);

        let (saved, migrated) = decode_preferences(
            br#"{"schemaVersion":2,"finglish":false,"settings":{"segmentSeconds":6,"encrypt":false,"maxWidth":null}}"#,
        ).unwrap();
        assert!(!migrated && !saved.finglish);
        assert_eq!(saved.settings.segment_seconds, 6);
        assert!(!saved.settings.encrypt);
        assert_eq!(saved.settings.max_width, None);
    }
}

use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Output, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::thread;
use std::time::Duration;

pub(crate) const PLAYLIST: &str = "playlist.m3u8";
pub(crate) const STAGED_KEY: &str = "key.bin";
const CANCELLED: &str = "تبدیل لغو شد.";
pub const DEFAULT_MAX_WIDTH: u32 = 1024;
const HLS_EXTENSIONS: &str = "3gp,aac,ac3,avi,bin,eac3,flac,key,m4a,m4s,m4v,mkv,mov,mp2,mp3,mp4,mpeg,mpegts,mpg,oga,ogg,ogv,m3u8,ts,vob,wav";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Format {
    Hls,
    Mp4,
    Webm,
}

impl Format {
    pub(crate) fn extension(self) -> &'static str {
        match self {
            Self::Hls => "m3u8",
            Self::Mp4 => "mp4",
            Self::Webm => "webm",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Quality {
    Compact,
    Balanced,
    High,
}

impl Quality {
    fn crf(self, format: Format) -> &'static str {
        match (self, format) {
            (Self::Compact, Format::Webm) => "39",
            (Self::Balanced, Format::Webm) => "32",
            (Self::High, Format::Webm) => "24",
            (Self::Compact, _) => "28",
            (Self::Balanced, _) => "23",
            (Self::High, _) => "18",
        }
    }

    fn audio_bitrate(self) -> u32 {
        match self {
            Self::Compact => 96_000,
            Self::Balanced => 128_000,
            Self::High => 192_000,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub format: Format,
    pub quality: Quality,
    pub max_height: Option<u32>,
    #[serde(default)]
    pub max_width: Option<u32>,
    pub segment_seconds: u8,
    pub encrypt: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            format: Format::Hls,
            quality: Quality::Balanced,
            max_height: None,
            max_width: Some(DEFAULT_MAX_WIDTH),
            segment_seconds: 10,
            encrypt: true,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub frame_rate: Option<f64>,
    pub video_bitrate: Option<u64>,
    pub has_audio: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SizeEstimate {
    pub minimum_bytes: u64,
    pub maximum_bytes: u64,
}

pub fn estimate_output_size(
    video: &VideoInfo,
    input_bytes: u64,
    settings: &Settings,
) -> Option<SizeEstimate> {
    if !video.duration.is_finite() || video.duration <= 0.0 || video.width == 0 || video.height == 0
    {
        return None;
    }
    let (width, height) = (f64::from(video.width), f64::from(video.height));
    let limit_width = settings.max_width.map_or(1.0, |cap| f64::from(cap) / width);
    let limit_height = settings
        .max_height
        .map_or(1.0, |cap| f64::from(cap) / height);
    let scale = limit_width.min(limit_height).min(1.0);
    let fps = video.frame_rate.unwrap_or(30.0).clamp(1.0, 144.0);
    let quality = match settings.quality {
        Quality::High => 1.55,
        Quality::Balanced => 1.0,
        Quality::Compact => 0.66,
    };
    let codec = if settings.format == Format::Webm {
        0.76
    } else {
        1.0
    };
    let nominal = width * height * scale.powi(2) * fps * 0.045;
    let source = video
        .video_bitrate
        .map(|rate| rate as f64)
        .unwrap_or_else(|| {
            let rate = input_bytes as f64 * 8.0 / video.duration;
            if video.has_audio { rate * 0.85 } else { rate }
        });
    // Use source density as a signal about the material rather than assuming CRF gives a fixed bitrate.
    let scaled_source = (source * scale.powf(1.4)).clamp(nominal * 0.18, nominal * 5.0);
    let picture_rate = nominal.powf(0.58) * scaled_source.powf(0.42) * quality * codec;
    let audio_rate = if video.has_audio {
        f64::from(settings.quality.audio_bitrate())
    } else {
        0.0
    };
    let container_overhead = if settings.format == Format::Hls {
        1.06
    } else {
        1.02
    };
    let bytes = |picture_multiple| {
        (video.duration * (picture_rate * picture_multiple + audio_rate) * container_overhead / 8.0
            + 4096.0) as u64
    };
    Some(SizeEstimate {
        minimum_bytes: bytes(0.62),
        maximum_bytes: bytes(1.62),
    })
}

#[cfg(test)]
#[test]
fn estimates_follow_width_and_quality_and_allow_unknown_duration() {
    let mut video = VideoInfo {
        duration: 90.0,
        width: 1920,
        height: 1080,
        frame_rate: Some(30.0),
        video_bitrate: Some(2_500_000),
        has_audio: true,
    };
    let default = Settings::default();
    let bounded = estimate_output_size(&video, 0, &default).unwrap();
    assert!(bounded.minimum_bytes < bounded.maximum_bytes);
    let original = Settings {
        max_width: None,
        ..default.clone()
    };
    assert!(
        bounded.maximum_bytes
            < estimate_output_size(&video, 0, &original)
                .unwrap()
                .maximum_bytes
    );
    let high = Settings {
        quality: Quality::High,
        ..default
    };
    assert!(
        bounded.maximum_bytes
            < estimate_output_size(&video, 0, &high)
                .unwrap()
                .maximum_bytes
    );
    video.duration = 0.0;
    assert!(estimate_output_size(&video, 0, &high).is_none());
}

#[derive(Deserialize)]
struct Probe {
    streams: Vec<Stream>,
    format: Option<Container>,
}

#[derive(Deserialize)]
struct Container {
    duration: Option<String>,
}

#[derive(Deserialize)]
struct Stream {
    codec_type: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    duration: Option<String>,
    avg_frame_rate: Option<String>,
    bit_rate: Option<String>,
    disposition: Option<StreamDisposition>,
    #[serde(default)]
    side_data_list: Vec<StreamSideData>,
}

#[derive(Deserialize)]
struct StreamDisposition {
    attached_pic: Option<u8>,
}

#[derive(Deserialize)]
struct StreamSideData {
    rotation: Option<i32>,
}

fn tool(executable: &Path) -> Command {
    let mut command = Command::new(executable);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    command.stdin(Stdio::null());
    command
}

fn probe_command(ffprobe: &Path, input: &Path) -> Command {
    let mut command = tool(ffprobe);
    command.args([
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,width,height,duration,avg_frame_rate,bit_rate:stream_disposition=attached_pic:stream_side_data=rotation:format=duration",
        "-of",
        "json",
    ]);
    configure_input(&mut command, input);
    command
}

pub fn probe(ffprobe: &Path, input: &Path) -> Result<VideoInfo, String> {
    let output = probe_command(ffprobe, input)
        .output()
        .map_err(|error| format!("اجرای FFprobe ممکن نبود. {error}"))?;
    parse_probe(output)
}

pub fn probe_cancellable(
    ffprobe: &Path,
    input: &Path,
    cancel: &AtomicBool,
) -> Result<VideoInfo, String> {
    check_cancelled(cancel)?;
    let mut child = probe_command(ffprobe, input)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("اجرای FFprobe ممکن نبود. {error}"))?;
    let stdout = child.stdout.take().expect("FFprobe uses piped stdout");
    let stderr = child.stderr.take().expect("FFprobe uses piped stderr");
    let output = thread::scope(|scope| {
        let read_stdout = scope.spawn(|| read_probe_pipe(stdout));
        let read_stderr = scope.spawn(|| read_probe_pipe(stderr));
        let status = wait_cancellable(&mut child, cancel, || {})?;
        // Drain both streams while the child runs so an error cannot fill a pipe and stall it.
        let stdout = read_stdout
            .join()
            .expect("FFprobe stdout reader panicked")?;
        let stderr = read_stderr
            .join()
            .expect("FFprobe stderr reader panicked")?;
        Ok::<Output, String>(Output {
            status,
            stdout,
            stderr,
        })
    })?;
    check_cancelled(cancel)?;
    parse_probe(output)
}

fn read_probe_pipe(mut pipe: impl Read) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    pipe.read_to_end(&mut bytes)
        .map_err(|error| format!("خواندن اطلاعات ویدیو ممکن نبود. {error}"))?;
    Ok(bytes)
}

fn parse_probe(output: Output) -> Result<VideoInfo, String> {
    if !output.status.success() {
        return Err(format!(
            "خواندن فایل ویدیو ممکن نبود. {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let details: Probe = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("خواندن اطلاعات ویدیو ممکن نبود. {error}"))?;
    let (stream, width, height) = details
        .streams
        .iter()
        .find(|stream| {
            stream.codec_type.as_deref() == Some("video")
                && stream
                    .disposition
                    .as_ref()
                    .and_then(|disposition| disposition.attached_pic)
                    != Some(1)
        })
        .and_then(|stream| Some((stream, stream.width?, stream.height?)))
        .filter(|(_, width, height)| *width > 0 && *height > 0)
        .ok_or("این فایل تصویر ویدیویی قابل تبدیل ندارد.")?;
    let duration = [
        details
            .format
            .as_ref()
            .and_then(|details| details.duration.as_deref()),
        stream.duration.as_deref(),
    ]
    .into_iter()
    .flatten()
    .filter_map(|value| value.parse::<f64>().ok())
    .find(|value| value.is_finite() && *value > 0.0)
    .unwrap_or(0.0);

    let rotation = stream.side_data_list.iter().find_map(|data| data.rotation);
    let (width, height) = match rotation.map(|angle| angle.rem_euclid(180)) {
        Some(90) => (height, width),
        _ => (width, height),
    };
    let frame_rate = stream
        .avg_frame_rate
        .as_deref()
        .and_then(|rate| rate.split_once('/'))
        .and_then(|(numerator, denominator)| {
            Some(numerator.parse::<f64>().ok()? / denominator.parse::<f64>().ok()?)
        })
        .filter(|rate| rate.is_finite() && *rate > 0.0);
    Ok(VideoInfo {
        duration,
        width,
        height,
        frame_rate,
        video_bitrate: stream
            .bit_rate
            .as_deref()
            .and_then(|rate| rate.parse().ok()),
        has_audio: details
            .streams
            .iter()
            .any(|stream| stream.codec_type.as_deref() == Some("audio")),
    })
}

fn candidates(base: &Path, stem: &str) -> impl Iterator<Item = PathBuf> {
    let base = base.to_owned();
    let stem = stem.to_owned();
    (1_u64..).map(move |index| {
        let name = if index == 1 {
            stem.clone()
        } else {
            format!("{stem}-{index}")
        };
        base.join(format!("{name}.zip"))
    })
}

fn available(path: &Path, format: Format) -> bool {
    let legacy_path = path.with_extension(if format == Format::Hls {
        ""
    } else {
        format.extension()
    });
    // Keep older outputs and directories used when extracting an earlier archive.
    fs::symlink_metadata(path).is_err() && fs::symlink_metadata(legacy_path).is_err()
}

pub fn preview_reserved(
    base: &Path,
    stem: &str,
    format: Format,
    is_reserved: impl Fn(&Path) -> bool,
) -> PathBuf {
    candidates(base, stem)
        .find(|path| available(path, format) && !is_reserved(path))
        .expect("output candidates are unbounded")
}

pub(crate) struct StagingDirectory(PathBuf);

impl StagingDirectory {
    pub(crate) fn create(base: &Path) -> Result<Self, String> {
        loop {
            let mut random = [0u8; 12];
            getrandom::fill(&mut random)
                .map_err(|error| format!("ساخت پوشهٔ موقت ممکن نبود. {error}"))?;
            let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
            let directory = base.join(format!(".video-converter-{suffix}"));
            match fs::create_dir(&directory) {
                Ok(()) => return Ok(Self(directory)),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(format!("نوشتن در پوشهٔ خروجی ممکن نبود. {error}")),
            }
        }
    }

    pub(crate) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for StagingDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(self.path());
    }
}

pub fn convert(
    ffmpeg: &Path,
    input: &Path,
    destination_directory: &Path,
    stem: &str,
    settings: &Settings,
    duration: f64,
    cancel: &AtomicBool,
    progress: impl Fn(u8),
) -> Result<PathBuf, String> {
    check_cancelled(cancel)?;
    if settings.format == Format::Hls && !(2..=30).contains(&settings.segment_seconds) {
        return Err("مدت قطعهٔ HLS باید بین ۲ تا ۳۰ ثانیه باشد.".into());
    }
    let input =
        std::path::absolute(input).map_err(|error| format!("مسیر ورودی نامعتبر است. {error}"))?;
    let ffmpeg =
        std::path::absolute(ffmpeg).map_err(|error| format!("مسیر FFmpeg نامعتبر است. {error}"))?;
    fs::create_dir_all(destination_directory)
        .map_err(|error| format!("ساخت پوشهٔ خروجی ممکن نبود. {error}"))?;
    let staging = StagingDirectory::create(destination_directory)?;

    let (relative_output, artifact) = match settings.format {
        Format::Hls => {
            let directory = staging.path().join("hls");
            fs::create_dir(&directory)
                .map_err(|error| format!("ساخت پوشهٔ موقت HLS ممکن نبود. {error}"))?;
            (Path::new("hls").join(PLAYLIST), directory)
        }
        format => {
            let file = PathBuf::from(format!("result.{}", format.extension()));
            let artifact = staging.path().join(&file);
            (file, artifact)
        }
    };

    let mut command = tool(&ffmpeg);
    command.current_dir(staging.path());
    configure(&mut command, &input, &relative_output, settings);
    if settings.format == Format::Hls && settings.encrypt {
        prepare_encryption(staging.path())?;
    }

    let log = staging.path().join("ffmpeg.log");
    check_cancelled(cancel)?;
    run(&mut command, &log, duration, cancel, &progress)?;
    check_cancelled(cancel)?;
    let final_path = package_and_publish(
        &staging.path().join("output.zip"),
        &artifact,
        destination_directory,
        stem,
        settings,
        cancel,
    )?;
    progress(100);
    Ok(final_path)
}

fn check_cancelled(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        return Err(CANCELLED.into());
    }
    Ok(())
}

fn configure(command: &mut Command, input: &Path, output: &Path, settings: &Settings) {
    command.args([
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-progress",
        "pipe:1",
        "-nostats",
        "-n",
    ]);
    configure_input(command, input).args([
        "-map",
        "0:V:0",
        "-map",
        "0:a:0?",
        "-pix_fmt",
        "yuv420p",
        "-b:a",
        &settings.quality.audio_bitrate().to_string(),
    ]);

    // Keep the displayed aspect ratio and ensure dimensions fit 4:2:0 chroma.
    let scale = if let Some(width) = settings.max_width {
        format!("scale='max(2,trunc(min(iw,{width})/2)*2)':-2")
    } else if let Some(height) = settings.max_height {
        format!("scale=-2:'max(2,trunc(min(ih,{height})/2)*2)'")
    } else {
        "scale='max(2,trunc(iw/2)*2)':'max(2,trunc(ih/2)*2)'".to_owned()
    };
    command.args(["-vf", &scale, "-crf", settings.quality.crf(settings.format)]);

    match settings.format {
        Format::Hls | Format::Mp4 => {
            command.args(["-c:v", "libx264", "-preset", "medium", "-c:a", "aac"]);
        }
        Format::Webm => {
            command.args([
                "-c:v",
                "libvpx-vp9",
                "-b:v",
                "0",
                "-row-mt",
                "1",
                "-cpu-used",
                "3",
                "-c:a",
                "libopus",
            ]);
        }
    }

    match settings.format {
        Format::Hls => {
            let seconds = settings.segment_seconds.to_string();
            let keyframes = format!("expr:gte(t,n_forced*{seconds})");
            command.args([
                "-flags",
                "+cgop",
                "-force_key_frames",
                &keyframes,
                "-f",
                "hls",
                "-hls_time",
                &seconds,
                "-hls_playlist_type",
                "vod",
                "-hls_flags",
                "independent_segments",
                "-hls_segment_filename",
                "hls/segment-%05d.ts",
            ]);
            if settings.encrypt {
                command.args(["-hls_key_info_file", "key-info.txt"]);
            }
        }
        Format::Mp4 => {
            command.args(["-movflags", "+faststart"]);
        }
        Format::Webm => {}
    }
    command.arg(output);
}

fn configure_input<'a>(command: &'a mut Command, input: &Path) -> &'a mut Command {
    command.args(["-protocol_whitelist", "file,crypto,data"]);
    if input
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("m3u8"))
    {
        command.args(["-allowed_extensions", HLS_EXTENSIONS]);
    }
    command.arg("-i").arg(input)
}

fn prepare_encryption(staging: &Path) -> Result<(), String> {
    let mut key = [0u8; 16];
    getrandom::fill(&mut key).map_err(|error| format!("ساخت کلید HLS ممکن نبود. {error}"))?;
    fs::write(staging.join("hls").join(STAGED_KEY), key)
        .and_then(|()| {
            fs::write(
                staging.join("key-info.txt"),
                format!("{STAGED_KEY}\nhls/{STAGED_KEY}\n"),
            )
        })
        .map_err(|error| format!("ذخیرهٔ کلید HLS ممکن نبود. {error}"))
}

pub(crate) fn is_hls_segment(name: &str) -> bool {
    name.strip_prefix("segment-")
        .and_then(|name| name.strip_suffix(".ts"))
        .is_some_and(|number| {
            !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit())
        })
}

fn run(
    command: &mut Command,
    log: &Path,
    duration: f64,
    cancel: &AtomicBool,
    progress: &impl Fn(u8),
) -> Result<(), String> {
    let stderr =
        File::create(log).map_err(|error| format!("نوشتن گزارش تبدیل ممکن نبود. {error}"))?;
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(stderr)
        .spawn()
        .map_err(|error| format!("اجرای FFmpeg ممکن نبود. {error}"))?;
    let stdout = child
        .stdout
        .take()
        .expect("FFmpeg progress uses piped stdout");
    let current = AtomicU8::new(0);

    let result = thread::scope(|scope| {
        scope.spawn(|| read_progress(stdout, duration, &current));
        let mut last = 0;
        wait_cancellable(&mut child, cancel, || {
            let value = current.load(Ordering::Relaxed);
            if value > last {
                progress(value);
                last = value;
            }
        })
    })?;

    if !result.success() {
        let details = log_tail(log).unwrap_or_default();
        return Err(format!("تبدیل ویدیو انجام نشد. {}", details.trim()));
    }
    Ok(())
}

fn wait_cancellable(
    child: &mut Child,
    cancel: &AtomicBool,
    mut poll: impl FnMut(),
) -> Result<ExitStatus, String> {
    let result = loop {
        if let Err(error) = check_cancelled(cancel) {
            break Err(error);
        }
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => {}
            Err(error) => break Err(format!("بررسی وضعیت پردازش ممکن نبود. {error}")),
        }
        poll();
        thread::sleep(Duration::from_millis(100));
    };
    let _ = child.kill();
    let _ = child.wait();
    result
}

fn read_progress(stdout: impl Read, duration: f64, current: &AtomicU8) {
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        let Some(microseconds) = line
            .strip_prefix("out_time_us=")
            .and_then(|time| time.parse::<i64>().ok())
        else {
            continue;
        };
        if duration.is_finite() && duration > 0.0 {
            let percentage = (microseconds as f64 / 10_000.0 / duration).clamp(0.0, 99.0);
            current.fetch_max(percentage as u8, Ordering::Relaxed);
        }
    }
}

fn log_tail(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    file.seek(SeekFrom::Start(size.saturating_sub(4096)))?;
    let mut contents = Vec::new();
    file.take(4096).read_to_end(&mut contents)?;
    Ok(String::from_utf8_lossy(&contents).into_owned())
}

fn package_and_publish(
    zip: &Path,
    artifact: &Path,
    base: &Path,
    stem: &str,
    settings: &Settings,
    cancel: &AtomicBool,
) -> Result<PathBuf, String> {
    for destination in candidates(base, stem).filter(|path| available(path, settings.format)) {
        check_cancelled(cancel)?;
        let name = destination
            .file_stem()
            .and_then(|name| name.to_str())
            .ok_or("نام ZIP معتبر نیست.")?;
        let packed = crate::archive::pack(zip, artifact, name, settings, cancel);
        check_cancelled(cancel)?;
        packed.map_err(|error| format!("ساخت فایل ZIP ممکن نبود. {error}"))?;
        match move_without_overwrite(zip, &destination) {
            Ok(()) => return Ok(destination),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("ذخیرهٔ خروجی ممکن نبود. {error}")),
        }
    }
    unreachable!("output candidates are unbounded")
}

#[cfg(windows)]
fn move_without_overwrite(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileW(existing: *const u16, new: *const u16) -> i32;
    }

    let source = fs::canonicalize(source)?;
    let parent = fs::canonicalize(destination.parent().ok_or(io::ErrorKind::InvalidInput)?)?;
    let target = parent.join(destination.file_name().ok_or(io::ErrorKind::InvalidInput)?);
    let source_utf16: Vec<_> = source.as_os_str().encode_wide().chain([0]).collect();
    let target_utf16: Vec<_> = target.as_os_str().encode_wide().chain([0]).collect();
    // MoveFileW publishes atomically on the same volume and rejects an existing target.
    // The canonicalized paths support extended-length Unicode paths and both buffers are null terminated.
    if unsafe { MoveFileW(source_utf16.as_ptr(), target_utf16.as_ptr()) } != 0 {
        return Ok(());
    }
    let error = io::Error::last_os_error();
    if fs::symlink_metadata(&target).is_ok() {
        return Err(io::ErrorKind::AlreadyExists.into());
    }
    Err(error)
}

#[cfg(not(windows))]
fn move_without_overwrite(source: &Path, destination: &Path) -> io::Result<()> {
    fs::hard_link(source, destination)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_never_recommends_overwriting_a_file_or_hls_folder() {
        let directory = StagingDirectory::create(&std::env::temp_dir()).unwrap();
        fs::create_dir(directory.path().join("lesson")).unwrap();
        fs::write(directory.path().join("lesson.mp4"), "original").unwrap();
        assert_eq!(
            preview_reserved(directory.path(), "lesson", Format::Hls, |_| false),
            directory.path().join("lesson-2.zip")
        );
        assert_eq!(
            preview_reserved(directory.path(), "lesson", Format::Mp4, |path| {
                path.file_name().is_some_and(|name| name == "lesson-2.zip")
            }),
            directory.path().join("lesson-3.zip")
        );
    }

    #[test]
    fn progress_uses_microseconds_and_reserves_100_for_published_output() {
        let current = AtomicU8::new(0);
        read_progress(
            &b"out_time_us=500000\nout_time_us=1000000\n"[..],
            2.0,
            &current,
        );
        assert_eq!(current.load(Ordering::Relaxed), 50);
        read_progress(
            &b"out_time_us=2000000\nout_time_us=N/A\n"[..],
            2.0,
            &current,
        );
        assert_eq!(current.load(Ordering::Relaxed), 99);
    }

    #[test]
    fn cancelled_probe_exits_before_trying_to_start_the_subprocess() {
        let cancel = AtomicBool::new(true);
        let result = probe_cancellable(
            Path::new("nonexistent.exe"),
            Path::new("video.mp4"),
            &cancel,
        );
        assert!(matches!(result, Err(error) if error == CANCELLED));
    }
}

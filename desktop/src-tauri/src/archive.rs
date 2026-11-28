use crate::engine::{Format, PLAYLIST, STAGED_KEY, Settings, is_hls_segment};
use std::{
    fs::{self, File},
    io::{self, BufReader, BufWriter, Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};
use zip::{CompressionMethod, ZipArchive, ZipWriter, write::SimpleFileOptions};

fn key_name(stem: &str) -> String {
    format!("{stem}.key")
}

fn stored() -> SimpleFileOptions {
    SimpleFileOptions::default().compression_method(CompressionMethod::Stored)
}

fn invalid_archive() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "ساختار ZIP خروجی معتبر نیست.")
}

pub(crate) fn pack(
    path: &Path,
    artifact: &Path,
    stem: &str,
    settings: &Settings,
    cancel: &AtomicBool,
) -> io::Result<()> {
    let mut zip = ZipWriter::new(BufWriter::new(File::create(path)?)).set_auto_large_file();
    if settings.format == Format::Hls {
        let mut playlist = fs::read_to_string(artifact.join(PLAYLIST))?;
        if settings.encrypt {
            let key = key_name(stem);
            let staged_uri = format!("URI=\"{STAGED_KEY}\"");
            if !playlist.contains(&staged_uri) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "کلید HLS در فهرست پخش پیدا نشد.",
                ));
            }
            // Leave spaces and Unicode literal for local HLS readers as well as browsers.
            playlist = playlist.replace(&staged_uri, &format!("URI=\"{key}\""));
            add_file(&mut zip, &key, &artifact.join(STAGED_KEY), cancel)?;
        }
        zip.start_file(PLAYLIST, stored())?;
        zip.write_all(playlist.as_bytes())?;
        for entry in fs::read_dir(artifact)? {
            let entry = entry?;
            if let Some(name) = entry.file_name().to_str()
                && is_hls_segment(name)
            {
                add_file(&mut zip, name, &entry.path(), cancel)?;
            }
        }
    } else {
        let name = format!("{stem}.{}", settings.format.extension());
        add_file(&mut zip, &name, artifact, cancel)?;
    }
    let mut file = zip.finish()?;
    file.flush()?;
    file.get_ref().sync_all()
}

fn add_file(
    zip: &mut ZipWriter<BufWriter<File>>,
    name: &str,
    path: &Path,
    cancel: &AtomicBool,
) -> io::Result<()> {
    let mut source = File::open(path)?;
    zip.start_file(name, stored())?;
    let mut buffer = [0; 128 * 1024];
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(io::ErrorKind::Interrupted.into());
        }
        let count = source.read(&mut buffer)?;
        if count == 0 {
            return Ok(());
        }
        zip.write_all(&buffer[..count])?;
    }
}

pub(crate) fn unpack_for_player(archive: &Path, directory: &Path) -> io::Result<PathBuf> {
    let stem = archive
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or_else(invalid_archive)?;
    let key = key_name(stem);
    let mp4 = format!("{stem}.mp4");
    let webm = format!("{stem}.webm");
    let mut zip = ZipArchive::new(BufReader::new(File::open(archive)?))?;
    let hls = zip.index_for_name(PLAYLIST).is_some();
    let mut media = None;
    for index in 0..zip.len() {
        let mut file = zip.by_index(index)?;
        let name = file.name()?.into_owned();
        let playable = if hls {
            name == PLAYLIST
        } else {
            name == mp4 || name == webm
        };
        let hls_asset = hls && (is_hls_segment(&name) || (name == key && file.size() == 16));
        if !file.is_file()
            || file.compression() != CompressionMethod::Stored
            || (!playable && !hls_asset)
        {
            return Err(invalid_archive());
        }
        let path = directory.join(name);
        io::copy(&mut file, &mut File::create_new(&path)?)?;
        if playable && media.replace(path).is_some() {
            return Err(invalid_archive());
        }
    }
    media.ok_or_else(invalid_archive)
}

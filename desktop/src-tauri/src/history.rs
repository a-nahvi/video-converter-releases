use crate::{JobStatus, engine::Settings, write_atomic};
use serde::{Deserialize, Serialize};
use std::{
    cmp::Reverse,
    fs::{self, File, OpenOptions},
    io::{self, BufRead, BufReader, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Entry {
    #[serde(default)]
    id: String,
    source: PathBuf,
    status: JobStatus,
    finished_at: u64,
    settings: Settings,
    pub(crate) output: Option<PathBuf>,
    error: Option<String>,
}

pub(crate) fn record(
    file: &Path,
    source: &Path,
    settings: &Settings,
    status: JobStatus,
    output: Option<&Path>,
    error: Option<&str>,
) -> io::Result<()> {
    let _guard = lock_journal(file)?;
    let mut id = [0_u8; 16];
    getrandom::fill(&mut id).map_err(|error| io::Error::other(error.to_string()))?;
    let finished_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let entry = Entry {
        id: id.iter().map(|byte| format!("{byte:02x}")).collect(),
        source: source.to_owned(),
        status,
        finished_at,
        settings: settings.clone(),
        output: output.map(Path::to_owned),
        error: error.map(str::to_owned),
    };
    // A leading delimiter keeps the next entry readable after a partial write.
    let mut line = vec![b'\n'];
    serde_json::to_writer(&mut line, &entry)?;
    line.push(b'\n');
    let mut journal = OpenOptions::new().create(true).append(true).open(file)?;
    journal.write_all(&line)?;
    journal.sync_data()
}

pub(crate) fn list(file: &Path) -> io::Result<Vec<Entry>> {
    let _guard = lock_journal(file)?;
    read_journal(file)
}

pub(crate) fn delete(file: &Path, id: Option<&str>) -> io::Result<()> {
    let _guard = lock_journal(file)?;
    let mut remaining = Vec::new();
    if let Some(id) = id {
        remaining = read_journal(file)?;
        let before = remaining.len();
        remaining.retain(|entry| entry.id != id);
        if remaining.len() == before {
            return Ok(());
        }
    }
    write_atomic(file, |replacement| {
        for entry in remaining.iter().rev() {
            serde_json::to_writer(&mut *replacement, entry)?;
            replacement.write_all(b"\n")?;
        }
        Ok(())
    })
}

fn lock_journal(file: &Path) -> io::Result<File> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    let guard = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(file.with_extension("lock"))?;
    guard.lock()?;
    Ok(guard)
}

fn read_journal(file: &Path) -> io::Result<Vec<Entry>> {
    let reader = match File::open(file) {
        Ok(file) => BufReader::new(file),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    read_entries(reader)
}

fn read_entries(reader: impl BufRead) -> io::Result<Vec<Entry>> {
    let mut entries = Vec::new();
    for (position, line) in reader.split(b'\n').enumerate() {
        let line = line?;
        if let Ok(mut entry) = serde_json::from_slice::<Entry>(&line) {
            if entry.id.is_empty() {
                entry.id = format!("legacy-{position}-{}", entry.finished_at);
            }
            entries.push(entry);
        }
    }
    entries.reverse();
    entries.sort_by_key(|entry| Reverse(entry.finished_at));
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_keeps_complete_records_around_a_partial_write() {
        let lines = br#"{"source":"a.mp4","status":"done","finishedAt":10,"settings":{}}
{"unterminated":
{"source":"b.mov","status":"cancelled","finishedAt":12,"settings":{}}
"#;
        let entries = read_entries(&lines[..]).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].source, Path::new("b.mov"));
        assert_eq!(entries[1].source, Path::new("a.mp4"));
    }

    #[test]
    fn deleting_legacy_rows_keeps_remaining_ids_and_output_files() {
        let directory = crate::engine::StagingDirectory::create(&std::env::temp_dir()).unwrap();
        let journal = directory.path().join("history.jsonl");
        let output = directory.path().join("a.zip");
        fs::write(&output, b"archive").unwrap();
        let mut legacy = File::create(&journal).unwrap();
        for finished_at in [10, 20] {
            let entry = serde_json::json!({
                "source": "a.mp4", "status": "done", "finishedAt": finished_at,
                "settings": {}, "output": output,
            });
            writeln!(legacy, "{entry}").unwrap();
        }
        drop(legacy);

        let entries = list(&journal).unwrap();
        delete(&journal, Some(&entries[1].id)).unwrap();
        let remaining = list(&journal).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, entries[0].id);
        delete(&journal, None).unwrap();
        assert!(list(&journal).unwrap().is_empty());
        assert_eq!(fs::read(output).unwrap(), b"archive");
    }
}

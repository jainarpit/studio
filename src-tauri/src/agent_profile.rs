//! Studio's instructions for the agent in the chat panel.
//!
//! Codex, Claude Agent and Gemini CLI each read an instructions file from the
//! folder they run in (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`). When an agent runs
//! in Studio's own folder, Studio writes its instructions there, with a few task
//! guides beside them. The text lives in `src/agent-profile/`, so anyone can read
//! exactly what the agent is told.
//!
//! - Only ever writes inside Studio's own agent folder, to names fixed here.
//! - Rewrites a file only when it is missing or still exactly what Studio last
//!   wrote. A file the user has edited is left alone until they restore it.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

/// Bump when the instructions or the guides change, so the files are rewritten.
pub const VERSION: u32 = 1;

const INSTRUCTIONS: &str = include_str!("../../src/agent-profile/instructions.md");

/// The guides, by file name, written into `spec0-studio/guides/`.
const GUIDES: &[(&str, &str)] = &[
    ("test-an-api.md", include_str!("../../src/agent-profile/guides/test-an-api.md")),
    ("check-a-server.md", include_str!("../../src/agent-profile/guides/check-a-server.md")),
    ("build-a-collection.md", include_str!("../../src/agent-profile/guides/build-a-collection.md")),
    ("explain-a-failed-run.md", include_str!("../../src/agent-profile/guides/explain-a-failed-run.md")),
];

const GUIDES_DIR: &str = "spec0-studio/guides";

/// Where Studio keeps what it last wrote, in its own settings folder.
pub const RECORD_FILE: &str = "instructions.json";

/// The instructions file each agent reads from its working folder.
pub fn file_for(agent: &str) -> &'static str {
    match agent {
        "claude" => "CLAUDE.md",
        "gemini" => "GEMINI.md",
        // Codex, and any other ACP program: AGENTS.md is the shared convention.
        _ => "AGENTS.md",
    }
}

fn marker() -> String {
    format!(
        "<!-- Written by Spec0 Studio (agent instructions v{VERSION}). Studio keeps this file up to date. \
         If you edit it, Studio leaves it as it is; restore Studio's version in Settings, under Agent chat. -->"
    )
}

/// The files for one agent: relative path and contents.
pub fn files_for(agent: &str) -> Vec<(String, String)> {
    let mut files = vec![(file_for(agent).to_string(), format!("{}\n\n{}", marker(), INSTRUCTIONS))];
    for (name, text) in GUIDES {
        files.push((format!("{GUIDES_DIR}/{name}"), format!("{}\n\n{}", marker(), text)));
    }
    files
}

/// How Studio's instructions stand for a chat.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum State {
    /// Written and current: the agent reads them from its folder.
    Installed,
    /// The user edited one of the files, so Studio left it as it is.
    Edited,
    /// Turned off in Settings.
    Off,
    /// The agent works in a folder the user chose; Studio writes nothing there.
    Elsewhere,
    /// Writing failed. The chat sends the instructions with the first message instead.
    Failed,
}

/// What Studio last wrote, by relative path.
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct Record {
    #[serde(default)]
    pub written: BTreeMap<String, String>,
}

/// A path inside `root`, from one of the fixed relative names. Refuses anything
/// that could leave the folder.
pub fn inside(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let rel = Path::new(relative);
    if relative.is_empty()
        || rel.is_absolute()
        || rel.components().any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(format!("{relative} isn't a file name inside the agent's folder."));
    }
    Ok(root.join(rel))
}

/// What to do with one file.
#[derive(Debug, PartialEq, Eq)]
enum Plan {
    Keep,
    Write,
    Edited,
}

fn plan(current: Option<&str>, desired: &str, last: Option<&str>) -> Plan {
    match current {
        Some(current) if current == desired => Plan::Keep,
        None => Plan::Write,
        Some(current) if Some(current) == last => Plan::Write,
        Some(_) => Plan::Edited,
    }
}

fn read(path: &Path) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

fn write(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("{}: {error}", parent.display()))?;
    }
    std::fs::write(path, text).map_err(|error| format!("{}: {error}", path.display()))
}

/// Put the agent's instructions in `root`, keeping any file the user edited.
/// With `force`, Studio's version replaces edited files too.
pub fn install(root: &Path, agent: &str, record: &mut Record, force: bool) -> Result<State, String> {
    let mut edited = false;
    for (relative, desired) in files_for(agent) {
        let path = inside(root, &relative)?;
        let current = read(&path);
        let last = record.written.get(&relative).map(String::as_str);
        match plan(current.as_deref(), &desired, last) {
            Plan::Keep => {
                record.written.insert(relative, desired);
            }
            Plan::Edited if !force => edited = true,
            Plan::Write | Plan::Edited => {
                write(&path, &desired)?;
                record.written.insert(relative, desired);
            }
        }
    }
    Ok(if edited { State::Edited } else { State::Installed })
}

/// What `install` would find, without writing anything. For Settings.
pub fn status(root: &Path, agent: &str, record: &Record) -> Result<State, String> {
    for (relative, desired) in files_for(agent) {
        let path = inside(root, &relative)?;
        let last = record.written.get(&relative).map(String::as_str);
        if plan(read(&path).as_deref(), &desired, last) == Plan::Edited {
            return Ok(State::Edited);
        }
    }
    Ok(State::Installed)
}

/// Turned off: remove every file Studio wrote that is still exactly as written.
/// Files the user edited stay. Returns whether any edited file is left.
pub fn remove(root: &Path, record: &mut Record) -> bool {
    let mut left = false;
    for (relative, last) in std::mem::take(&mut record.written) {
        let Ok(path) = inside(root, &relative) else { continue };
        match read(&path) {
            Some(current) if current == last => {
                let _ = std::fs::remove_file(&path);
            }
            Some(_) => {
                left = true;
            }
            None => {}
        }
    }
    let _ = std::fs::remove_dir(root.join(GUIDES_DIR));
    let _ = std::fs::remove_dir(root.join("spec0-studio"));
    left
}

pub fn load_record(path: &Path) -> Record {
    read(path).and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

pub fn save_record(path: &Path, record: &Record) -> Result<(), String> {
    let text = serde_json::to_string_pretty(record).map_err(|error| error.to_string())?;
    write(path, &text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("studio-profile-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn each_agent_gets_the_file_it_reads() {
        assert_eq!(file_for("codex"), "AGENTS.md");
        assert_eq!(file_for("claude"), "CLAUDE.md");
        assert_eq!(file_for("gemini"), "GEMINI.md");
        assert_eq!(file_for("custom"), "AGENTS.md");
    }

    #[test]
    fn the_files_carry_the_version_and_the_bundled_text() {
        let files = files_for("codex");
        assert_eq!(files.len(), 1 + GUIDES.len());
        assert!(files[0].1.contains(&format!("agent instructions v{VERSION}")));
        assert!(files[0].1.contains("spec0-studio"));
        assert!(files.iter().skip(1).all(|(path, _)| path.starts_with("spec0-studio/guides/")));
    }

    #[test]
    fn nothing_outside_the_folder() {
        let root = Path::new("/tmp/agent");
        assert!(inside(root, "AGENTS.md").is_ok());
        assert!(inside(root, "spec0-studio/guides/a.md").is_ok());
        assert!(inside(root, "../AGENTS.md").is_err());
        assert!(inside(root, "spec0-studio/../../x").is_err());
        assert!(inside(root, "/etc/passwd").is_err());
        assert!(inside(root, "").is_err());
    }

    #[test]
    fn writes_then_keeps_then_rewrites_when_studio_changes_them() {
        let root = temp("write");
        let mut record = Record::default();
        assert_eq!(install(&root, "codex", &mut record, false).unwrap(), State::Installed);
        let text = std::fs::read_to_string(root.join("AGENTS.md")).unwrap();
        assert!(text.starts_with("<!-- Written by Spec0 Studio"));
        assert!(root.join("spec0-studio/guides/test-an-api.md").is_file());

        // An older version Studio wrote is replaced.
        std::fs::write(root.join("AGENTS.md"), "old version").unwrap();
        record.written.insert("AGENTS.md".into(), "old version".into());
        assert_eq!(install(&root, "codex", &mut record, false).unwrap(), State::Installed);
        assert_eq!(std::fs::read_to_string(root.join("AGENTS.md")).unwrap(), text);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_edited_file_is_left_alone_until_restored() {
        let root = temp("edited");
        let mut record = Record::default();
        install(&root, "claude", &mut record, false).unwrap();
        std::fs::write(root.join("CLAUDE.md"), "my own notes").unwrap();
        assert_eq!(status(&root, "claude", &record).unwrap(), State::Edited);
        assert_eq!(install(&root, "claude", &mut record, false).unwrap(), State::Edited);
        assert_eq!(std::fs::read_to_string(root.join("CLAUDE.md")).unwrap(), "my own notes");

        assert_eq!(install(&root, "claude", &mut record, true).unwrap(), State::Installed);
        assert_ne!(std::fs::read_to_string(root.join("CLAUDE.md")).unwrap(), "my own notes");
        assert_eq!(status(&root, "claude", &record).unwrap(), State::Installed);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_file_studio_never_wrote_counts_as_the_users() {
        let root = temp("foreign");
        std::fs::write(root.join("GEMINI.md"), "someone else's").unwrap();
        let mut record = Record::default();
        assert_eq!(install(&root, "gemini", &mut record, false).unwrap(), State::Edited);
        assert_eq!(std::fs::read_to_string(root.join("GEMINI.md")).unwrap(), "someone else's");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn turning_it_off_removes_only_studios_unchanged_files() {
        let root = temp("off");
        let mut record = Record::default();
        install(&root, "codex", &mut record, false).unwrap();
        std::fs::write(root.join("spec0-studio/guides/test-an-api.md"), "edited guide").unwrap();
        assert!(remove(&root, &mut record));
        assert!(!root.join("AGENTS.md").exists());
        assert!(root.join("spec0-studio/guides/test-an-api.md").is_file());
        assert!(record.written.is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_record_round_trips() {
        let root = temp("record");
        let path = root.join(RECORD_FILE);
        let mut record = Record::default();
        record.written.insert("AGENTS.md".into(), "text".into());
        save_record(&path, &record).unwrap();
        assert_eq!(load_record(&path), record);
        assert_eq!(load_record(&root.join("missing.json")), Record::default());
        let _ = std::fs::remove_dir_all(&root);
    }
}

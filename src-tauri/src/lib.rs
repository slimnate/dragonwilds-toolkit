mod world_index;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize)]
pub struct CharacterFileInfo {
    pub path: String,
    pub name: String,
}

#[derive(Serialize)]
struct WorldNameInfo {
    guid: String,
    name: String,
}

fn saved_root_path() -> Result<PathBuf, String> {
    let local = std::env::var("LOCALAPPDATA").map_err(|_| "LOCALAPPDATA is not set".to_string())?;
    Ok(PathBuf::from(local).join("RSDragonwilds").join("Saved"))
}

fn default_worlds_dir_path() -> Result<PathBuf, String> {
    Ok(saved_root_path()?.join("SaveGames"))
}

fn is_world_sav(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".sav")
        && !lower.ends_with(".backup")
        && !lower.ends_with(".editorbackup")
        && !lower.contains(".verbackup")
        && lower != "enhancedinputusersettings.sav"
}

fn b64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    let mut index = 0;
    while index + 3 <= bytes.len() {
        let value = ((bytes[index] as u32) << 16) | ((bytes[index + 1] as u32) << 8) | (bytes[index + 2] as u32);
        out.push(TABLE[((value >> 18) & 63) as usize] as char);
        out.push(TABLE[((value >> 12) & 63) as usize] as char);
        out.push(TABLE[((value >> 6) & 63) as usize] as char);
        out.push(TABLE[(value & 63) as usize] as char);
        index += 3;
    }
    if index < bytes.len() {
        let remain = bytes.len() - index;
        let mut value = (bytes[index] as u32) << 16;
        if remain == 2 {
            value |= (bytes[index + 1] as u32) << 8;
        }
        out.push(TABLE[((value >> 18) & 63) as usize] as char);
        out.push(TABLE[((value >> 12) & 63) as usize] as char);
        if remain == 2 {
            out.push(TABLE[((value >> 6) & 63) as usize] as char);
            out.push('=');
        } else {
            out.push('=');
            out.push('=');
        }
    }
    out
}

fn b64_value(byte: u8) -> Result<u8, String> {
    match byte {
        b'A'..=b'Z' => Ok(byte - b'A'),
        b'a'..=b'z' => Ok(byte - b'a' + 26),
        b'0'..=b'9' => Ok(byte - b'0' + 52),
        b'+' => Ok(62),
        b'/' => Ok(63),
        _ => Err("World save payload is not valid base64".to_string()),
    }
}

fn b64_decode(text: &str) -> Result<Vec<u8>, String> {
    let bytes = text.as_bytes();
    if bytes.len() % 4 != 0 {
        return Err("World save payload is not valid base64".to_string());
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    for chunk in bytes.chunks(4) {
        let pad = chunk.iter().filter(|byte| **byte == b'=').count();
        if pad > 2 {
            return Err("World save payload is not valid base64".to_string());
        }
        let a = b64_value(chunk[0])?;
        let b = b64_value(chunk[1])?;
        let c = if chunk[2] == b'=' { 0 } else { b64_value(chunk[2])? };
        let d = if chunk[3] == b'=' { 0 } else { b64_value(chunk[3])? };
        let value = ((a as u32) << 18) | ((b as u32) << 12) | ((c as u32) << 6) | (d as u32);
        out.push((value >> 16) as u8);
        if pad < 2 {
            out.push((value >> 8) as u8);
        }
        if pad < 1 {
            out.push(value as u8);
        }
    }
    Ok(out)
}

fn default_save_dir_path() -> Result<PathBuf, String> {
    Ok(saved_root_path()?.join("SaveCharacters"))
}

fn save_folder_path(folder: &str) -> Result<PathBuf, String> {
    match folder {
        "saved" => saved_root_path(),
        "characters" => default_save_dir_path(),
        "worlds" => default_worlds_dir_path(),
        _ => Err("Unknown save folder".to_string()),
    }
}

fn is_character_json(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".json")
        && !lower.ends_with(".backup")
        && !lower.ends_with(".editorbackup")
        && !lower.contains(".verbackup")
}

#[tauri::command]
fn default_save_dir() -> Result<String, String> {
    default_save_dir_path().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn default_saved_dir() -> Result<String, String> {
    saved_root_path().map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_in_explorer(folder: String) -> Result<(), String> {
    let path = save_folder_path(&folder)?;
    if !path.is_dir() {
        return Err(format!("Folder does not exist: {}", path.display()));
    }
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_characters(dir: Option<String>) -> Result<Vec<CharacterFileInfo>, String> {
    let folder = match dir {
        Some(value) if !value.is_empty() => PathBuf::from(value),
        _ => default_save_dir_path()?,
    };
    if !folder.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in fs::read_dir(&folder).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_file() && is_character_json(&name) {
            files.push(CharacterFileInfo {
                path: path.to_string_lossy().into_owned(),
                name,
            });
        }
    }
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(files)
}

#[tauri::command]
fn read_character(path: String) -> Result<String, String> {
    fs::read_to_string(Path::new(&path)).map_err(|err| err.to_string())
}

#[tauri::command]
fn default_worlds_dir() -> Result<String, String> {
    default_worlds_dir_path().map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_worlds(dir: Option<String>) -> Result<Vec<CharacterFileInfo>, String> {
    let folder = match dir {
        Some(value) if !value.is_empty() => PathBuf::from(value),
        _ => default_worlds_dir_path()?,
    };
    if !folder.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in fs::read_dir(&folder).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_file() && is_world_sav(&name) {
            files.push(CharacterFileInfo {
                path: path.to_string_lossy().into_owned(),
                name,
            });
        }
    }
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(files)
}

#[tauri::command]
fn list_world_names(dir: Option<String>) -> Result<Vec<WorldNameInfo>, String> {
    let folder = match dir {
        Some(value) if !value.is_empty() => PathBuf::from(value),
        _ => default_worlds_dir_path()?,
    };
    if !folder.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in fs::read_dir(&folder).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if !path.is_file() || !is_world_sav(&name) {
            continue;
        }
        let Some(identity) = world_index::read_world_identity(&path) else {
            continue;
        };
        if identity.name.is_empty() {
            continue;
        }
        files.push(WorldNameInfo {
            guid: identity.guid,
            name: identity.name,
        });
    }
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    let mut seen = std::collections::HashSet::new();
    files.retain(|info| seen.insert(info.guid.to_ascii_uppercase()));
    Ok(files)
}

#[tauri::command]
fn read_world(path: String) -> Result<String, String> {
    let bytes = fs::read(Path::new(&path)).map_err(|err| err.to_string())?;
    Ok(b64_encode(&bytes))
}

#[tauri::command]
fn write_world(path: String, contents: String, backup: bool) -> Result<(), String> {
    let file = Path::new(&path);
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    if backup && file.exists() {
        let bak = format!("{path}.editorbackup");
        fs::copy(file, bak).map_err(|err| err.to_string())?;
    }
    let bytes = b64_decode(&contents)?;
    fs::write(file, bytes).map_err(|err| err.to_string())
}

#[tauri::command]
fn write_character(path: String, contents: String, backup: bool) -> Result<(), String> {
    let file = Path::new(&path);
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    if backup && file.exists() {
        let bak = format!("{path}.editorbackup");
        fs::copy(file, bak).map_err(|err| err.to_string())?;
    }
    fs::write(file, contents).map_err(|err| err.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            default_save_dir,
            default_saved_dir,
            open_in_explorer,
            list_characters,
            read_character,
            write_character,
            default_worlds_dir,
            list_worlds,
            list_world_names,
            read_world,
            write_world
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

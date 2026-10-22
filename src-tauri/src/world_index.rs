use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

pub struct WorldIdentity {
    pub guid: String,
    pub name: String,
}

const MAX_INFO_BYTES: u64 = 32 * 1024 * 1024;

/// Read the world GUID and display name from a slot's INFO/CINF header.
pub fn read_world_identity(path: &Path) -> Option<WorldIdentity> {
    let mut file = File::open(path).ok()?;
    let mut header = [0u8; 8];
    file.read_exact(&mut header).ok()?;
    if &header[0..4] != b"SAVE" {
        return None;
    }
    let save_len = u32::from_le_bytes(header[4..8].try_into().ok()?) as u64;
    let save_end = 8 + save_len;
    let mut cursor = 8u64;
    while cursor + 8 <= save_end {
        file.seek(SeekFrom::Start(cursor)).ok()?;
        let mut chunk = [0u8; 8];
        file.read_exact(&mut chunk).ok()?;
        if !chunk[0..4].iter().all(|byte| byte.is_ascii_uppercase()) {
            break;
        }
        let len = u32::from_le_bytes(chunk[4..8].try_into().ok()?) as u64;
        if cursor + 8 + len > save_end {
            break;
        }
        if &chunk[0..4] == b"INFO" {
            if len > MAX_INFO_BYTES {
                return None;
            }
            let mut info = vec![0u8; len as usize];
            file.read_exact(&mut info).ok()?;
            return identity_from_info(&info);
        }
        cursor += 8 + len;
    }
    None
}

fn identity_from_info(info: &[u8]) -> Option<WorldIdentity> {
    let nodes = find_packed_suffix(info)?;
    let cinf = nodes.into_iter().find(|node| node.magic == *b"CINF")?;
    let (guid, name) = parse_cinf(&info[cinf.payload_start..cinf.payload_end])?;
    Some(WorldIdentity { guid, name })
}

struct PackedChunk {
    magic: [u8; 4],
    payload_start: usize,
    payload_end: usize,
}

fn looks_like_chunk(bytes: &[u8], offset: usize, limit: usize) -> bool {
    if offset + 8 > limit {
        return false;
    }
    if !bytes[offset..offset + 4].iter().all(|byte| byte.is_ascii_uppercase()) {
        return false;
    }
    let len = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap_or([0; 4])) as usize;
    offset + 8 + len <= limit
}

fn find_packed_suffix(payload: &[u8]) -> Option<Vec<PackedChunk>> {
    let end = payload.len();
    for cursor in 0..end {
        if !looks_like_chunk(payload, cursor, end) {
            continue;
        }
        let mut nodes = Vec::new();
        let mut at = cursor;
        let mut ok = true;
        while at < end {
            if !looks_like_chunk(payload, at, end) {
                ok = false;
                break;
            }
            let len = u32::from_le_bytes(payload[at + 4..at + 8].try_into().ok()?) as usize;
            let next = at + 8 + len;
            if next <= at {
                ok = false;
                break;
            }
            let mut magic = [0u8; 4];
            magic.copy_from_slice(&payload[at..at + 4]);
            nodes.push(PackedChunk {
                magic,
                payload_start: at + 8,
                payload_end: next,
            });
            at = next;
        }
        if ok && at == end && !nodes.is_empty() {
            return Some(nodes);
        }
    }
    None
}

fn read_i32(bytes: &[u8], cursor: &mut usize) -> Option<i32> {
    if *cursor + 4 > bytes.len() {
        return None;
    }
    let value = i32::from_le_bytes(bytes[*cursor..*cursor + 4].try_into().ok()?);
    *cursor += 4;
    Some(value)
}

fn read_fstring(bytes: &[u8], offset: usize, end: usize) -> Option<(String, usize)> {
    if offset + 4 > end {
        return None;
    }
    let count = i32::from_le_bytes(bytes[offset..offset + 4].try_into().ok()?);
    let start = offset + 4;
    if count == 0 {
        return Some((String::new(), start));
    }
    if count > 0 {
        let count = count as usize;
        if count > 1_000_000 || start + count > end {
            return None;
        }
        let text = String::from_utf8_lossy(&bytes[start..start + count - 1]).into_owned();
        return Some((text, start + count));
    }
    let chars = (-count) as usize;
    if chars == 0 || chars > 1_000_000 || start + chars * 2 > end {
        return None;
    }
    let units: Vec<u16> = bytes[start..start + chars * 2 - 2]
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    Some((String::from_utf16_lossy(&units), start + chars * 2))
}

fn parse_cinf(payload: &[u8]) -> Option<(String, String)> {
    let mut cursor = 0;
    let name_count = read_i32(payload, &mut cursor)?;
    if !(0..=10_000).contains(&name_count) {
        return None;
    }
    let mut names = Vec::with_capacity(name_count as usize);
    for _ in 0..name_count {
        let (text, next) = read_fstring(payload, cursor, payload.len())?;
        names.push(text);
        cursor = next;
    }
    let count = read_i32(payload, &mut cursor)?;
    if !(0..=100_000).contains(&count) {
        return None;
    }
    let count = count as usize;
    if cursor + count * 4 + 4 > payload.len() {
        return None;
    }
    let mut offsets = Vec::with_capacity(count);
    for _ in 0..count {
        offsets.push(read_i32(payload, &mut cursor)?);
    }
    let data_count = read_i32(payload, &mut cursor)?;
    if data_count < 0 {
        return None;
    }
    let data_count = data_count as usize;
    let blob = cursor;
    if blob + data_count > payload.len() {
        return None;
    }

    let mut parts = [0u32; 4];
    let mut found = [false; 4];
    let mut world_name = String::new();
    for (index, name) in names.iter().enumerate() {
        if index >= offsets.len() {
            break;
        }
        let start_off = offsets[index];
        if start_off < 0 {
            return None;
        }
        let end_off = if index + 1 < offsets.len() {
            offsets[index + 1]
        } else {
            data_count as i32
        };
        if end_off < start_off {
            return None;
        }
        let start = blob + start_off as usize;
        let end = blob + end_off as usize;
        if end > payload.len() {
            return None;
        }
        let slice = &payload[start..end];
        match name.as_str() {
            "GUID_A" | "GUID_B" | "GUID_C" | "GUID_D" if slice.len() >= 4 => {
                let which = match name.as_str() {
                    "GUID_A" => 0,
                    "GUID_B" => 1,
                    "GUID_C" => 2,
                    _ => 3,
                };
                parts[which] = u32::from_le_bytes(slice[0..4].try_into().ok()?);
                found[which] = true;
            }
            "WorldName" => {
                if let Some((text, _)) = read_fstring(slice, 0, slice.len()) {
                    world_name = text;
                }
            }
            _ => {}
        }
    }
    if found.iter().any(|flag| !*flag) {
        return None;
    }
    let guid = format!("{:08X}{:08X}{:08X}{:08X}", parts[0], parts[1], parts[2], parts[3]);
    Some((guid, world_name))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fstring(text: &str) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&(text.len() as i32 + 1).to_le_bytes());
        out.extend_from_slice(text.as_bytes());
        out.push(0);
        out
    }

    fn chunk(magic: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(magic);
        out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        out.extend_from_slice(payload);
        out
    }

    #[test]
    fn reads_guid_and_name_from_cinf_suffix() {
        let names = ["GUID_A", "GUID_B", "GUID_C", "GUID_D", "WorldName"];
        let mut payload = Vec::new();
        payload.extend_from_slice(&(names.len() as i32).to_le_bytes());
        for name in names {
            payload.extend_from_slice(&fstring(name));
        }
        let slices: Vec<Vec<u8>> = vec![
            0x80649F04u32.to_le_bytes().to_vec(),
            0x4B5BDF2Fu32.to_le_bytes().to_vec(),
            0x41CAE58Fu32.to_le_bytes().to_vec(),
            0x2C2F25C4u32.to_le_bytes().to_vec(),
            fstring("HelloWorld"),
        ];
        payload.extend_from_slice(&(slices.len() as i32).to_le_bytes());
        let mut data_cursor = 0i32;
        for slice in &slices {
            payload.extend_from_slice(&data_cursor.to_le_bytes());
            data_cursor += slice.len() as i32;
        }
        payload.extend_from_slice(&data_cursor.to_le_bytes());
        for slice in &slices {
            payload.extend_from_slice(slice);
        }
        let mut info = b"not-a-chunk-prefix!!".to_vec();
        info.extend_from_slice(&chunk(b"CINF", &payload));
        let identity = identity_from_info(&info).expect("identity");
        assert_eq!(identity.guid, "80649F044B5BDF2F41CAE58F2C2F25C4");
        assert_eq!(identity.name, "HelloWorld");
    }
}

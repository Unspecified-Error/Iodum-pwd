//! Tauri 后端：内置确定性密码生成（SHA-256 计数器流 + 全池均匀采样），
//! 不依赖 workspace 外部路径，并返回强度 / 字符池 / 构成等指标供前端绘制 burn 风格仪表盘。

mod password;
mod stream;

use crate::password::{entropy_bits, generate_password_raw, POOL_SIZE};
use serde::Serialize;

/// 密码长度边界（与 encryptor 的校验、TUI 版本一致）
pub const MIN_LEN: usize = 6;
pub const MAX_LEN: usize = 4096;

#[derive(Serialize)]
pub struct GenOut {
    password: String,
    /// 熵（bits）：四类均衡方案的理论熵，见 encryptor::password::entropy_bits
    entropy: f64,
    /// 强度档位：Weak / Medium / Strong / Very Strong
    tier: String,
    /// 字符池总大小（新方案恒为 94）
    pool: f64,
    /// 字符构成 [low, up, dig, sym]
    mix: Vec<(&'static str, usize)>,
}

fn composition(pass: &str) -> Vec<(&'static str, usize)> {
    let mut counts = vec![("low", 0usize), ("up", 0), ("dig", 0), ("sym", 0)];
    for c in pass.chars() {
        let idx = if c.is_ascii_lowercase() {
            0
        } else if c.is_ascii_uppercase() {
            1
        } else if c.is_ascii_digit() {
            2
        } else {
            3
        };
        counts[idx].1 += 1;
    }
    counts
}

fn tier_of(bits: f64) -> &'static str {
    if bits < 36.0 {
        "Weak"
    } else if bits < 60.0 {
        "Medium"
    } else if bits < 80.0 {
        "Strong"
    } else {
        "Very Strong"
    }
}

/// 生成密码并返回全部指标；失败（seed 为空、长度越界等）返回错误消息
#[tauri::command]
fn generate_password(seed: String, length: usize) -> Result<GenOut, String> {
    if !(MIN_LEN..=MAX_LEN).contains(&length) {
        return Err(format!("length must be {MIN_LEN}..={MAX_LEN}"));
    }
    let pass = generate_password_raw(&seed, length).map_err(|e| e.to_string())?;
    let entropy = entropy_bits(pass.len());
    let mix = composition(&pass);
    let tier = tier_of(entropy).to_string();
    Ok(GenOut {
        password: pass,
        entropy,
        tier,
        pool: POOL_SIZE as f64,
        mix,
    })
}

/// 写入系统剪贴板（WebView 里 navigator.clipboard 在部分环境不可靠）
#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    arboard::Clipboard::new()
        .and_then(|mut c| c.set_text(text))
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![generate_password, copy_text])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

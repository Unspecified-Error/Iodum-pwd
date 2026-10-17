//! 密码生成核心（桌面端内置版本，与 encryptor crate 同源同算法，
//! 不依赖 workspace 外部路径）。

use anyhow::{bail, Error, Result};
use crate::stream::SeedStream;

/// 四类字符池（可见 ASCII，不含空格）：小写 26 / 大写 26 / 数字 10 / 符号 32
const LOWER: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
const UPPER: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS: &[u8] = b"0123456789";
const SYMBOLS: &[u8] = b"!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

/// 字符池总大小
pub const POOL_SIZE: usize = 94;

/// 检查四类字符是否都在场
fn classes_present(chars: &[u8]) -> bool {
    [LOWER, UPPER, DIGITS, SYMBOLS]
        .iter()
        .all(|pool| chars.iter().any(|c| pool.contains(c)))
}

/// 生成纯密码。
///
/// 方案要点：
/// 1. SHA-256 计数器流把 seed 确定性地扩展为近似均匀的随机源，杜绝
///    旧方案 "interval 反复拼接" 产生的大段周期性重复；
/// 2. 长度参与流的域分隔（`seed \0 length`）：同 seed 不同长度得到
///    完全独立的流，密码之间不存在前缀关系；
/// 3. 全池 94 字符 IID 均匀采样：类别数量不设配额、完全随机（熵最大）；
/// 4. 整串拒绝采样保证四类字符都在场——出现的密码不会缺数字或缺符号。
pub fn generate_password_raw(seed: &str, length: usize) -> Result<String, Error> {
    if length < 6 {
        bail!("length must >= 6");
    }
    if seed.is_empty() {
        bail!("seed must not be empty");
    }

    let mut rng = SeedStream::new(&format!("{seed}\0{length}"));
    let pool: Vec<u8> = [LOWER, UPPER, DIGITS, SYMBOLS].concat();

    // IID 全池均匀采样；整串重抽（拒绝采样）保证四类在场且分布仍严格均匀
    let chars: Vec<u8> = loop {
        let chars: Vec<u8> = (0..length)
            .map(|_| pool[rng.below(POOL_SIZE as u64) as usize])
            .collect();
        if classes_present(&chars) {
            break chars;
        }
    };

    Ok(String::from_utf8(chars).expect("charset is pure ASCII"))
}

/// 本方案的真实熵（bits）：
/// 全池 IID 均匀 + 条件"四类都在场"，由容斥计算合法串数 N(k)：
/// N(k) = Σ_T (-1)^|T| (94 - Σ pool_T)^k，熵 = log2 N(k)。
/// 用比例形式计算避免 f64 在大长度下溢出。
pub fn entropy_bits(length: usize) -> f64 {
    let pools = [26.0f64, 26.0, 10.0, 32.0];
    let k = length as f64;
    let base = k * (POOL_SIZE as f64).log2();
    let mut sum = 0.0f64;
    for mask in 0..16usize {
        let excluded: f64 = (0..4)
            .filter(|&i| mask & (1 << i) != 0)
            .map(|i| pools[i])
            .sum();
        let ratio = (POOL_SIZE as f64 - excluded) / POOL_SIZE as f64;
        let sign = if mask.count_ones() % 2 == 0 { 1.0 } else { -1.0 };
        sum += sign * ratio.powf(k);
    }
    base + sum.max(1e-12).log2()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic() {
        let a = generate_password_raw("jdwnp", 16).unwrap();
        let b = generate_password_raw("jdwnp", 16).unwrap();
        assert_eq!(a, b);
        assert_ne!(a, generate_password_raw("jdwnq", 16).unwrap());
    }

    #[test]
    fn all_classes_present() {
        for seed in ["a1!", "balance", "zz9", "x"] {
            let p = generate_password_raw(seed, 16).unwrap();
            assert_eq!(p.len(), 16);
            assert!(p.chars().any(|c| c.is_ascii_lowercase()));
            assert!(p.chars().any(|c| c.is_ascii_uppercase()));
            assert!(p.chars().any(|c| c.is_ascii_digit()));
            assert!(p.chars().any(|c| !c.is_ascii_alphanumeric()));
        }
    }

    #[test]
    fn composition_varies() {
        // 不再固定 4/4/4/4：多个 seed 的构成应出现差异
        let sig = |p: &str| {
            [
                p.chars().filter(|c| c.is_ascii_lowercase()).count(),
                p.chars().filter(|c| c.is_ascii_uppercase()).count(),
                p.chars().filter(|c| c.is_ascii_digit()).count(),
                p.chars().filter(|c| !c.is_ascii_alphanumeric()).count(),
            ]
        };
        let first = sig(&generate_password_raw("s0", 16).unwrap());
        assert!(
            (0..30).any(|i| sig(&generate_password_raw(&format!("s{i}"), 16).unwrap()) != first),
            "composition never varied: {first:?}"
        );
    }

    #[test]
    fn no_long_periodic_repetition() {
        let p = generate_password_raw("repeat", 256).unwrap();
        let b = p.as_bytes();
        // 旧方案的病灶：同一大段反复出现。相邻 16 字节段必须互不相同
        for w in (0..b.len() - 16).step_by(16) {
            assert_ne!(&b[w..w + 16], &b[w + 16..w + 32]);
        }
    }

    #[test]
    fn long_lengths_ok() {
        let p = generate_password_raw("long", 2048).unwrap();
        assert_eq!(p.len(), 2048);
        assert!(classes_present(p.as_bytes()));
    }

    #[test]
    fn different_lengths_independent() {
        // 同 seed 不同长度不得共享前缀：长密码的前 16 位 ≠ 16 位密码
        let short = generate_password_raw("jdwnp", 16).unwrap();
        let long = generate_password_raw("jdwnp", 64).unwrap();
        assert_ne!(&long[..16], &short);
    }

    #[test]
    fn entropy_matches_formula() {
        // 16 字符 ≈ log2(94^16) - log2(1/0.82) ≈ 104.6
        let bits = entropy_bits(16);
        assert!((103.0..=105.0).contains(&bits), "{bits}");
        assert!(entropy_bits(6) < entropy_bits(2048));
    }

    #[test]
    fn rejects_invalid_input() {
        assert!(generate_password_raw("", 16).is_err());
        assert!(generate_password_raw("valid", 5).is_err());
        assert!(generate_password_raw("abc", 16).is_ok()); // 短 seed 允许
    }
}

//! 由种子派生的确定性随机流（SHA-256 计数器模式）。
//!
//! 把任意 seed 扩展为近似均匀、无周期结构的字节序列，
//! 作为密码生成的随机源。桌面端内置版本，不依赖外部 crate 路径。

use sha2::{Digest, Sha256};

/// 每块 = SHA256(counter_le32 || seed)，32 字节，耗尽后 counter 自增续充
pub struct SeedStream {
    seed: Vec<u8>,
    counter: u32,
    buf: [u8; 32],
    pos: usize,
}

impl SeedStream {
    pub fn new(seed: &str) -> Self {
        Self {
            seed: seed.as_bytes().to_vec(),
            counter: 0,
            buf: [0; 32],
            pos: 32, // 强制首次取用即 refill
        }
    }

    fn refill(&mut self) {
        let mut h = Sha256::new();
        h.update(self.counter.to_le_bytes());
        h.update(&self.seed);
        self.buf = h.finalize().into();
        self.counter = self.counter.wrapping_add(1);
        self.pos = 0;
    }

    pub fn next_u64(&mut self) -> u64 {
        if self.pos + 8 > self.buf.len() {
            self.refill();
        }
        let mut b = [0u8; 8];
        b.copy_from_slice(&self.buf[self.pos..self.pos + 8]);
        self.pos += 8;
        u64::from_le_bytes(b)
    }

    /// 无偏采样 [0, n)：拒绝采样消除模偏差
    pub fn below(&mut self, n: u64) -> u64 {
        debug_assert!(n >= 1);
        if n <= 1 {
            return 0;
        }
        // m = 2^64 mod n；接受 v < 2^64 - m 的值再取模即严格均匀
        let m = ((u64::MAX % n) + 1) % n;
        loop {
            let v = self.next_u64();
            if m == 0 || v < u64::MAX - m + 1 {
                return v % n;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::SeedStream;
    use std::collections::HashMap;

    #[test]
    fn deterministic() {
        let a: Vec<u64> = (0..16)
            .scan(SeedStream::new("jdwnp"), |r, _| Some(r.next_u64()))
            .collect();
        let b: Vec<u64> = (0..16)
            .scan(SeedStream::new("jdwnp"), |r, _| Some(r.next_u64()))
            .collect();
        assert_eq!(a, b);
    }

    #[test]
    fn below_is_uniform_and_in_range() {
        let mut rng = SeedStream::new("uniformity");
        let n = 7u64;
        let mut hist: HashMap<u64, u32> = HashMap::new();
        for _ in 0..70_000 {
            let v = rng.below(n);
            assert!(v < n);
            *hist.entry(v).or_default() += 1;
        }
        let expected = 70_000 / n as u32;
        for k in 0..n {
            let c = hist.get(&k).copied().unwrap_or(0);
            assert!(
                (c as i64 - expected as i64).abs() < expected as i64 / 5,
                "bucket {k} = {c}, expected ~{expected}"
            );
        }
    }

    #[test]
    fn different_seeds_diverge() {
        let a = SeedStream::new("aaaa").next_u64();
        let b = SeedStream::new("aaab").next_u64();
        assert_ne!(a, b);
    }
}

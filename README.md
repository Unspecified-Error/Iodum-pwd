<div align="center">

<img src="logo.svg" width="128" alt="Iodum logo" />

# Iodum

**确定性密码生成器 · burn 风格可视化仪表盘**

*同一种子，永远同一个密码 —— 看得见的熵。*

![Platform](https://img.shields.io/badge/platform-Windows-blue)
![Rust](https://img.shields.io/badge/Rust-stable-dea584?logo=rust)
![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8DB?logo=tauri)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)

</div>

---

## 为什么是 Iodum

碘（I，127 号元素）的化学性质**极其稳定**——正如这个生成器的承诺：
**同一个 seed + 同一个长度，在任何机器、任何时间，永远得到同一个密码。**
没有随机数存储、没有云同步，你的种子就是唯一的钥匙。

Iodum 是 [PasswdGenerator](../) 的桌面发行版：内置完整密码引擎，
**零外部路径依赖**，整个 `desktop/` 文件夹拷到任何地方都能构建。

## 特性

| | |
|---|---|
| 🎯 **确定性引擎** | SHA-256 计数器流派生，无状态、可复现、可审计 |
| 🔀 **全池均匀采样** | 94 字符池 IID 采样，类别数量不设配额，熵最大 |
| 🛡️ **四类保证** | 拒绝采样确保小写 / 大写 / 数字 / 符号全部在场 |
| 🔒 **无前缀泄露** | 长度参与域分隔，同 seed 不同长度之间零前缀关系 |
| 📊 **burn 仪表盘** | 熵历史曲线、字符构成图、seed 记录表，训练面板同款视觉 |
| ⚡ **实时计算** | 逐键生成，Rust 后端 IPC 零防抖直返 |

## 密码引擎

```
block_i   = SHA256( counter_i ‖ seed ‖ 0x00 ‖ length )
random    = SeedStream{ block_0 ‖ block_1 ‖ ... }
password  = 拒绝采样( 全池 94 字符均匀采样, 直到四类字符都在场 )
```

**熵（精确公式，容斥原理）**——界面显示的不是估算，是数学：

$$
E = \log_2 N(k), \quad N(k) = \sum_{T \subseteq \{1,2,3,4\}} (-1)^{|T|}\,(94 - \textstyle\sum_{p \in T} |p|)^k
$$

16 字符密码 ≈ **104.6 bits**；2048 字符 ≈ **13287 bits**。

| 参数 | 值 |
|---|---|
| 字符池 | `a-z` 26 · `A-Z` 26 · `0-9` 10 · 符号 32 |
| 长度范围 | 6 – 2048 |
| 输出编码 | UTF-8（纯可见 ASCII，无空格） |

## 快速开始

**前置**：[Rust stable](https://rustup.rs)、Node.js ≥ 20、WebView2（Win11 自带）

```bash
cd desktop
npm install          # 首次安装（npm 12 需批准 esbuild 脚本）
npm run tauri dev    # 开发模式
npm run tauri build  # 产出 NSIS 安装包 + 独立 exe
```

## 快捷键

| 按键 | 功能 |
|---|---|
| 输入任意文本 | 即时生成（种子 ≥ 1 字符即可，推荐 ≥ 4） |
| `↑` / `↓` | 长度 ±1 |
| `PgUp` / `PgDn` | 长度 ±5 |
| `←` / `→` | 切换图表页（History / Seeds / Charset） |
| `Enter` | 复制密码到剪贴板 |
| `Ctrl+S` | 显示 / 隐藏密码 |
| `Shift+S` | 记录当前 seed + 长度（持久化） |
| `Ctrl+R` | 重置（清空历史） |

## 项目结构

```
desktop/
├── src/
│   ├── App.jsx          # burn 风格仪表盘（Controls / Metrics / Status / Plots）
│   ├── styles.css       # 黑底 + 金色主题，与 TUI 同一套配色
│   └── main.jsx
├── src-tauri/
│   ├── src/
│   │   ├── password.rs  # 密码引擎：采样 + 拒绝域 + 精确熵（含 8 项测试）
│   │   ├── stream.rs    # SeedStream：SHA-256 计数器流（含 3 项测试）
│   │   ├── lib.rs       # Tauri 命令：generate_password / copy_text
│   │   └── main.rs
│   ├── icons/icon.ico
│   └── tauri.conf.json  # 固定窗口 1165 × 690
└── logo.svg             # Iᴾ 标志
```

## 设计决策

- **为什么不用 CSPRNG？** Iodum 的价值在确定性：种子是唯一需要记忆的东西。
  密码不落盘、不传输，丢了就丢了——换个种子再生成一个即可。
- **为什么长度要域分隔？** 直接用流前缀会让 64 位密码包含 16 位密码——
  泄露短密码等于泄露长密码的前缀。`(seed ‖ 0x00 ‖ length)` 切断这条链。
- **为什么显示精确熵而不是 log2(94^k)？** "四类都在场"是条件事件，
  条件熵略低于无条件熵；诚实的数字比好看的数字更专业。

---

<div align="center">

© shieber · crafted with Rust + React

</div>

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import logoUrl from "../logo.svg";

const MIN_LEN = 6;
const MAX_LEN = 2048;
const HISTORY_CAP = 2048;
const STATUS_TTL = 3000;

// burn 配色
const GOLD = "#daa520";
const RED = "#e74c3c";
const BLUE = "#6495ed";
const DIM = "#787880";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function loadLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

const tierColor = (tier) =>
  tier === "Weak" || tier === "Medium" ? RED : GOLD;

/* 测量容器实际尺寸，让 SVG 铺满且不变形 */
function useSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/* ---------- 图表 ---------- */

function HistoryChart({ history }) {
  const [areaRef, { w: W, h: H }] = useSize();

  // 首帧先渲染测量占位，拿到尺寸后再画满整个面板
  if (!W || !H) return <div ref={areaRef} className="chart-fill" />;

  if (history.length === 0) {
    return (
      <div ref={areaRef} className="chart-fill chart-empty">
        type a seed or adjust length to plot entropy...
      </div>
    );
  }

  const PAD = { l: 42, r: 16, t: 16, b: 26 };
  const maxBits = Math.max(50, ...history) * 1.15;
  const xRight = Math.max(30, history.length - 1);
  const x = (i) => PAD.l + (i / xRight) * (W - PAD.l - PAD.r);
  const y = (v) => H - PAD.b - (v / maxBits) * (H - PAD.t - PAD.b);
  const last = history[history.length - 1];

  // 数据量大时抽稀，避免 thousands of DOM nodes
  const step = Math.max(1, Math.ceil(history.length / 800));
  const pts = [];
  for (let i = 0; i < history.length; i += step) pts.push([x(i), y(history[i])]);
  if ((history.length - 1) % step !== 0) pts.push([x(history.length - 1), y(last)]);

  const gridY = [0.25, 0.5, 0.75].map((k) => maxBits * k);
  const lastX = x(history.length - 1);

  return (
    <div ref={areaRef} className="chart-fill">
      <svg width={W} height={H}>
        {gridY.map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="#2a2f3a" strokeWidth="1" />
            <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" className="axis">
              {v.toFixed(0)}
            </text>
          </g>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="#3a404c" strokeWidth="1" />
        <text x={PAD.l - 6} y={y(0) + 4} textAnchor="end" className="axis">0</text>
        <text x={(PAD.l + W - PAD.r) / 2} y={H - 8} textAnchor="middle" className="axis">gen</text>

        {pts.map(([px, py], i) => (
          <circle key={i} cx={px} cy={py} r="2" fill={RED} />
        ))}
        {/* 最新点：蓝色竖线 + 标记，仿 burn 的 Train/Valid 标注 */}
        <line x1={lastX} x2={lastX} y1={y(0)} y2={y(last)} stroke={BLUE} strokeWidth="1" strokeDasharray="3 3" />
        <circle cx={lastX} cy={y(last)} r="3.5" fill={BLUE} />
        <text x={Math.min(lastX + 6, W - PAD.r)} y={Math.max(y(last) - 6, 12)} className="axis" fill={BLUE}>
          {last.toFixed(1)}
        </text>
      </svg>
    </div>
  );
}

function CharsetChart({ mix }) {
  const total = Math.max(1, mix.reduce((s, [, c]) => s + c, 0));
  return (
    <div className="charset">
      {mix.map(([name, count]) => {
        const pct = (count / total) * 100;
        return (
          <div className="charset-row" key={name}>
            <span className="charset-label">{name} {count} · {pct.toFixed(1)}%</span>
            <div className="charset-track">
              <div
                className="charset-bar"
                style={{
                  width: `${pct}%`,
                  background: count > 0 ? GOLD : "transparent",
                  boxShadow: count > 0 ? "none" : `inset 0 0 0 1px ${DIM}`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SeedsChart({ records }) {
  if (records.length === 0) {
    return <div className="chart-empty">press Shift+S to record current seed + length...</div>;
  }
  return (
    <div className="seeds">
      <div className="seeds-head">
        <span>#</span><span>seed</span><span>len</span><span>bits</span>
      </div>
      {records.map((r, i) => (
        <div className="seeds-row" key={`${r.seed}:${r.length}`}
             title={`${r.seed} · ${r.length}`}>
          <span className="dim">{i + 1}</span>
          <span className="seed-cell">{r.seed.length > 20 ? r.seed.slice(0, 20) + ".." : r.seed}</span>
          <span>{r.length}</span>
          <span>{r.entropy != null ? r.entropy.toFixed(1) : "-"}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- 密码着色显示 ---------- */

function PasswordText({ pass, show }) {
  const cells = useMemo(() => {
    if (!show) return [{ t: "*".repeat(Math.min(pass.length, 100)), c: DIM }];
    const out = [];
    let run = "", color = null;
    for (const ch of pass.slice(0, 100)) {
      const c = /[0-9]/.test(ch) ? GOLD : /[a-zA-Z]/.test(ch) ? "#e8e8e8" : RED;
      if (c === color) run += ch;
      else {
        if (color) out.push({ t: run, c: color });
        run = ch; color = c;
      }
    }
    if (color) out.push({ t: run, c: color });
    return out;
  }, [pass, show]);

  return (
    <span className="password-text">
      {cells.map((s, i) => <span key={i} style={{ color: s.c }}>{s.t}</span>)}
      {pass.length > 100 && <span style={{ color: DIM }}>...</span>}
    </span>
  );
}

/* ---------- 内嵌标题栏 ---------- */

function TitleBar() {
  const appWindow = useMemo(() => getCurrentWindow(), []);
  return (
    <div className="titlebar" data-tauri-drag-region>
      <img className="titlebar-logo" src={logoUrl} alt="" data-tauri-drag-region draggable={false} />
      <span className="titlebar-title" data-tauri-drag-region>Iodum</span>
      <span className="titlebar-sub" data-tauri-drag-region>deterministic password generator</span>
      <div className="titlebar-actions">
        <button className="tb-btn" title="最小化" onClick={() => appWindow.minimize()}>&#x2500;</button>
        <button className="tb-btn tb-close" title="关闭" onClick={() => appWindow.close()}>&#x2715;</button>
      </div>
    </div>
  );
}

/* ---------- 主界面 ---------- */

export default function App() {
  const [seed, setSeed] = useState("");
  const [length, setLength] = useState(16);
  const [show, setShow] = useState(true);
  const [tab, setTab] = useState("history");
  const [gen, setGen] = useState(null); // {password,entropy,tier,pool,mix}
  const [err, setErr] = useState(null);
  const [history, setHistory] = useState(() => loadLS("pg_history", []));
  const [records, setRecords] = useState(() => loadLS("pg_records", []));
  const [note, setNote] = useState(null); // {msg, color}
  const noteTimer = useRef(null);
  const genRef = useRef(null);
  genRef.current = gen;

  const flash = useCallback((msg, color) => {
    setNote({ msg, color });
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), STATUS_TTL);
  }, []);

  // 实时生成
  useEffect(() => {
    if (!seed) { setGen(null); setErr(null); return; }
    // 实时计算：每次输入立即请求；cleanup 置 alive=false 丢弃乱序的过期响应
    let alive = true;
    invoke("generate_password", { seed, length })
      .then((out) => {
        if (!alive) return;
        setGen(out); setErr(null);
      })
      .catch((e) => {
        if (!alive) return;
        setErr(String(e)); setGen(null);
      });
    return () => { alive = false; };
  }, [seed, length]);

  // 记录熵历史（同 TUI 的 record()）
  useEffect(() => {
    if (!gen) return;
    setHistory((h) => {
      if (h.length && h[h.length - 1] === gen.entropy) return h;
      const next = [...h, gen.entropy];
      return next.length > HISTORY_CAP ? next.slice(-HISTORY_CAP) : next;
    });
  }, [gen]);

  useEffect(() => { localStorage.setItem("pg_history", JSON.stringify(history)); }, [history]);
  useEffect(() => { localStorage.setItem("pg_records", JSON.stringify(records)); }, [records]);

  const copyPassword = useCallback(() => {
    const g = genRef.current;
    if (!g) { flash("ERR: nothing to copy", RED); return; }
    invoke("copy_text", { text: g.password })
      .then(() => flash("OK: copied to clipboard", GOLD))
      .catch((e) => flash(`ERR: copy failed: ${e}`, RED));
  }, [flash]);

  const recordSeed = useCallback(() => {
    const g = genRef.current;
    if (!g) { flash("ERR: invalid seed/length, nothing recorded", RED); return; }
    setRecords((rs) => {
      const rest = rs.filter((r) => !(r.seed === seed && r.length === length));
      return [{ seed, length, entropy: g.entropy }, ...rest].slice(0, 256);
    });
    flash("OK: seed + length recorded", GOLD);
  }, [seed, length, flash]);

  const reset = useCallback(() => {
    setSeed(""); setLength(16); setHistory([]); setRecords([]); setShow(true); setTab("history"); setNote(null);
  }, []);

  const bumpLength = useCallback((d) => setLength((l) => clamp(l + d, MIN_LEN, MAX_LEN)), []);

  // 全局快捷键（与 TUI 版一致）
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === "s") { e.preventDefault(); setShow((v) => !v); return; }
      if (e.ctrlKey && e.key.toLowerCase() === "r") { e.preventDefault(); reset(); return; }
      if (e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); recordSeed(); return; }
      if (e.key === "Enter") { e.preventDefault(); copyPassword(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); bumpLength(1); }
      else if (e.key === "ArrowDown") { e.preventDefault(); bumpLength(-1); }
      else if (e.key === "PageUp") { e.preventDefault(); bumpLength(5); }
      else if (e.key === "PageDown") { e.preventDefault(); bumpLength(-5); }
      else if (e.key === "Home") { setLength(MIN_LEN); }
      else if (e.key === "End") { setLength(MAX_LEN); }
      else if (e.key === "ArrowRight") { setTab((t) => (t === "history" ? "seeds" : "charset")); }
      else if (e.key === "ArrowLeft") { setTab((t) => (t === "charset" ? "seeds" : "history")); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bumpLength, copyPassword, recordSeed, reset]);

  const ratio = (length - MIN_LEN) / (MAX_LEN - MIN_LEN);
  const mix = gen?.mix ?? [["low", 0], ["up", 0], ["dig", 0], ["sym", 0]];

  return (
    <div className="root">
      <TitleBar/>
      <div className="dash">
      <div className="dash-main">
        <div className="col-left">
          <fieldset className="card">
            <legend>Controls</legend>
            <div className="kv"><span className="k">Quit</span><span className="v">Alt+F4 / 关闭窗口</span></div>
            <div className="kv"><span className="k">Copy</span><span className="v">Enter</span></div>
            <div className="kv"><span className="k">Show Hide</span><span className="v">Ctrl+S</span></div>
            <div className="kv"><span className="k">Record Seed</span><span className="v">Shift+S</span></div>
            <div className="kv"><span className="k">Reset</span><span className="v">Ctrl+R</span></div>
            <div className="kv"><span className="k">Length</span><span className="v">↑ ↓ · PgUp / PgDn</span></div>
            <div className="kv"><span className="k">Plot Tabs</span><span className="v">← →</span></div>
          </fieldset>

          <fieldset className="card grow">
            <legend>Metrics</legend>
            <div className="section-name">Seed</div>
            <textarea
              className="seed-input"
              autoFocus
              spellCheck={false}
              placeholder="type seed, >= 4 chars..."
              value={seed}
              lines={3}
              onChange={(e) => setSeed(e.target.value)}
            >
              {seed}
            </textarea>
            <div className="section-name">Password
              <span className="mini-actions">
                <button onClick={copyPassword}>copy</button>
                <button onClick={() => setShow((v) => !v)}>{show ? "hide" : "show"}</button>
              </span>
            </div>
            <div className="password-line">
              {err ? <span style={{ color: RED }}>{err}</span>
                : gen ? <PasswordText pass={gen.password} show={show} />
                : <span style={{ color: DIM }}>-</span>}
            </div>
            <div className="section-name">Strength</div>
            {gen ? (
              <>
                <div className="kv"><span className="k">Tier</span><span className="v" style={{ color: tierColor(gen.tier) }}>{gen.tier}</span></div>
                <div className="kv"><span className="k">Entropy</span><span className="v">{gen.entropy.toFixed(1)} bits</span></div>
                <div className="kv"><span className="k">Mix</span><span className="v">{mix.map(([n, c]) => `${n}${c}`).join(" · ")}</span></div>
              </>
            ) : <div className="dim">-</div>}
          </fieldset>

          <fieldset className="card status">
            <legend>Status</legend>
            {gen ? (
              <><div className="kv"><span className="k">Seed</span><span className="v">{seed ? seed.slice(-20) : "-"}</span></div>
              <div className="kv"><span className="k">Length</span><span className="v">{length} / {MAX_LEN}</span></div>
              <div className="kv"><span className="k">Entropy</span><span className="v">{gen ? `${gen.entropy.toFixed(0)} bits` : "-"}</span></div>
              <div className="kv"><span className="k">Pool</span><span className="v">{gen.pool.toFixed(0)} chars</span></div>
              <div className="kv"><span className="k">Note</span><span className="v" style={{ color: note?.color ?? DIM }}>{note?.msg ?? "-"}</span></div></>
            ) : <div className="dim">-</div>}
          </fieldset>
        </div>

        <fieldset className="col-right card">
          <legend>Plots</legend>
          <div className="tabs">
            {[["history", "History"], ["seeds", "Seeds"], ["charset", "Charset"]].map(([id, label]) => (
              <button key={id} className={tab === id ? "tab active" : "tab"} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          <div className="chart-title">
            {tab === "history" && `Entropy History (${history.length} of ${HISTORY_CAP})`}
            {tab === "seeds" && `Recorded Seeds (${records.length})`}
            {tab === "charset" && "Charset Composition (share of total)"}
          </div>
          <div className="chart-area">
            {tab === "history" && <HistoryChart history={history} />}
            {tab === "seeds" && <SeedsChart records={records} />}
            {tab === "charset" && (gen ? <CharsetChart mix={mix} /> : <div className="chart-empty">type a seed to plot charset counts...</div>)}
          </div>
        </fieldset>
      </div>

      <div className="progress-row">
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${ratio * 100}%` }} />
          <span className="progress-label">{length} / {MAX_LEN} · {(ratio * 100).toFixed(0)} %</span>
        </div>
        <span className="progress-bits">( Entropy {gen ? gen.entropy.toFixed(0) : "-"} bits )</span>
      </div>
      </div>
    </div>
  );
}

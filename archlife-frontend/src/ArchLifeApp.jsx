import React, { useState, useEffect, useCallback } from "react";
import {
  Circle,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  CalendarDays,
  Flame,
  ListTodo,
  Sunrise,
  StickyNote,
  Target,
  Wallet,
  CreditCard,
  TrendingUp,
  Sparkles,
  Loader2,
  Settings,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { ThemeProvider, useTheme, useBackgroundControls, hexToRgba } from "./theme.jsx";
import { LanguageProvider, useT, useLanguage } from "./i18n.jsx";
import SettingsView from "./SettingsView.jsx";

// ---------- デザイントークン ----------
// 配色(COLORS)はテーマ切り替えに対応するため theme.js に移動した。
// 各コンポーネントの先頭で `const COLORS = useTheme();` として取得する。

export const FONT_DISPLAY =
  '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif';
export const FONT_BODY =
  '"Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif';
export const FONT_MONO = '"SF Mono", Menlo, Consolas, monospace';

const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];
const CATEGORIES = ["食費", "日用品", "交通", "娯楽", "家賃", "光熱費", "通信", "医療", "その他"];
const CYCLES = ["月次", "年次"];
// バックエンド(Render等)のAPIのオリジン。
// .env(または .env.local)の VITE_API_BASE_URL で上書きする(未設定時はローカル開発用にフォールバック)。
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

// ---------- 暗号化ストレージ ----------
// サーバーは暗号文と匿名IDしか持たない。中身は端末側でのみ復号する。
// (元コードにあった window.storage はClaude.aiのアーティファクト専用の疑似APIで、
//  通常のブラウザでは動かないため、実際のバックエンドと通信する実装に置き換えている)

const ANON_ID_KEY = "archlife_anon_id";
const PASSPHRASE_KEY = "archlife_passphrase"; // 端末内にのみ保存。サーバーには送らない。

function getOrCreateAnonId() {
  let id = localStorage.getItem(ANON_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ANON_ID_KEY, id);
  }
  return id;
}

function getOrCreatePassphrase() {
  let p = localStorage.getItem(PASSPHRASE_KEY);
  if (!p) {
    p =
      window.prompt(
        "初回設定: データを暗号化するためのパスフレーズを決めてください。\n(忘れると復元できません。他の端末と同期したい場合は同じものを使ってください)"
      ) || "please-change-this-passphrase";
    localStorage.setItem(PASSPHRASE_KEY, p);
  }
  return p;
}

async function deriveKey(passphrase, saltStr) {
  const salt = new TextEncoder().encode(saltStr);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function b64ToBuf(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

async function encryptJSON(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return { iv: bufToB64(iv), ciphertext: bufToB64(cipherBuf) };
}
async function decryptJSON(key, { iv, ciphertext }) {
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBuf(iv) },
    key,
    b64ToBuf(ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(plainBuf));
}

const anonId = getOrCreateAnonId();
let cryptoKeyPromise = null;
function getCryptoKey() {
  if (!cryptoKeyPromise) cryptoKeyPromise = deriveKey(getOrCreatePassphrase(), anonId);
  return cryptoKeyPromise;
}

// 設定ページ(データ/プライバシー欄)から参照するための公開関数
export function getAnonId() {
  return anonId;
}
export function resetPassphrase() {
  localStorage.removeItem(PASSPHRASE_KEY);
  window.location.reload();
}

const storage = {
  async get(key) {
    const cryptoKey = await getCryptoKey();
    const r = await fetch(`${API_BASE_URL}/api/blobs/${anonId}/${encodeURIComponent(key)}`);
    if (r.status === 404) throw new Error("not found");
    if (!r.ok) throw new Error(`取得に失敗しました (status ${r.status})`);
    const enc = await r.json();
    const value = await decryptJSON(cryptoKey, enc);
    return { key, value: JSON.stringify(value) };
  },
  async set(key, value) {
    const cryptoKey = await getCryptoKey();
    const obj = typeof value === "string" ? JSON.parse(value) : value;
    const enc = await encryptJSON(cryptoKey, obj);
    const r = await fetch(`${API_BASE_URL}/api/blobs/${anonId}/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(enc),
    });
    if (!r.ok) throw new Error(`保存に失敗しました (status ${r.status})`);
    return { key, value };
  },
};

// ---------- AI: 端末スペックに応じた3段の経路選択 ----------
//
// 1. 高スペック(WebGPU対応・非モバイル・十分なCPU/メモリ): 端末内でWebLLMを動かす。
//    データは一切どこにも送信されない、最もプライバシーが強い経路。
// 2. 低スペックで外部APIに同意済み: バックエンド経由でOpenAI/Claudeを呼ぶ(集計済みデータのみ送信)。
// 3. 低スペックでまだ同意していない/同意しなかった: バックエンドの自己ホストLLM(Render上のQwen)を使う。
//    速度は劣るが外部には出ない。

const EXTERNAL_AI_CONSENT_KEY = "archlife_external_ai_consent"; // "granted" | "declined"
const EXTERNAL_AI_PROVIDER_KEY = "archlife_external_ai_provider"; // "openai" | "claude"
export const NEEDS_CONSENT = "NEEDS_CONSENT";

export function detectDeviceCapability() {
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const isMobile = /Android|iPhone|iPad|iPod/i.test(nav.userAgent || "");
  const hasWebGPU = typeof navigator !== "undefined" && !!nav.gpu;
  const cores = nav.hardwareConcurrency || 2;
  const memory = nav.deviceMemory || 4; // 未対応ブラウザでは既定値扱いにする
  const capable = hasWebGPU && !isMobile && cores >= 4 && memory >= 4;
  return { capable, isMobile, hasWebGPU, cores, memory };
}

export function getExternalAiConsent() {
  return localStorage.getItem(EXTERNAL_AI_CONSENT_KEY); // null | "granted" | "declined"
}
export function setExternalAiConsent(value, provider) {
  localStorage.setItem(EXTERNAL_AI_CONSENT_KEY, value);
  if (provider) localStorage.setItem(EXTERNAL_AI_PROVIDER_KEY, provider);
}
export function getExternalAiProvider() {
  return localStorage.getItem(EXTERNAL_AI_PROVIDER_KEY) || "openai";
}
export function resetExternalAiConsent() {
  localStorage.removeItem(EXTERNAL_AI_CONSENT_KEY);
}

// ユーザーが「自動判定」を上書きして、実行方法を固定したい場合の設定。
// null(未設定) = 自動判定(端末性能→同意状況の順で決める、従来通り)
// "ondevice" | "server-local" | "external" のいずれかを強制する。
const AI_MODE_OVERRIDE_KEY = "archlife_ai_mode_override";
export function getAiModeOverride() {
  return localStorage.getItem(AI_MODE_OVERRIDE_KEY);
}
export function setAiModeOverride(value) {
  if (value) {
    localStorage.setItem(AI_MODE_OVERRIDE_KEY, value);
  } else {
    localStorage.removeItem(AI_MODE_OVERRIDE_KEY);
  }
}

let webllmEnginePromise = null;
async function runOnDevice(prompt, onProgress) {
  if (!webllmEnginePromise) {
    webllmEnginePromise = (async () => {
      // 事前に `npm install @mlc-ai/web-llm` が必要。
      const webllm = await import("@mlc-ai/web-llm");
      return webllm.CreateMLCEngine("Qwen2.5-1.5B-Instruct-q4f16_1-MLC", {
        initProgressCallback: onProgress,
      });
    })();
  }
  const engine = await webllmEnginePromise;
  const reply = await engine.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
  });
  const text = reply.choices?.[0]?.message?.content;
  if (!text) throw new Error("端末内AIから応答がありませんでした");
  return text;
}

async function callBackendAi({ kind, payload, useExternal, provider }) {
  const r = await fetch(`${API_BASE_URL}/api/ai/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, payload, useExternal, provider }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `APIエラー (status ${r.status})`);
  return data.text;
}

/**
 * @param {Object} opts
 * @param {string} opts.kind - "today" | "spending" | "habits"
 * @param {Object} opts.payload - 集計済みデータ(バックエンド経路で使う)
 * @param {string} opts.prompt - 完成したプロンプト文字列(端末内AI経路で使う)
 * @param {(p:any)=>void} [opts.onProgress] - 端末内モデルのロード進捗コールバック
 * @returns {Promise<{text:string, source:"ondevice"|"external"|"server-local"}>}
 */
async function analyzeSmart({ kind, payload, prompt, onProgress }) {
  const cap = detectDeviceCapability();
  const override = getAiModeOverride();
  const mode = override || (cap.capable ? "ondevice" : null);

  if (mode === "ondevice") {
    const text = await runOnDevice(prompt, onProgress);
    return { text, source: "ondevice" };
  }
  if (mode === "server-local") {
    const text = await callBackendAi({ kind, payload, useExternal: false });
    return { text, source: "server-local" };
  }
  if (mode === "external") {
    const text = await callBackendAi({ kind, payload, useExternal: true, provider: getExternalAiProvider() });
    return { text, source: "external" };
  }

  // ここに来るのは「非力端末 & 上書き未設定」の場合のみ。従来通り同意状況で決める。
  const consent = getExternalAiConsent();
  if (consent === "granted") {
    const text = await callBackendAi({ kind, payload, useExternal: true, provider: getExternalAiProvider() });
    return { text, source: "external" };
  }
  if (consent === "declined") {
    const text = await callBackendAi({ kind, payload, useExternal: false });
    return { text, source: "server-local" };
  }

  const err = new Error("この端末では外部AIの利用について確認が必要です");
  err.code = NEEDS_CONSENT;
  throw err;
}

// 日記・メモは個人的な内容を含みうるため、実行方法の設定に関わらず常に端末内AIのみで処理する
// (自己ホストサーバーにも外部APIにも一切送信しない)。非対応端末では利用できない旨を伝える。
async function analyzeOnDeviceOnly({ prompt, onProgress }) {
  const cap = detectDeviceCapability();
  if (!cap.capable) {
    throw new Error(
      "この内容は外部に送信しないため、端末内AIに対応した端末でのみ利用できます(この端末は非対応と判定されています)。"
    );
  }
  const text = await runOnDevice(prompt, onProgress);
  return { text, source: "ondevice" };
}

// ---------- 各ページ共通で使うAIプロンプト生成 ----------
// today/spending/habits/calendar/goals/subscriptions/assets は集計済みデータのみを扱うため、
// analyzeSmart(端末内/自己ホスト/外部を自動選択)を通す。診断/助言色が強くならないよう、
// 断定を避けた短い箇条書きを求める文言で統一している。

function buildTodayInsight(todos, habits, goals) {
  const key = todayKey();
  const payload = {
    todos: todos.map((t) => ({ text: t.text, done: t.done })),
    habits: habits.map((h) => ({ name: h.name, streak: countStreak(h.checkins), doneToday: !!h.checkins[key] })),
    goals: goals.map((g) => ({ title: g.title, progress: g.progress })),
  };
  const todoLines = payload.todos.map((t) => `- [${t.done ? "済" : "未"}] ${t.text}`).join("\n") || "(なし)";
  const habitLines = payload.habits.map((h) => `- ${h.name}(連続${h.streak}日, 今日${h.doneToday ? "済" : "未"})`).join("\n") || "(なし)";
  const goalLines = payload.goals.map((g) => `- ${g.title}(${g.progress}%)`).join("\n") || "(なし)";
  const prompt = `あなたはライフ管理アプリ「ArchLife」のアシスタントです。以下のユーザーの今日のタスク、習慣、目標をもとに、今日優先すべきことを3〜5個、短い箇条書きで日本語で提案してください。前置きは不要です。

# 今日のタスク
${todoLines}

# 習慣(連続日数)
${habitLines}

# 目標
${goalLines}`;
  return { kind: "today", payload, prompt };
}

function buildSpendingInsight(expenses, monthPrefix) {
  const monthExpenses = expenses.filter((e) => e.date.startsWith(monthPrefix));
  if (monthExpenses.length === 0) return null;
  const byCategory = {};
  monthExpenses.forEach((e) => {
    byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount);
  });
  const total = monthExpenses.reduce((s, e) => s + Number(e.amount), 0);
  const payload = { total, byCategory };
  const catLines = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([c, a]) => `- ${c}: ¥${a.toLocaleString()}`)
    .join("\n");
  const prompt = `あなたはライフ管理アプリ「ArchLife」の家計簿アシスタントです。以下(${monthPrefix})の支出データを分析し、気づいた傾向や無駄遣いの可能性、節約のヒントを日本語で3〜5個、短い箇条書きで提案してください。前置きは不要です。

# 対象月の支出合計
¥${total.toLocaleString()}

# カテゴリ別内訳
${catLines}`;
  return { kind: "spending", payload, prompt };
}

function buildHabitsInsight(habits) {
  if (habits.length === 0) return null;
  const payload = {
    habits: habits.map((h) => ({
      name: h.name,
      totalDays: Object.keys(h.checkins).filter((k) => h.checkins[k]).length,
      streak: countStreak(h.checkins),
    })),
  };
  const lines = payload.habits.map((h) => `- ${h.name}: 記録した合計${h.totalDays}日、現在の連続日数${h.streak}日`).join("\n");
  const prompt = `あなたはライフ管理アプリ「ArchLife」の習慣コーチです。以下の習慣の記録データを分析し、続いている点・崩れやすい点・改善のための具体的な工夫を日本語で3〜5個、短い箇条書きで提案してください。前置きは不要です。

# 習慣データ
${lines}`;
  return { kind: "habits", payload, prompt };
}

function buildWeekAheadInsight(todos) {
  const today = new Date();
  const inRange = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    inRange.push(todayKey(d));
  }
  const upcoming = todos.filter((t) => t.date && inRange.includes(t.date) && !t.done);
  if (upcoming.length === 0) return null;
  const payload = { upcoming: upcoming.map((t) => ({ date: t.date, text: t.text })) };
  const lines = [...payload.upcoming].sort((a, b) => (a.date < b.date ? -1 : 1)).map((t) => `- ${t.date}: ${t.text}`).join("\n");
  const prompt = `あなたはライフ管理アプリ「ArchLife」のスケジュールアシスタントです。以下の今後7日間の未完了タスクを見て、優先順位や詰め込みすぎていないかについて日本語で3〜5個、短い箇条書きで提案してください。前置きは不要です。

# 今後7日間の予定
${lines}`;
  return { kind: "calendar", payload, prompt };
}

function buildGoalsInsight(goals) {
  if (goals.length === 0) return null;
  const payload = { goals: goals.map((g) => ({ title: g.title, progress: g.progress })) };
  const lines = payload.goals.map((g) => `- ${g.title}(進捗${g.progress}%)`).join("\n");
  const prompt = `あなたはライフ管理アプリ「ArchLife」の目標達成コーチです。以下の目標一覧を見て、進みが良いもの・停滞していそうなものを踏まえ、次に取れる具体的で小さな一歩を日本語で3〜5個、短い箇条書きで提案してください。前置きは不要です。

# 目標一覧
${lines}`;
  return { kind: "goals", payload, prompt };
}

function buildSubscriptionsInsight(subscriptions) {
  if (subscriptions.length === 0) return null;
  const payload = { subscriptions: subscriptions.map((s) => ({ name: s.name, amount: Number(s.amount), cycle: s.cycle })) };
  const monthlyTotal = subscriptions.reduce(
    (sum, s) => sum + (s.cycle === "年次" ? Number(s.amount) / 12 : Number(s.amount)),
    0
  );
  const lines = payload.subscriptions.map((s) => `- ${s.name}: ¥${s.amount.toLocaleString()}(${s.cycle})`).join("\n");
  const prompt = `あなたはライフ管理アプリ「ArchLife」のサブスク管理アシスタントです。以下のサブスク一覧(月換算合計 ¥${Math.round(monthlyTotal).toLocaleString()})を見て、重複していそうなものや見直す価値がありそうなものを日本語で3〜5個、短い箇条書きで指摘してください。前置きは不要です。

# サブスク一覧
${lines}`;
  return { kind: "subscriptions", payload, prompt };
}

function buildAssetsInsight(assets) {
  if (assets.length < 2) return null;
  const sorted = [...assets].sort((a, b) => (a.date < b.date ? -1 : 1));
  const payload = { history: sorted.map((a) => ({ date: a.date, amount: Number(a.amount) })) };
  const lines = payload.history.map((a) => `- ${a.date}: ¥${a.amount.toLocaleString()}`).join("\n");
  const prompt = `あなたはライフ管理アプリ「ArchLife」の資産管理アシスタントです。以下の資産推移の記録を見て、変化の傾向やペースについて気づいたことを日本語で3〜5個、短い箇条書きでコメントしてください。断定的な投資助言はせず、あくまで記録の振り返りとしてコメントしてください。前置きは不要です。

# 資産推移
${lines}`;
  return { kind: "assets", payload, prompt };
}

// 日記・メモは analyzeOnDeviceOnly 専用(kind/payloadは使わずprompt文字列のみ)。
function buildDiaryReflectionPrompt(diary) {
  const entries = Object.entries(diary)
    .filter(([, v]) => v && v.trim())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 14);
  if (entries.length === 0) return null;
  const text = entries.map(([k, v]) => `[${k}]\n${v.slice(0, 500)}`).join("\n\n");
  return `あなたはライフ管理アプリ「ArchLife」の日記アシスタントです。以下は直近の日記です。内容を評価・診断するのではなく、書かれている出来事や気分の傾向から気づいたことを、優しい言葉で日本語で3〜5個、短い箇条書きで挙げてください。前置きは不要です。

# 直近の日記
${text}`;
}

function buildMemoOrganizePrompt(memos) {
  if (memos.length === 0) return null;
  const recent = memos.slice(0, 20);
  const text = recent.map((m) => `- ${m.text.slice(0, 200)}`).join("\n");
  return `あなたはライフ管理アプリ「ArchLife」のメモ整理アシスタントです。以下の断片的なメモを見て、関連するテーマごとに整理し、対応し忘れていそうなものがあれば指摘してください。日本語で簡潔にまとめてください。前置きは不要です。

# メモ一覧
${text}`;
}

export function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

// ---------- 共通スタイル ----------
// これらはモジュール直下(コンポーネント外)の定数のため、テーマ切り替えに反応させるには
// CSS変数(--ink 等。ルート要素で現在のテーマ色をセットしている)を参照する形にしている。
export const navBtnStyle = {
  border: `1px solid var(--ink)`,
  background: "transparent",
  color: "var(--ink)",
  width: 28,
  height: 28,
  borderRadius: 5,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  flexShrink: 0,
};

const inputBaseStyle = {
  background: "transparent",
  border: `1px solid var(--line)`,
  borderRadius: 5,
  padding: "7px 8px",
  fontFamily: FONT_BODY,
  fontSize: 13,
  color: "var(--ink)",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const underlineInputStyle = {
  flex: 1,
  background: "transparent",
  border: "none",
  borderBottom: `1px dashed var(--line)`,
  padding: "6px 2px",
  fontFamily: FONT_BODY,
  fontSize: 14,
  color: "var(--ink)",
  outline: "none",
};

const primaryButtonStyle = {
  border: `1px solid var(--ink)`,
  background: "transparent",
  color: "var(--ink)",
  height: 36,
  borderRadius: 6,
  width: "100%",
  cursor: "pointer",
  fontFamily: FONT_BODY,
  fontSize: 13,
  letterSpacing: "0.05em",
};

export const smallBtnStyle = {
  border: `1px solid var(--line)`,
  background: "transparent",
  color: "var(--ink-faint)",
  borderRadius: 5,
  padding: "3px 10px",
  fontFamily: FONT_MONO,
  fontSize: 11,
  cursor: "pointer",
};

// ---------- Hankoスタンプ(完了マーク) ----------
function Hanko({ show }) {
  const COLORS = useTheme();
  return (
    <span
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <span
        className={show ? "hanko-stamp-in" : ""}
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          border: `2px solid ${COLORS.hanko}`,
          opacity: show ? 1 : 0,
          transform: show ? "scale(1) rotate(-8deg)" : "scale(1.8) rotate(-8deg)",
          transition: "opacity 0.18s ease-out, transform 0.18s ease-out",
        }}
      />
    </span>
  );
}

export function EmptyNote({ text }) {
  const COLORS = useTheme();
  return (
    <p
      style={{
        fontFamily: FONT_BODY,
        fontSize: 12.5,
        color: COLORS.inkFaint,
        fontStyle: "italic",
        padding: "10px 2px",
      }}
    >
      {text}
    </p>
  );
}

export function SectionLabel({ icon, label }) {
  const COLORS = useTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 10,
        color: COLORS.hanko,
      }}
    >
      {icon}
      <span
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 13,
          letterSpacing: "0.15em",
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, borderBottom: `1px solid ${COLORS.line}`, marginLeft: 6 }} />
    </div>
  );
}

function countStreak(checkins) {
  let streak = 0;
  let d = new Date();
  while (checkins[todayKey(d)]) {
    streak += 1;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

// ---------- 今日のページ(Todo + 習慣サマリー) ----------
function TodayView({ todos, toggleTodo, addTodo, deleteTodo, habits, toggleHabitToday, goals }) {
  const COLORS = useTheme();
  const [text, setText] = useState("");
  const key = todayKey();

  async function suggestToday(onProgress) {
    const built = buildTodayInsight(todos, habits, goals);
    return analyzeSmart({ kind: built.kind, payload: built.payload, prompt: built.prompt, onProgress });
  }

  return (
    <div>
      <AiCard title="今日やるべきこと(AI)" buttonLabel="提案してもらう" onRun={suggestToday} />
      <SectionLabel icon={<ListTodo size={15} />} label="今日のタスク" />
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) {
              addTodo(text.trim());
              setText("");
            }
          }}
          placeholder="今日やることを書く…"
          style={underlineInputStyle}
        />
        <button
          onClick={() => {
            if (text.trim()) {
              addTodo(text.trim());
              setText("");
            }
          }}
          style={{ ...navBtnStyle, width: 30, height: 30, borderRadius: 4 }}
        >
          <Plus size={15} />
        </button>
      </div>

      <div>
        {todos.length === 0 && (
          <EmptyNote text="まだタスクがありません。上の欄に書いて追加してください。" />
        )}
        {todos.map((t) => (
          <div
            key={t.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 2px",
              borderBottom: `1px dashed ${COLORS.line}`,
              opacity: t.done ? 0.55 : 1,
            }}
          >
            <button
              onClick={() => toggleTodo(t.id)}
              style={{
                position: "relative",
                width: 26,
                height: 26,
                borderRadius: "50%",
                border: `1.5px solid ${COLORS.inkFaint}`,
                background: "transparent",
                cursor: "pointer",
                flexShrink: 0,
              }}
              aria-label={t.done ? "完了を取り消す" : "完了にする"}
            >
              <Hanko show={t.done} />
            </button>
            <span
              style={{
                fontFamily: FONT_BODY,
                fontSize: 14.5,
                color: COLORS.ink,
                textDecoration: t.done ? "line-through" : "none",
                flex: 1,
              }}
            >
              {t.text}
            </span>
            <button
              onClick={() => deleteTodo(t.id)}
              style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.inkFaint, padding: 4 }}
              aria-label="削除"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div style={{ height: 28 }} />

      <SectionLabel icon={<Flame size={15} />} label="今日の習慣" />
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {habits.length === 0 && (
          <EmptyNote text="習慣を登録すると、ここに毎日のチェックが並びます。" />
        )}
        {habits.map((h) => {
          const done = !!h.checkins[key];
          const streak = countStreak(h.checkins);
          return (
            <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 2px" }}>
              <button
                onClick={() => toggleHabitToday(h.id)}
                style={{
                  position: "relative",
                  width: 24,
                  height: 24,
                  borderRadius: 5,
                  border: `1.5px solid ${COLORS.moss}`,
                  background: done ? "rgba(86,104,74,0.12)" : "transparent",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <Hanko show={done} />
              </button>
              <span style={{ fontFamily: FONT_BODY, fontSize: 14, color: COLORS.ink, flex: 1 }}>
                {h.name}
              </span>
              {streak > 0 && (
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 11,
                    color: COLORS.gold,
                    border: `1px solid ${COLORS.gold}`,
                    borderRadius: 10,
                    padding: "1px 8px",
                  }}
                >
                  {streak}日連続
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- カレンダービュー ----------
function CalendarView({ todos }) {
  const COLORS = useTheme();
  const [cursor, setCursor] = useState(new Date());
  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const todosByDate = {};
  todos.forEach((t) => {
    if (t.date) {
      todosByDate[t.date] = (todosByDate[t.date] || 0) + 1;
    }
  });

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const key = todayKey();

  async function suggestWeek(onProgress) {
    const built = buildWeekAheadInsight(todos);
    if (!built) return { text: "今後7日間に予定されている未完了タスクがありません。", source: null };
    return analyzeSmart({ kind: built.kind, payload: built.payload, prompt: built.prompt, onProgress });
  }

  return (
    <div>
      <AiCard title="今週の見通し(AI)" buttonLabel="見てもらう" onRun={suggestWeek} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <button onClick={() => setCursor(new Date(year, month - 1, 1))} style={navBtnStyle}>
          <ChevronLeft size={16} />
        </button>
        <span style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: COLORS.ink }}>
          {year}年 {month + 1}月
        </span>
        <button onClick={() => setCursor(new Date(year, month + 1, 1))} style={navBtnStyle}>
          <ChevronRight size={16} />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
        {WEEKDAYS_JA.map((w) => (
          <div key={w} style={{ textAlign: "center", fontFamily: FONT_MONO, fontSize: 11, color: COLORS.inkFaint, padding: "4px 0" }}>
            {w}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const isToday = dateStr === key;
          const count = todosByDate[dateStr] || 0;
          return (
            <div
              key={i}
              style={{
                aspectRatio: "1",
                border: isToday ? `1.5px solid ${COLORS.hanko}` : `1px solid ${COLORS.line}`,
                borderRadius: 6,
                padding: 4,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                background: isToday ? "rgba(161,61,63,0.06)" : "transparent",
              }}
            >
              <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: isToday ? COLORS.hanko : COLORS.ink }}>
                {d}
              </span>
              {count > 0 && (
                <span style={{ alignSelf: "flex-end", width: 6, height: 6, borderRadius: "50%", background: COLORS.gold }} />
              )}
            </div>
          );
        })}
      </div>
      <p style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: COLORS.inkFaint, marginTop: 14 }}>
        ● 印はその日に締切のあるタスクがあることを示します。将来的にGoogle Calendarと同期する予定の場所です。
      </p>
    </div>
  );
}

// ---------- 習慣ビュー(週間トラッカー) ----------
function HabitsView({ habits, addHabit, toggleHabitDate, deleteHabit }) {
  const COLORS = useTheme();
  const [name, setName] = useState("");
  const days = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(d);
  }

  async function analyzeHabitsInline(onProgress) {
    const built = buildHabitsInsight(habits);
    if (!built) return { text: "習慣データがまだありません。下から登録してみてください。", source: null };
    return analyzeSmart({ kind: built.kind, payload: built.payload, prompt: built.prompt, onProgress });
  }

  return (
    <div>
      <AiCard title="習慣分析(AI)" buttonLabel="分析してもらう" onRun={analyzeHabitsInline} />
      <SectionLabel icon={<Flame size={15} />} label="習慣トラッカー(直近7日)" />

      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              addHabit(name.trim());
              setName("");
            }
          }}
          placeholder="新しい習慣を追加(例: 読書 10分)"
          style={underlineInputStyle}
        />
        <button
          onClick={() => {
            if (name.trim()) {
              addHabit(name.trim());
              setName("");
            }
          }}
          style={navBtnStyle}
        >
          <Plus size={15} />
        </button>
      </div>

      {habits.length === 0 && <EmptyNote text="習慣を追加すると、ここに週間の記録が表示されます。" />}

      {habits.map((h) => (
        <div key={h.id} style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontFamily: FONT_BODY, fontSize: 14, color: COLORS.ink, flex: 1 }}>{h.name}</span>
            <button
              onClick={() => deleteHabit(h.id)}
              style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.inkFaint }}
            >
              <Trash2 size={13} />
            </button>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {days.map((d) => {
              const k = todayKey(d);
              const done = !!h.checkins[k];
              return (
                <button
                  key={k}
                  onClick={() => toggleHabitDate(h.id, k)}
                  style={{
                    position: "relative",
                    flex: 1,
                    height: 34,
                    borderRadius: 5,
                    border: `1.5px solid ${COLORS.moss}`,
                    background: done ? "rgba(86,104,74,0.12)" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <Hanko show={done} />
                  <span
                    style={{
                      position: "absolute",
                      bottom: -16,
                      left: 0,
                      right: 0,
                      textAlign: "center",
                      fontFamily: FONT_MONO,
                      fontSize: 9.5,
                      color: COLORS.inkFaint,
                    }}
                  >
                    {WEEKDAYS_JA[d.getDay()]}
                  </span>
                </button>
              );
            })}
          </div>
          <div style={{ height: 18 }} />
        </div>
      ))}
    </div>
  );
}

// ---------- 日記ビュー ----------
function DiaryView({ diary, saveDiary }) {
  const COLORS = useTheme();
  const key = todayKey();
  const [draft, setDraft] = useState(diary[key] || "");

  useEffect(() => {
    setDraft(diary[key] || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const entries = Object.entries(diary)
    .filter(([k]) => k !== key && diary[k])
    .sort((a, b) => (a[0] < b[0] ? 1 : -1));

  async function reflectDiary(onProgress) {
    const prompt = buildDiaryReflectionPrompt(diary);
    if (!prompt) return { text: "日記がまだありません。書きためると、ここで振り返りをもらえます。", source: null };
    return analyzeOnDeviceOnly({ prompt, onProgress });
  }

  return (
    <div>
      <AiCard title="日記から気づきをもらう(AI・端末内のみ)" buttonLabel="振り返ってもらう" onRun={reflectDiary} />
      <SectionLabel icon={<BookOpen size={15} />} label={`今日の日記 (${key})`} />
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => saveDiary(key, draft)}
        placeholder="今日あったこと、感じたことを書く…"
        style={{
          width: "100%",
          minHeight: 120,
          background: "transparent",
          border: `1px dashed ${COLORS.line}`,
          borderRadius: 6,
          padding: 10,
          fontFamily: FONT_BODY,
          fontSize: 14,
          color: COLORS.ink,
          outline: "none",
          resize: "vertical",
          lineHeight: 1.7,
          boxSizing: "border-box",
        }}
      />
      <p style={{ fontFamily: FONT_BODY, fontSize: 11, color: COLORS.inkFaint, marginTop: 6 }}>
        欄の外をクリックすると自動で保存されます。
      </p>

      <div style={{ height: 24 }} />
      <SectionLabel icon={<CalendarDays size={15} />} label="過去の日記" />
      {entries.length === 0 && <EmptyNote text="過去の日記がここに並びます。" />}
      {entries.map(([k, text]) => (
        <div key={k} style={{ padding: "10px 2px", borderBottom: `1px dashed ${COLORS.line}` }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: COLORS.hanko, marginBottom: 4 }}>{k}</div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: COLORS.ink, whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
            {text}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- メモビュー ----------
function MemoView({ memos, addMemo, deleteMemo }) {
  const COLORS = useTheme();
  const [text, setText] = useState("");

  async function organizeMemos(onProgress) {
    const prompt = buildMemoOrganizePrompt(memos);
    if (!prompt) return { text: "メモがまだありません。", source: null };
    return analyzeOnDeviceOnly({ prompt, onProgress });
  }

  return (
    <div>
      <AiCard title="メモを整理してもらう(AI・端末内のみ)" buttonLabel="整理してもらう" onRun={organizeMemos} />
      <SectionLabel icon={<StickyNote size={15} />} label="メモ" />
      <div style={{ marginBottom: 20 }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="思いついたことを書き留める…"
          style={{
            width: "100%",
            minHeight: 70,
            background: "transparent",
            border: `1px dashed ${COLORS.line}`,
            borderRadius: 6,
            padding: 10,
            fontFamily: FONT_BODY,
            fontSize: 14,
            color: COLORS.ink,
            outline: "none",
            resize: "vertical",
            boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button
            onClick={() => {
              if (text.trim()) {
                addMemo(text.trim());
                setText("");
              }
            }}
            style={navBtnStyle}
          >
            <Plus size={15} />
          </button>
        </div>
      </div>

      {memos.length === 0 && <EmptyNote text="メモを追加すると、ここに並びます。" />}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {memos.map((m) => (
          <div
            key={m.id}
            style={{
              border: `1px solid ${COLORS.line}`,
              borderRadius: 6,
              padding: 12,
              background: COLORS.paperDark,
              position: "relative",
            }}
          >
            <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: COLORS.inkFaint, marginBottom: 6 }}>
              {m.createdAt}
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: COLORS.ink, whiteSpace: "pre-wrap", lineHeight: 1.6, paddingRight: 22 }}>
              {m.text}
            </div>
            <button
              onClick={() => deleteMemo(m.id)}
              style={{ position: "absolute", top: 10, right: 10, border: "none", background: "transparent", cursor: "pointer", color: COLORS.inkFaint }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- 目標ビュー ----------
function GoalsView({ goals, addGoal, updateProgress, deleteGoal }) {
  const COLORS = useTheme();
  const [title, setTitle] = useState("");

  async function suggestGoalSteps(onProgress) {
    const built = buildGoalsInsight(goals);
    if (!built) return { text: "目標がまだありません。下から追加してみてください。", source: null };
    return analyzeSmart({ kind: built.kind, payload: built.payload, prompt: built.prompt, onProgress });
  }

  return (
    <div>
      <AiCard title="目標達成のヒント(AI)" buttonLabel="ヒントをもらう" onRun={suggestGoalSteps} />
      <SectionLabel icon={<Target size={15} />} label="目標管理" />
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim()) {
              addGoal(title.trim());
              setTitle("");
            }
          }}
          placeholder="新しい目標を書く(例: 5kg減量する)"
          style={underlineInputStyle}
        />
        <button
          onClick={() => {
            if (title.trim()) {
              addGoal(title.trim());
              setTitle("");
            }
          }}
          style={navBtnStyle}
        >
          <Plus size={15} />
        </button>
      </div>

      {goals.length === 0 && <EmptyNote text="目標を追加すると、ここに進捗バーが並びます。" />}

      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {goals.map((g) => (
          <div key={g.id}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 6, gap: 8 }}>
              <span style={{ fontFamily: FONT_BODY, fontSize: 14, color: COLORS.ink, flex: 1 }}>{g.title}</span>
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 12,
                  color: g.progress >= 100 ? COLORS.moss : COLORS.inkFaint,
                }}
              >
                {g.progress}%
              </span>
              <button
                onClick={() => deleteGoal(g.id)}
                style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.inkFaint }}
              >
                <Trash2 size={13} />
              </button>
            </div>
            <div style={{ height: 10, borderRadius: 5, background: COLORS.paperDark, border: `1px solid ${COLORS.line}`, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${g.progress}%`,
                  background: g.progress >= 100 ? COLORS.moss : COLORS.gold,
                  transition: "width 0.2s ease",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button onClick={() => updateProgress(g.id, -10)} style={smallBtnStyle}>−10%</button>
              <button onClick={() => updateProgress(g.id, 10)} style={smallBtnStyle}>+10%</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- 家計簿ビュー ----------
function MoneyView({ expenses, addExpense, deleteExpense }) {
  const COLORS = useTheme();
  const [cursor, setCursor] = useState(new Date());
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;

  const [date, setDate] = useState(todayKey());
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");

  const monthExpenses = expenses
    .filter((e) => e.date.startsWith(monthPrefix))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const total = monthExpenses.reduce((s, e) => s + Number(e.amount), 0);

  const byCategory = {};
  monthExpenses.forEach((e) => {
    byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount);
  });
  const maxCat = Math.max(1, ...Object.values(byCategory));

  async function analyzeMonthSpending(onProgress) {
    const built = buildSpendingInsight(expenses, monthPrefix);
    if (!built) return { text: "この月の支出データがありません。", source: null };
    return analyzeSmart({ kind: built.kind, payload: built.payload, prompt: built.prompt, onProgress });
  }

  return (
    <div>
      <AiCard title={`${year}年${month + 1}月の支出分析(AI)`} buttonLabel="分析してもらう" onRun={analyzeMonthSpending} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <button onClick={() => setCursor(new Date(year, month - 1, 1))} style={navBtnStyle}>
          <ChevronLeft size={16} />
        </button>
        <span style={{ fontFamily: FONT_DISPLAY, fontSize: 18, color: COLORS.ink }}>
          {year}年 {month + 1}月の家計簿
        </span>
        <button onClick={() => setCursor(new Date(year, month + 1, 1))} style={navBtnStyle}>
          <ChevronRight size={16} />
        </button>
      </div>

      <div style={{ textAlign: "center", padding: "14px 0", marginBottom: 20, border: `1px solid ${COLORS.line}`, borderRadius: 8, background: COLORS.paperDark }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: COLORS.inkFaint }}>今月の支出合計</div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 30, color: COLORS.hanko }}>
          ¥{total.toLocaleString()}
        </div>
      </div>

      {Object.keys(byCategory).length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <SectionLabel icon={<Wallet size={15} />} label="カテゴリ別" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Object.entries(byCategory)
              .sort((a, b) => b[1] - a[1])
              .map(([cat, amt]) => (
                <div key={cat} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 60, fontFamily: FONT_BODY, fontSize: 12, color: COLORS.ink, flexShrink: 0 }}>
                    {cat}
                  </span>
                  <div style={{ flex: 1, height: 10, borderRadius: 5, background: COLORS.paper, border: `1px solid ${COLORS.line}`, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(amt / maxCat) * 100}%`, background: COLORS.moss }} />
                  </div>
                  <span style={{ width: 74, textAlign: "right", fontFamily: FONT_MONO, fontSize: 11, color: COLORS.inkFaint, flexShrink: 0 }}>
                    ¥{amt.toLocaleString()}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      <SectionLabel icon={<Plus size={15} />} label="支出を記録" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputBaseStyle} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputBaseStyle}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="金額" style={inputBaseStyle} />
        <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="メモ(任意)" style={inputBaseStyle} />
      </div>
      <button
        onClick={() => {
          if (amount && Number(amount) > 0) {
            addExpense({ date, category, amount: Number(amount), memo });
            setAmount("");
            setMemo("");
          }
        }}
        style={{ ...primaryButtonStyle, marginBottom: 24 }}
      >
        記録する
      </button>

      <SectionLabel icon={<CalendarDays size={15} />} label="今月の記録" />
      {monthExpenses.length === 0 && <EmptyNote text="この月の支出はまだありません。" />}
      {monthExpenses.map((e) => (
        <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 2px", borderBottom: `1px dashed ${COLORS.line}` }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: COLORS.inkFaint, width: 40, flexShrink: 0 }}>
            {e.date.slice(5)}
          </span>
          <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: COLORS.hanko, border: `1px solid ${COLORS.hanko}`, borderRadius: 10, padding: "1px 8px", flexShrink: 0 }}>
            {e.category}
          </span>
          <span style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.ink, flex: 1 }}>{e.memo}</span>
          <span style={{ fontFamily: FONT_MONO, fontSize: 13, color: COLORS.ink }}>
            ¥{Number(e.amount).toLocaleString()}
          </span>
          <button
            onClick={() => deleteExpense(e.id)}
            style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.inkFaint }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------- サブスク管理ビュー ----------
function SubscriptionsView({ subscriptions, addSubscription, deleteSubscription }) {
  const COLORS = useTheme();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [cycle, setCycle] = useState(CYCLES[0]);
  const [nextDate, setNextDate] = useState("");

  const monthlyTotal = subscriptions.reduce(
    (sum, s) => sum + (s.cycle === "年次" ? Number(s.amount) / 12 : Number(s.amount)),
    0
  );
  const yearlyTotal = monthlyTotal * 12;
  const key = todayKey();

  const sorted = [...subscriptions].sort((a, b) => {
    if (!a.nextDate) return 1;
    if (!b.nextDate) return -1;
    return a.nextDate < b.nextDate ? -1 : 1;
  });

  async function suggestSubscriptionReview(onProgress) {
    const built = buildSubscriptionsInsight(subscriptions);
    if (!built) return { text: "サブスクがまだ登録されていません。", source: null };
    return analyzeSmart({ kind: built.kind, payload: built.payload, prompt: built.prompt, onProgress });
  }

  return (
    <div>
      <AiCard title="見直しの提案(AI)" buttonLabel="提案してもらう" onRun={suggestSubscriptionReview} />
      <SectionLabel icon={<CreditCard size={15} />} label="サブスク管理" />

      <div style={{ display: "flex", gap: 14, marginBottom: 20 }}>
        <div style={{ flex: 1, textAlign: "center", padding: "12px 0", border: `1px solid ${COLORS.line}`, borderRadius: 8, background: COLORS.paperDark }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: COLORS.inkFaint }}>月換算合計</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, color: COLORS.hanko }}>¥{Math.round(monthlyTotal).toLocaleString()}</div>
        </div>
        <div style={{ flex: 1, textAlign: "center", padding: "12px 0", border: `1px solid ${COLORS.line}`, borderRadius: 8, background: COLORS.paperDark }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: COLORS.inkFaint }}>年換算合計</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, color: COLORS.ink }}>¥{Math.round(yearlyTotal).toLocaleString()}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="サービス名(例: Netflix)" style={inputBaseStyle} />
        <select value={cycle} onChange={(e) => setCycle(e.target.value)} style={inputBaseStyle}>
          {CYCLES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="金額" style={inputBaseStyle} />
        <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} style={inputBaseStyle} />
      </div>
      <button
        onClick={() => {
          if (name.trim() && amount && Number(amount) > 0) {
            addSubscription({ name: name.trim(), amount: Number(amount), cycle, nextDate });
            setName("");
            setAmount("");
            setNextDate("");
          }
        }}
        style={{ ...primaryButtonStyle, marginBottom: 24 }}
      >
        サブスクを追加
      </button>

      {sorted.length === 0 && <EmptyNote text="サブスクを追加すると、次回請求日順に並びます。" />}
      {sorted.map((s) => {
        const soon = s.nextDate && s.nextDate >= key && s.nextDate <= todayKey(new Date(Date.now() + 7 * 86400000));
        return (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 2px", borderBottom: `1px dashed ${COLORS.line}` }}>
            <span style={{ fontFamily: FONT_BODY, fontSize: 14, color: COLORS.ink, flex: 1 }}>{s.name}</span>
            <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: COLORS.inkFaint }}>{s.cycle}</span>
            <span style={{ fontFamily: FONT_MONO, fontSize: 13, color: COLORS.ink, width: 76, textAlign: "right" }}>
              ¥{Number(s.amount).toLocaleString()}
            </span>
            {s.nextDate && (
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 10.5,
                  color: soon ? COLORS.hanko : COLORS.inkFaint,
                  border: `1px solid ${soon ? COLORS.hanko : COLORS.line}`,
                  borderRadius: 10,
                  padding: "1px 7px",
                  flexShrink: 0,
                }}
              >
                次回 {s.nextDate.slice(5)}
              </span>
            )}
            <button
              onClick={() => deleteSubscription(s.id)}
              style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.inkFaint }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ---------- 資産推移ビュー ----------
function AssetsView({ assets, addAsset, deleteAsset }) {
  const COLORS = useTheme();
  const [date, setDate] = useState(todayKey());
  const [amount, setAmount] = useState("");

  const sorted = [...assets].sort((a, b) => (a.date < b.date ? -1 : 1));
  const latest = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  const diff = latest && prev ? latest.amount - prev.amount : null;

  async function analyzeAssetTrend(onProgress) {
    const built = buildAssetsInsight(assets);
    if (!built) return { text: "資産の記録が2件以上ないと分析できません。まずは2回以上記録してみてください。", source: null };
    return analyzeSmart({ kind: built.kind, payload: built.payload, prompt: built.prompt, onProgress });
  }

  const chartW = 560;
  const chartH = 160;
  const pad = 24;
  let points = "";
  let dots = [];
  if (sorted.length > 0) {
    const values = sorted.map((a) => a.amount);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const stepX = sorted.length > 1 ? (chartW - pad * 2) / (sorted.length - 1) : 0;
    dots = sorted.map((a, i) => {
      const x = pad + stepX * i;
      const y = pad + (chartH - pad * 2) * (1 - (a.amount - min) / range);
      return { x, y, a };
    });
    points = dots.map((d) => `${d.x},${d.y}`).join(" ");
  }

  return (
    <div>
      <AiCard title="資産推移の分析(AI)" buttonLabel="分析してもらう" onRun={analyzeAssetTrend} />
      <SectionLabel icon={<TrendingUp size={15} />} label="資産推移" />

      <div style={{ textAlign: "center", padding: "14px 0", marginBottom: 16, border: `1px solid ${COLORS.line}`, borderRadius: 8, background: COLORS.paperDark }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: COLORS.inkFaint }}>最新の資産総額</div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 30, color: COLORS.ink }}>
          {latest ? `¥${Number(latest.amount).toLocaleString()}` : "—"}
        </div>
        {diff !== null && (
          <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: diff >= 0 ? COLORS.moss : COLORS.hanko }}>
            {diff >= 0 ? "+" : ""}
            {diff.toLocaleString()} (前回比)
          </div>
        )}
      </div>

      {sorted.length > 1 && (
        <div style={{ marginBottom: 22, border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: 10, background: COLORS.paperDark }}>
          <svg width="100%" viewBox={`0 0 ${chartW} ${chartH}`} preserveAspectRatio="xMidYMid meet">
            <line x1={pad} y1={chartH - pad} x2={chartW - pad} y2={chartH - pad} stroke={COLORS.line} strokeWidth="1" />
            <polyline points={points} fill="none" stroke={COLORS.moss} strokeWidth="2" />
            {dots.map((d, i) => (
              <circle key={i} cx={d.x} cy={d.y} r="3.5" fill={COLORS.gold} stroke={COLORS.paperDark} strokeWidth="1" />
            ))}
          </svg>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputBaseStyle} />
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="資産総額" style={inputBaseStyle} />
      </div>
      <button
        onClick={() => {
          if (amount && Number(amount) >= 0) {
            addAsset({ date, amount: Number(amount) });
            setAmount("");
          }
        }}
        style={{ ...primaryButtonStyle, marginBottom: 24 }}
      >
        記録する
      </button>

      {sorted.length === 0 && <EmptyNote text="資産総額を記録すると、ここに推移グラフが表示されます。" />}
      {[...sorted].reverse().map((a) => (
        <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 2px", borderBottom: `1px dashed ${COLORS.line}` }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: COLORS.inkFaint, width: 84, flexShrink: 0 }}>{a.date}</span>
          <span style={{ fontFamily: FONT_MONO, fontSize: 13, color: COLORS.ink, flex: 1 }}>¥{Number(a.amount).toLocaleString()}</span>
          <button
            onClick={() => deleteAsset(a.id)}
            style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.inkFaint }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------- AI提案ビュー ----------
function SourceBadge({ source }) {
  const COLORS = useTheme();
  const map = {
    ondevice: { label: "🔒 端末内で処理", color: COLORS.moss },
    "server-local": { label: "🔒 自己ホストAIで処理", color: COLORS.moss },
    external: { label: "☁️ 外部APIを使用", color: COLORS.gold },
  };
  const info = map[source];
  if (!info) return null;
  return (
    <span style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: info.color, border: `1px solid ${info.color}`, borderRadius: 4, padding: "2px 6px", marginLeft: 8 }}>
      {info.label}
    </span>
  );
}

function AiCard({ title, buttonLabel, onRun }) {
  const COLORS = useTheme();
  // idle | loading | done | error | needs-consent
  const [state, setState] = useState("idle");
  const [result, setResult] = useState("");
  const [source, setSource] = useState(null);
  const [progress, setProgress] = useState("");

  async function run() {
    setState("loading");
    setProgress("");
    try {
      const { text, source } = await onRun((p) => setProgress(p?.text || ""));
      setResult(text);
      setSource(source);
      setState("done");
    } catch (err) {
      if (err.code === NEEDS_CONSENT) {
        setState("needs-consent");
        return;
      }
      setResult(err.message || "エラーが発生しました");
      setState("error");
    }
  }

  function decide(consent) {
    setExternalAiConsent(consent, "openai");
    run();
  }

  return (
    <div style={{ marginBottom: 26, border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: 16, background: COLORS.paperDark }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontFamily: FONT_DISPLAY, fontSize: 15, color: COLORS.ink, display: "flex", alignItems: "center" }}>
          {title}
          {state === "done" && <SourceBadge source={source} />}
        </span>
        <button
          onClick={run}
          disabled={state === "loading"}
          style={{
            ...navBtnStyle,
            width: "auto",
            height: 30,
            padding: "0 12px",
            borderRadius: 5,
            fontFamily: FONT_BODY,
            fontSize: 12,
            gap: 6,
            opacity: state === "loading" ? 0.6 : 1,
          }}
        >
          {state === "loading" ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
          {state === "loading" ? "考え中…" : buttonLabel}
        </button>
      </div>

      {state === "idle" && <EmptyNote text="ボタンを押すとAIが提案します。" />}

      {state === "loading" && progress && (
        <p style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: COLORS.inkFaint }}>
          端末内AIを準備中: {progress}
        </p>
      )}

      {state === "needs-consent" && (
        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: COLORS.ink, lineHeight: 1.7 }}>
          <p style={{ marginBottom: 10 }}>
            この端末では処理が重い可能性があります。外部AI(OpenAI)を使うと速く結果が返りますが、
            集計済みのデータ(カテゴリ別合計など。日記本文などは含みません)が外部に送信されます。
            使いますか？
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => decide("granted")} style={{ ...navBtnStyle, width: "auto", height: 28, padding: "0 12px", borderRadius: 5, fontSize: 12 }}>
              外部AIを使う
            </button>
            <button onClick={() => decide("declined")} style={{ ...navBtnStyle, width: "auto", height: 28, padding: "0 12px", borderRadius: 5, fontSize: 12 }}>
              ローカルのまま待つ
            </button>
          </div>
        </div>
      )}

      {state === "error" && (
        <p style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: COLORS.hanko }}>{result}</p>
      )}
      {state === "done" && result && (
        <p style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: COLORS.ink, whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
          {result}
        </p>
      )}
    </div>
  );
}

// AIタブを開いた時、かつ「非力端末(バックエンドのローカルAIに頼る可能性がある)」の時だけ、
// バックエンドのローカルAI(Ollama)が今使える状態かを確認する。端末内AIが使える端末では呼ばない。
function useAiStatus(enabled) {
  const [status, setStatus] = useState({ state: "idle" });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setStatus({ state: "loading" });
    fetch(`${API_BASE_URL}/api/ai/status`)
      .then((r) => {
        if (!r.ok) throw new Error("status check failed");
        return r.json();
      })
      .then((data) => {
        if (!cancelled) setStatus({ state: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setStatus({ state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return status;
}

function LocalAiStatusNote({ status }) {
  const COLORS = useTheme();
  const noteStyle = { marginTop: 8, marginBottom: 4, lineHeight: 1.7 };
  const codeStyle = {
    display: "inline-block",
    background: COLORS.paper,
    border: `1px solid ${COLORS.line}`,
    borderRadius: 4,
    padding: "1px 6px",
    fontFamily: FONT_MONO,
    fontSize: 10.5,
    color: COLORS.ink,
  };

  if (status.state === "loading") {
    return <p style={noteStyle}>サーバー側のローカルAI起動状況を確認中…</p>;
  }
  if (status.state === "error") {
    return (
      <p style={noteStyle}>
        バックエンド({API_BASE_URL})に接続できませんでした。backendコンテナ/サーバーが起動しているか確認してください。
      </p>
    );
  }
  if (status.state !== "ready") return null;

  const { local } = status.data;
  if (local.available && local.modelInstalled) {
    return <p style={{ ...noteStyle, color: COLORS.moss }}>✓ ローカルAI(自己ホスト {local.model})が起動しています。</p>;
  }
  if (local.available && !local.modelInstalled) {
    return (
      <p style={noteStyle}>
        ローカルAIサーバーは起動していますが、モデルが未取得です。次を実行してください:
        <br />
        <code style={codeStyle}>docker exec -it archlife-ollama ollama pull {local.model}</code>
      </p>
    );
  }
  return (
    <p style={noteStyle}>
      ローカルAI(Ollama)は現在起動していません。「外部AIを使う」を選ぶか、次のコマンドで起動できます:
      <br />
      <code style={codeStyle}>docker compose --profile ai up -d --build</code>
      <br />
      <code style={codeStyle}>docker exec -it archlife-ollama ollama pull {local.model}</code>
    </p>
  );
}

export const MODE_LABELS = {
  ondevice: "端末内AI",
  "server-local": "自己ホストAI(サーバー)",
  external: "外部AI",
};

export function AiSettingsPanel() {
  const COLORS = useTheme();
  const [open, setOpen] = useState(false);
  const [consent, setConsent] = useState(getExternalAiConsent());
  const [override, setOverride] = useState(getAiModeOverride());
  const cap = detectDeviceCapability();

  const autoMode = cap.capable ? "ondevice" : consent === "granted" ? "external" : consent === "declined" ? "server-local" : null;
  const effectiveMode = override || autoMode;
  const aiStatus = useAiStatus(open && effectiveMode !== "ondevice");

  function chooseOverride(value) {
    setAiModeOverride(value);
    setOverride(value);
  }
  function chooseConsent(value) {
    if (value === null) {
      resetExternalAiConsent();
    } else {
      setExternalAiConsent(value, "openai");
    }
    setConsent(value);
  }

  const modeChoiceStyle = (active, disabled) => ({
    ...navBtnStyle,
    width: "auto",
    height: 26,
    padding: "0 10px",
    borderRadius: 5,
    fontSize: 11,
    opacity: disabled ? 0.35 : active ? 1 : 0.55,
    cursor: disabled ? "not-allowed" : "pointer",
  });

  return (
    <div style={{ marginBottom: 20 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          border: `1px solid ${COLORS.line}`,
          background: COLORS.paperDark,
          color: COLORS.inkFaint,
          borderRadius: 6,
          padding: "6px 10px",
          fontFamily: FONT_BODY,
          fontSize: 11.5,
          cursor: "pointer",
        }}
      >
        <Settings size={13} />
        AI設定
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        <span style={{ marginLeft: 4, color: COLORS.ink }}>
          現在: {effectiveMode ? MODE_LABELS[effectiveMode] : "未設定(初回に確認)"}
        </span>
      </button>

      {open && (
        <div
          style={{
            marginTop: 8,
            border: `1px dashed ${COLORS.line}`,
            borderRadius: 8,
            padding: 12,
            fontFamily: FONT_BODY,
            fontSize: 11.5,
            color: COLORS.inkFaint,
          }}
        >
          <p style={{ marginBottom: 6 }}>
            この端末は{cap.capable ? "端末内AIを使える性能があると判定されています。" : "端末内AIには非力と判定されています。"}
            必要なら下記で実行方法を固定できます(既定は自動判定)。
          </p>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <span>実行方法:</span>
            <button onClick={() => chooseOverride(null)} style={modeChoiceStyle(!override, false)}>自動(推奨)</button>
            <button
              onClick={() => cap.capable && chooseOverride("ondevice")}
              disabled={!cap.capable}
              title={!cap.capable ? "この端末は端末内AIの性能要件を満たしていません" : ""}
              style={modeChoiceStyle(override === "ondevice", !cap.capable)}
            >
              端末内のみ
            </button>
            <button onClick={() => chooseOverride("server-local")} style={modeChoiceStyle(override === "server-local", false)}>自己ホストのみ</button>
            <button onClick={() => chooseOverride("external")} style={modeChoiceStyle(override === "external", false)}>外部APIのみ</button>
          </div>

          {(effectiveMode === "external" || (!override && !cap.capable)) && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
              <span>外部AI利用の同意(非力端末での自動判定用):</span>
              <button onClick={() => chooseConsent("granted")} style={modeChoiceStyle(consent === "granted", false)}>許可する</button>
              <button onClick={() => chooseConsent("declined")} style={modeChoiceStyle(consent === "declined", false)}>許可しない</button>
              <button onClick={() => chooseConsent(null)} style={modeChoiceStyle(!consent, false)}>毎回確認する</button>
            </div>
          )}

          {effectiveMode !== "ondevice" && <LocalAiStatusNote status={aiStatus} />}
        </div>
      )}
    </div>
  );
}

function AiView({ todos, habits, expenses, goals }) {
  const COLORS = useTheme();
  const key = todayKey();

  async function suggestToday(onProgress) {
    const built = buildTodayInsight(todos, habits, goals);
    return analyzeSmart({ kind: built.kind, payload: built.payload, prompt: built.prompt, onProgress });
  }

  async function analyzeSpending(onProgress) {
    const built = buildSpendingInsight(expenses, key.slice(0, 7));
    if (!built) return { text: "今月の支出データがまだありません。家計簿タブで記録してみてください。", source: null };
    return analyzeSmart({ kind: built.kind, payload: built.payload, prompt: built.prompt, onProgress });
  }

  async function analyzeHabits(onProgress) {
    const built = buildHabitsInsight(habits);
    if (!built) return { text: "習慣データがまだありません。習慣タブで登録してみてください。", source: null };
    return analyzeSmart({ kind: built.kind, payload: built.payload, prompt: built.prompt, onProgress });
  }

  return (
    <div>
      <SectionLabel icon={<Sparkles size={15} />} label="AIアシスタント" />
      <p style={{ fontFamily: FONT_BODY, fontSize: 12, color: COLORS.inkFaint, marginBottom: 12 }}>
        端末の性能に応じて、端末内AI・自己ホストAI・外部APIを自動で使い分けます。外部APIは同意した場合のみ使われます。
        カレンダー・習慣・日記・目標・家計簿・サブスク・資産の各ページにも、そのページ専用のAIカードがあります。
        ここは全体まとめ用のページです。日記・メモの内容は、設定に関わらず常に端末内AIのみで処理され、外部やサーバーには送信されません。
        実行方法(端末内/自己ホスト/外部API)の切り替えは「設定」タブに移動しました。
      </p>
      <AiCard title="今日やるべきこと" buttonLabel="提案してもらう" onRun={suggestToday} />
      <AiCard title="支出分析(今月)" buttonLabel="分析してもらう" onRun={analyzeSpending} />
      <AiCard title="習慣分析" buttonLabel="分析してもらう" onRun={analyzeHabits} />
    </div>
  );
}

// ---------- 起動時リマインド(習慣ストリーク / サブスク更新日) ----------
// 設計書5章の「EventBridgeでの毎日7時ストリーク再計算・毎日正午サブスク検知」に相当する処理。
// サーバーは暗号文しか持たず中身を復号できないため、この判定と表示はアプリを開いた端末上(ここ)で行う。
const SUBSCRIPTION_REMINDER_DAYS = 3;

function ReminderBanner({ subscriptions, habits, onDismiss }) {
  const COLORS = useTheme();
  const t = useT();
  const key = todayKey();
  const limitKey = todayKey(new Date(Date.now() + SUBSCRIPTION_REMINDER_DAYS * 86400000));

  const dueSubs = subscriptions
    .filter((s) => s.nextDate && s.nextDate >= key && s.nextDate <= limitKey)
    .sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1));

  const atRiskHabits = habits.filter((h) => countStreak(h.checkins) > 0 && !h.checkins[key]);

  if (dueSubs.length === 0 && atRiskHabits.length === 0) return null;

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        background: COLORS.paperDark,
        border: `1px solid ${COLORS.hanko}`,
        borderRadius: 8,
        padding: "10px 34px 10px 14px",
        marginBottom: 18,
      }}
    >
      <button
        onClick={onDismiss}
        aria-label="閉じる"
        style={{
          position: "absolute",
          top: 6,
          right: 8,
          border: "none",
          background: "transparent",
          color: COLORS.inkFaint,
          cursor: "pointer",
          fontFamily: FONT_MONO,
          fontSize: 13,
          lineHeight: 1,
        }}
      >
        ×
      </button>
      {dueSubs.map((s) => (
        <div key={`sub-${s.id}`} style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: COLORS.ink }}>
          <CreditCard size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
          <strong>{s.name}</strong> {t("reminder.subDue")}(
          {s.nextDate.slice(5)})
        </div>
      ))}
      {atRiskHabits.map((h) => (
        <div key={`habit-${h.id}`} style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: COLORS.ink }}>
          <Flame size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
          <strong>{h.name}</strong> {t("reminder.habitAtRisk")}({t("reminder.streakDays", countStreak(h.checkins))})
        </div>
      ))}
    </div>
  );
}

// ---------- メインアプリ ----------
function ArchLifeAppInner() {
  const COLORS = useTheme();
  const { bgImage, bgOverlay } = useBackgroundControls();
  const t = useT();
  const { lang } = useLanguage();
  const [tab, setTab] = useState("today");
  const [todos, setTodos] = useState([]);
  const [habits, setHabits] = useState([]);
  const [diary, setDiary] = useState({});
  const [memos, setMemos] = useState([]);
  const [goals, setGoals] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [assets, setAssets] = useState([]);
  const [ready, setReady] = useState(false);
  const [remindersDismissed, setRemindersDismissed] = useState(false);

  useEffect(() => {
    (async () => {
      async function load(key, fallback) {
        try {
          const r = await storage.get(key);
          return r ? JSON.parse(r.value) : fallback;
        } catch {
          return fallback;
        }
      }
      setTodos(await load("lifeos:todos", defaultTodos()));
      setHabits(await load("lifeos:habits", defaultHabits()));
      setDiary(await load("lifeos:diary", {}));
      setMemos(await load("lifeos:memos", []));
      setGoals(await load("lifeos:goals", defaultGoals()));
      setExpenses(await load("lifeos:expenses", []));
      setSubscriptions(await load("lifeos:subscriptions", []));
      setAssets(await load("lifeos:assets", []));
      setReady(true);
    })();
  }, []);

  const persist = useCallback((key, setter) => async (next) => {
    setter(next);
    try {
      await storage.set(key, JSON.stringify(next));
    } catch {}
  }, []);

  const persistTodos = persist("lifeos:todos", setTodos);
  const persistHabits = persist("lifeos:habits", setHabits);
  const persistDiary = persist("lifeos:diary", setDiary);
  const persistMemos = persist("lifeos:memos", setMemos);
  const persistGoals = persist("lifeos:goals", setGoals);
  const persistExpenses = persist("lifeos:expenses", setExpenses);
  const persistSubscriptions = persist("lifeos:subscriptions", setSubscriptions);
  const persistAssets = persist("lifeos:assets", setAssets);

  // Todo
  function addTodo(text) {
    persistTodos([...todos, { id: crypto.randomUUID(), text, done: false, date: todayKey() }]);
  }
  function toggleTodo(id) {
    persistTodos(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  }
  function deleteTodo(id) {
    persistTodos(todos.filter((t) => t.id !== id));
  }

  // 習慣
  function addHabit(name) {
    persistHabits([...habits, { id: crypto.randomUUID(), name, checkins: {} }]);
  }
  function deleteHabit(id) {
    persistHabits(habits.filter((h) => h.id !== id));
  }
  function toggleHabitDate(id, dateKey) {
    persistHabits(
      habits.map((h) =>
        h.id === id ? { ...h, checkins: { ...h.checkins, [dateKey]: !h.checkins[dateKey] } } : h
      )
    );
  }
  function toggleHabitToday(id) {
    toggleHabitDate(id, todayKey());
  }

  // 日記
  function saveDiary(dateKey, text) {
    persistDiary({ ...diary, [dateKey]: text });
  }

  // メモ
  function addMemo(text) {
    persistMemos([
      { id: crypto.randomUUID(), text, createdAt: new Date().toLocaleString("ja-JP") },
      ...memos,
    ]);
  }
  function deleteMemo(id) {
    persistMemos(memos.filter((m) => m.id !== id));
  }

  // 目標
  function addGoal(title) {
    persistGoals([...goals, { id: crypto.randomUUID(), title, progress: 0 }]);
  }
  function updateProgress(id, delta) {
    persistGoals(
      goals.map((g) =>
        g.id === id ? { ...g, progress: Math.max(0, Math.min(100, g.progress + delta)) } : g
      )
    );
  }
  function deleteGoal(id) {
    persistGoals(goals.filter((g) => g.id !== id));
  }

  // 家計簿
  function addExpense(entry) {
    persistExpenses([...expenses, { id: crypto.randomUUID(), ...entry }]);
  }
  function deleteExpense(id) {
    persistExpenses(expenses.filter((e) => e.id !== id));
  }

  // サブスク
  function addSubscription(entry) {
    persistSubscriptions([...subscriptions, { id: crypto.randomUUID(), ...entry }]);
  }
  function deleteSubscription(id) {
    persistSubscriptions(subscriptions.filter((s) => s.id !== id));
  }

  // 資産
  function addAsset(entry) {
    persistAssets([...assets, { id: crypto.randomUUID(), ...entry }]);
  }
  function deleteAsset(id) {
    persistAssets(assets.filter((a) => a.id !== id));
  }

  const now = new Date();
  const dateNum = now.getDate();
  const monthName = now.toLocaleDateString(lang === "en" ? "en-US" : "ja-JP", { month: "long" });
  const weekday = t(`weekday.${now.getDay()}`);

  const TABS = [
    { id: "today", label: t("tab.today"), icon: <Sunrise size={15} /> },
    { id: "calendar", label: t("tab.calendar"), icon: <CalendarDays size={15} /> },
    { id: "habits", label: t("tab.habits"), icon: <Flame size={15} /> },
    { id: "diary", label: t("tab.diary"), icon: <BookOpen size={15} /> },
    { id: "memo", label: t("tab.memo"), icon: <StickyNote size={15} /> },
    { id: "goals", label: t("tab.goals"), icon: <Target size={15} /> },
    { id: "money", label: t("tab.money"), icon: <Wallet size={15} /> },
    { id: "subscriptions", label: t("tab.subscriptions"), icon: <CreditCard size={15} /> },
    { id: "assets", label: t("tab.assets"), icon: <TrendingUp size={15} /> },
    { id: "ai", label: t("tab.ai"), icon: <Sparkles size={15} /> },
    { id: "settings", label: t("tab.settings"), icon: <Settings size={15} /> },
  ];

  return (
    <div
      style={{
        fontFamily: FONT_BODY,
        backgroundColor: COLORS.paper,
        backgroundImage: bgImage
          ? `linear-gradient(${hexToRgba(COLORS.paper, bgOverlay)}, ${hexToRgba(COLORS.paper, bgOverlay)}), url(${bgImage})`
          : `radial-gradient(${COLORS.line} 1px, transparent 1px)`,
        backgroundSize: bgImage ? "cover" : "16px 16px",
        backgroundPosition: bgImage ? "center" : undefined,
        backgroundRepeat: bgImage ? "no-repeat" : undefined,
        minHeight: 640,
        height: "100vh",
        borderRadius: 10,
        overflow: "hidden",
        display: "flex",
        boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
        // 一部の共通スタイル定数(navBtnStyle等)はコンポーネント外で定義されているため
        // CSS変数経由で現在のテーマ色を渡している。
        "--paper": COLORS.paper,
        "--paper-dark": COLORS.paperDark,
        "--ink": COLORS.ink,
        "--ink-faint": COLORS.inkFaint,
        "--hanko": COLORS.hanko,
        "--moss": COLORS.moss,
        "--gold": COLORS.gold,
        "--line": COLORS.line,
      }}
    >
      <style>{`
        .hanko-stamp-in { animation: hankoDown 0.22s ease-out; }
        @keyframes hankoDown {
          0% { transform: scale(2.2) rotate(-8deg); opacity: 0; }
          60% { transform: scale(0.9) rotate(-8deg); opacity: 1; }
          100% { transform: scale(1) rotate(-8deg); opacity: 1; }
        }
        .spin { animation: spin 0.9s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      {/* サイドタブ */}
      <div
        style={{
          width: 108,
          flexShrink: 0,
          background: COLORS.paperDark,
          borderRight: `1px solid ${COLORS.line}`,
          display: "flex",
          flexDirection: "column",
          paddingTop: 20,
          overflowY: "auto",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 17, letterSpacing: "0.08em", color: COLORS.hanko }}>
            ArchLife
          </div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: COLORS.inkFaint, marginTop: 1 }}>
            {t("appSubtitle")}
          </div>
        </div>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: COLORS.inkFaint }}>
            {now.getFullYear()}
          </div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 28, color: COLORS.ink, lineHeight: 1 }}>
            {dateNum}
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: COLORS.inkFaint }}>
            {monthName} ({weekday})
          </div>
        </div>

        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              padding: "10px 4px",
              border: "none",
              borderLeft: tab === t.id ? `3px solid ${COLORS.hanko}` : "3px solid transparent",
              background: tab === t.id ? COLORS.paper : "transparent",
              color: tab === t.id ? COLORS.hanko : COLORS.inkFaint,
              cursor: "pointer",
              fontFamily: FONT_BODY,
              fontSize: 10.5,
            }}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* メインコンテンツ */}
      <div style={{ flex: 1, padding: "26px 30px", overflowY: "auto" }}>
        {ready && !remindersDismissed && (
          <ReminderBanner
            subscriptions={subscriptions}
            habits={habits}
            onDismiss={() => setRemindersDismissed(true)}
          />
        )}
        {!ready ? (
          <p style={{ fontFamily: FONT_BODY, color: COLORS.inkFaint, fontSize: 13 }}>{t("loading")}</p>
        ) : tab === "today" ? (
          <TodayView
            todos={todos}
            toggleTodo={toggleTodo}
            addTodo={addTodo}
            deleteTodo={deleteTodo}
            habits={habits}
            toggleHabitToday={toggleHabitToday}
            goals={goals}
          />
        ) : tab === "calendar" ? (
          <CalendarView todos={todos} />
        ) : tab === "habits" ? (
          <HabitsView habits={habits} addHabit={addHabit} toggleHabitDate={toggleHabitDate} deleteHabit={deleteHabit} />
        ) : tab === "diary" ? (
          <DiaryView diary={diary} saveDiary={saveDiary} />
        ) : tab === "memo" ? (
          <MemoView memos={memos} addMemo={addMemo} deleteMemo={deleteMemo} />
        ) : tab === "goals" ? (
          <GoalsView goals={goals} addGoal={addGoal} updateProgress={updateProgress} deleteGoal={deleteGoal} />
        ) : tab === "money" ? (
          <MoneyView expenses={expenses} addExpense={addExpense} deleteExpense={deleteExpense} />
        ) : tab === "subscriptions" ? (
          <SubscriptionsView subscriptions={subscriptions} addSubscription={addSubscription} deleteSubscription={deleteSubscription} />
        ) : tab === "assets" ? (
          <AssetsView assets={assets} addAsset={addAsset} deleteAsset={deleteAsset} />
        ) : tab === "settings" ? (
          <SettingsView />
        ) : (
          <AiView todos={todos} habits={habits} expenses={expenses} goals={goals} />
        )}
      </div>
    </div>
  );
}

// アプリ全体をテーマ(背景)・言語のプロバイダーで包む。
// これにより配下のどのコンポーネントからも useTheme() / useT() で
// 現在の設定(背景テーマ・表示言語)を参照・利用できる。
export default function ArchLifeApp() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <ArchLifeAppInner />
      </LanguageProvider>
    </ThemeProvider>
  );
}

function defaultTodos() {
  return [{ id: crypto.randomUUID(), text: "人生管理OSのMVPを触ってみる", done: false, date: todayKey() }];
}
function defaultHabits() {
  return [{ id: crypto.randomUUID(), name: "水を飲む", checkins: {} }];
}
function defaultGoals() {
  return [{ id: crypto.randomUUID(), title: "人生管理OSをリリースする", progress: 10 }];
}

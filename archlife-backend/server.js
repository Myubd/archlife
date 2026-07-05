// ArchLifeOS backend
//
// 方針:
// - サーバーは「匿名ID」と「暗号文」しか扱わない。中身を復号する処理は一切書かない。
// - AI分析は既定でローカルLLM(Ollama上のQwen等)に投げる。
// - 外部API(Claude/GPT)は、フロント側が明示的に useExternal=true を送ってきた時だけ呼ぶ。
//   その場合も、送られてくる payload は「集計済みデータ」であることを前提にする
//   (生の日記本文などを送らない設計はフロント側の責務)。
// - リクエストボディはログに出さない(個人データがログに残らないようにするため)。

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// プライバシー配慮: ボディを含まない最小限のアクセスログのみ出す
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Neonは接続にSSLを要求する。ローカルのdocker-compose用Postgresでは無効化できるよう
// PGSSLMODE=disable を明示的に指定できるようにしてある。
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
});

app.get("/health", (req, res) => res.json({ ok: true }));

// ---------- 暗号化ブロブの保存/取得 ----------

// 保存(新規 or 上書き)
app.put("/api/blobs/:anonId/:key", async (req, res) => {
  const { anonId, key } = req.params;
  const { ciphertext, iv } = req.body || {};
  if (!ciphertext || !iv) {
    return res.status(400).json({ error: "ciphertext and iv are required" });
  }
  try {
    await pool.query(
      `INSERT INTO blobs (anon_id, item_key, ciphertext, iv, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (anon_id, item_key)
       DO UPDATE SET ciphertext = $3, iv = $4, updated_at = now()`,
      [anonId, key, ciphertext, iv]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "保存に失敗しました" });
  }
});

// 単一キー取得
app.get("/api/blobs/:anonId/:key", async (req, res) => {
  const { anonId, key } = req.params;
  try {
    const r = await pool.query(
      "SELECT ciphertext, iv, updated_at FROM blobs WHERE anon_id = $1 AND item_key = $2",
      [anonId, key]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: "not found" });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "取得に失敗しました" });
  }
});

// この匿名IDが持っているキー一覧
app.get("/api/blobs/:anonId", async (req, res) => {
  const { anonId } = req.params;
  try {
    const r = await pool.query(
      "SELECT item_key, updated_at FROM blobs WHERE anon_id = $1 ORDER BY updated_at DESC",
      [anonId]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: "一覧取得に失敗しました" });
  }
});

// 削除
app.delete("/api/blobs/:anonId/:key", async (req, res) => {
  const { anonId, key } = req.params;
  try {
    await pool.query("DELETE FROM blobs WHERE anon_id = $1 AND item_key = $2", [anonId, key]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "削除に失敗しました" });
  }
});

// ---------- AI設定(外部APIを使うかどうか) ----------

app.get("/api/ai-settings/:anonId", async (req, res) => {
  const { anonId } = req.params;
  const r = await pool.query("SELECT allow_external_api, external_provider FROM ai_settings WHERE anon_id = $1", [anonId]);
  if (r.rows.length === 0) {
    return res.json({ allow_external_api: false, external_provider: "claude" });
  }
  res.json(r.rows[0]);
});

app.put("/api/ai-settings/:anonId", async (req, res) => {
  const { anonId } = req.params;
  const { allow_external_api, external_provider } = req.body || {};
  await pool.query(
    `INSERT INTO ai_settings (anon_id, allow_external_api, external_provider)
     VALUES ($1, $2, $3)
     ON CONFLICT (anon_id) DO UPDATE SET allow_external_api = $2, external_provider = $3`,
    [anonId, !!allow_external_api, external_provider || "claude"]
  );
  res.json({ ok: true });
});

// ---------- AI利用可否の確認(AIタブを開いた時だけフロントから呼ばれる軽量チェック) ----------
// ここでの失敗はアプリ全体を止めない。「ローカルAIが今使えるか」を教えるだけのエンドポイント。
app.get("/api/ai/status", async (req, res) => {
  const base = normalizeOllamaBase(process.env.OLLAMA_URL);
  const model = process.env.OLLAMA_MODEL || "qwen3:8b";

  let localAvailable = false;
  let modelInstalled = false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const r = await fetch(`${base}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    if (r.ok) {
      localAvailable = true;
      const data = await r.json().catch(() => ({}));
      modelInstalled = (data.models || []).some((m) => (m.name || "").startsWith(model));
    }
  } catch {
    localAvailable = false;
  }

  res.json({
    local: { available: localAvailable, modelInstalled, model },
    external: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
    },
  });
});

// ---------- AI分析: ローカル優先、外部はオプトインのみ ----------

app.post("/api/ai/analyze", async (req, res) => {
  const { kind, payload, useExternal, provider } = req.body || {};
  if (!payload) return res.status(400).json({ error: "payload is required" });

  const prompt = buildPrompt(kind, payload);

  try {
    let text;
    let source;
    if (useExternal) {
      if (provider === "openai") {
        text = await callOpenAI(prompt);
        source = "openai";
      } else {
        text = await callClaude(prompt);
        source = "claude";
      }
    } else {
      text = await callLocalQwen(prompt);
      source = "local";
    }
    res.json({ text, source });
  } catch (err) {
    res.status(502).json({ error: err.message || "AI呼び出しに失敗しました" });
  }
});

function buildPrompt(kind, payload) {
  const json = JSON.stringify(payload);
  const templates = {
    today: `あなたはライフ管理アプリのアシスタントです。以下の要約データ(タスク・習慣・目標)をもとに、今日優先すべきことを3〜5個、日本語で短い箇条書きで提案してください。前置きは不要です。\n\n${json}`,
    spending: `あなたは家計簿アシスタントです。以下の支出集計データ(カテゴリ別合計)を分析し、気づいた傾向や節約のヒントを3〜5個、日本語で短い箇条書きで提案してください。前置きは不要です。\n\n${json}`,
    habits: `あなたは習慣コーチです。以下の習慣の記録データ(継続日数など)を分析し、改善のための具体的な工夫を3〜5個、日本語で短い箇条書きで提案してください。前置きは不要です。\n\n${json}`,
    calendar: `あなたはスケジュールアシスタントです。以下の今後7日間の未完了タスクのデータを見て、優先順位や詰め込みすぎていないかについて3〜5個、日本語で短い箇条書きで提案してください。前置きは不要です。\n\n${json}`,
    goals: `あなたは目標達成コーチです。以下の目標一覧(タイトルと進捗%)を見て、進みが良いもの・停滞していそうなものを踏まえ、次に取れる具体的で小さな一歩を3〜5個、日本語で短い箇条書きで提案してください。前置きは不要です。\n\n${json}`,
    subscriptions: `あなたはサブスク管理アシスタントです。以下のサブスク一覧(名前・金額・周期)を見て、重複していそうなものや見直す価値がありそうなものを3〜5個、日本語で短い箇条書きで指摘してください。前置きは不要です。\n\n${json}`,
    assets: `あなたは資産管理アシスタントです。以下の資産推移の記録(日付・金額)を見て、変化の傾向やペースについて気づいたことを3〜5個、日本語で短い箇条書きでコメントしてください。断定的な投資助言はせず、あくまで記録の振り返りとしてコメントしてください。前置きは不要です。\n\n${json}`,
  };
  return templates[kind] || `以下のデータについて分析し、日本語で短くコメントしてください。\n\n${json}`;
}

// Renderのrender.yamlでは OLLAMA_URL を `fromService: property: hostport` から注入しており、
// この値は "host:port" 形式でスキーム(http://)を含まない。スキームが無い場合は自動で補う。
function normalizeOllamaBase(url) {
  if (!url) return "http://ollama:11434";
  return /^https?:\/\//i.test(url) ? url : `http://${url}`;
}

async function callLocalQwen(prompt) {
  const base = normalizeOllamaBase(process.env.OLLAMA_URL);
  // Renderの構成ではGPUが使えないため、CPUでも現実的な速度で動く小型モデルを既定にしている。
  // AWS(EC2+GPU)版で使っていた7Bクラスに戻したい場合はOLLAMA_MODELで上書きする。
  const model = process.env.OLLAMA_MODEL || "qwen3:8b";
  const r = await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false }),
  });
  if (!r.ok) throw new Error(`ローカルLLMエラー (status ${r.status})`);
  const data = await r.json();
  if (!data.response) throw new Error("ローカルLLMから応答がありませんでした");
  return data.response;
}

async function callClaude(prompt) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY が設定されていません");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!r.ok) throw new Error(`Claude APIエラー (status ${r.status})`);
  const data = await r.json();
  const text = (data.content || []).map((b) => (b.type === "text" ? b.text : "")).join("\n");
  if (!text) throw new Error("Claudeから応答がありませんでした");
  return text;
}

async function callOpenAI(prompt) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY が設定されていません");
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!r.ok) throw new Error(`OpenAI APIエラー (status ${r.status})`);
  const data = await r.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAIから応答がありませんでした");
  return text;
}

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`ArchLife backend listening on ${port}`));

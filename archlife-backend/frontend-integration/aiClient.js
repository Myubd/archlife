// aiClient.js
//
// ArchLifeApp.jsx の `callClaude(prompt)` の代わりに使う関数群。
// 既存コードは「テキストのプロンプトを1本渡してテキストを受け取る」形だったが、
// ローカル/外部の切り替えとデータ最小化のため、ここでは
// 「集計済みのpayload(オブジェクト)を渡す」形にしている。
//
// 重要: payload には生の日記本文などを含めない。カテゴリ別合計・件数・継続日数など、
// 集計済みの数値/短いラベルだけを渡すこと(外部APIに送る場合のデータ最小化のため)。

/**
 * @param {Object} opts
 * @param {string} opts.apiBaseUrl
 * @param {"today"|"spending"|"habits"} opts.kind
 * @param {Object} opts.payload - 集計済みデータ
 * @param {boolean} opts.useExternal - falseなら常にローカルLLM。trueならユーザーが明示的にオンにした場合のみ。
 * @param {"claude"|"openai"} [opts.provider]
 */
export async function analyzeWithBackend({ apiBaseUrl, kind, payload, useExternal, provider }) {
  const r = await fetch(`${apiBaseUrl}/api/ai/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, payload, useExternal, provider }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `AI呼び出しに失敗しました (status ${r.status})`);
  return { text: data.text, source: data.source };
}

export async function getAiSettings({ apiBaseUrl, anonId }) {
  const r = await fetch(`${apiBaseUrl}/api/ai-settings/${anonId}`);
  if (!r.ok) throw new Error("AI設定の取得に失敗しました");
  return r.json();
}

export async function setAiSettings({ apiBaseUrl, anonId, allowExternalApi, externalProvider }) {
  const r = await fetch(`${apiBaseUrl}/api/ai-settings/${anonId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allow_external_api: allowExternalApi, external_provider: externalProvider }),
  });
  if (!r.ok) throw new Error("AI設定の保存に失敗しました");
  return r.json();
}

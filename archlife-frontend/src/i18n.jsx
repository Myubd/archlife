import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

// ---------- 軽量i18n ----------
// 現状はアプリの「外枠」(サイドバー・タブ名・設定ページ・リマインダー等)を対象にした
// 実用最小限の翻訳です。各タブの中身(今日/日記/家計簿など個別画面の文言)は
// 現状すべて日本語のままです。必要になったらキーを追加して対象を広げてください。

export const LANGUAGES = [
  { id: "ja", label: "日本語" },
  { id: "en", label: "English" },
];
export const DEFAULT_LANG = "ja";
const LANG_STORAGE_KEY = "archlife_lang";

const dict = {
  ja: {
    appSubtitle: "人生管理OS",
    loading: "読み込み中…",
    "tab.today": "今日",
    "tab.calendar": "カレンダー",
    "tab.habits": "習慣",
    "tab.diary": "日記",
    "tab.memo": "メモ",
    "tab.goals": "目標",
    "tab.money": "家計簿",
    "tab.subscriptions": "サブスク",
    "tab.assets": "資産",
    "tab.ai": "AI",
    "tab.settings": "設定",
    "weekday.0": "日",
    "weekday.1": "月",
    "weekday.2": "火",
    "weekday.3": "水",
    "weekday.4": "木",
    "weekday.5": "金",
    "weekday.6": "土",
    "reminder.subDue": "の次回請求日が近づいています",
    "reminder.habitAtRisk": "が今日まだ未達成です",
    "reminder.streakDays": (n) => `連続${n}日が途切れます`,
    "settings.title": "設定",
    "settings.appearance": "見た目",
    "settings.appearanceDesc": "背景のテーマを選べます。アプリ全体の配色に反映されます。",
    "settings.background": "背景テーマ",
    "settings.bgImage": "背景画像",
    "settings.bgImageDesc": "好きな画像をアップロードして背景に設定できます。テーマ色はその画像の上に薄く重なるフィルターとして使われます。",
    "settings.bgImageChoose": "画像を選ぶ",
    "settings.bgImageChanging": "処理中…",
    "settings.bgImageRemove": "画像を削除してテーマ色に戻す",
    "settings.bgImageCurrent": "現在の背景画像",
    "settings.bgImageNone": "画像は設定されていません",
    "settings.bgOverlay": "フィルターの濃さ(文字の読みやすさ調整)",
    "settings.bgOverlayLight": "薄い",
    "settings.bgOverlayStrong": "濃い",
    "settings.bgSaveError": "画像が大きすぎるなどの理由でこの端末に保存できませんでした。今は表示されていますが、再読み込みすると消えます。別の画像を試すか、サイズを小さくしてください。",
    "settings.language": "言語",
    "settings.languageDesc": "アプリの表示言語を切り替えます(サイドバーや設定画面などに反映されます)。",
    "settings.languageNote": "現時点では各タブの入力画面などは日本語のままの部分があります。",
    "settings.ai": "AI設定",
    "settings.aiDesc": "端末内AI・自己ホストAI・外部APIのどれを使うかを設定します。",
    "settings.data": "データとプライバシー",
    "settings.dataDesc": "このアプリのデータは、あなたが決めたパスフレーズで端末内で暗号化されてから保存されます。サーバーは暗号文しか持てません。",
    "settings.anonId": "匿名ID",
    "settings.resetPassphrase": "パスフレーズを再設定する",
    "settings.resetPassphraseWarn": "パスフレーズを変更すると、これまでのデータは新しいパスフレーズでは復号できなくなります。本当に再設定しますか?",
    "settings.about": "このアプリについて",
  },
  en: {
    appSubtitle: "Life Management OS",
    loading: "Loading…",
    "tab.today": "Today",
    "tab.calendar": "Calendar",
    "tab.habits": "Habits",
    "tab.diary": "Diary",
    "tab.memo": "Memo",
    "tab.goals": "Goals",
    "tab.money": "Budget",
    "tab.subscriptions": "Subscriptions",
    "tab.assets": "Assets",
    "tab.ai": "AI",
    "tab.settings": "Settings",
    "weekday.0": "Sun",
    "weekday.1": "Mon",
    "weekday.2": "Tue",
    "weekday.3": "Wed",
    "weekday.4": "Thu",
    "weekday.5": "Fri",
    "weekday.6": "Sat",
    "reminder.subDue": "is due soon",
    "reminder.habitAtRisk": "hasn't been done today",
    "reminder.streakDays": (n) => `your ${n}-day streak will break`,
    "settings.title": "Settings",
    "settings.appearance": "Appearance",
    "settings.appearanceDesc": "Choose a background theme. It applies to the whole app's colors.",
    "settings.background": "Background theme",
    "settings.bgImage": "Background image",
    "settings.bgImageDesc": "Upload your own image to use as the background. The theme color is applied as a light overlay on top of it.",
    "settings.bgImageChoose": "Choose image",
    "settings.bgImageChanging": "Processing…",
    "settings.bgImageRemove": "Remove image and use theme color",
    "settings.bgImageCurrent": "Current background image",
    "settings.bgImageNone": "No image set",
    "settings.bgOverlay": "Overlay strength (for text readability)",
    "settings.bgOverlayLight": "Light",
    "settings.bgOverlayStrong": "Strong",
    "settings.bgSaveError": "Couldn't save this image on this device (it may be too large). It's showing now, but will disappear after a reload. Try a smaller image.",
    "settings.language": "Language",
    "settings.languageDesc": "Switch the app's display language (applies to the sidebar and settings screen).",
    "settings.languageNote": "Some screens inside each tab are currently still Japanese-only.",
    "settings.ai": "AI settings",
    "settings.aiDesc": "Choose whether to use on-device AI, self-hosted AI, or an external API.",
    "settings.data": "Data & privacy",
    "settings.dataDesc": "Your data is encrypted on this device with a passphrase you set, before being saved. The server only ever holds ciphertext.",
    "settings.anonId": "Anonymous ID",
    "settings.resetPassphrase": "Reset passphrase",
    "settings.resetPassphraseWarn": "Changing your passphrase means existing data can no longer be decrypted with the new one. Are you sure you want to reset it?",
    "settings.about": "About this app",
  },
};

function readStoredLang() {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY);
    return v && dict[v] ? v : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

const LanguageContext = createContext({ lang: DEFAULT_LANG, setLang: () => {} });

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(readStoredLang);

  useEffect(() => {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {}
  }, [lang]);

  const value = useMemo(
    () => ({
      lang,
      setLang: (id) => setLang(dict[id] ? id : DEFAULT_LANG),
    }),
    [lang]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}

// t("key") または t("key", arg) の形で使う
export function useT() {
  const { lang } = useContext(LanguageContext);
  return (key, ...args) => {
    const entry = (dict[lang] && dict[lang][key]) ?? dict[DEFAULT_LANG][key] ?? key;
    return typeof entry === "function" ? entry(...args) : entry;
  };
}

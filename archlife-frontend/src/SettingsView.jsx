import React, { useState, useEffect } from "react";
import { Palette, Languages, Sparkles, ShieldCheck, Check, Image as ImageIcon, X } from "lucide-react";
import { useTheme, useThemeControls, useBackgroundControls, DEFAULT_BG_OVERLAY } from "./theme.jsx";
import { useLanguage, useT, LANGUAGES } from "./i18n.jsx";
import {
  FONT_DISPLAY,
  FONT_BODY,
  FONT_MONO,
  SectionLabel,
  smallBtnStyle,
  AiSettingsPanel,
  getAnonId,
  resetPassphrase,
} from "./ArchLifeApp.jsx";

// 好きな画像を背景に設定する機能で使う。端末のlocalStorageに保存するため、
// アップロードされた画像はそのまま保存せず、いったんcanvasでリサイズ・圧縮してから
// データURL化する(そうしないと数MBの写真がそのまま保存されて容量オーバーになりやすい)。
function resizeImageToDataUrl(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("画像の読み込みに失敗しました"));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------- 設定ページ ----------
// 「見た目(背景テーマ)」「言語」「AI」「データ/プライバシー」をまとめた独立ページ。
// 以前は「AI」タブの中に埋め込まれていた実行方法の設定を、ここに集約している。

function SettingsCard({ icon, title, desc, children }) {
  const COLORS = useTheme();
  return (
    <div
      style={{
        border: `1px solid ${COLORS.line}`,
        borderRadius: 10,
        padding: 16,
        marginBottom: 16,
        background: COLORS.paperDark,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, color: COLORS.hanko }}>
        {icon}
        <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14, letterSpacing: "0.08em" }}>{title}</span>
      </div>
      {desc && (
        <p style={{ fontFamily: FONT_BODY, fontSize: 12, color: COLORS.inkFaint, marginBottom: 12, lineHeight: 1.6 }}>
          {desc}
        </p>
      )}
      {children}
    </div>
  );
}

function ThemeSwatch({ id, label, active, onClick }) {
  const COLORS = useTheme();
  // 実際のテーマ定義から見本色を取り出したいので、選択中でなくても
  // useThemeControls経由ではなく直接 THEMES を参照する簡易実装にする。
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        border: `1px solid ${active ? COLORS.hanko : COLORS.line}`,
        background: active ? COLORS.paper : "transparent",
        borderRadius: 8,
        padding: "8px 12px",
        cursor: "pointer",
        fontFamily: FONT_BODY,
        fontSize: 12.5,
        color: COLORS.ink,
      }}
    >
      <ThemeDot id={id} />
      {label}
      {active && <Check size={13} color={COLORS.hanko} />}
    </button>
  );
}

function ThemeDot({ id }) {
  // プレビュー用の小さな色見本。テーマごとの代表色をここだけ直書きする
  // (theme.js を書き換えたらここも合わせて更新する)。
  const previews = {
    washi: ["#EDE7DA", "#A13D3F"],
    sumi: ["#1E1E1C", "#D9696B"],
    ai: ["#E7EEF2", "#2F5D8A"],
    sakura: ["#F7EBEE", "#B5495B"],
  };
  const [bg, accent] = previews[id] || previews.washi;
  return (
    <span
      style={{
        display: "inline-block",
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: bg,
        border: `2px solid ${accent}`,
        flexShrink: 0,
      }}
    />
  );
}

export default function SettingsView() {
  const COLORS = useTheme();
  const t = useT();
  const { themeId, setThemeId, themes } = useThemeControls();
  const { bgImage, bgOverlay, bgSaveError, setBgImage, setBgOverlay } = useBackgroundControls();
  const { lang, setLang } = useLanguage();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [bgProcessing, setBgProcessing] = useState(false);
  const [anonId, setAnonId] = useState("…");

  useEffect(() => {
    let cancelled = false;
    getAnonId().then((id) => {
      if (!cancelled) setAnonId(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleResetPassphrase() {
    if (!confirmingReset) {
      setConfirmingReset(true);
      return;
    }
    resetPassphrase();
  }

  async function handleBgFileChange(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // 同じファイルを選び直しても onChange が発火するようにする
    if (!file) return;
    setBgProcessing(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setBgImage(dataUrl);
    } catch {
      // 読み込み失敗時は何もしない(元の背景のまま)
    } finally {
      setBgProcessing(false);
    }
  }

  return (
    <div>
      <SectionLabel icon={<Sparkles size={15} />} label={t("settings.title")} />

      <SettingsCard
        icon={<Palette size={15} />}
        title={t("settings.appearance")}
        desc={t("settings.appearanceDesc")}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {themes.map((th) => (
            <ThemeSwatch
              key={th.id}
              id={th.id}
              label={th.label}
              active={th.id === themeId}
              onClick={() => setThemeId(th.id)}
            />
          ))}
        </div>
      </SettingsCard>

      <SettingsCard icon={<ImageIcon size={15} />} title={t("settings.bgImage")} desc={t("settings.bgImageDesc")}>
        {bgImage ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
            <img
              src={bgImage}
              alt={t("settings.bgImageCurrent")}
              style={{
                width: 84,
                height: 56,
                objectFit: "cover",
                borderRadius: 6,
                border: `1px solid ${COLORS.line}`,
              }}
            />
            <button
              onClick={() => setBgImage(null)}
              style={{ ...smallBtnStyle, display: "flex", alignItems: "center", gap: 4, padding: "6px 10px" }}
            >
              <X size={12} />
              {t("settings.bgImageRemove")}
            </button>
          </div>
        ) : (
          <p style={{ fontFamily: FONT_BODY, fontSize: 12, color: COLORS.inkFaint, marginBottom: 12, fontStyle: "italic" }}>
            {t("settings.bgImageNone")}
          </p>
        )}

        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            border: `1px solid ${COLORS.ink}`,
            color: COLORS.ink,
            borderRadius: 6,
            padding: "7px 14px",
            cursor: bgProcessing ? "not-allowed" : "pointer",
            fontFamily: FONT_BODY,
            fontSize: 12.5,
            opacity: bgProcessing ? 0.6 : 1,
          }}
        >
          <ImageIcon size={13} />
          {bgProcessing ? t("settings.bgImageChanging") : t("settings.bgImageChoose")}
          <input
            type="file"
            accept="image/*"
            onChange={handleBgFileChange}
            disabled={bgProcessing}
            style={{ display: "none" }}
          />
        </label>

        {bgImage && (
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                fontFamily: FONT_BODY,
                fontSize: 11.5,
                color: COLORS.inkFaint,
                marginBottom: 6,
              }}
            >
              {t("settings.bgOverlay")}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: COLORS.inkFaint }}>
                {t("settings.bgOverlayLight")}
              </span>
              <input
                type="range"
                min={0.3}
                max={0.95}
                step={0.01}
                value={bgOverlay ?? DEFAULT_BG_OVERLAY}
                onChange={(e) => setBgOverlay(Number(e.target.value))}
                style={{ flex: 1, accentColor: COLORS.hanko }}
              />
              <span style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: COLORS.inkFaint }}>
                {t("settings.bgOverlayStrong")}
              </span>
            </div>
          </div>
        )}

        {bgSaveError && (
          <p style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: COLORS.hanko, marginTop: 10, lineHeight: 1.6 }}>
            {t("settings.bgSaveError")}
          </p>
        )}
      </SettingsCard>

      <SettingsCard
        icon={<Languages size={15} />}
        title={t("settings.language")}
        desc={t("settings.languageDesc")}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          {LANGUAGES.map((l) => (
            <button
              key={l.id}
              onClick={() => setLang(l.id)}
              style={{
                border: `1px solid ${l.id === lang ? COLORS.hanko : COLORS.line}`,
                background: l.id === lang ? COLORS.paper : "transparent",
                color: COLORS.ink,
                borderRadius: 8,
                padding: "8px 14px",
                cursor: "pointer",
                fontFamily: FONT_BODY,
                fontSize: 12.5,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {l.label}
              {l.id === lang && <Check size={13} color={COLORS.hanko} />}
            </button>
          ))}
        </div>
        <p style={{ fontFamily: FONT_BODY, fontSize: 11, color: COLORS.inkFaint, fontStyle: "italic" }}>
          {t("settings.languageNote")}
        </p>
      </SettingsCard>

      <SettingsCard icon={<Sparkles size={15} />} title={t("settings.ai")} desc={t("settings.aiDesc")}>
        <AiSettingsPanel />
      </SettingsCard>

      <SettingsCard
        icon={<ShieldCheck size={15} />}
        title={t("settings.data")}
        desc={t("settings.dataDesc")}
      >
        <p
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: COLORS.inkFaint,
            marginBottom: 12,
            wordBreak: "break-all",
          }}
        >
          {t("settings.anonId")}: {anonId}
        </p>
        {confirmingReset && (
          <p style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: COLORS.hanko, marginBottom: 8, lineHeight: 1.6 }}>
            {t("settings.resetPassphraseWarn")}
          </p>
        )}
        <button
          onClick={handleResetPassphrase}
          style={{
            ...smallBtnStyle,
            padding: "6px 12px",
            fontSize: 11.5,
            color: confirmingReset ? "#fff" : COLORS.inkFaint,
            background: confirmingReset ? COLORS.hanko : "transparent",
            borderColor: confirmingReset ? COLORS.hanko : COLORS.line,
          }}
        >
          {t("settings.resetPassphrase")}
        </button>
        {confirmingReset && (
          <button
            onClick={() => setConfirmingReset(false)}
            style={{ ...smallBtnStyle, marginLeft: 8, padding: "6px 12px", fontSize: 11.5 }}
          >
            ×
          </button>
        )}
      </SettingsCard>
    </div>
  );
}

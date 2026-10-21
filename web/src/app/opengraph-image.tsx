import { ImageResponse } from "next/og";

/*
 * The card a shared link shows: the question the home page opens with, and a small drawing of the
 * one thing it does (a published slot, a tested slot, and the time the two share getting shorter).
 * No index, festival or figure, because a shared link may point at either published day.
 * Rendered once at build time in Archivo, the site's one family (the cuts are at the end of this file);
 * colors are the dark theme's.
 */

export const alt = "Clash Control: which clash is worth moving?";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BACKGROUND = "#0a0e15";
const FOREGROUND = "#eceff2";
const MUTED = "#aab2bd";
// Raspberry, the dark theme's shared-time colour: used on the two shared-time bands and nowhere else.
const ACCENT = "#f180b5";
const BORDER = "#323843";

/** The site mark (components/site/logo-mark.tsx): a solid set slot and its moved place as an outline, in ink only. */
function Mark() {
  return (
    <svg width="72" height="72" viewBox="0 0 32 32">
      <path
        fill={FOREGROUND}
        d="M9 3h9.5a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-7a1.5 1.5 0 0 0-1.5 1.5v16.5a1 1 0 0 1-1 1a6 6 0 0 1-6-6v-14a6 6 0 0 1 6-6z"
      />
      <path
        fill="none"
        stroke={FOREGROUND}
        strokeWidth="2"
        strokeLinejoin="round"
        d="M23 28h-9.5a.5.5 0 0 1-.5-.5v-4a.5.5 0 0 1 .5-.5h7a2.5 2.5 0 0 0 2.5-2.5v-16.5a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5z"
      />
    </svg>
  );
}

/**
 * Two stage rows on one time axis: the published slot is solid, the tested slot is dashed (in ink: it is
 * a set) and a short raspberry band is the time the two share, shorter in the second row.
 */
function SlotDiagram() {
  const label = { display: "flex", fontSize: 20, letterSpacing: 0, color: MUTED } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 400 }}>
      <div style={label}>Published</div>
      <svg width="400" height="110" viewBox="0 0 400 110">
        <rect x="0" y="8" width="216" height="34" rx="6" fill={FOREGROUND} />
        <rect x="1.5" y="54" width="297" height="34" rx="6" fill={BACKGROUND} stroke={FOREGROUND} strokeWidth="3" />
        <rect x="0" y="98" width="216" height="10" rx="5" fill={ACCENT} />
      </svg>
      <div style={{ ...label, marginTop: 18 }}>Tested move</div>
      <svg width="400" height="110" viewBox="0 0 400 110">
        <rect x="0" y="8" width="216" height="34" rx="6" fill={FOREGROUND} />
        <rect
          x="85"
          y="54"
          width="298"
          height="34"
          rx="6"
          fill={BACKGROUND}
          stroke={FOREGROUND}
          strokeWidth="3.5"
          strokeDasharray="12 8"
        />
        <rect x="84" y="98" width="132" height="10" rx="5" fill={ACCENT} />
      </svg>
    </div>
  );
}

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BACKGROUND,
          color: FOREGROUND,
          fontFamily: "Archivo",
          padding: "64px 84px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <Mark />
          {/* The wordmark and the question at the site's display weight (type-wordmark, type-display). */}
          <div style={{ fontSize: 44, fontWeight: 600, letterSpacing: "-0.01em" }}>Clash Control</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 92,
              fontWeight: 600,
              lineHeight: 1.02,
              letterSpacing: "-0.034em",
              width: 640,
            }}
          >
            <div>Which clash</div>
            <div>is worth</div>
            <div>moving?</div>
          </div>
          <SlotDiagram />
        </div>

        <div
          style={{
            display: "flex",
            paddingTop: 24,
            borderTop: `2px solid ${BORDER}`,
            fontSize: 30,
            lineHeight: 1.3,
            color: MUTED,
          }}
        >
          Published-day examples · Qloo-derived taste rank, not attendance.
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Archivo", data: Buffer.from(ARCHIVO_400, "base64"), weight: 400, style: "normal" },
        // Drawn at 620, the site's display weight; listed as 600, the nearest weight the renderer names.
        { name: "Archivo", data: Buffer.from(ARCHIVO_620, "base64"), weight: 600, style: "normal" },
      ],
    },
  );
}

/*
 * Archivo, cut from the site's own Archivo build asset (next/font) at width 100 and two weights: 400 for
 * the labels and the caption, and 620 for the name and the question. Each keeps printable ASCII and the
 * middle dot, which is every character the card prints, with its kerning, as WOFF (about 8 KB each). A
 * character outside that set would send the renderer to another host for a fallback font, so keep the
 * card's words inside it.
 * Archivo: Copyright 2020 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo),
 * licensed under the SIL Open Font License 1.1 (https://openfontlicense.org).
 */
const ARCHIVO_400 = "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";
const ARCHIVO_620 = "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";

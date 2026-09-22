import { m } from "framer-motion";
import { Link } from "react-router-dom";
import { T, font } from "../lib/theme.js";
import Icon from "./Icon.jsx";

export const FEEDBACK_URL =
  "https://github.com/okhalifa-official/cf-performance-feedback/discussions";

// Bug reports go to their own category, so they are not mixed in with feature
// ideas and can be triaged first.
export const BUG_REPORT_URL =
  "https://github.com/okhalifa-official/cf-performance-feedback/discussions/categories/bug-reports";

/** Site-wide footer. Its job is the feedback link: the analyzer is judged on
 *  whether its recommendations feel right, and that only comes from users
 *  saying so. The link leaves the app, so it is marked as external and opens
 *  in a new tab rather than losing an in-progress analysis. */
export default function Footer() {
  return (
    <footer style={{
      borderTop: `1px solid ${T.border}`,
      marginTop: 64, padding: "28px 22px 34px",
    }}>
      <div style={{
        maxWidth: 1240, margin: "0 auto",
        display: "flex", flexWrap: "wrap", gap: 16,
        alignItems: "center", justifyContent: "space-between",
      }}>
        <p style={{
          margin: 0, fontSize: 12.5, color: T.textFaint,
          fontFamily: font.sans, lineHeight: 1.6,
        }}>
          {/* The landing page carries the full disclaimer directly above this,
              so repeating it there would read as a stutter. Inside the app
              there is no other notice, which is where this line earns its
              place. */}
          Found a problem, or want something added? Tell us.
        </p>

        <Link to="/terms" style={{
          fontSize: 12.5, color: T.textFaint, textDecoration: "none",
          fontFamily: font.sans,
        }}>
          Terms
        </Link>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <ReportIssueButton size="sm" />
          <FeedbackButton size="sm" />
        </div>
      </div>
    </footer>
  );
}

/** Also exported on its own so pages can place the call to action inline
 *  (the dashboard puts one under a finished run, where the user has just
 *  formed an opinion and is most likely to share it). */
export function FeedbackButton({ label = "Send feedback", size = "md" }) {
  const pad = size === "sm" ? "7px 13px" : "9px 16px";
  const fs  = size === "sm" ? 12.5 : 13.5;
  return (
    <m.a
      href={FEEDBACK_URL}
      target="_blank"
      rel="noopener noreferrer"
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.97 }}
      style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        padding: pad, borderRadius: 9, textDecoration: "none",
        fontFamily: font.sans, fontSize: fs, fontWeight: 600,
        color: T.text, background: T.surface,
        border: `1px solid ${T.border}`,
      }}
    >
      <span style={{ color: T.accent, display: "flex" }}>
        <Icon name="chat" size={15} strokeWidth={1.8} />
      </span>
      {label}
      <span style={{ color: T.textFaint, display: "flex" }}>
        <Icon name="external" size={12} strokeWidth={1.9} />
      </span>
    </m.a>
  );
}

/** Links to the bug-reports category specifically. Offered where something has
 *  visibly gone wrong — a refused payment, a failed analysis — so the report
 *  arrives with the context still fresh. */
export function ReportIssueButton({ label = "Report an issue", size = "md" }) {
  const pad = size === "sm" ? "7px 13px" : "9px 16px";
  const fs  = size === "sm" ? 12.5 : 13.5;
  return (
    <m.a
      href={BUG_REPORT_URL}
      target="_blank"
      rel="noopener noreferrer"
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.97 }}
      style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        padding: pad, borderRadius: 9, textDecoration: "none",
        fontFamily: font.sans, fontSize: fs, fontWeight: 600,
        color: T.text, background: T.surface,
        border: `1px solid ${T.border}`,
      }}
    >
      <span style={{ color: T.warn, display: "flex" }}>
        <Icon name="alert" size={14} strokeWidth={1.9} />
      </span>
      {label}
      <span style={{ color: T.textFaint, display: "flex" }}>
        <Icon name="external" size={12} strokeWidth={1.9} />
      </span>
    </m.a>
  );
}

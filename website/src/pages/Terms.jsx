import { T } from "../lib/theme.js";
import { Card } from "../components/ui.jsx";
import { FEEDBACK_URL } from "../components/Footer.jsx";

// Kept in step with TERMS_VERSION in server/routes/auth.js, which is what each
// account records at sign-up.
const VERSION = "2026-09-22";

const SECTIONS = [
  {
    h: "What this service is",
    p: [
      "CFAnalyzer reads publicly available Codeforces data through the official Codeforces API and produces an assessment of your strengths, weaknesses and suggested practice problems.",
      "It is an independent project. It is not built, endorsed or sponsored by Codeforces or its developers, and it is not affiliated with them in any way.",
    ],
  },
  {
    h: "Your account",
    p: [
      "You need a working email address, which we ask you to confirm with a code before the analyzer can be used. One person should hold one account.",
      "Your email address is fixed once the account exists. If you need it changed, contact us on the discussion channel and we will do it for you.",
      "Your Codeforces handle may be changed once every six months. Analysing a handle other than your own is limited: once every three months on the free tier, once a week on Plus.",
      "You are responsible for keeping your password to yourself and for what happens under your account.",
    ],
  },
  {
    h: "Plus subscriptions and payment",
    p: [
      "Plus is sold in fixed terms of one, three or six months. Payment is by InstaPay transfer, confirmed by uploading the receipt and entering its reference number.",
      "An approved payment adds its term to any time you already have. Terms do not renew automatically and nothing is charged to you without you sending a transfer.",
      "One transfer may be submitted per day, and each transaction reference may be used once.",
      "If an automatic check cannot confirm a payment, it goes to manual review. If something has gone wrong with a payment, contact us and we will sort it out.",
    ],
  },
  {
    h: "What we cannot promise",
    p: [
      "The analysis is a model's estimate, not advice and not a prediction. Ratings, recommended problems and coaching plans may be wrong, and acting on them is your decision.",
      "The service depends on the Codeforces API and on our own infrastructure. It may be unavailable, and results may change as the model is retrained.",
    ],
  },
  {
    h: "Your data",
    p: [
      "We store your email address, your Codeforces handle, your analyses and your payment records. Submitted payment screenshots are kept so payments can be reviewed and disputed.",
      "We do not sell your data. Analyses are visible to you and to administrators of this service.",
      "You may ask us to delete your account and its data through the discussion channel.",
    ],
  },
  {
    h: "Acceptable use",
    p: [
      "Do not attempt to bypass the limits described here, submit payment receipts that are not yours, or use the service to place load on Codeforces.",
      "Accounts that do may be suspended.",
    ],
  },
  {
    h: "Changes",
    p: [
      "These terms may change. The version you agreed to is recorded against your account, and material changes will be announced on the discussion channel.",
    ],
  },
];

export default function Terms() {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "48px 22px 20px" }}>
      <h1 style={{ fontSize: 30, fontWeight: 780, margin: "0 0 8px",
                   letterSpacing: -0.8 }}>
        Terms and Conditions
      </h1>
      <p style={{ color: T.textFaint, fontSize: 13, margin: "0 0 30px" }}>
        Version {VERSION}. Creating an account means accepting these terms.
      </p>

      <Card style={{ padding: 28 }}>
        {SECTIONS.map((s, i) => (
          <section key={s.h} style={{ marginBottom: i === SECTIONS.length - 1 ? 0 : 26 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 10px" }}>
              {s.h}
            </h2>
            {s.p.map((line) => (
              <p key={line} style={{ margin: "0 0 10px", fontSize: 14,
                                     color: T.textDim, lineHeight: 1.7 }}>
                {line}
              </p>
            ))}
          </section>
        ))}
      </Card>

      <p style={{ fontSize: 13, color: T.textFaint, lineHeight: 1.7,
                  margin: "22px 0 0" }}>
        Questions about any of this?{" "}
        <a href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer"
           style={{ color: T.accent, fontWeight: 600, textDecoration: "none" }}>
          Ask on the discussion channel
        </a>.
      </p>
    </div>
  );
}

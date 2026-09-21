import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { m, LazyMotion, domAnimation } from "framer-motion";
import { AuthProvider, useAuth } from "./lib/auth.jsx";
import { T, font } from "./lib/theme.js";
import { Button, Spinner } from "./components/ui.jsx";
import Landing from "./pages/Landing.jsx";
import { Login, Signup } from "./pages/Auth.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Profile from "./pages/Profile.jsx";
import Admin from "./pages/Admin.jsx";

export default function App() {
  return (
    <AuthProvider>
      {/* LazyMotion + the lightweight `m` component keep the animation engine
          out of the initial bundle: it is fetched once, in parallel, instead of
          blocking first paint. */}
      <LazyMotion features={domAnimation} strict>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </LazyMotion>
    </AuthProvider>
  );
}

function Shell() {
  const { ready } = useAuth();
  if (!ready) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center",
                    background: T.bg }}>
        <Spinner size={26} color={T.accent} />
      </div>
    );
  }
  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text,
                  fontFamily: font.sans }}>
      <Nav />
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/login"  element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/signup" element={<GuestOnly><Signup /></GuestOnly>} />
        <Route path="/dashboard" element={<Private><Dashboard /></Private>} />
        <Route path="/profile"   element={<Private><Profile /></Private>} />
        <Route path="/admin"     element={<AdminOnly><Admin /></AdminOnly>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

function HomeRoute() {
  const { user, accountsEnabled } = useAuth();
  if (!accountsEnabled) return <Navigate to="/dashboard" replace />;
  if (user) return <Navigate to={user.role === "admin" ? "/admin" : "/dashboard"} replace />;
  return <Landing />;
}

function Private({ children }) {
  const { user, accountsEnabled } = useAuth();
  const loc = useLocation();
  // When the deployment has no database, accounts are switched off entirely
  // and the analyzer stays usable anonymously. Guarding here would otherwise
  // lock everyone out of the only working page.
  if (!accountsEnabled) return children;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return children;
}

function AdminOnly({ children }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  // Non-admins are sent away rather than shown a refusal, matching the API,
  // which 404s the admin surface for them.
  if (user.role !== "admin") return <Navigate to="/dashboard" replace />;
  return children;
}

function GuestOnly({ children }) {
  const { user } = useAuth();
  if (user) return <Navigate to={user.role === "admin" ? "/admin" : "/dashboard"} replace />;
  return children;
}

function Nav() {
  const { user, logout, isAdmin, accountsEnabled } = useAuth();
  const loc = useLocation();
  const link = (to, label) => (
    <Link key={to} to={to} style={{
      fontSize: 14, fontWeight: 600, textDecoration: "none", padding: "7px 12px",
      borderRadius: 8, color: loc.pathname === to ? T.text : T.textDim,
      background: loc.pathname === to ? T.surfaceHi : "transparent",
    }}>{label}</Link>
  );

  return (
    <m.header
      initial={{ y: -14, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4 }}
      style={{
        position: "sticky", top: 0, zIndex: 100,
        borderBottom: `1px solid ${T.border}`,
        background: `${T.bg}e8`, backdropFilter: "blur(12px)",
      }}
    >
      <div style={{
        maxWidth: 1240, margin: "0 auto", padding: "13px 22px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 16,
      }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 10,
                              textDecoration: "none", color: T.text }}>
          <div style={{
            width: 27, height: 27, borderRadius: 8,
            background: `linear-gradient(135deg, ${T.accent}, ${T.violet})`,
          }} />
          <span style={{ fontWeight: 750, fontSize: 15.5, letterSpacing: -0.3 }}>
            Codeforces Analyzer
          </span>
        </Link>

        <nav style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {!accountsEnabled ? null : user ? (
            <>
              {link("/dashboard", "Analyse")}
              {isAdmin && link("/admin", "Admin")}
              {link("/profile", "Profile")}
              <Button size="sm" variant="ghost" onClick={logout}
                      style={{ marginLeft: 6 }}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Link to="/login"><Button size="sm" variant="ghost">Sign in</Button></Link>
              <Link to="/signup"><Button size="sm">Get started</Button></Link>
            </>
          )}
        </nav>
      </div>
    </m.header>
  );
}

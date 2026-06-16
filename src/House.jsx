import React, { useState, useMemo, useEffect } from "react";
import { supabase } from "./supabase.js";

/* =========================================================================
   ABODE — shared housing search
   Production build: Supabase auth + DB, /api/enrich serverless function.
   ========================================================================= */

const DISPLAY_NAMES = {
  "gllsadrien@gmail.com": "Adrien",
  "charlotte.goffinet@edhec.com": "Charlotte",
};

const fmtPrice = (n) =>
  n == null ? "—" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

const fmtDate = (iso) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(new Date(iso));

const hostOf = (url) => {
  try { return new URL(url).hostname.replace("www.", ""); } catch { return ""; }
};

export default function House() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [listings, setListings] = useState([]);
  const [sortBy, setSortBy] = useState("date");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  const fetchListings = async () => {
    const { data } = await supabase.from("listings").select("*").order("created_at", { ascending: false });
    setListings(data ?? []);
  };

  useEffect(() => {
    if (!session) return;
    fetchListings();
    const channel = supabase
      .channel("listings")
      .on("postgres_changes", { event: "*", schema: "public", table: "listings" }, fetchListings)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session]);

  const owners = useMemo(
    () => Array.from(new Set(listings.map((l) => l.added_by))),
    [listings]
  );

  const view = useMemo(() => {
    let v = [...listings];
    if (ownerFilter !== "all") v = v.filter((l) => l.added_by === ownerFilter);
    if (sortBy === "date") v.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (sortBy === "owner") v.sort((a, b) => a.added_by.localeCompare(b.added_by) || new Date(b.created_at) - new Date(a.created_at));
    if (sortBy === "price") v.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    return v;
  }, [listings, sortBy, ownerFilter]);

  const addListing = async (obj) => {
    const { data: { user } } = await supabase.auth.getUser();
    const added_by = DISPLAY_NAMES[user.email] ?? user.email;
    await supabase.from("listings").insert({ ...obj, added_by });
  };

  const removeListing = async (id) => {
    await supabase.from("listings").delete().eq("id", id);
  };

  if (authLoading) return <div style={{ minHeight: "100vh", background: "var(--bg)" }}><style>{CSS}</style></div>;
  if (!session) return <LoginScreen />;

  return (
    <div style={S.root}>
      <style>{CSS}</style>

      {/* Top bar */}
      <header style={S.bar}>
        <div style={S.brand}>
          <span style={S.mark}>◴</span>
          <span style={S.wordmark}>House</span>
          <span style={S.sub}>· votre recherche, à deux</span>
        </div>
        <button style={S.addBtn} className="addBtn" onClick={() => setSheetOpen(true)}>
          <span style={{ fontSize: 17, lineHeight: 0, marginTop: -1 }}>+</span> Ajouter une annonce
        </button>
      </header>

      {/* Controls */}
      <div style={S.controls}>
        <div style={S.segGroup}>
          <span style={S.ctrlLabel}>Trier</span>
          {[["date", "Date"], ["owner", "Ajouté par"], ["price", "Prix"]].map(([k, label]) => (
            <button key={k} onClick={() => setSortBy(k)} className="seg" style={{ ...S.seg, ...(sortBy === k ? S.segOn : {}) }}>
              {label}
            </button>
          ))}
        </div>
        <div style={S.segGroup}>
          <span style={S.ctrlLabel}>Qui</span>
          <button onClick={() => setOwnerFilter("all")} className="seg" style={{ ...S.seg, ...(ownerFilter === "all" ? S.segOn : {}) }}>Tous</button>
          {owners.map((o) => (
            <button key={o} onClick={() => setOwnerFilter(o)} className="seg" style={{ ...S.seg, ...(ownerFilter === o ? S.segOn : {}) }}>{o}</button>
          ))}
        </div>
        <span style={S.count}>{view.length} bien{view.length > 1 ? "s" : ""}</span>
      </div>

      {/* Grid — solid cards */}
      <main style={S.grid}>
        {view.length === 0 && (
          <div style={S.empty}>
            <p style={{ margin: 0, fontSize: 15, color: "var(--ink-2)" }}>Rien ici pour ce filtre.</p>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-3)" }}>Changez le filtre, ou ajoutez une annonce.</p>
          </div>
        )}
        {view.map((l) => (
          <article key={l.id} style={S.card} className="card">
            <div style={S.thumbWrap}>
              {l.image_url ? <img src={l.image_url} alt="" style={S.thumb} /> : <div style={S.thumbFallback}>pas d'image</div>}
              <span style={S.owner} className="ownerPill">{l.added_by}</span>
            </div>
            <div style={S.cardBody}>
              <div style={S.priceRow}>
                <span style={S.price}>{fmtPrice(l.price)}</span>
                <span style={S.meta}>{[l.surface && `${l.surface} m²`, l.rooms && `${l.rooms} p.`].filter(Boolean).join(" · ")}</span>
              </div>
              <h3 style={S.title}>{l.title || hostOf(l.url)}</h3>
              <p style={S.loc}>{l.location || "—"}</p>
              {l.notes && <p style={S.notes}>{l.notes}</p>}
              <div style={S.cardFoot}>
                <a href={l.url} target="_blank" rel="noreferrer" style={S.link} className="link">{hostOf(l.url)} ↗</a>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={S.date}>{fmtDate(l.created_at)}</span>
                  <button onClick={() => removeListing(l.id)} style={S.del} className="del" aria-label="Supprimer">✕</button>
                </div>
              </div>
            </div>
          </article>
        ))}
      </main>

      {sheetOpen && <AddSheet onClose={() => setSheetOpen(false)} onAdd={addListing} />}
    </div>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const send = async () => {
    await supabase.auth.signInWithOtp({ email });
    setSent(true);
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "grid", placeItems: "center", fontFamily: "'Inter', -apple-system, system-ui, sans-serif" }}>
      <style>{CSS}</style>
      <div style={{ borderRadius: 20, padding: 32, width: "min(400px, 90vw)", background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 8px 40px rgba(0,0,0,.10)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <span style={{ fontSize: 24, color: "var(--green)" }}>◴</span>
          <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--ink-1)" }}>House</span>
        </div>
        {sent ? (
          <p style={{ color: "var(--ink-1)", fontSize: 15, margin: 0 }}>Lien envoyé — vérifie ta boîte mail.</p>
        ) : (
          <>
            <p style={{ color: "var(--ink-2)", fontSize: 14, margin: "0 0 16px" }}>Entre ton adresse email pour recevoir un lien de connexion.</p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && email && send()}
              placeholder="ton@email.com"
              style={{ ...S.input, width: "100%", marginBottom: 12 }}
              className="input"
            />
            <button
              onClick={send}
              disabled={!email}
              style={{ ...S.addBtn, width: "100%", justifyContent: "center", ...(!email ? S.disabled : {}) }}
              className="addBtn"
            >
              Envoyer le lien
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function AddSheet({ onClose, onAdd }) {
  const [url, setUrl] = useState("");
  const [busyType, setBusyType] = useState(null);
  const [enriched, setEnriched] = useState(false);
  const [form, setForm] = useState({ title: "", image_url: "", price: "", location: "", surface: "", rooms: "", notes: "" });

  const busy = busyType !== null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const doEnrich = async () => {
    if (!url) return;
    setBusyType("url");
    try {
      const res = await fetch(`/api/enrich?url=${encodeURIComponent(url)}`);
      const data = res.ok ? await res.json() : {};
      setForm((f) => ({
        ...f,
        title: data.title || f.title,
        image_url: data.image_url || f.image_url,
        price: data.price ?? f.price,
        location: data.location || f.location,
        surface: data.surface ?? f.surface,
        rooms: data.rooms ?? f.rooms,
      }));
    } catch {}
    setEnriched(true);
    setBusyType(null);
  };

  const handleScreenshot = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusyType("screenshot");

    // Upload to Supabase Storage → becomes the card image
    const path = `listings/${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, "_")}`;
    const { error } = await supabase.storage.from("screenshots").upload(path, file);
    if (!error) {
      const { data: { publicUrl } } = supabase.storage.from("screenshots").getPublicUrl(path);
      setForm((f) => ({ ...f, image_url: publicUrl }));
    }

    // Extract fields via Claude vision
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const base64 = ev.target.result.split(",")[1];
        const res = await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64, mediaType: file.type }),
        });
        if (res.ok) {
          const data = await res.json();
          setForm((f) => ({
            ...f,
            title: data.title || f.title,
            price: data.price != null ? data.price : f.price,
            location: data.location || f.location,
            surface: data.surface != null ? data.surface : f.surface,
            rooms: data.rooms != null ? data.rooms : f.rooms,
          }));
        }
      } catch {}
      setEnriched(true);
      setBusyType(null);
    };
    reader.readAsDataURL(file);
  };

  const save = () => {
    if (!url) return;
    onAdd({
      url,
      title: form.title.trim(),
      image_url: form.image_url.trim(),
      price: form.price === "" ? null : Number(form.price),
      location: form.location.trim(),
      surface: form.surface === "" ? null : Number(form.surface),
      rooms: form.rooms === "" ? null : Number(form.rooms),
      notes: form.notes.trim(),
    });
    onClose();
  };

  return (
    <div style={S.scrim} onClick={onClose}>
      <div style={S.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={S.sheetHead}>
          <h2 style={S.sheetTitle}>Ajouter une annonce</h2>
          <button onClick={onClose} style={S.sheetX} className="del">✕</button>
        </div>

        <label style={S.fieldLabel}>Lien de l'annonce</label>
        <div style={S.urlRow}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Collez l'URL (Leboncoin, SeLoger, PAP…)" style={S.input} className="input" />
          <button onClick={doEnrich} disabled={!url || busy} style={{ ...S.fetchBtn, ...((!url || busy) ? S.disabled : {}) }} className="fetchBtn">
            {busyType === "url" ? "Lecture…" : "Récupérer"}
          </button>
        </div>

        <div style={S.orDivider}>
          <div style={S.orLine} /><span style={S.orText}>ou</span><div style={S.orLine} />
        </div>

        <label style={{ display: "block", cursor: busy ? "not-allowed" : "pointer" }}>
          <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleScreenshot} disabled={busy} />
          <span className="fetchBtn" style={{ ...S.screenshotBtn, ...(busy ? S.disabled : {}) }}>
            {busyType === "screenshot" ? "Analyse en cours…" : "Importer une capture d'écran"}
          </span>
        </label>

        {enriched && <p style={S.hint}>On a pré-rempli ce qu'on a pu lire. Complétez ou corrigez ci-dessous.</p>}

        <div style={S.formGrid}>
          <Field label="Titre" full><input value={form.title} onChange={set("title")} style={S.input} className="input" /></Field>
          <Field label="Prix (€)"><input value={form.price} onChange={set("price")} inputMode="numeric" style={S.input} className="input" /></Field>
          <Field label="Surface (m²)"><input value={form.surface} onChange={set("surface")} inputMode="numeric" style={S.input} className="input" /></Field>
          <Field label="Localisation"><input value={form.location} onChange={set("location")} style={S.input} className="input" /></Field>
          <Field label="Pièces"><input value={form.rooms} onChange={set("rooms")} inputMode="numeric" style={S.input} className="input" /></Field>
          <Field label="Notes" full><textarea value={form.notes} onChange={set("notes")} rows={2} style={{ ...S.input, resize: "vertical" }} className="input" /></Field>
        </div>

        <div style={S.sheetFoot}>
          <button onClick={onClose} style={S.ghost} className="ghost">Annuler</button>
          <button onClick={save} disabled={!url} style={{ ...S.addBtn, ...(!url ? S.disabled : {}) }} className="addBtn">Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, full }) {
  return (
    <div style={{ gridColumn: full ? "1 / -1" : "auto", display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={S.fieldLabel}>{label}</label>
      {children}
    </div>
  );
}

/* ----------------------------- styling ----------------------------- */
const CSS = `
:root{
  --bg:#f4f6f9; --ink-1:#1a202c; --ink-2:#4a5568; --ink-3:#9ca3af;
  --surface:#ffffff; --border:#e2e8f0;
  --card:#ffffff; --card-shadow:0 2px 12px rgba(0,0,0,.07);
  --green:#2d6a4f; --green-dim:#edf4f0; --green-ink:#ffffff;
}
*{box-sizing:border-box}
.seg{cursor:pointer;transition:all .15s ease}
.seg:hover{color:var(--ink-1);background:var(--green-dim)}
.addBtn{cursor:pointer;transition:transform .12s ease, filter .15s ease}
.addBtn:hover{filter:brightness(1.07)} .addBtn:active{transform:scale(.97)}
.fetchBtn{cursor:pointer;transition:filter .15s} .fetchBtn:hover{filter:brightness(1.08)}
.ghost{cursor:pointer;transition:color .15s,border-color .15s} .ghost:hover{color:var(--ink-1);border-color:var(--ink-2)}
.card{transition:transform .18s cubic-bezier(.2,.7,.3,1), box-shadow .18s ease}
.card:hover{transform:translateY(-3px); box-shadow:0 16px 36px rgba(0,0,0,.13)}
.card:hover .ownerPill{opacity:1}
.link{transition:color .15s} .link:hover{color:var(--green)}
.del{cursor:pointer;opacity:.35;transition:opacity .15s} .del:hover{opacity:.8}
.input{transition:border-color .15s, background .15s}
.input:focus{outline:none;border-color:var(--green);background:#f5fcf8}
@media (prefers-reduced-motion: reduce){ *{transition:none!important} }
`;

const S = {
  root: { minHeight: "100vh", fontFamily: "'Inter', -apple-system, system-ui, sans-serif", color: "var(--ink-1)", background: "var(--bg)", paddingBottom: 60 },

  bar: { position: "sticky", top: 0, zIndex: 20, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px", background: "var(--surface)", borderBottom: "1px solid var(--border)", boxShadow: "0 1px 8px rgba(0,0,0,.05)" },
  brand: { display: "flex", alignItems: "center", gap: 9 },
  mark: { fontSize: 22, color: "var(--green)" },
  wordmark: { fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--ink-1)" },
  sub: { fontSize: 13, color: "var(--ink-3)" },
  addBtn: { display: "inline-flex", alignItems: "center", gap: 7, background: "var(--green)", color: "var(--green-ink)", border: "none", borderRadius: 11, padding: "10px 17px", fontSize: 14, fontWeight: 600, fontFamily: "inherit" },

  controls: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18, margin: "20px 24px", padding: "12px 18px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 1px 6px rgba(0,0,0,.04)" },
  segGroup: { display: "inline-flex", alignItems: "center", gap: 4 },
  ctrlLabel: { fontSize: 12, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".08em", marginRight: 6 },
  seg: { background: "transparent", border: "none", color: "var(--ink-2)", fontSize: 13.5, fontWeight: 500, padding: "6px 12px", borderRadius: 8, fontFamily: "inherit" },
  segOn: { background: "var(--green-dim)", color: "var(--green)", fontWeight: 600 },
  count: { marginLeft: "auto", fontSize: 13, color: "var(--ink-3)" },

  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 20, padding: "0 24px" },
  empty: { gridColumn: "1 / -1", textAlign: "center", padding: "80px 0" },

  card: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 18, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "var(--card-shadow)" },
  thumbWrap: { position: "relative", aspectRatio: "16/9", background: "#e8edf2" },
  thumb: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  thumbFallback: { width: "100%", height: "100%", display: "grid", placeItems: "center", color: "var(--ink-3)", fontSize: 13 },
  owner: { position: "absolute", bottom: 10, left: 10, fontSize: 11.5, fontWeight: 600, padding: "4px 10px", borderRadius: 99, background: "rgba(0,0,0,.52)", backdropFilter: "blur(8px)", color: "#fff", border: "1px solid rgba(255,255,255,.18)", opacity: .9 },
  cardBody: { padding: "16px 18px 18px", display: "flex", flexDirection: "column", gap: 6 },
  priceRow: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 },
  price: { fontSize: 21, fontWeight: 700, letterSpacing: "-0.025em", color: "var(--ink-1)" },
  meta: { fontSize: 12.5, color: "var(--ink-3)", fontWeight: 500 },
  title: { margin: 0, fontSize: 14.5, fontWeight: 600, lineHeight: 1.35, color: "var(--ink-1)" },
  loc: { margin: 0, fontSize: 13, color: "var(--ink-2)" },
  notes: { margin: "2px 0 0", fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.45, fontStyle: "italic" },
  cardFoot: { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6, paddingTop: 12, borderTop: "1px solid var(--border)" },
  link: { fontSize: 12, color: "var(--ink-3)", textDecoration: "none" },
  date: { fontSize: 12, color: "var(--ink-3)" },
  del: { background: "transparent", border: "none", color: "var(--ink-3)", fontSize: 12 },

  scrim: { position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,.30)", backdropFilter: "blur(4px)", display: "grid", placeItems: "center", padding: 20 },
  sheet: { width: "min(560px, 100%)", maxHeight: "90vh", overflowY: "auto", borderRadius: 20, padding: 24, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 24px 64px rgba(0,0,0,.16)" },
  sheetHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  sheetTitle: { margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--ink-1)" },
  sheetX: { background: "transparent", border: "none", color: "var(--ink-3)", fontSize: 14 },
  fieldLabel: { fontSize: 12, color: "var(--ink-2)", fontWeight: 500 },
  urlRow: { display: "flex", gap: 8, marginBottom: 6 },
  input: { flex: 1, width: "100%", background: "#f8fafc", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", color: "var(--ink-1)", fontSize: 14, fontFamily: "inherit" },
  fetchBtn: { whiteSpace: "nowrap", background: "var(--green-dim)", color: "var(--green)", border: "1px solid #c5ddd4", borderRadius: 10, padding: "0 16px", fontSize: 13.5, fontWeight: 600, fontFamily: "inherit" },
  hint: { fontSize: 12.5, color: "var(--green)", margin: "4px 0 12px" },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 },
  sheetFoot: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 },
  ghost: { background: "transparent", border: "1px solid var(--border)", color: "var(--ink-2)", fontSize: 14, fontWeight: 500, padding: "10px 16px", fontFamily: "inherit", borderRadius: 10 },
  orDivider: { display: "flex", alignItems: "center", gap: 10, margin: "10px 0" },
  orLine: { flex: 1, height: 1, background: "var(--border)" },
  orText: { fontSize: 12, color: "var(--ink-3)", whiteSpace: "nowrap" },
  screenshotBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", padding: "10px 16px", background: "var(--green-dim)", color: "var(--green)", border: "1px solid #c5ddd4", borderRadius: 10, fontSize: 13.5, fontWeight: 600, fontFamily: "inherit" },
  disabled: { opacity: .4, cursor: "not-allowed" },
};

import React, { useState, useMemo, useEffect } from "react";
import { supabase } from "./supabase.js";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/* =========================================================================
   ABODE — shared housing search
   Production build: Supabase auth + DB, /api/enrich serverless function.
   ========================================================================= */

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

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

const REACTIONS = { dislike: "👎", like: "👍", love: "❤️" };

const geocode = async (location) => {
  if (!location) return { lat: null, lng: null };
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location + ", France")}&format=json&limit=1`,
      { headers: { "User-Agent": "HouseApp/1.0" } }
    );
    const [hit] = await res.json();
    return hit ? { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) } : { lat: null, lng: null };
  } catch { return { lat: null, lng: null }; }
};

export default function House() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [listings, setListings] = useState([]);
  const [sortBy, setSortBy] = useState("date");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [reactionFilter, setReactionFilter] = useState("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
    if (!vapidKey) return;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
        await supabase.from("push_subscriptions").upsert(
          { user_email: session.user.email, subscription: sub.toJSON() },
          { onConflict: "user_email" }
        );
      } catch {}
    })();
  }, [session]);

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

  const cities = useMemo(
    () => Array.from(new Set(listings.map((l) => l.location).filter(Boolean))).sort(),
    [listings]
  );

  const view = useMemo(() => {
    let v = [...listings];
    if (ownerFilter !== "all") v = v.filter((l) => l.added_by === ownerFilter);
    if (cityFilter !== "all") v = v.filter((l) => l.location === cityFilter);
    if (reactionFilter !== "all") v = v.filter((l) => l.reaction === reactionFilter);
    if (sortBy === "date") v.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (sortBy === "owner") v.sort((a, b) => a.added_by.localeCompare(b.added_by) || new Date(b.created_at) - new Date(a.created_at));
    if (sortBy === "price") v.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    return v;
  }, [listings, sortBy, ownerFilter, cityFilter, reactionFilter]);

  const addListing = async (obj) => {
    const { data: { user } } = await supabase.auth.getUser();
    const added_by = DISPLAY_NAMES[user.email] ?? user.email;
    const { lat, lng } = await geocode(obj.location);
    await supabase.from("listings").insert({ ...obj, added_by, lat, lng });
    fetchListings();
    const { data: otherSubs } = await supabase
      .from("push_subscriptions").select("subscription").neq("user_email", user.email);
    if (otherSubs?.length) {
      fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscriptions: otherSubs.map((s) => s.subscription),
          title: "House",
          body: `${added_by} a ajouté une annonce${obj.title ? ` — ${obj.title}` : ""}.`,
        }),
      }).catch(() => {});
    }
  };

  const removeListing = async (id) => {
    await supabase.from("listings").delete().eq("id", id);
    fetchListings();
  };

  const setReaction = async (id, reaction) => {
    await supabase.from("listings").update({ reaction }).eq("id", id);
    fetchListings();
  };

  if (authLoading) return <div style={{ minHeight: "100vh", background: "var(--bg)" }}><style>{CSS}</style></div>;
  if (!session) return <LoginScreen />;

  return (
    <div style={S.root}>
      <style>{CSS}</style>

      {/* Top bar */}
      <header style={S.bar}>
        <div style={S.brand}>
          <svg style={S.mark} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
          <span style={S.wordmark}>House</span>
        </div>
        <button style={S.userBtn} className="ghost" onClick={() => setUserMenuOpen(true)}>
          {DISPLAY_NAMES[session.user.email] ?? session.user.email}
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
        {cities.length > 0 && (
          <div style={S.segGroup}>
            <span style={S.ctrlLabel}>Ville</span>
            <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} style={S.cityPick}>
              <option value="all">Toutes</option>
              {cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}
        <div style={S.segGroup}>
          <span style={S.ctrlLabel}>Avis</span>
          {[["all", "Tous"], ...Object.entries(REACTIONS).map(([k, v]) => [k, v])].map(([k, label]) => (
            <button key={k} onClick={() => setReactionFilter(k)} className="seg" style={{ ...S.seg, ...(reactionFilter === k ? S.segOn : {}) }}>
              {label}
            </button>
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
          <a key={l.id} href={l.url} target="_blank" rel="noreferrer" style={S.card} className="card">
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
                <div style={{ display: "flex", gap: 4 }}>
                  {Object.entries(REACTIONS).map(([key, emoji]) => (
                    <button
                      key={key}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setReaction(l.id, l.reaction === key ? null : key); }}
                      style={{ ...S.reactionBtn, ...(l.reaction === key ? S.reactionBtnOn : {}) }}
                      className="reactionBtn"
                      aria-label={key}
                    >{emoji}</button>
                  ))}
                </div>
                <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeListing(l.id); }} style={S.del} className="del" aria-label="Supprimer">✕</button>
              </div>
            </div>
          </a>
        ))}
      </main>

      {/* Floating buttons */}
      <div style={S.fabGroup}>
        <button style={S.fab} className="fab" onClick={() => setSheetOpen(true)}>
          <span style={{ fontSize: 20, lineHeight: 1 }}>+</span> Ajouter une annonce
        </button>
        <button style={S.mapBtn} className="mapBtn" onClick={() => setMapOpen(true)} aria-label="Voir la carte">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
            <line x1="8" y1="2" x2="8" y2="18"/>
            <line x1="16" y1="6" x2="16" y2="22"/>
          </svg>
        </button>
      </div>

      {sheetOpen && <AddSheet onClose={() => setSheetOpen(false)} onAdd={addListing} />}
      {userMenuOpen && <UserSheet onClose={() => setUserMenuOpen(false)} />}
      {mapOpen && <MapOverlay listings={listings} onClose={() => setMapOpen(false)} onRefresh={fetchListings} onCitySelect={(city) => { setCityFilter(city); setMapOpen(false); }} />}
    </div>
  );
}

function BoundsFitter({ pins }) {
  const map = useMap();
  const fitted = React.useRef(false);
  useEffect(() => {
    if (fitted.current || pins.length === 0) return;
    fitted.current = true;
    if (pins.length === 1) {
      map.setView([pins[0].lat, pins[0].lng], 10);
    } else {
      map.fitBounds(pins.map((p) => [p.lat, p.lng]), { padding: [48, 48] });
    }
  }, [pins]);
  return null;
}

function MapOverlay({ listings, onClose, onRefresh, onCitySelect }) {
  // resolved holds geocoded coords keyed by listing id, updated immediately as each city resolves
  const [resolved, setResolved] = useState(() => {
    const acc = {};
    listings.forEach((l) => { if (l.lat && l.lng) acc[l.id] = { lat: l.lat, lng: l.lng }; });
    return acc;
  });
  const [geocoding, setGeocoding] = useState(false);

  useEffect(() => {
    const missing = listings.filter((l) => l.location && !resolved[l.id]);
    if (!missing.length) return;
    setGeocoding(true);
    (async () => {
      for (const l of missing) {
        const { lat, lng } = await geocode(l.location);
        if (lat && lng) {
          setResolved((prev) => ({ ...prev, [l.id]: { lat, lng } }));
          supabase.from("listings").update({ lat, lng }).eq("id", l.id).then(() => {});
        }
      }
      setGeocoding(false);
      onRefresh();
    })();
  }, []);

  const pins = useMemo(() => {
    const acc = {};
    listings.forEach((l) => {
      const coords = resolved[l.id];
      if (!coords || !l.location) return;
      if (!acc[l.location]) acc[l.location] = { lat: coords.lat, lng: coords.lng, location: l.location, count: 0 };
      acc[l.location].count++;
    });
    return Object.values(acc);
  }, [listings, resolved]);

  const cityIcon = (label) =>
    L.divIcon({
      html: `<span style="position:absolute;left:0;top:0;transform:translate(-50%,-50%);display:inline-block;background:#2d6a4f;color:#fff;padding:5px 10px;border-radius:99px;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.25);font-family:-apple-system,system-ui,sans-serif">${label}</span>`,
      className: "",
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });

  return (
    <div style={S.mapScrim} onClick={onClose}>
      <div style={S.mapWrap} onClick={(e) => e.stopPropagation()}>
        <button style={S.mapClose} className="del" onClick={onClose} aria-label="Fermer">✕</button>
        {geocoding && (
          <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1000, background: "#fff", padding: "6px 14px", borderRadius: 99, fontSize: 12, color: "var(--ink-2)", boxShadow: "0 2px 8px rgba(0,0,0,.12)", whiteSpace: "nowrap" }}>
            Géolocalisation en cours…
          </div>
        )}
        <MapContainer center={[46.5, 2.5]} zoom={6} style={{ height: "100%", width: "100%" }} zoomControl={false}>
          <TileLayer
            attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {pins.map((p) => (
            <Marker
              key={p.location}
              position={[p.lat, p.lng]}
              icon={cityIcon(`${p.location.split(",")[0]} · ${p.count}`)}
              eventHandlers={{ click: () => onCitySelect(p.location) }}
            />
          ))}
          {pins.length > 0 && <BoundsFitter pins={pins} />}
        </MapContainer>
        {!geocoding && pins.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
            <p style={{ background: "var(--surface)", padding: "10px 18px", borderRadius: 12, fontSize: 14, color: "var(--ink-2)", margin: 0, boxShadow: "0 2px 12px rgba(0,0,0,.10)" }}>
              Aucun bien géolocalisé — ajoutez une localisation à vos annonces.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const signIn = async () => {
    if (!email || !password) return;
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError("Email ou mot de passe incorrect.");
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "grid", placeItems: "center", fontFamily: "'Inter', -apple-system, system-ui, sans-serif" }}>
      <style>{CSS}</style>
      <div style={{ borderRadius: 20, padding: 32, width: "min(400px, 90vw)", background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 8px 40px rgba(0,0,0,.10)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
          <span style={{ fontSize: 24, color: "var(--green)" }}>◴</span>
          <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--ink-1)" }}>House</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={S.fieldLabel}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ton@email.com" style={S.input} className="input" autoComplete="email" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={S.fieldLabel}>Mot de passe</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" style={S.input} className="input" autoComplete="current-password" onKeyDown={(e) => e.key === "Enter" && signIn()} />
          </div>
          {error && <p style={{ margin: 0, fontSize: 13, color: "#e53e3e" }}>{error}</p>}
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginTop: 2 }}>
            <input type="checkbox" defaultChecked style={{ accentColor: "var(--green)", width: 15, height: 15 }} />
            <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Rester connecté·e</span>
          </label>
          <button onClick={signIn} disabled={!email || !password || loading} style={{ ...S.addBtn, justifyContent: "center", marginTop: 4, ...(!email || !password || loading ? S.disabled : {}) }} className="addBtn">
            {loading ? "Connexion…" : "Se connecter"}
          </button>
        </div>
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

function UserSheet({ onClose }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);

  const changePassword = async () => {
    if (!newPassword || newPassword !== confirm) {
      setMsg({ ok: false, text: "Les mots de passe ne correspondent pas." });
      return;
    }
    if (newPassword.length < 6) {
      setMsg({ ok: false, text: "Le mot de passe doit faire au moins 6 caractères." });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setMsg(error ? { ok: false, text: "Erreur. Réessaie." } : { ok: true, text: "Mot de passe mis à jour." });
    setLoading(false);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div style={S.scrim} onClick={onClose}>
      <div style={{ ...S.sheet, width: "min(400px, 100%)" }} onClick={(e) => e.stopPropagation()}>
        <div style={S.sheetHead}>
          <h2 style={S.sheetTitle}>Mon compte</h2>
          <button onClick={onClose} style={S.sheetX} className="del">✕</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={S.fieldLabel}>Nouveau mot de passe</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" style={S.input} className="input" autoComplete="new-password" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={S.fieldLabel}>Confirmer</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" style={S.input} className="input" autoComplete="new-password" onKeyDown={(e) => e.key === "Enter" && changePassword()} />
          </div>
          {msg && <p style={{ margin: 0, fontSize: 13, color: msg.ok ? "var(--green)" : "#e53e3e" }}>{msg.text}</p>}
          <button onClick={changePassword} disabled={!newPassword || !confirm || loading} style={{ ...S.addBtn, justifyContent: "center", ...(!newPassword || !confirm || loading ? S.disabled : {}) }} className="addBtn">
            {loading ? "Enregistrement…" : "Changer le mot de passe"}
          </button>
        </div>

        <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--border)" }}>
          <button onClick={signOut} style={{ ...S.ghost, width: "100%", textAlign: "center", color: "#e53e3e", borderColor: "#fecaca" }} className="ghost">
            Se déconnecter
          </button>
        </div>
      </div>
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
.fab{cursor:pointer;transition:transform .15s cubic-bezier(.2,.7,.3,1), box-shadow .15s ease}
.fab:hover{transform:translateY(-2px);box-shadow:0 8px 28px rgba(45,106,79,.55)}
.fab:active{transform:scale(.97)}
.mapBtn{cursor:pointer;transition:transform .15s ease, box-shadow .15s ease}
.mapBtn:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,.15)}
.fetchBtn{cursor:pointer;transition:filter .15s} .fetchBtn:hover{filter:brightness(1.08)}
.ghost{cursor:pointer;transition:color .15s,border-color .15s} .ghost:hover{color:var(--ink-1);border-color:var(--ink-2)}
.card{transition:transform .18s cubic-bezier(.2,.7,.3,1), box-shadow .18s ease}
.card:hover{transform:translateY(-3px); box-shadow:0 16px 36px rgba(0,0,0,.13)}
.card:hover .ownerPill{opacity:1}
.del{cursor:pointer;opacity:.35;transition:opacity .15s} .del:hover{opacity:.8}
.reactionBtn:hover{opacity:.7!important;background:var(--green-dim)}
.input{transition:border-color .15s, background .15s}
.input:focus{outline:none;border-color:var(--green);background:#f5fcf8}
@media (prefers-reduced-motion: reduce){ *{transition:none!important} }
`;

const S = {
  root: { minHeight: "100vh", fontFamily: "'Inter', -apple-system, system-ui, sans-serif", color: "var(--ink-1)", background: "var(--bg)", paddingBottom: 100 },

  bar: { position: "sticky", top: 0, zIndex: 20, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px", background: "var(--surface)", borderBottom: "1px solid var(--border)", boxShadow: "0 1px 8px rgba(0,0,0,.05)" },
  brand: { display: "flex", alignItems: "center", gap: 9 },
  mark: { width: 22, height: 22, color: "var(--green)", flexShrink: 0 },
  fabGroup: { position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", zIndex: 30, display: "flex", alignItems: "center", gap: 10 },
  fab: { display: "inline-flex", alignItems: "center", gap: 8, background: "var(--green)", color: "var(--green-ink)", border: "none", borderRadius: 99, padding: "14px 26px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", boxShadow: "0 4px 20px rgba(45,106,79,.4)", whiteSpace: "nowrap" },
  mapBtn: { background: "#fff", border: "1px solid var(--border)", borderRadius: 99, width: 48, height: 48, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--green)", boxShadow: "0 4px 16px rgba(0,0,0,.10)", flexShrink: 0 },
  mapScrim: { position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,.38)", backdropFilter: "blur(4px)", display: "grid", placeItems: "center", padding: 20 },
  mapWrap: { position: "relative", width: "100%", maxWidth: 900, height: "80vh", borderRadius: 20, overflow: "hidden", border: "1px solid var(--border)", boxShadow: "0 24px 64px rgba(0,0,0,.22)" },
  mapClose: { position: "absolute", top: 12, right: 12, zIndex: 1000, background: "#fff", border: "1px solid var(--border)", borderRadius: 99, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "var(--ink-2)" },
  wordmark: { fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--ink-1)" },
  sub: { fontSize: 13, color: "var(--ink-3)" },
  userBtn: { background: "transparent", border: "1px solid var(--border)", borderRadius: 99, padding: "7px 14px", fontSize: 13, fontWeight: 500, color: "var(--ink-2)", fontFamily: "inherit" },
  addBtn: { display: "inline-flex", alignItems: "center", gap: 7, background: "var(--green)", color: "var(--green-ink)", border: "none", borderRadius: 11, padding: "10px 17px", fontSize: 14, fontWeight: 600, fontFamily: "inherit" },

  controls: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18, margin: "20px 24px", padding: "12px 18px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 1px 6px rgba(0,0,0,.04)" },
  segGroup: { display: "inline-flex", alignItems: "center", gap: 4 },
  ctrlLabel: { fontSize: 12, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".08em", marginRight: 6 },
  seg: { background: "transparent", border: "none", color: "var(--ink-2)", fontSize: 13.5, fontWeight: 500, padding: "6px 12px", borderRadius: 8, fontFamily: "inherit" },
  segOn: { background: "var(--green-dim)", color: "var(--green)", fontWeight: 600 },
  cityPick: { background: "transparent", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 10px", fontSize: 13.5, fontWeight: 500, color: "var(--ink-2)", fontFamily: "inherit", cursor: "pointer" },
  count: { marginLeft: "auto", fontSize: 13, color: "var(--ink-3)" },

  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 20, padding: "0 24px" },
  empty: { gridColumn: "1 / -1", textAlign: "center", padding: "80px 0" },

  card: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 18, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "var(--card-shadow)", textDecoration: "none", color: "inherit", cursor: "pointer" },
  thumbWrap: { position: "relative", height: 180, flexShrink: 0, background: "#e8edf2" },
  thumb: { width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", display: "block" },
  thumbFallback: { width: "100%", height: "100%", display: "grid", placeItems: "center", color: "var(--ink-3)", fontSize: 13 },
  owner: { position: "absolute", bottom: 10, left: 10, fontSize: 11.5, fontWeight: 600, padding: "4px 10px", borderRadius: 99, background: "rgba(0,0,0,.52)", backdropFilter: "blur(8px)", color: "#fff", border: "1px solid rgba(255,255,255,.18)", opacity: .9 },
  cardBody: { padding: "16px 18px 18px", display: "flex", flexDirection: "column", gap: 6, flex: 1, overflow: "hidden" },
  priceRow: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 },
  price: { fontSize: 21, fontWeight: 700, letterSpacing: "-0.025em", color: "var(--ink-1)" },
  meta: { fontSize: 12.5, color: "var(--ink-3)", fontWeight: 500 },
  title: { margin: 0, fontSize: 14.5, fontWeight: 600, lineHeight: 1.35, color: "var(--ink-1)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  loc: { margin: 0, fontSize: 13, color: "var(--ink-2)" },
  notes: { margin: "2px 0 0", fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.45, fontStyle: "italic" },
  cardFoot: { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--border)" },
  reactionBtn: { background: "transparent", border: "none", fontSize: 16, padding: "2px 5px", borderRadius: 8, cursor: "pointer", opacity: 0.35, transition: "opacity .15s, background .15s" },
  reactionBtnOn: { opacity: 1, background: "var(--green-dim)" },
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

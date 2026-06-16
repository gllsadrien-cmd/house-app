export default async function handler(req, res) {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "missing url" });
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HouseBot/1.0)" },
    });
    const html = await r.text();
    const og = (p) => {
      const m =
        html.match(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']+)`, "i")) ||
        html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${p}["']`, "i"));
      return m ? m[1] : null;
    };
    const priceMatch = html.match(/(\d[\d\s.,]{3,})\s*€/);
    const price = priceMatch ? Number(priceMatch[1].replace(/[\s.]/g, "").replace(",", ".")) : null;
    res.setHeader("Cache-Control", "s-maxage=86400");
    res.json({
      title: og("title"),
      image_url: og("image"),
      location: "",
      surface: null,
      rooms: null,
      price: Number.isFinite(price) ? price : null,
    });
  } catch {
    res.json({ title: null, image_url: null, price: null, location: "", surface: null, rooms: null });
  }
}

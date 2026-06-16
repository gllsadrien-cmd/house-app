import Anthropic from "@anthropic-ai/sdk";

export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { base64, mediaType } = req.body;
  if (!base64) return res.status(400).json({ error: "missing image" });

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType || "image/jpeg", data: base64 },
            },
            {
              type: "text",
              text: `Tu regardes une capture d'écran d'une annonce immobilière française. Extrais ces champs et retourne UNIQUEMENT du JSON valide (null si non visible) :
{"title": string, "price": number (entier en euros, sans formatage), "location": string (ville ou quartier), "surface": number (entier en m²), "rooms": number (entier)}`,
            },
          ],
        },
      ],
    });
    const text = msg.content[0].text;
    const match = text.match(/\{[\s\S]*\}/);
    res.json(JSON.parse(match ? match[0] : text));
  } catch {
    res.json({ title: null, price: null, location: null, surface: null, rooms: null });
  }
}

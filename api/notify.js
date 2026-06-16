import webpush from "web-push";

webpush.setVapidDetails(
  "mailto:gllsadrien@gmail.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { subscriptions, title, body } = req.body;
  if (!subscriptions?.length) return res.json({ sent: 0 });

  const payload = JSON.stringify({ title: title ?? "House", body });

  await Promise.allSettled(
    subscriptions.map((sub) => webpush.sendNotification(sub, payload).catch(() => {}))
  );

  res.json({ sent: subscriptions.length });
}

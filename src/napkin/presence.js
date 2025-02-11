import WebSocket from "ws";
import after from "after";

/**
  * Napkin.io function that connects to discord gateway to update the presence for the bots
  * Discord blocks cloudflare workers from accessing their gateway for some reason :skull:
  * TODO: Add Authorization header checks to prevent this endpoint being spammed if the url gets leaked
  * @param {NapkinRequest} req
  * @param {NapkinResponse} res
  *
  * @ps I was told to put hartbeat instead of heartbeat
*/
export default (req, res) => new Promise(async resolve => {
  let { ticker, coinData } = req.query || {};
  if (!ticker || !coinData) return resolve(res.status(400).json({ error: "Malformed URL" }));
  coinData = JSON.parse(coinData);

  const ops = {
    READY: 0,
    HARTBEAT: 1,
    IDENTIFY: 2,
    HELLO: 10,
    HARTBEAT_ACK: 11
  };
  const next = after(3, err => resolve(err ? res.status(500).json({ error: err.message }) : res.status(200).json({ success: true })));

  const
    ws = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json"),
    send = (op, d) => ws.send(JSON.stringify({ d, op })),
    got = message => console.log("[discord]", message),
    put = message => console.log("[napkin]", message)
  let s = null;

  ws.addEventListener("open", _ => {
    got("socket open");
    next();
  });
  ws.addEventListener("message", ({ data }) => {
    data = JSON.parse(data);
    s = data.s;

    switch (data.op) {
      case ops.HARTBEAT:
      case ops.HELLO:
        got("hello/hartbeat");
        put("hartbeat");
        send(1, s);
        break;
      case ops.HARTBEAT_ACK:
        got("hartbeat ack");
        put("identify");
        const f = n => new Intl.NumberFormat("en-US").format(n);
        const presence = [
          `Market Cap: $${f(Math.round(coinData.usd_market_cap))}`,
          `24h Vol: $${f(Math.round(coinData.usd_24h_vol))}`,
          `24h Change: ${(100 * ((coinData.usd + coinData.usd_24h_change) / coinData.usd - 1)).toFixed(2)}%`
        ][Math.floor(Math.random() * 3)];
        send(2, {
          token: process.env[`TOKEN_${ticker.toUpperCase()}`],
          properties: {
            os: "code913 has a cute blåhaj",
            browser: "napkin.io",
            device: "napkin.io"
          },
          presence: {
            status: "online",
            afk: false,
            activities: [{
              name: presence,
              type: 3
            }]
          },
          intents: 0
        });
        next();
        break;
      case ops.READY:
        got("ready; presence has been set");
        put("closing socket");
        ws.close();
        next();
        break;
    }
  });
  ws.addEventListener("error", err => {
    got("socket error");
    next(err);
  });
  ws.addEventListener("close", _ => got("socket close"));
});

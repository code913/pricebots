import { verifyKey, InteractionResponseType } from "discord-interactions";
import { Router } from "itty-router";
import tickers from "./tickers.js";

/**
 * Cloudflare worker that periodically pings the napkin function to update presence and also sets guild nicknames for the bots
 * Napkin's cron scheduler currently only supports >hourly, that's why this worker is used to ping it
 */
async function cronHandler(env) {
	let coinDataFunc = new URL(env.NAPKIN_COINDATA_FUNCTION_URL);
	coinDataFunc.searchParams.append("tickers", [ ...tickers.keys() ].join(","));
	const data = await fetch(coinDataFunc).then(r => r.json());
	let promises = [];

	for (let [ticker, displayName] of tickers.entries()) {
		const tokenVar = `TOKEN_${displayName.toUpperCase()}`;
		const token = env[tokenVar];
		if (!token) {
			console.warn(`You did not set a token for ${tokenVar}`);
			continue;
		}
		if (!data[ticker]) continue;
		promises.push(setNick(data[ticker], token));
		const presenceFunc = new URL(env.NAPKIN_PRESENCE_FUNCTION_URL);
		presenceFunc.searchParams.append("ticker", ticker);
		presenceFunc.searchParams.append("coinData", JSON.stringify(data[ticker]));
		console.log(presenceFunc.href);
		promises.push(fetch(presenceFunc));
	}

	return await Promise.all(promises);
}

const router = Router();

router.get("/", _ => {
	return new Response("hi");
});
router.get("/cron", async (_, env) => {
	await cronHandler(env);

	return new Response("set nicks");
});
router.post("/interactions", _ => {
	return new Response(JSON.stringify({
		type: InteractionResponseType.PONG
	}), {
		headers: {
			"content-type": "application/json",
		},
	});
});

// https://github.com/code913/snippets/blob/main/discord/fetch.js
const dapi = (path, token, method = "GET", body, parse = true) => fetch(`https://discord.com/api/v10/${path}`, {
	headers: {
		"Authorization": `Bot ${token}`,
		"Content-Type": body && "application/json"
	},
	body: body && JSON.stringify(body),
	method: method
}).then(r => parse ? r.json() : r);

async function setNick(data, token) {
	const guilds = await dapi("users/@me/guilds", token);
	const CHANGE_NICKNAME = (1n << 26n);

	for (const { id, permissions } of guilds) {
		if ((BigInt(permissions) & CHANGE_NICKNAME) !== (CHANGE_NICKNAME)) continue;

		await dapi(`guilds/${id}/members/@me`, token, "PATCH", {
			nick: `$${data.usd} (${data.usd_24h_change > 0 ? "↗" : "↘"})`
		}, false);
	}
}

export default {
	async fetch(request, env) {
		if (request.method === "POST") {
			const botName = new URL(request.url)?.searchParams?.get("bot") ?? "";
			const publicKey = env[`PUBLIC_KEY_${botName.toUpperCase()}`];
			console.log({ botName, publicKey });
			const signature = request.headers.get("x-signature-ed25519");
			const timestamp = request.headers.get("x-signature-timestamp");
			const body = await request.clone().arrayBuffer();
			const isValidRequest = botName && signature && timestamp && verifyKey(
				body,
				signature,
				timestamp,
				publicKey ?? ""
			);

			if (!isValidRequest) return new Response("Bad request signature.", { status: 401 });
		}

		return router.handle(request, env);
	},

	async scheduled(_, env, ctx) {
		return ctx.waitUntil(cronHandler(env));
	}
};
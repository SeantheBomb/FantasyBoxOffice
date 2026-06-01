// Register (or update) all Discord slash commands for the Fantasy Box Office bot.
//
// Usage:
//   DISCORD_BOT_TOKEN=<bot_token> node scripts/register-discord-commands.js
//
// Bot token is at https://discord.com/developers/applications/1505968596478722230/bot

const APP_ID = "1505968596478722230";
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID; // optional — clears stale guild-scoped commands if provided

if (!BOT_TOKEN) {
  console.error("Set DISCORD_BOT_TOKEN env var before running.");
  process.exit(1);
}

const commands = [
  {
    name: "bet",
    description: "Predict a movie's opening weekend domestic gross",
    options: [
      {
        name: "movie",
        description: "Movie to bet on",
        type: 3, // STRING
        required: true,
        autocomplete: true,
      },
      {
        name: "estimate",
        description: "Your prediction, e.g. $45M (whole millions only)",
        type: 3, // STRING
        required: true,
      },
    ],
  },
  {
    name: "auction",
    description: "Start an auction for an unclaimed, unreleased movie",
    options: [
      {
        name: "movie",
        description: "Movie to auction",
        type: 3, // STRING
        required: true,
        autocomplete: true,
      },
      {
        name: "starting_bid",
        description: "Opening bid in points (default: 1)",
        type: 4, // INTEGER
        required: false,
        min_value: 1,
      },
    ],
  },
  {
    name: "bid",
    description: "Raise your bid on an active auction",
    options: [
      {
        name: "movie",
        description: "Movie being auctioned",
        type: 3, // STRING
        required: true,
        autocomplete: true,
      },
      {
        name: "amount",
        description: "Points to bid (default: current bid + 1). Type 'pass' to learn how to pass.",
        type: 3, // STRING — allows catching "pass" input and redirecting to /pass
        required: false,
      },
    ],
  },
  {
    name: "points",
    description: "Show how many points each league player has remaining",
  },
  {
    name: "pass",
    description: "Pass on an active auction — you won't be able to bid on that movie again",
    options: [
      {
        name: "movie",
        description: "Movie being auctioned",
        type: 3, // STRING
        required: true,
        autocomplete: true,
      },
    ],
  },
  {
    name: "upcoming",
    description: "List movies releasing in the next 8 weeks, highlighting ones still available to auction",
  },
  {
    name: "void",
    description: "Void one of your owned movies (costs 2× its purchase price). Admins can void any player's movie.",
    options: [
      {
        name: "movie",
        description: "Movie to void",
        type: 3, // STRING
        required: true,
        autocomplete: true,
      },
    ],
  },
];

// Clear stale guild-scoped commands first (if guild ID provided).
if (GUILD_ID) {
  const guildUrl = `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`;
  const guildRes = await fetch(guildUrl, {
    method: "PUT",
    headers: { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify([]),
  });
  if (guildRes.ok) {
    console.log(`Cleared guild-scoped commands for guild ${GUILD_ID}`);
  } else {
    const err = await guildRes.json().catch(() => ({}));
    console.warn("Warning: could not clear guild commands:", JSON.stringify(err));
  }
}

// Register (or overwrite) all global commands.
const url = `https://discord.com/api/v10/applications/${APP_ID}/commands`;

const res = await fetch(url, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${BOT_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(commands),
});

const data = await res.json();
if (!res.ok) {
  console.error("Failed to register commands:", JSON.stringify(data, null, 2));
  process.exit(1);
}

console.log("Global commands registered:");
for (const cmd of data) {
  console.log(`  /${cmd.name} (id: ${cmd.id})`);
}

// Register (or update) all Discord slash commands for the Fantasy Box Office bot.
//
// Usage:
//   DISCORD_APP_ID=<app_id> DISCORD_BOT_TOKEN=<bot_token> node scripts/register-discord-commands.js
//
// Find your App ID and Bot Token at https://discord.com/developers/applications.

const APP_ID = process.env.DISCORD_APP_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!APP_ID || !BOT_TOKEN) {
  console.error("Set DISCORD_APP_ID and DISCORD_BOT_TOKEN env vars before running.");
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
        description: "Points to bid (default: current bid + 1)",
        type: 4, // INTEGER
        required: false,
        min_value: 1,
      },
    ],
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
];

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

console.log("Commands registered:");
for (const cmd of data) {
  console.log(`  /${cmd.name} (id: ${cmd.id})`);
}

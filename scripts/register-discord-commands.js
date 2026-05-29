// Register (or update) all Discord slash commands for the Fantasy Box Office bot.
//
// Usage:
//   DISCORD_BOT_TOKEN=<bot_token> node scripts/register-discord-commands.js
//
// Bot token is at https://discord.com/developers/applications/1505968596478722230/bot

const APP_ID = "1505968596478722230";
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

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

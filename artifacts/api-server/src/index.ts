import app from "./app";

import { logger } from "./lib/logger";

import { startTelegramBot } from "./lib/telegram-bot";

import {

  getCurrentAutomaticGame,

  advanceAutomaticGame,

} from "./lib/bingo-store";

const rawPort = process.env["PORT"];

if (!rawPort) {

  throw new Error(

    "PORT environment variable is required but was not provided.",

  );

}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {

  throw new Error(`Invalid PORT value: "${rawPort}"`);

}

async function runAutomaticBingo() {

  try {

    const game = getCurrentAutomaticGame();

    if (!game) {

      return;

    }

    await advanceAutomaticGame(game.id);

  } catch (err) {

    logger.error({ err }, "Automatic Bingo scheduler error");

  }

}

app.listen(port, (err) => {

  if (err) {

    logger.error({ err }, "Error listening on port");

    process.exit(1);

  }

  logger.info({ port }, "Server listening");

  startTelegramBot();

  // Automatic Bingo:

  // checks the current game every 3.5 seconds.

  // 45-second lobby -> live game -> automatic ball calls.

  setInterval(() => {

    void runAutomaticBingo();

  }, 3500);

  // Run once immediately after the server starts.

  void runAutomaticBingo();

  logger.info(

    "Automatic Bingo scheduler started: 3.5-second interval",

  );

});

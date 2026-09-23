import { logger } from "./logger";

import {

  advanceAutomaticGame,

  getOrCreateAutomaticGame,

  getTelegramLanguage,

  getTelegramParticipants,

  getTelegramWallet,

  hasTelegramUser,

  setTelegramLanguage,

  setTelegramPhone,

  setTelegramSession,

  telegramWalletAction,

  upsertTelegramUser,

} from "./bingo-store";

type Language = "en" | "am";

type TelegramButton = {

  text: string;

  callback_data?: string;

  web_app?: { url: string };

  request_contact?: boolean;

};

type TelegramKeyboard = {

  inline_keyboard?: Array<Array<TelegramButton>>;

  keyboard?: Array<Array<TelegramButton>>;

  resize_keyboard?: boolean;

  one_time_keyboard?: boolean;

};

type TelegramContact = {

  phone_number: string;

  first_name?: string;

  user_id?: number;

};

type TelegramMessage = {

  message_id: number;

  chat: { id: number };

  text?: string;

  contact?: TelegramContact;

  from?: {

    id: number;

    first_name?: string;

    username?: string;

  };

};

type TelegramCallback = {

  id: string;

  data?: string;

  from: {

    id: number;

    first_name?: string;

    username?: string;

  };

  message?: TelegramMessage;

};

type TelegramUpdate = {

  update_id: number;

  message?: TelegramMessage;

  callback_query?: TelegramCallback;

};

const botToken = process.env.BOT_TOKEN;

const apiBase = botToken

  ? `https://api.telegram.org/bot${botToken}`

  : undefined;

/*

 * Fast Bingo Mini App

 *

 * Use the Cloudflare Worker URL directly.

 * TELEGRAM_MINI_APP_URL can still override it if configured.

 */

const telegramMiniAppUrl =

  process.env.TELEGRAM_MINI_APP_URL ||

  "https://fast-bingo-mini-app.dagnaeli21.workers.dev/";

const telegramPollingEnabled =

  process.env.NODE_ENV === "production";

const LOBBY_SECONDS = 45;

const CALL_INTERVAL_MS = 3500;

let polling = false;

let lastAutomaticStatus:

  | "waiting"

  | "live"

  | "completed"

  | undefined;

let lastAutomaticNumber = 0;

let lastAutomaticGameId = "";

const copy: Record<

  Language,

  Record<string, string>

> = {

  en: {

    welcome:

      "Welcome to Fast Bingo ❤️\n\nChoose your language to continue.",

    main:

      "Welcome to Fast Bingo ❤️\n\nChoose an option below.",

    gameInProgress:

      "🎱 GAME IN PROGRESS\n\nPlease wait for the next round to start.",

    lobby:

      "🎫 NEW ROUND\n\nChoose your cartela(s) before the countdown ends.\n\nYou can select up to 4 cartelas.",

    lobbyEnded:

      "The round has started.\n\nCartela selection is now closed.",

    roundStarted:

      "🎱 ROUND STARTED!\n\nNumbers are now being called automatically.",

    roundFinished:

      "🏆 ROUND COMPLETE!\n\nThe next round will start automatically.",

    phone:

      "📱 Please share your phone number to continue.",

    phoneSaved:

      "✅ Phone number saved.",

    balance:

      "💵 Your balance",

    help:

      "📲 Fast Bingo Help\n\nOpen the game with 🎮 Play.\n\nDuring the 45-second lobby you can select up to 4 cartelas.\n\nWhen the round starts, selection closes and numbers are called automatically.",

    language:

      "Choose your language.",

    walletUpdated:

      "Balance updated.",

    walletError:

      "Wallet action could not be completed.",

    invalid:

      "Please use the buttons below.",

    play:

      "🎮 Play",

    balanceButton:

      "💵 Balance",

    languageButton:

      "🌐 Language",

    helpButton:

      "📲 Help",

    sharePhone:

      "📱 Share phone number",

    back:

      "⬅️ Back",

    deposit:

      "📥 Deposit",

    withdraw:

      "📤 Withdraw",

    telebirr:

      "Telebirr",

    ebirr:

      "eBirr",

    mpesa:

      "M-PESA",

    saved:

      "Saved",

  },

  am: {

    welcome:

      "እንኳን ወደ Fast ቢንጎ በደህና መጡ ❤️\n\nቋንቋዎን ይምረጡ።",

    main:

      "እንኳን ወደ Fast ቢንጎ በደህና መጡ ❤️\n\nከታች ያለውን አማራጭ ይምረጡ።",

    gameInProgress:

      "🎱 GAME IN PROGRESS\n\nእባኮትን ቀጣይ ዙር እስከሚጀምር ይጠብቁ!",

    lobby:

      "🎫 አዲስ ዙር\n\nየሚፈልጉትን ካርቴላ ይምረጡ።\n\nእስከ 4 ካርቴላ መምረጥ ይችላሉ።",

    lobbyEnded:

      "ዙሩ ተጀምሯል።\n\nየካርቴላ ምርጫ አሁን ተዘግቷል።",

    roundStarted:

      "🎱 ዙሩ ተጀምሯል!\n\nቁጥሮች አሁን በራስ-ሰር ይጠራሉ።",

    roundFinished:

      "🏆 ዙሩ ተጠናቋል!\n\nቀጣዩ ዙር በራስ-ሰር ይጀምራል።",

    phone:

      "📱 ለመቀጠል የስልክ ቁጥርዎን ያጋሩ።",

    phoneSaved:

      "✅ የስልክ ቁጥርዎ ተመዝግቧል።",

    balance:

      "💵 የእርስዎ ሂሳብ",

    help:

      "📲 Fast Bingo እርዳታ\n\n🎮 ይጫወቱ የሚለውን በመንካት ጨዋታውን ይክፈቱ።\n\nበ45 ሰከንድ የሎቢ ጊዜ እስከ 4 ካርቴላ መምረጥ ይችላሉ።\n\nዙሩ ሲጀምር ምርጫው ይዘጋል እና ቁጥሮች በራስ-ሰር ይጠራሉ።",

    language:

      "ቋንቋዎን ይምረጡ።",

    walletUpdated:

      "ሂሳቡ ተስተካክሏል።",

    walletError:

      "የሂሳብ ለውጡ አልተሳካም።",

    invalid:

      "ከታች ያሉትን አዝራሮች ይጠቀሙ።",

    play:

      "🎮 ይጫወቱ",

    balanceButton:

      "💵 ሂሳብ",

    languageButton:

      "🌐 ቋንቋ",

    helpButton:

      "📲 እርዳታ",

    sharePhone:

      "📱 ስልክ ቁጥሬን አጋራ",

    back:

      "⬅️ ተመለስ",

    deposit:

      "📥 ገቢ",

    withdraw:

      "📤 ወጪ",

    telebirr:

      "Telebirr",

    ebirr:

      "eBirr",

    mpesa:

      "M-PESA",

    saved:

      "ተቀምጧል",

  },

};

function t(

  language: Language,

  key: string,

): string {

  return (

    copy[language][key] ??

    copy.en[key] ??

    key

  );

}

function nameOf(

  message:

    | TelegramMessage

    | TelegramCallback,

): string {

  const user = message.from;

  return (

    user?.first_name?.trim() ||

    user?.username?.trim() ||

    "Player"

  );

}

function mainKeyboard(

  language: Language,

): TelegramKeyboard {

  const rows: TelegramButton[][] = [];

  /*

   * IMPORTANT:

   * 🎮 Play is a Telegram Web App button.

   * It opens the Cloudflare Fast Bingo Mini App directly.

   */

  rows.push([

    {

      text: t(language, "play"),

      web_app: {

        url: telegramMiniAppUrl,

      },

    },

  ]);

  rows.push([

    {

      text: t(

        language,

        "balanceButton",

      ),

      callback_data:

        "menu:balance",

    },

    {

      text: t(

        language,

        "languageButton",

      ),

      callback_data:

        "menu:language",

    },

  ]);

  rows.push([

    {

      text: t(

        language,

        "helpButton",

      ),

      callback_data:

        "menu:help",

    },

  ]);

  return {

    inline_keyboard: rows,

  };

}

function phoneKeyboard(

  language: Language,

): TelegramKeyboard {

  return {

    keyboard: [

      [

        {

          text: t(

            language,

            "sharePhone",

          ),

          request_contact: true,

        },

      ],

    ],

    resize_keyboard: true,

    one_time_keyboard: true,

  };

}

function walletKeyboard(

  language: Language,

): TelegramKeyboard {

  return {

    inline_keyboard: [

      [

        {

          text: t(

            language,

            "deposit",

          ),

          callback_data:

            "wallet:deposit",

        },

        {

          text: t(

            language,

            "withdraw",

          ),

          callback_data:

            "wallet:withdraw",

        },

      ],

      [

        {

          text: t(

            language,

            "back",

          ),

          callback_data:

            "menu:home",

        },

      ],

    ],

  };

}

function walletMethodKeyboard(

  language: Language,

  action:

    | "deposit"

    | "withdraw",

): TelegramKeyboard {

  return {

    inline_keyboard: [

      [

        {

          text: t(

            language,

            "telebirr",

          ),

          callback_data:

            `wallet:${action}:telebirr`,

        },

      ],

      [

        {

          text: t(

            language,

            "ebirr",

          ),

          callback_data:

            `wallet:${action}:ebirr`,

        },

      ],

      [

        {

          text: t(

            language,

            "mpesa",

          ),

          callback_data:

            `wallet:${action}:mpesa`,

        },

      ],

      [

        {

          text: t(

            language,

            "back",

          ),

          callback_data:

            "menu:balance",

        },

      ],

    ],

  };

}

async function telegramRequest<T>(

  method: string,

  body: Record<

    string,

    unknown

  > = {},

): Promise<T> {

  if (!apiBase) {

    throw new Error(

      "BOT_TOKEN is not configured",

    );

  }

  const response = await fetch(

    `${apiBase}/${method}`,

    {

      method: "POST",

      headers: {

        "content-type":

          "application/json",

      },

      body: JSON.stringify(body),

    },

  );

  const payload =

    (await response.json()) as {

      ok: boolean;

      result?: T;

      description?: string;

    };

  if (

    !response.ok ||

    !payload.ok

  ) {

    throw new Error(

      `Telegram ${method} failed: ${

        payload.description ??

        response.statusText

      }`,

    );

  }

  return payload.result as T;

}

async function sendMessage(

  chatId: string,

  text: string,

  replyMarkup?: TelegramKeyboard,

): Promise<void> {

  await telegramRequest(

    "sendMessage",

    {

      chat_id: chatId,

      text,

      reply_markup:

        replyMarkup,

      disable_web_page_preview:

        true,

    },

  );

}

async function removeKeyboard(

  chatId: string,

  text: string,

): Promise<void> {

  await telegramRequest(

    "sendMessage",

    {

      chat_id: chatId,

      text,

      reply_markup: {

        remove_keyboard: true,

      },

    },

  );

}

async function showMainMenu(

  chatId: string,

  language: Language,

): Promise<void> {

  await sendMessage(

    chatId,

    t(language, "main"),

    mainKeyboard(language),

  );

}

async function showPhoneRequest(

  chatId: string,

  language: Language,

): Promise<void> {

  await sendMessage(

    chatId,

    t(language, "phone"),

    phoneKeyboard(language),

  );

}

async function showWallet(

  chatId: string,

  telegramId: string,

  language: Language,

): Promise<void> {

  const wallet =

    getTelegramWallet(

      telegramId,

    );

  await sendMessage(

    chatId,

    `${t(language, "balance")}

ETB ${wallet.balance.toFixed(2)}`,

    walletKeyboard(language),

  );

}

async function showLanguage(

  chatId: string,

  language: Language,

): Promise<void> {

  await sendMessage(

    chatId,

    t(language, "language"),

    {

      inline_keyboard: [

        [

          {

            text: "English",

            callback_data:

              "language:en",

          },

          {

            text: "አማርኛ",

            callback_data:

              "language:am",

          },

        ],

      ],

    },

  );

}

async function notifyParticipants(

  gameId: string,

  textEn: string,

  textAm: string,

): Promise<void> {

  const participants =

    getTelegramParticipants(

      gameId,

    );

  for (

    const telegramId of participants

  ) {

    try {

      const language =

        getTelegramLanguage(

          telegramId,

        );

      await sendMessage(

        telegramId,

        language === "am"

          ? textAm

          : textEn,

        mainKeyboard(language),

      );

    } catch (error) {

      logger.warn(

        {

          error,

          telegramId,

        },

        "Could not notify Telegram player",

      );

    }

  }

}

async function handlePhone(

  message: TelegramMessage,

): Promise<void> {

  if (

    !message.from ||

    !message.contact

  ) {

    return;

  }

  const telegramId =

    String(message.from.id);

  const language =

    getTelegramLanguage(

      telegramId,

    );

  if (

    message.contact.user_id &&

    message.contact.user_id !==

      message.from.id

  ) {

    await sendMessage(

      String(message.chat.id),

      t(language, "phone"),

      phoneKeyboard(language),

    );

    return;

  }

  setTelegramPhone(

    telegramId,

    message.contact.phone_number,

  );

  setTelegramSession(

    telegramId,

    "menu",

  );

  await removeKeyboard(

    String(message.chat.id),

    t(language, "phoneSaved"),

  );

  await showMainMenu(

    String(message.chat.id),

    language,

  );

}

async function handleMessage(

  message: TelegramMessage,

): Promise<void> {

  if (!message.from) {

    return;

  }

  const telegramId =

    String(message.from.id);

  const chatId =

    String(message.chat.id);

  upsertTelegramUser(

    telegramId,

    nameOf(message),

    message.from.username,

  );

  if (message.contact) {

    await handlePhone(message);

    return;

  }

  const text =

    message.text?.trim() ?? "";

  const language =

    getTelegramLanguage(

      telegramId,

    );

  if (text === "/start") {

    setTelegramSession(

      telegramId,

      "menu",

    );

    await showMainMenu(

      chatId,

      language,

    );

    return;

  }

  if (

    text === "/menu" ||

    text === "/help"

  ) {

    setTelegramSession(

      telegramId,

      "menu",

    );

    if (text === "/help") {

      await sendMessage(

        chatId,

        t(language, "help"),

        mainKeyboard(language),

      );

    } else {

      await showMainMenu(

        chatId,

        language,

      );

    }

    return;

  }

  if (

    text === "/phone" ||

    text === "/login"

  ) {

    await showPhoneRequest(

      chatId,

      language,

    );

    return;

  }

  await sendMessage(

    chatId,

    t(language, "invalid"),

    mainKeyboard(language),

  );

}

async function handleCallback(

  callback: TelegramCallback,

): Promise<void> {

  if (

    !callback.message ||

    !callback.data

  ) {

    return;

  }

  const telegramId =

    String(callback.from.id);

  const chatId =

    String(

      callback.message.chat.id,

    );

  upsertTelegramUser(

    telegramId,

    nameOf(callback),

    callback.from.username,

  );

  await telegramRequest(

    "answerCallbackQuery",

    {

      callback_query_id:

        callback.id,

    },

  );

  const parts =

    callback.data.split(":");

  const scope = parts[0];

  const action = parts[1];

  const value = parts[2];

  const language =

    getTelegramLanguage(

      telegramId,

    );

  if (

    scope === "language" &&

    (action === "en" ||

      action === "am")

  ) {

    setTelegramLanguage(

      telegramId,

      action,

    );

    setTelegramSession(

      telegramId,

      "menu",

    );

    await showMainMenu(

      chatId,

      action,

    );

    return;

  }

  if (scope === "menu") {

    if (action === "home") {

      await showMainMenu(

        chatId,

        language,

      );

      return;

    }

    if (action === "language") {

      await showLanguage(

        chatId,

        language,

      );

      return;

    }

    if (action === "help") {

      await sendMessage(

        chatId,

        t(language, "help"),

        mainKeyboard(language),

      );

      return;

    }

    if (action === "balance") {

      await showWallet(

        chatId,

        telegramId,

        language,

      );

      return;

    }

    return;

  }

  if (

    scope === "wallet" &&

    action === "deposit"

  ) {

    if (!value) {

      await sendMessage(

        chatId,

        t(language, "deposit"),

        walletMethodKeyboard(

          language,

          "deposit",

        ),

      );

      return;

    }

    try {

      const wallet =

        telegramWalletAction(

          telegramId,

          "deposit",

          100,

          value as

            | "telebirr"

            | "ebirr"

            | "mpesa",

        );

      await sendMessage(

        chatId,

        `${t(

          language,

          "walletUpdated",

        )}

ETB ${wallet.balance.toFixed(2)}`,

        mainKeyboard(language),

      );

    } catch {

      await sendMessage(

        chatId,

        t(

          language,

          "walletError",

        ),

        mainKeyboard(language),

      );

    }

    return;

  }

  if (

    scope === "wallet" &&

    action === "withdraw"

  ) {

    if (!value) {

      await sendMessage(

        chatId,

        t(language, "withdraw"),

        walletMethodKeyboard(

          language,

          "withdraw",

        ),

      );

      return;

    }

    try {

      const wallet =

        telegramWalletAction(

          telegramId,

          "withdrawal",

          100,

          value as

            | "telebirr"

            | "ebirr"

            | "mpesa",

        );

      await sendMessage(

        chatId,

        `${t(

          language,

          "walletUpdated",

        )}

ETB ${wallet.balance.toFixed(2)}`,

        mainKeyboard(language),

      );

    } catch {

      await sendMessage(

        chatId,

        t(

          language,

          "walletError",

        ),

        mainKeyboard(language),

      );

    }

    return;

  }

}

async function poll(): Promise<void> {

  if (!apiBase || polling) {

    return;

  }

  polling = true;

  let offset = 0;

  try {

    await telegramRequest(

      "deleteWebhook",

      {

        drop_pending_updates:

          false,

      },

    );

    logger.info(

      "Telegram bot polling started",

    );

    while (polling) {

      try {

        const updates =

          await telegramRequest<

            TelegramUpdate[]

          >("getUpdates", {

            offset,

            timeout: 20,

            allowed_updates: [

              "message",

              "callback_query",

            ],

          });

        for (

          const update of

            updates ?? []

        ) {

          offset =

            update.update_id + 1;

          if (update.message) {

            await handleMessage(

              update.message,

            );

          }

          if (

            update.callback_query

          ) {

            await handleCallback(

              update.callback_query,

            );

          }

        }

      } catch (error) {

        logger.error(

          {

            error,

          },

          "Telegram polling error",

        );

        await new Promise(

          (resolve) =>

            setTimeout(

              resolve,

              3000,

            ),

        );

      }

    }

  } catch (error) {

    logger.error(

      {

        error,

      },

      "Telegram bot could not start",

    );

  }

}

/**

 * 24/7 automatic Bingo engine.

 *

 * The store controls:

 * - 45 second lobby

 * - live transition

 * - 3.5 second number calls

 * - winner detection

 * - completion

 * - next automatic lobby

 */

async function automaticRounds(): Promise<void> {

  try {

    const before =

      getOrCreateAutomaticGame();

    const previousStatus =

      lastAutomaticGameId ===

      before.id

        ? lastAutomaticStatus

        : undefined;

    const previousNumber =

      lastAutomaticGameId ===

      before.id

        ? lastAutomaticNumber

        : before.currentNumber;

    const updated =

      advanceAutomaticGame(

        before.id,

      );

    if (!updated) {

      return;

    }

    const gameChanged =

      lastAutomaticGameId !==

      updated.id;

    lastAutomaticGameId =

      updated.id;

    lastAutomaticStatus =

      updated.status;

    lastAutomaticNumber =

      updated.currentNumber;

    if (

      gameChanged &&

      updated.status ===

        "waiting"

    ) {

      logger.info(

        {

          gameId: updated.id,

          nextCallIn:

            updated.nextCallIn,

        },

        "Automatic Bingo lobby started",

      );

      return;

    }

    if (

      previousStatus !==

        "live" &&

      updated.status ===

        "live"

    ) {

      await notifyParticipants(

        updated.id,

        "🎱 ROUND STARTED!\n\nNumbers are now being called automatically.",

        "🎱 ዙሩ ተጀምሯል!\n\nቁጥሮች አሁን በራስ-ሰር ይጠራሉ።",

      );

      logger.info(

        {

          gameId: updated.id,

        },

        "Automatic Bingo round started",

      );

      return;

    }

    if (

      updated.status ===

        "live" &&

      updated.currentNumber !==

        previousNumber

    ) {

      await notifyParticipants(

        updated.id,

        `🎱 NUMBER CALLED: ${updated.currentNumber}\n\nCalled: ${updated.calledNumbers.length}/75`,

        `🎱 የተጠራው ቁጥር: ${updated.currentNumber}\n\nየተጠሩ: ${updated.calledNumbers.length}/75`,

      );

      logger.info(

        {

          gameId: updated.id,

          number:

            updated.currentNumber,

          called:

            updated.calledNumbers.length,

        },

        "Automatic Bingo number called",

      );

      return;

    }

    if (

      previousStatus ===

        "live" &&

      updated.status ===

        "completed"

    ) {

      await notifyParticipants(

        updated.id,

        "🏆 ROUND COMPLETE!\n\nThe next round will start automatically.",

        "🏆 ዙሩ ተጠናቋል!\n\nቀጣዩ ዙር በራስ-ሰር ይጀምራል።",

      );

      logger.info(

        {

          gameId: updated.id,

        },

        "Automatic Bingo round completed",

      );

      return;

    }

  } catch (error) {

    logger.error(

      {

        error,

      },

      "Automatic Bingo round failed",

    );

  }

}

export function startTelegramBot(): void {

  if (!botToken) {

    logger.warn(

      "BOT_TOKEN is missing; Telegram bot integration is disabled",

    );

    return;

  }

  if (!telegramPollingEnabled) {

    logger.info(

      {

        nodeEnv:

          process.env.NODE_ENV ??

          "unset",

      },

      "Telegram bot integration is disabled outside production",

    );

    return;

  }

  void poll();

  /*

   * Run the automatic game engine

   * continuously.

   *

   * The store decides whether:

   * - lobby is still counting down

   * - round should start

   * - next ball should be called

   * - winner has completed the round

   * - next lobby should be created

   */

  setInterval(() => {

    void automaticRounds();

  }, 500);

}

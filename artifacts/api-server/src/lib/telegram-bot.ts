import { logger } from "./logger";
import {
  advanceGame,
  createTelegramGame,
  getGame,
  getGameByShareCode,
  getGames,
  getTelegramCard,
  getTelegramGame,
  getTelegramHost,
  getTelegramLanguage,
  getTelegramParticipants,
  getTelegramSession,
  getTelegramWallet,
  hasTelegramUser,
  joinTelegramGame,
  setTelegramLanguage,
  setTelegramSession,
  telegramWalletAction,
  upsertTelegramUser,
  type BingoCategory,
  type BingoGame,
  type BingoGameStatus,
  type WalletMethod,
} from "./bingo-store";

type Language = "en" | "am";
type TelegramKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};
type TelegramMessage = {
  message_id: number;
  chat: { id: number };
  text?: string;
  from?: { id: number; first_name?: string; username?: string };
};
type TelegramCallback = {
  id: string;
  data?: string;
  from: { id: number; first_name?: string; username?: string };
  message?: TelegramMessage;
};
type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallback;
};

const botToken = process.env.BOT_TOKEN;
const apiBase = botToken ? `https://api.telegram.org/bot${botToken}` : undefined;
const activeCallSnapshots = new Map<string, number>();
const pendingRoomNames = new Map<string, string>();
let polling = false;

const copy: Record<Language, Record<string, string>> = {
  en: {
    welcome: "Welcome to Fast Bingo. Choose your language.",
    menu: "Fast Bingo main menu\n\nClassic 75-ball bingo. Demo mode only: no real money or gambling.",
    create: "Send a room name, then choose a room category.",
    join: "Send a room code such as FB-7K2P.",
    category: "Choose a card category.",
    created: "Room created. Share this code with your players:",
    joined: "You joined the room.",
    noRoom: "That room was not found or has already finished.",
    noGame: "You are not in an active game yet.",
    wallet: "Demo wallet only\nBalance:",
    card: "Your bingo card",
    liveRooms: "Live rooms",
    noLiveRooms: "There are no live rooms right now.",
    hostOnly: "Only the room host can use this control.",
    started: "Round started. Numbers will be called automatically.",
    paused: "Round paused.",
    reset: "Round reset.",
    bingo: "BINGO verified. The round is complete.",
    invalid: "I did not understand that. Use the menu below.",
    demo: "Demo only",
    room: "Room",
    players: "players",
    current: "Current call",
    called: "Called",
  },
  am: {
    welcome: "እንኳን ወደ Fast Bingo በደህና መጡ። ቋንቋዎን ይምረጡ።",
    menu: "እንኳን ወደ Fast ቢንጎ በደህና መጡ ❤️\n\nFast ቢንጎ እያዝናና መሸለሙን ቀጥሏል!\n\nእየተዝናኑ ያሸንፉ 🎉",
    create: "የክፍሉን ስም ይላኩ፣ ከዚያ የክፍል ምድብ ይምረጡ።",
    join: "እንደ FB-7K2P ያለ የክፍል ኮድ ይላኩ።",
    category: "የካርድ ምድብ ይምረጡ።",
    created: "ክፍሉ ተፈጥሯል። ይህን ኮድ ለተጫዋቾች ያጋሩ፦",
    joined: "ክፍሉን ተቀላቅለዋል።",
    noRoom: "ይህ ክፍል አልተገኘም ወይም ተጠናቋል።",
    noGame: "እስካሁን በንቁ ጨዋታ ውስጥ አይደሉም።",
    wallet: "የሙከራ ቦርሳ ብቻ\nቀሪ ሂሳብ፦",
    card: "የእርስዎ ቢንጎ ካርድ",
    liveRooms: "የቀጥታ ክፍሎች",
    noLiveRooms: "አሁን የቀጥታ ክፍል የለም።",
    hostOnly: "ይህን መቆጣጠሪያ የክፍሉ አስተናጋጅ ብቻ ሊጠቀምበት ይችላል።",
    started: "ዙሩ ተጀምሯል። ቁጥሮች በራስ-ሰር ይጠራሉ።",
    paused: "ዙሩ ቆሟል።",
    reset: "ዙሩ እንደገና ተጀምሯል።",
    bingo: "ቢንጎ ተረጋግጧል። ዙሩ ተጠናቋል።",
    invalid: "ያ አልገባኝም። ከታች ያለውን ምናሌ ይጠቀሙ።",
    demo: "የሙከራ ብቻ",
    room: "ክፍል",
    players: "ተጫዋቾች",
    current: "የአሁኑ ጥሪ",
    called: "የተጠሩ",
  },
};

function t(language: Language, key: string): string {
  return copy[language][key] ?? copy.en[key];
}

function nameOf(message: TelegramMessage | TelegramCallback): string {
  const user = message.from;
  return user?.first_name?.trim() || user?.username?.trim() || "Player";
}

function categoryButtons(prefix: "create" | "join"): TelegramKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "Normal", callback_data: `category:${prefix}:normal` },
        { text: "VIP", callback_data: `category:${prefix}:vip` },
        { text: "VVIP", callback_data: `category:${prefix}:vvip` },
      ],
    ],
  };
}

function menuKeyboard(language: Language): TelegramKeyboard {
  if (language === "am") {
    return {
      inline_keyboard: [
        [
          { text: "🎮 ይጫወቱ", callback_data: "menu:create" },
          { text: "💵 ሂሳብ", callback_data: "menu:wallet" },
        ],
        [
          { text: "📤 ገቢ ለማድረግ", callback_data: "menu:wallet" },
          { text: "📤 ወጪ ለማድረግ", callback_data: "menu:wallet" },
        ],
        [
          { text: "🔗 ጋብዝ & አግኝ", callback_data: "menu:home" },
          { text: "💎 VIP ክፍል", callback_data: "menu:create" },
        ],
        [
          { text: "📢 Special promoter", callback_data: "menu:home" },
          { text: "📲 እርዳታ", callback_data: "menu:home" },
        ],
        [{ text: "⚖️ ደንቦች", callback_data: "menu:home" }],
      ],
    };
  }
  return {
    inline_keyboard: [
      [
        { text: "Create room", callback_data: "menu:create" },
        { text: "Join room", callback_data: "menu:join" },
      ],
      [
        { text: "My card", callback_data: "menu:card" },
        { text: "Live rooms", callback_data: "menu:rooms" },
      ],
      [
        { text: "Demo wallet", callback_data: "menu:wallet" },
        { text: "Language", callback_data: "menu:language" },
      ],
    ],
  };
}

async function telegramRequest<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  if (!apiBase) throw new Error("BOT_TOKEN is not configured");
  const response = await fetch(`${apiBase}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as { ok: boolean; result?: T; description?: string };
  if (!response.ok || !payload.ok) {
    throw new Error(`Telegram ${method} failed: ${payload.description ?? response.statusText}`);
  }
  return payload.result as T;
}

async function sendMessage(
  chatId: string,
  text: string,
  replyMarkup?: TelegramKeyboard,
): Promise<void> {
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup,
    disable_web_page_preview: true,
  });
}

function languageKeyboard(): TelegramKeyboard {
  return {
    inline_keyboard: [[
      { text: "English", callback_data: "language:en" },
      { text: "አማርኛ", callback_data: "language:am" },
    ]],
  };
}

function categoryLabel(category: BingoCategory): string {
  return category.toUpperCase();
}

function gameSummary(game: BingoGame, language: Language): string {
  return `${t(language, "room")}: ${game.name}\n${game.shareCode}\n${game.players.length} ${t(language, "players")}\n${t(language, "current")}: ${game.currentNumber || "—"}\n${t(language, "called")}: ${game.calledNumbers.length}/75`;
}

function renderCard(game: BingoGame, telegramId: string, language: Language): string {
  const card = getTelegramCard(game.id, telegramId);
  if (!card) return t(language, "noGame");
  const marked = new Set(card.marked);
  const rows = [];
  for (let row = 0; row < 5; row += 1) {
    const values = card.numbers.slice(row * 5, row * 5 + 5).map((value) => {
      if (value === 0) return "FREE";
      return marked.has(value) ? `[${String(value).padStart(2, "0")}]` : ` ${String(value).padStart(2, "0")} `;
    });
    rows.push(values.join(" | "));
  }
  return `${t(language, "card")} · ${card.label}\nB   I   N   G   O\n${rows.join("\n")}\n\n${gameSummary(game, language)}`;
}

function hostKeyboard(game: BingoGame): TelegramKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "Start", callback_data: `host:start:${game.id}` },
        { text: "Call now", callback_data: `host:call:${game.id}` },
      ],
      [
        { text: "Pause", callback_data: `host:pause:${game.id}` },
        { text: "Reset", callback_data: `host:reset:${game.id}` },
        { text: "Claim", callback_data: `host:claim:${game.id}` },
      ],
    ],
  };
}

async function showMenu(chatId: string, language: Language): Promise<void> {
  await sendMessage(chatId, t(language, "menu"), menuKeyboard(language));
}

async function showWallet(chatId: string, language: Language, telegramId: string): Promise<void> {
  const wallet = getTelegramWallet(telegramId);
  await sendMessage(
    chatId,
    `${t(language, "wallet")} ETB ${wallet.balance.toFixed(2)}\n\nTelebirr · Demo only\n eBirr · Demo only\n M-PESA · Demo only`,
    {
      inline_keyboard: [
        [
          { text: "+100 Telebirr", callback_data: "wallet:deposit:telebirr" },
          { text: "+100 eBirr", callback_data: "wallet:deposit:ebirr" },
        ],
        [
          { text: "+100 M-PESA", callback_data: "wallet:deposit:mpesa" },
          { text: "Withdraw demo", callback_data: "wallet:withdraw:telebirr" },
        ],
        [{ text: "Main menu", callback_data: "menu:home" }],
      ],
    },
  );
}

async function showLiveRooms(chatId: string, language: Language): Promise<void> {
  const games = getGames().filter((game) => game.status !== "completed");
  if (games.length === 0) {
    await sendMessage(chatId, t(language, "noLiveRooms"), menuKeyboard(language));
    return;
  }
  const keyboard = games.slice(0, 8).map((game) => [
    { text: `${game.name} · ${game.shareCode}`, callback_data: `room:${game.id}` },
  ]);
  await sendMessage(chatId, `${t(language, "liveRooms")}\n\n${games.map((game) => gameSummary(game, language)).join("\n\n")}`, {
    inline_keyboard: [...keyboard, [{ text: "Main menu", callback_data: "menu:home" }]],
  });
}

async function showGame(chatId: string, telegramId: string, game: BingoGame): Promise<void> {
  const language = getTelegramLanguage(telegramId);
  const isHost = getTelegramHost(game.id) === telegramId;
  await sendMessage(
    chatId,
    `${gameSummary(game, language)}\n\n${renderCard(game, telegramId, language)}`,
    isHost ? hostKeyboard(game) : menuKeyboard(language),
  );
}

async function broadcastGame(game: BingoGame, previousNumber: number): Promise<void> {
  const participants = getTelegramParticipants(game.id);
  const calls = game.currentNumber ? `\n\n${game.currentNumber}` : "";
  for (const telegramId of participants) {
    const language = getTelegramLanguage(telegramId);
    const text = game.status === "completed"
      ? `${t(language, "bingo")}\n\n${gameSummary(game, language)}`
      : `${game.name}\n${t(language, "current")}: ${game.currentNumber}${calls}\n${t(language, "called")}: ${game.calledNumbers.length}/75`;
    try {
      await sendMessage(telegramId, text);
    } catch (error) {
      logger.warn({ error, telegramId }, "Could not notify Telegram player");
    }
  }
  if (previousNumber === game.currentNumber && game.status !== "completed") return;
}

async function handleMessage(message: TelegramMessage): Promise<void> {
  if (!message.from || !message.text) return;
  const telegramId = String(message.from.id);
  const chatId = String(message.chat.id);
  const known = hasTelegramUser(telegramId);
  upsertTelegramUser(telegramId, nameOf(message), message.from.username);
  const language = getTelegramLanguage(telegramId);
  const text = message.text.trim();

  if (text === "/start") {
    if (!known) {
      await sendMessage(chatId, t("en", "welcome"), languageKeyboard());
    } else {
      setTelegramSession(telegramId, "menu");
      await showMenu(chatId, language);
    }
    return;
  }
  if (text === "/menu" || text === "/help") {
    setTelegramSession(telegramId, "menu");
    await showMenu(chatId, language);
    return;
  }

  const session = getTelegramSession(telegramId);
  if (session.state === "create_name") {
    pendingRoomNames.set(telegramId, text.slice(0, 40));
    setTelegramSession(telegramId, "create_category");
    await sendMessage(chatId, `${t(language, "category")}\n\n${text.slice(0, 40)}`, categoryButtons("create"));
    return;
  }
  if (session.state === "join_code") {
    const game = getGameByShareCode(text.toUpperCase());
    if (!game) {
      await sendMessage(chatId, t(language, "noRoom"), menuKeyboard(language));
      return;
    }
    setTelegramSession(telegramId, "join_category", game.id);
    await sendMessage(chatId, `${gameSummary(game, language)}\n\n${t(language, "category")}`, categoryButtons("join"));
    return;
  }
  await sendMessage(chatId, t(language, "invalid"), menuKeyboard(language));
}

async function handleCallback(callback: TelegramCallback): Promise<void> {
  if (!callback.message || !callback.data) return;
  const telegramId = String(callback.from.id);
  const chatId = String(callback.message.chat.id);
  upsertTelegramUser(telegramId, nameOf(callback), callback.from.username);
  await telegramRequest("answerCallbackQuery", { callback_query_id: callback.id });
  const [scope, action, value] = callback.data.split(":");

  if (scope === "language" && (action === "en" || action === "am")) {
    setTelegramLanguage(telegramId, action);
    setTelegramSession(telegramId, "menu");
    await showMenu(chatId, action);
    return;
  }
  const language = getTelegramLanguage(telegramId);
  if (scope === "menu") {
    if (action === "home") {
      setTelegramSession(telegramId, "menu");
      await showMenu(chatId, language);
    } else if (action === "create") {
      setTelegramSession(telegramId, "create_name");
      await sendMessage(chatId, t(language, "create"));
    } else if (action === "join") {
      setTelegramSession(telegramId, "join_code");
      await sendMessage(chatId, t(language, "join"));
    } else if (action === "card") {
      const game = getTelegramGame(telegramId);
      if (!game) await sendMessage(chatId, t(language, "noGame"), menuKeyboard(language));
      else await showGame(chatId, telegramId, game);
    } else if (action === "rooms") {
      await showLiveRooms(chatId, language);
    } else if (action === "wallet") {
      await showWallet(chatId, language, telegramId);
    } else if (action === "language") {
      await sendMessage(chatId, t(language, "welcome"), languageKeyboard());
    }
    return;
  }
  if (scope === "category" && (action === "create" || action === "join")) {
    const category = value as BingoCategory;
    const session = getTelegramSession(telegramId);
    if (action === "create" && session.state === "create_category") {
      const game = createTelegramGame(
        pendingRoomNames.get(telegramId) || "Fast Bingo room",
        category,
        telegramId,
        nameOf(callback),
      );
      pendingRoomNames.delete(telegramId);
      setTelegramSession(telegramId, "menu", game.id);
      await sendMessage(chatId, `${t(language, "created")} ${game.shareCode}\n\n${gameSummary(game, language)}`, hostKeyboard(game));
    } else if (action === "join" && session.state === "join_category" && session.gameId) {
      const game = joinTelegramGame(session.gameId, telegramId, nameOf(callback), category);
      if (!game) await sendMessage(chatId, t(language, "noRoom"), menuKeyboard(language));
      else {
        setTelegramSession(telegramId, "menu", game.id);
        await sendMessage(chatId, `${t(language, "joined")}\n\n${gameSummary(game, language)}`);
        await showGame(chatId, telegramId, game);
      }
    }
    return;
  }
  if (scope === "room" && action) {
    const game = getGame(action);
    if (!game) {
      await sendMessage(chatId, t(language, "noRoom"), menuKeyboard(language));
      return;
    }
    setTelegramSession(telegramId, "join_category", game.id);
    await sendMessage(chatId, `${gameSummary(game, language)}\n\n${t(language, "category")}`, categoryButtons("join"));
    return;
  }
  if (scope === "wallet" && (action === "deposit" || action === "withdraw")) {
    try {
      const wallet = telegramWalletAction(
        telegramId,
        action === "withdraw" ? "withdrawal" : "deposit",
        100,
        value as WalletMethod,
      );
      await sendMessage(chatId, `${t(language, "wallet")} ETB ${wallet.balance.toFixed(2)}\n\n${t(language, "demo")}`, menuKeyboard(language));
    } catch (error) {
      await sendMessage(chatId, error instanceof Error ? error.message : "Wallet action failed", menuKeyboard(language));
    }
    return;
  }
  if (scope === "host" && action && value) {
    const game = getGame(value);
    if (!game) return;
    if (getTelegramHost(game.id) !== telegramId) {
      await sendMessage(chatId, t(language, "hostOnly"));
      return;
    }
    const updated = advanceGame(game.id, action as "start" | "call" | "pause" | "reset" | "claim");
    if (!updated) return;
    if (action === "start") await sendMessage(chatId, t(language, "started"));
    if (action === "pause") await sendMessage(chatId, t(language, "paused"));
    if (action === "reset") await sendMessage(chatId, t(language, "reset"));
    await broadcastGame(updated, game.currentNumber);
    await showGame(chatId, telegramId, updated);
  }
}

async function poll(): Promise<void> {
  if (!apiBase || polling) return;
  polling = true;
  let offset = 0;
  try {
    await telegramRequest("deleteWebhook", { drop_pending_updates: false });
    logger.info("Telegram bot polling started");
    while (polling) {
      try {
        const updates = await telegramRequest<TelegramUpdate[]>("getUpdates", {
          offset,
          timeout: 20,
          allowed_updates: ["message", "callback_query"],
        });
        for (const update of updates ?? []) {
          offset = update.update_id + 1;
          if (update.message) await handleMessage(update.message);
          if (update.callback_query) await handleCallback(update.callback_query);
        }
      } catch (error) {
        logger.error({ error }, "Telegram polling error");
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  } catch (error) {
    logger.error({ error }, "Telegram bot could not start");
  }
}

async function automaticCalls(): Promise<void> {
  for (const game of getGames().filter((item) => item.status === "live")) {
    const previousNumber = activeCallSnapshots.get(game.id) ?? game.currentNumber;
    const updated = advanceGame(game.id, "call");
    if (!updated || updated.currentNumber === previousNumber) continue;
    activeCallSnapshots.set(game.id, updated.currentNumber);
    await broadcastGame(updated, previousNumber);
  }
}

export function startTelegramBot(): void {
  if (!botToken) {
    logger.warn("BOT_TOKEN is missing; Telegram bot integration is disabled");
    return;
  }
  void poll();
  setInterval(() => {
    void automaticCalls().catch((error) => logger.error({ error }, "Automatic bingo call failed"));
  }, 10000);
}
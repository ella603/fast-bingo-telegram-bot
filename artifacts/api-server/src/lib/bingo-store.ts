import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type BingoCategory = "normal" | "vip" | "vvip";
export type BingoGameStatus = "waiting" | "live" | "completed";
export type BingoAction = "start" | "call" | "pause" | "reset" | "claim";
export type WalletMethod = "telebirr" | "ebirr" | "mpesa";

export type BingoPlayer = {
  id: string;
  name: string;
  initials: string;
  category: BingoCategory;
  cardLabel: string;
  joinedAt: string;
};

export type BingoGame = {
  id: string;
  name: string;
  status: BingoGameStatus;
  hostName: string;
  players: BingoPlayer[];
  calledNumbers: number[];
  currentNumber: number;
  nextCallIn: number;
  shareCode: string;
  winnerCount: number;
  startedAt: string;
};

export type BingoCard = {
  id: string;
  label: string;
  category: BingoCategory;
  status: "available" | "in-play" | "reserved";
  numbers: number[];
  marked: number[];
};

export type BingoActivity = {
  id: string;
  title: string;
  detail: string;
  time: string;
  tone: "success" | "info" | "warning" | "neutral";
};

export type BingoWallet = {
  balance: number;
  currency: string;
  entries: Array<{
    id: string;
    type: "deposit" | "withdrawal";
    amount: number;
    method: WalletMethod;
    status: "demo" | "pending";
    createdAt: string;
  }>;
};

const dataDir = path.resolve(process.cwd(), "data");
mkdirSync(dataDir, { recursive: true });
const database = new DatabaseSync(path.join(dataDir, "fast-bingo.sqlite"));

database.exec(`
  CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL,
    numbers TEXT NOT NULL,
    marked TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    host_name TEXT NOT NULL,
    players TEXT NOT NULL,
    called_numbers TEXT NOT NULL,
    current_number INTEGER NOT NULL DEFAULT 0,
    next_call_in INTEGER NOT NULL DEFAULT 10,
    share_code TEXT NOT NULL,
    winner_count INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS wallet (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    balance REAL NOT NULL,
    currency TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS wallet_entries (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    method TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    detail TEXT NOT NULL,
    time TEXT NOT NULL,
    tone TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS telegram_users (
    telegram_id TEXT PRIMARY KEY,
    username TEXT,
    first_name TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'en',
    category TEXT NOT NULL DEFAULT 'normal',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS telegram_sessions (
    telegram_id TEXT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'menu',
    game_id TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS telegram_wallets (
    telegram_id TEXT PRIMARY KEY,
    balance REAL NOT NULL DEFAULT 2500,
    currency TEXT NOT NULL DEFAULT 'ETB'
  );
  CREATE TABLE IF NOT EXISTS telegram_wallet_entries (
    id TEXT PRIMARY KEY,
    telegram_id TEXT NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    method TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_hosts (
    game_id TEXT PRIMARY KEY,
    telegram_id TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_player_links (
    game_id TEXT NOT NULL,
    telegram_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    PRIMARY KEY (game_id, telegram_id)
  );
`);

const now = () => new Date().toISOString();
const randomId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function makeCardNumbers(seed: number): number[] {
  const ranges = [
    [1, 15],
    [16, 30],
    [31, 45],
    [46, 60],
    [61, 75],
  ];
  const columns: number[][] = [];
  ranges.forEach(([min, max]) => {
    const pool = Array.from({ length: max - min + 1 }, (_, index) => min + index);
    columns.push(shuffle(pool).slice(0, 5).sort((a, b) => a - b));
  });
  return Array.from({ length: 5 }, (_, row) =>
    Array.from({ length: 5 }, (_, column) =>
      row === 2 && column === 2 ? 0 : columns[column][row],
    ),
  ).flat();
}

function seedCards(): void {
  const count = Number(
    (database.prepare("SELECT COUNT(*) as count FROM cards").get() as { count: number })
      .count,
  );
  if (count >= 400) return;
  const insert = database.prepare(
    "INSERT OR IGNORE INTO cards (id, label, category, status, numbers, marked) VALUES (?, ?, ?, 'available', ?, '[]')",
  );
  const categories: BingoCategory[] = [
    ...Array(360).fill("normal"),
    ...Array(32).fill("vip"),
    ...Array(8).fill("vvip"),
  ];
  for (let index = count; index < 400; index += 1) {
    const category = categories[index] ?? "normal";
    insert.run(
      `card-${String(index + 1).padStart(3, "0")}`,
      `FB-${String(index + 1).padStart(3, "0")}`,
      category,
      JSON.stringify(makeCardNumbers(index + 1)),
    );
  }
}

function seedWallet(): void {
  database
    .prepare("INSERT OR IGNORE INTO wallet (id, balance, currency) VALUES (1, 2500, 'ETB')")
    .run();
}

function seedActivities(): void {
  const count = Number(
    (database.prepare("SELECT COUNT(*) as count FROM activities").get() as { count: number })
      .count,
  );
  if (count > 0) return;
  const insert = database.prepare(
    "INSERT INTO activities (id, title, detail, time, tone) VALUES (?, ?, ?, ?, ?)",
  );
  insert.run("activity-1", "New room opened", "Selam started Friday Rush", "2 min ago", "info");
  insert.run("activity-2", "Bingo verified", "B-14 completed the top line", "8 min ago", "success");
  insert.run("activity-3", "Demo balance added", "Wallet credited with 500 ETB", "21 min ago", "neutral");
}

function readCard(row: Record<string, unknown>): BingoCard {
  return {
    id: String(row.id),
    label: String(row.label),
    category: row.category as BingoCategory,
    status: row.status as BingoCard["status"],
    numbers: JSON.parse(String(row.numbers)) as number[],
    marked: JSON.parse(String(row.marked)) as number[],
  };
}

function readGame(row: Record<string, unknown>): BingoGame {
  return {
    id: String(row.id),
    name: String(row.name),
    status: row.status as BingoGameStatus,
    hostName: String(row.host_name),
    players: JSON.parse(String(row.players)) as BingoPlayer[],
    calledNumbers: JSON.parse(String(row.called_numbers)) as number[],
    currentNumber: Number(row.current_number),
    nextCallIn: Number(row.next_call_in),
    shareCode: String(row.share_code),
    winnerCount: Number(row.winner_count),
    startedAt: String(row.started_at),
  };
}

function writeGame(game: BingoGame): void {
  database
    .prepare(
      "UPDATE games SET status = ?, host_name = ?, players = ?, called_numbers = ?, current_number = ?, next_call_in = ?, winner_count = ? WHERE id = ?",
    )
    .run(
      game.status,
      game.hostName,
      JSON.stringify(game.players),
      JSON.stringify(game.calledNumbers),
      game.currentNumber,
      game.nextCallIn,
      game.winnerCount,
      game.id,
    );
}

function cardHasWin(card: BingoCard, calledNumbers: number[]): boolean {
  const called = new Set(calledNumbers);
  const grid = card.numbers.map((value) => value === 0 || called.has(value));
  const lines = [
    [0, 1, 2, 3, 4],
    [5, 6, 7, 8, 9],
    [10, 11, 12, 13, 14],
    [15, 16, 17, 18, 19],
    [20, 21, 22, 23, 24],
    [0, 5, 10, 15, 20],
    [1, 6, 11, 16, 21],
    [2, 7, 12, 17, 22],
    [3, 8, 13, 18, 23],
    [4, 9, 14, 19, 24],
    [0, 6, 12, 18, 24],
    [4, 8, 12, 16, 20],
  ];
  return lines.some((line) => line.every((index) => grid[index]));
}

function seedGame(): void {
  const count = Number(
    (database.prepare("SELECT COUNT(*) as count FROM games").get() as { count: number }).count,
  );
  if (count > 0) return;
  const card = getCards("normal", 1)[0];
  const players: BingoPlayer[] = [
    { id: "player-1", name: "You", initials: "YO", category: "normal", cardLabel: card.label, joinedAt: now() },
    { id: "player-2", name: "Mimi", initials: "MI", category: "vip", cardLabel: "FB-041", joinedAt: now() },
    { id: "player-3", name: "Dawit", initials: "DA", category: "normal", cardLabel: "FB-112", joinedAt: now() },
    { id: "player-4", name: "Hana", initials: "HA", category: "vvip", cardLabel: "FB-397", joinedAt: now() },
  ];
  const game: BingoGame = {
    id: "game-friday-rush",
    name: "Friday Rush",
    status: "live",
    hostName: "Selam",
    players,
    calledNumbers: [14, 62, 37, 8, 54, 22, 71, 31, 6, 45, 18, 69],
    currentNumber: 69,
    nextCallIn: 8,
    shareCode: "FB-7K2P",
    winnerCount: 0,
    startedAt: now(),
  };
  database
    .prepare(
      "INSERT INTO games (id, name, status, host_name, players, called_numbers, current_number, next_call_in, share_code, winner_count, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      game.id,
      game.name,
      game.status,
      game.hostName,
      JSON.stringify(game.players),
      JSON.stringify(game.calledNumbers),
      game.currentNumber,
      game.nextCallIn,
      game.shareCode,
      game.winnerCount,
      game.startedAt,
    );
}

seedCards();
seedWallet();
seedActivities();
seedGame();

export function getCards(category?: BingoCategory, limit = 400): BingoCard[] {
  const rows = category
    ? database
        .prepare("SELECT * FROM cards WHERE category = ? ORDER BY id LIMIT ?")
        .all(category, limit)
    : database.prepare("SELECT * FROM cards ORDER BY id LIMIT ?").all(limit);
  return rows.map((row) => readCard(row as Record<string, unknown>));
}

export function getGames(): BingoGame[] {
  return database
    .prepare("SELECT * FROM games ORDER BY started_at DESC")
    .all()
    .map((row) => readGame(row as Record<string, unknown>));
}

export function getGame(id: string): BingoGame | undefined {
  const row = database.prepare("SELECT * FROM games WHERE id = ?").get(id);
  return row ? readGame(row as Record<string, unknown>) : undefined;
}

export function createGame(name: string, category: BingoCategory): BingoGame {
  const id = randomId("game");
  const shareCode = `FB-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const card = getCards(category, 1)[0];
  const player: BingoPlayer = {
    id: randomId("player"),
    name: "You",
    initials: "YO",
    category,
    cardLabel: card.label,
    joinedAt: now(),
  };
  const game: BingoGame = {
    id,
    name,
    status: "waiting",
    hostName: "You",
    players: [player],
    calledNumbers: [],
    currentNumber: 0,
    nextCallIn: 10,
    shareCode,
    winnerCount: 0,
    startedAt: now(),
  };
  database
    .prepare(
      "INSERT INTO games (id, name, status, host_name, players, called_numbers, current_number, next_call_in, share_code, winner_count, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      game.id,
      game.name,
      game.status,
      game.hostName,
      JSON.stringify(game.players),
      JSON.stringify(game.calledNumbers),
      game.currentNumber,
      game.nextCallIn,
      game.shareCode,
      game.winnerCount,
      game.startedAt,
    );
  return game;
}

export function createTelegramGame(
  name: string,
  category: BingoCategory,
  telegramId: string,
  hostName: string,
): BingoGame {
  const game = createGame(name, category);
  game.hostName = hostName;
  game.players[0].name = hostName;
  game.players[0].initials = hostName.slice(0, 2).toUpperCase();
  writeGame(game);
  database
    .prepare("INSERT OR REPLACE INTO game_hosts (game_id, telegram_id) VALUES (?, ?)")
    .run(game.id, telegramId);
  database
    .prepare(
      "INSERT OR REPLACE INTO game_player_links (game_id, telegram_id, player_id) VALUES (?, ?, ?)",
    )
    .run(game.id, telegramId, game.players[0].id);
  return game;
}

export function joinTelegramGame(
  gameId: string,
  telegramId: string,
  playerName: string,
  category: BingoCategory,
): BingoGame | undefined {
  const game = getGame(gameId);
  if (!game || game.status === "completed") return undefined;
  const existing = database
    .prepare("SELECT player_id FROM game_player_links WHERE game_id = ? AND telegram_id = ?")
    .get(gameId, telegramId);
  if (existing) return game;
  const card = getCards(category, 1)[0] ?? getCards("normal", 1)[0];
  const player: BingoPlayer = {
    id: randomId("player"),
    name: playerName,
    initials: playerName.slice(0, 2).toUpperCase(),
    category,
    cardLabel: card.label,
    joinedAt: now(),
  };
  game.players.push(player);
  writeGame(game);
  database
    .prepare("UPDATE cards SET status = ? WHERE label = ?")
    .run(game.status === "live" ? "in-play" : "reserved", card.label);
  database
    .prepare(
      "INSERT OR REPLACE INTO game_player_links (game_id, telegram_id, player_id) VALUES (?, ?, ?)",
    )
    .run(gameId, telegramId, player.id);
  return game;
}

export function getTelegramParticipants(gameId: string): string[] {
  return database
    .prepare("SELECT telegram_id FROM game_player_links WHERE game_id = ?")
    .all(gameId)
    .map((row) => String((row as Record<string, unknown>).telegram_id));
}

export function getTelegramHost(gameId: string): string | undefined {
  const row = database.prepare("SELECT telegram_id FROM game_hosts WHERE game_id = ?").get(gameId);
  return row ? String((row as Record<string, unknown>).telegram_id) : undefined;
}

export function getTelegramGame(telegramId: string): BingoGame | undefined {
  const row = database
    .prepare(
      `SELECT g.* FROM games g
       INNER JOIN game_player_links l ON l.game_id = g.id
       WHERE l.telegram_id = ? AND g.status != 'completed'
       ORDER BY g.started_at DESC LIMIT 1`,
    )
    .get(telegramId);
  return row ? readGame(row as Record<string, unknown>) : undefined;
}

export function getGameByShareCode(shareCode: string): BingoGame | undefined {
  const row = database
    .prepare("SELECT * FROM games WHERE UPPER(share_code) = UPPER(?)")
    .get(shareCode.trim());
  return row ? readGame(row as Record<string, unknown>) : undefined;
}

export function getTelegramCard(gameId: string, telegramId: string): BingoCard | undefined {
  const link = database
    .prepare("SELECT player_id FROM game_player_links WHERE game_id = ? AND telegram_id = ?")
    .get(gameId, telegramId) as Record<string, unknown> | undefined;
  if (!link) return undefined;
  const game = getGame(gameId);
  const player = game?.players.find((item) => item.id === String(link.player_id));
  if (!player) return undefined;
  const row = database.prepare("SELECT * FROM cards WHERE label = ?").get(player.cardLabel);
  return row ? readCard(row as Record<string, unknown>) : undefined;
}

export function upsertTelegramUser(
  telegramId: string,
  firstName: string,
  username?: string,
): void {
  database
    .prepare(
      `INSERT INTO telegram_users (telegram_id, first_name, username, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(telegram_id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username`,
    )
    .run(telegramId, firstName, username ?? null, now());
  database
    .prepare("INSERT OR IGNORE INTO telegram_wallets (telegram_id, balance, currency) VALUES (?, 2500, 'ETB')")
    .run(telegramId);
  database
    .prepare(
      "INSERT OR IGNORE INTO telegram_sessions (telegram_id, state, updated_at) VALUES (?, 'menu', ?)",
    )
    .run(telegramId, now());
}

export function hasTelegramUser(telegramId: string): boolean {
  const row = database
    .prepare("SELECT telegram_id FROM telegram_users WHERE telegram_id = ?")
    .get(telegramId);
  return Boolean(row);
}

export function setTelegramLanguage(telegramId: string, language: "en" | "am"): void {
  database.prepare("UPDATE telegram_users SET language = ? WHERE telegram_id = ?").run(language, telegramId);
}

export function getTelegramLanguage(telegramId: string): "en" | "am" {
  const row = database.prepare("SELECT language FROM telegram_users WHERE telegram_id = ?").get(telegramId);
  return row && (row as Record<string, unknown>).language === "am" ? "am" : "en";
}

export type TelegramSessionState = "menu" | "create_name" | "create_category" | "join_code" | "join_category";

export function setTelegramSession(
  telegramId: string,
  state: TelegramSessionState,
  gameId?: string,
): void {
  database
    .prepare(
      `INSERT INTO telegram_sessions (telegram_id, state, game_id, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(telegram_id) DO UPDATE SET state = excluded.state, game_id = excluded.game_id, updated_at = excluded.updated_at`,
    )
    .run(telegramId, state, gameId ?? null, now());
}

export function getTelegramSession(telegramId: string): {
  state: TelegramSessionState;
  gameId?: string;
} {
  const row = database
    .prepare("SELECT state, game_id FROM telegram_sessions WHERE telegram_id = ?")
    .get(telegramId) as Record<string, unknown> | undefined;
  return {
    state: (row?.state as TelegramSessionState | undefined) ?? "menu",
    gameId: row?.game_id ? String(row.game_id) : undefined,
  };
}

export function getTelegramWallet(telegramId: string): BingoWallet {
  const wallet = database
    .prepare("SELECT balance, currency FROM telegram_wallets WHERE telegram_id = ?")
    .get(telegramId) as Record<string, unknown> | undefined;
  const entries = database
    .prepare(
      "SELECT id, type, amount, method, status, created_at FROM telegram_wallet_entries WHERE telegram_id = ? ORDER BY created_at DESC",
    )
    .all(telegramId)
    .map((row) => {
      const entry = row as Record<string, unknown>;
      return {
        id: String(entry.id),
        type: entry.type as "deposit" | "withdrawal",
        amount: Number(entry.amount),
        method: entry.method as WalletMethod,
        status: entry.status as "demo" | "pending",
        createdAt: String(entry.created_at),
      };
    });
  return {
    balance: Number(wallet?.balance ?? 2500),
    currency: String(wallet?.currency ?? "ETB"),
    entries,
  };
}

export function telegramWalletAction(
  telegramId: string,
  type: "deposit" | "withdrawal",
  amount: number,
  method: WalletMethod,
): BingoWallet {
  const wallet = getTelegramWallet(telegramId);
  const nextBalance = type === "deposit" ? wallet.balance + amount : wallet.balance - amount;
  if (nextBalance < 0) throw new Error("Demo balance is too low for this withdrawal");
  database
    .prepare("INSERT OR IGNORE INTO telegram_wallets (telegram_id, balance, currency) VALUES (?, ?, 'ETB')")
    .run(telegramId, nextBalance);
  database.prepare("UPDATE telegram_wallets SET balance = ? WHERE telegram_id = ?").run(nextBalance, telegramId);
  database
    .prepare(
      "INSERT INTO telegram_wallet_entries (id, telegram_id, type, amount, method, status, created_at) VALUES (?, ?, ?, ?, ?, 'demo', ?)",
    )
    .run(randomId("wallet"), telegramId, type, amount, method, now());
  return getTelegramWallet(telegramId);
}

export function advanceGame(id: string, action: BingoAction): BingoGame | undefined {
  const game = getGame(id);
  if (!game) return undefined;
  if (action === "start") game.status = "live";
  if (action === "pause" && game.status === "live") game.status = "waiting";
  if (action === "reset") {
    game.status = "waiting";
    game.calledNumbers = [];
    game.currentNumber = 0;
    game.nextCallIn = 10;
    game.winnerCount = 0;
  }
  if (action === "call" && game.status === "live") {
    const uncalled = Array.from({ length: 75 }, (_, index) => index + 1).filter(
      (number) => !game.calledNumbers.includes(number),
    );
    const number = shuffle(uncalled)[0];
    if (number) {
      game.calledNumbers.push(number);
      game.currentNumber = number;
      game.nextCallIn = 10;
      game.players.forEach((player) => {
        const cardRow = database.prepare("SELECT * FROM cards WHERE label = ?").get(player.cardLabel);
        if (!cardRow) return;
        const card = readCard(cardRow as Record<string, unknown>);
        if (!card.marked.includes(number) && card.numbers.includes(number)) {
          card.marked.push(number);
          database.prepare("UPDATE cards SET marked = ?, status = 'in-play' WHERE id = ?").run(
            JSON.stringify(card.marked),
            card.id,
          );
        }
      });
      const hasWinner = game.players.some((player) => {
        const cardRow = database.prepare("SELECT * FROM cards WHERE label = ?").get(player.cardLabel);
        return cardRow ? cardHasWin(readCard(cardRow as Record<string, unknown>), game.calledNumbers) : false;
      });
      if (hasWinner) {
        game.winnerCount = Math.max(1, game.winnerCount);
        game.status = "completed";
      }
    }
  }
  if (action === "claim") {
    game.winnerCount = Math.max(1, game.winnerCount);
    game.status = "completed";
  }
  writeGame(game);
  return game;
}

export function getWallet(): BingoWallet {
  const wallet = database.prepare("SELECT * FROM wallet WHERE id = 1").get() as Record<string, unknown>;
  const entries = database
    .prepare("SELECT * FROM wallet_entries ORDER BY created_at DESC")
    .all()
    .map((row) => {
      const entry = row as Record<string, unknown>;
      return {
        id: String(entry.id),
        type: entry.type as "deposit" | "withdrawal",
        amount: Number(entry.amount),
        method: entry.method as WalletMethod,
        status: entry.status as "demo" | "pending",
        createdAt: String(entry.created_at),
      };
    });
  return { balance: Number(wallet.balance), currency: String(wallet.currency), entries };
}

export function walletAction(type: "deposit" | "withdrawal", amount: number, method: WalletMethod): BingoWallet {
  const wallet = getWallet();
  const nextBalance = type === "deposit" ? wallet.balance + amount : wallet.balance - amount;
  if (nextBalance < 0) throw new Error("Demo balance is too low for this withdrawal");
  database.prepare("UPDATE wallet SET balance = ? WHERE id = 1").run(nextBalance);
  database
    .prepare("INSERT INTO wallet_entries (id, type, amount, method, status, created_at) VALUES (?, ?, ?, ?, 'demo', ?)")
    .run(randomId("wallet"), type, amount, method, now());
  return getWallet();
}

export function getActivities(): BingoActivity[] {
  return database
    .prepare("SELECT * FROM activities ORDER BY rowid DESC")
    .all()
    .map((row) => {
      const activity = row as Record<string, unknown>;
      return {
        id: String(activity.id),
        title: String(activity.title),
        detail: String(activity.detail),
        time: String(activity.time),
        tone: activity.tone as BingoActivity["tone"],
      };
    });
}
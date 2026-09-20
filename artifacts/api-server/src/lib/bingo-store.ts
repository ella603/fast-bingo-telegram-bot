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

const CARD_PRICE = 10;

const PRIZE_PER_CARD = 8;

const LOBBY_SECONDS = 45;

const CALL_INTERVAL_SECONDS = 3.5;

const dataDir = path.resolve(process.cwd(), "data");

mkdirSync(dataDir, { recursive: true });

const database = new DatabaseSync(

  path.join(dataDir, "fast-bingo.sqlite"),

);

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

    next_call_in REAL NOT NULL DEFAULT 45,

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

  CREATE TABLE IF NOT EXISTS game_winners (

    game_id TEXT NOT NULL,

    telegram_id TEXT NOT NULL,

    player_id TEXT NOT NULL,

    prize REAL NOT NULL DEFAULT 0,

    created_at TEXT NOT NULL,

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

/**

 * Classic 75-ball Bingo:

 *

 * B = 1-15

 * I = 16-30

 * N = 31-45

 * G = 46-60

 * O = 61-75

 *

 * Center N3 is FREE and stored as 0.

 */

function makeCardNumbers(): number[] {

  const ranges: Array<[number, number]> = [

    [1, 15],

    [16, 30],

    [31, 45],

    [46, 60],

    [61, 75],

  ];

  const columns: number[][] = [];

  for (const [min, max] of ranges) {

    const pool = Array.from(

      { length: max - min + 1 },

      (_, index) => min + index,

    );

    const selected = shuffle(pool)

      .slice(0, 5)

      .sort((a, b) => a - b);

    columns.push(selected);

  }

  return Array.from({ length: 5 }, (_, row) =>

    Array.from({ length: 5 }, (_, column) => {

      if (row === 2 && column === 2) {

        return 0;

      }

      return columns[column][row];

    }),

  ).flat();

}

function cardSignature(numbers: number[]): string {

  return numbers.join(",");

}

/**

 * Create 400 guaranteed-different cards.

 *

 * Existing old cards are replaced with fresh unique layouts if the

 * current database does not contain 400 unique layouts.

 */

function seedCards(): void {

  const rows = database

    .prepare("SELECT id, numbers FROM cards ORDER BY id")

    .all() as Array<Record<string, unknown>>;

  const signatures = new Set<string>();

  for (const row of rows) {

    try {

      const numbers = JSON.parse(String(row.numbers)) as number[];

      signatures.add(cardSignature(numbers));

    } catch {

      // Invalid old card will be regenerated below.

    }

  }

  const needsRegeneration =

    rows.length < 400 || signatures.size < 400;

  if (!needsRegeneration) {

    return;

  }

  database.exec("DELETE FROM cards");

  const insert = database.prepare(`

    INSERT INTO cards

      (id, label, category, status, numbers, marked)

    VALUES

      (?, ?, ?, 'available', ?, '[]')

  `);

  const categories: BingoCategory[] = [

    ...Array(360).fill("normal"),

    ...Array(32).fill("vip"),

    ...Array(8).fill("vvip"),

  ];

  const unique = new Set<string>();

  let index = 0;

  while (index < 400) {

    const numbers = makeCardNumbers();

    const signature = cardSignature(numbers);

    if (unique.has(signature)) {

      continue;

    }

    unique.add(signature);

    index += 1;

    insert.run(

      `card-${String(index).padStart(3, "0")}`,

      `FB-${String(index).padStart(3, "0")}`,

      categories[index - 1] ?? "normal",

      JSON.stringify(numbers),

    );

  }

}

function seedWallet(): void {

  database

    .prepare(`

      INSERT OR IGNORE INTO wallet

        (id, balance, currency)

      VALUES

        (1, 2500, 'ETB')

    `)

    .run();

}

function seedActivities(): void {

  const count = Number(

    (

      database

        .prepare("SELECT COUNT(*) as count FROM activities")

        .get() as { count: number }

    ).count,

  );

  if (count > 0) {

    return;

  }

  const insert = database.prepare(`

    INSERT INTO activities

      (id, title, detail, time, tone)

    VALUES

      (?, ?, ?, ?, ?)

  `);

  insert.run(

    "activity-1",

    "New game opened",

    "Fast Bingo lobby is ready",

    "2 min ago",

    "info",

  );

  insert.run(

    "activity-2",

    "Bingo verified",

    "A demo player completed two lines",

    "8 min ago",

    "success",

  );

  insert.run(

    "activity-3",

    "Demo balance added",

    "Wallet credited with 500 ETB",

    "21 min ago",

    "neutral",

  );

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

    .prepare(`

      UPDATE games

      SET

        status = ?,

        host_name = ?,

        players = ?,

        called_numbers = ?,

        current_number = ?,

        next_call_in = ?,

        winner_count = ?

      WHERE id = ?

    `)

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

/**

 * A winner needs TWO completed lines.

 *

 * FREE center counts automatically.

 */

function countCompletedLines(

  card: BingoCard,

  calledNumbers: number[],

): number {

  const called = new Set(calledNumbers);

  const grid = card.numbers.map(

    (value) => value === 0 || called.has(value),

  );

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

  return lines.filter((line) =>

    line.every((index) => grid[index]),

  ).length;

}

function cardHasWin(

  card: BingoCard,

  calledNumbers: number[],

): boolean {

  return countCompletedLines(card, calledNumbers) >= 2;

}

function getPrizePool(game: BingoGame): number {

  return game.players.length * PRIZE_PER_CARD;

}

function getCardCount(game: BingoGame): number {

  return game.players.length;

}

/**

 * Credit every Telegram winner.

 *

 * If 2+ players win on the same call, all of them are winners.

 * The demo prize pool is split equally between all winners.

 */

function settleWinners(

  game: BingoGame,

): string[] {

  const winnerIds: string[] = [];

  const winnerRows: Array<{

    telegramId: string;

    playerId: string;

  }> = [];

  for (const player of game.players) {

    const cardRow = database

      .prepare("SELECT * FROM cards WHERE label = ?")

      .get(player.cardLabel);

    if (!cardRow) {

      continue;

    }

    const card = readCard(

      cardRow as Record<string, unknown>,

    );

    if (!cardHasWin(card, game.calledNumbers)) {

      continue;

    }

    const link = database

      .prepare(`

        SELECT telegram_id

        FROM game_player_links

        WHERE game_id = ? AND player_id = ?

      `)

      .get(game.id, player.id) as

      | Record<string, unknown>

      | undefined;

    if (!link) {

      continue;

    }

    winnerRows.push({

      telegramId: String(link.telegram_id),

      playerId: player.id,

    });

    winnerIds.push(player.id);

  }

  if (winnerRows.length === 0) {

    return [];

  }

  const alreadySettled = database

    .prepare(

      "SELECT COUNT(*) as count FROM game_winners WHERE game_id = ?",

    )

    .get(game.id) as { count: number };

  if (Number(alreadySettled.count) > 0) {

    return winnerIds;

  }

  const totalPrize = getPrizePool(game);

  const prizePerWinner =

    winnerRows.length > 0

      ? Number((totalPrize / winnerRows.length).toFixed(2))

      : 0;

  for (const winner of winnerRows) {

    database

      .prepare(`

        UPDATE telegram_wallets

        SET balance = balance + ?

        WHERE telegram_id = ?

      `)

      .run(prizePerWinner, winner.telegramId);

    database

      .prepare(`

        INSERT INTO telegram_wallet_entries

          (id, telegram_id, type, amount, method, status, created_at)

        VALUES

          (?, ?, 'deposit', ?, 'telebirr', 'demo', ?)

      `)

      .run(

        randomId("win"),

        winner.telegramId,

        prizePerWinner,

        now(),

      );

    database

      .prepare(`

        INSERT OR IGNORE INTO game_winners

          (game_id, telegram_id, player_id, prize, created_at)

        VALUES

          (?, ?, ?, ?, ?)

      `)

      .run(

        game.id,

        winner.telegramId,

        winner.playerId,

        prizePerWinner,

        now(),

      );

  }

  return winnerIds;

}

function seedGame(): void {

  const count = Number(

    (

      database

        .prepare("SELECT COUNT(*) as count FROM games")

        .get() as { count: number }

    ).count,

  );

  if (count > 0) {

    return;

  }

  const card = getCards("normal", 1)[0];

  if (!card) {

    return;

  }

  const players: BingoPlayer[] = [

    {

      id: "player-1",

      name: "You",

      initials: "YO",

      category: "normal",

      cardLabel: card.label,

      joinedAt: now(),

    },

    {

      id: "player-2",

      name: "Mimi",

      initials: "MI",

      category: "vip",

      cardLabel: "FB-041",

      joinedAt: now(),

    },

    {

      id: "player-3",

      name: "Dawit",

      initials: "DA",

      category: "normal",

      cardLabel: "FB-112",

      joinedAt: now(),

    },

    {

      id: "player-4",

      name: "Hana",

      initials: "HA",

      category: "vvip",

      cardLabel: "FB-397",

      joinedAt: now(),

    },

  ];

  const game: BingoGame = {

    id: "game-friday-rush",

    name: "Friday Rush",

    status: "live",

    hostName: "Selam",

    players,

    calledNumbers: [

      14,

      62,

      37,

      8,

      54,

      22,

      71,

      31,

      6,

      45,

      18,

      69,

    ],

    currentNumber: 69,

    nextCallIn: CALL_INTERVAL_SECONDS,

    shareCode: "FB-7K2P",

    winnerCount: 0,

    startedAt: now(),

  };

  database

    .prepare(`

      INSERT INTO games

        (

          id,

          name,

          status,

          host_name,

          players,

          called_numbers,

          current_number,

          next_call_in,

          share_code,

          winner_count,

          started_at

        )

      VALUES

        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

    `)

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

export function getCards(

  category?: BingoCategory,

  limit = 400,

): BingoCard[] {

  const rows = category

    ? database

        .prepare(`

          SELECT *

          FROM cards

          WHERE category = ?

          ORDER BY id

          LIMIT ?

        `)

        .all(category, limit)

    : database

        .prepare(`

          SELECT *

          FROM cards

          ORDER BY id

          LIMIT ?

        `)

        .all(limit);

  return rows.map((row) =>

    readCard(row as Record<string, unknown>),

  );

}

export function getGames(): BingoGame[] {

  return database

    .prepare(

      "SELECT * FROM games ORDER BY started_at DESC",

    )

    .all()

    .map((row) =>

      readGame(row as Record<string, unknown>),

    );

}

export function getGame(

  id: string,

): BingoGame | undefined {

  const row = database

    .prepare("SELECT * FROM games WHERE id = ?")

    .get(id);

  return row

    ? readGame(row as Record<string, unknown>)

    : undefined;

}

export function createGame(

  name: string,

  category: BingoCategory,

): BingoGame {

  const id = randomId("game");

  const shareCode =

    `FB-${Math.random()

      .toString(36)

      .slice(2, 6)

      .toUpperCase()}`;

  const card = getCards(category, 1)[0];

  if (!card) {

    throw new Error("No Bingo card available");

  }

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

    nextCallIn: LOBBY_SECONDS,

    shareCode,

    winnerCount: 0,

    startedAt: now(),

  };

  database

    .prepare(`

      INSERT INTO games

        (

          id,

          name,

          status,

          host_name,

          players,

          called_numbers,

          current_number,

          next_call_in,

          share_code,

          winner_count,

          started_at

        )

      VALUES

        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

    `)

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

  database

    .prepare(

      "UPDATE cards SET status = 'reserved' WHERE id = ?",

    )

    .run(card.id);

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

  game.players[0].initials = hostName

    .slice(0, 2)

    .toUpperCase();

  writeGame(game);

  database

    .prepare(`

      INSERT OR REPLACE INTO game_hosts

        (game_id, telegram_id)

      VALUES

        (?, ?)

    `)

    .run(game.id, telegramId);

  database

    .prepare(`

      INSERT OR REPLACE INTO game_player_links

        (game_id, telegram_id, player_id)

      VALUES

        (?, ?, ?)

    `)

    .run(

      game.id,

      telegramId,

      game.players[0].id,

    );

  return game;

}

export function joinTelegramGame(

  gameId: string,

  telegramId: string,

  playerName: string,

  category: BingoCategory,

): BingoGame | undefined {

  const game = getGame(gameId);

  if (!game || game.status === "completed") {

    return undefined;

  }

  if (game.status === "live") {

    return undefined;

  }

  const existing = database

    .prepare(`

      SELECT player_id

      FROM game_player_links

      WHERE game_id = ? AND telegram_id = ?

    `)

    .get(gameId, telegramId);

  if (existing) {

    return game;

  }

  const wallet = getTelegramWallet(telegramId);

  if (wallet.balance < CARD_PRICE) {

    throw new Error(

      `A demo card costs ${CARD_PRICE} ETB`,

    );

  }

  const card =

    getCards(category, 400).find(

      (item) => item.status === "available",

    ) ??

    getCards("normal", 400).find(

      (item) => item.status === "available",

    );

  if (!card) {

    throw new Error("No available Bingo card");

  }

  database

    .prepare(`

      UPDATE telegram_wallets

      SET balance = balance - ?

      WHERE telegram_id = ?

    `)

    .run(CARD_PRICE, telegramId);

  database

    .prepare(`

      INSERT INTO telegram_wallet_entries

        (

          id,

          telegram_id,

          type,

          amount,

          method,

          status,

          created_at

        )

      VALUES

        (?, ?, 'withdrawal', ?, 'telebirr', 'demo', ?)

    `)

    .run(

      randomId("card"),

      telegramId,

      CARD_PRICE,

      now(),

    );

  const player: BingoPlayer = {

    id: randomId("player"),

    name: playerName,

    initials: playerName

      .slice(0, 2)

      .toUpperCase(),

    category,

    cardLabel: card.label,

    joinedAt: now(),

  };

  game.players.push(player);

  writeGame(game);

  database

    .prepare(

      "UPDATE cards SET status = 'reserved', marked = '[]' WHERE id = ?",

    )

    .run(card.id);

  database

    .prepare(`

      INSERT OR REPLACE INTO game_player_links

        (game_id, telegram_id, player_id)

      VALUES

        (?, ?, ?)

    `)

    .run(

      gameId,

      telegramId,

      player.id,

    );

  return game;

}

/**

 * Select a specific available card during the 45-second lobby.

 */

export function selectTelegramCard(

  gameId: string,

  telegramId: string,

  cardId: string,

): BingoGame | undefined {

  const game = getGame(gameId);

  if (!game || game.status !== "waiting") {

    return undefined;

  }

  const link = database

    .prepare(`

      SELECT player_id

      FROM game_player_links

      WHERE game_id = ? AND telegram_id = ?

    `)

    .get(gameId, telegramId) as

    | Record<string, unknown>

    | undefined;

  if (!link) {

    return undefined;

  }

  const playerId = String(link.player_id);

  const player = game.players.find(

    (item) => item.id === playerId,

  );

  if (!player) {

    return undefined;

  }

  const cardRow = database

    .prepare("SELECT * FROM cards WHERE id = ?")

    .get(cardId) as

    | Record<string, unknown>

    | undefined;

  if (!cardRow) {

    return undefined;

  }

  const card = readCard(cardRow);

  if (card.status !== "available") {

    return undefined;

  }

  const oldCard = database

    .prepare(

      "SELECT * FROM cards WHERE label = ?",

    )

    .get(player.cardLabel);

  if (oldCard) {

    database

      .prepare(`

        UPDATE cards

        SET status = 'available', marked = '[]'

        WHERE label = ?

      `)

      .run(player.cardLabel);

  }

  player.cardLabel = card.label;

  writeGame(game);

  database

    .prepare(`

      UPDATE cards

      SET status = 'reserved', marked = '[]'

      WHERE id = ?

    `)

    .run(card.id);

  return game;

}

export function getTelegramParticipants(

  gameId: string,

): string[] {

  return database

    .prepare(`

      SELECT telegram_id

      FROM game_player_links

      WHERE game_id = ?

    `)

    .all(gameId)

    .map((row) =>

      String(

        (row as Record<string, unknown>)

          .telegram_id,

      ),

    );

}

export function getTelegramHost(

  gameId: string,

): string | undefined {

  const row = database

    .prepare(`

      SELECT telegram_id

      FROM game_hosts

      WHERE game_id = ?

    `)

    .get(gameId);

  return row

    ? String(

        (row as Record<string, unknown>)

          .telegram_id,

      )

    : undefined;

}

export function getTelegramGame(

  telegramId: string,

): BingoGame | undefined {

  const row = database

    .prepare(`

      SELECT g.*

      FROM games g

      INNER JOIN game_player_links l

        ON l.game_id = g.id

      WHERE

        l.telegram_id = ?

        AND g.status != 'completed'

      ORDER BY g.started_at DESC

      LIMIT 1

    `)

    .get(telegramId);

  return row

    ? readGame(row as Record<string, unknown>)

    : undefined;

}

export function getGameByShareCode(

  shareCode: string,

): BingoGame | undefined {

  const row = database

    .prepare(`

      SELECT *

      FROM games

      WHERE UPPER(share_code) = UPPER(?)

    `)

    .get(shareCode.trim());

  return row

    ? readGame(row as Record<string, unknown>)

    : undefined;

}

export function getTelegramCard(

  gameId: string,

  telegramId: string,

): BingoCard | undefined {

  const link = database

    .prepare(`

      SELECT player_id

      FROM game_player_links

      WHERE game_id = ? AND telegram_id = ?

    `)

    .get(gameId, telegramId) as

    | Record<string, unknown>

    | undefined;

  if (!link) {

    return undefined;

  }

  const game = getGame(gameId);

  const player = game?.players.find(

    (item) =>

      item.id === String(link.player_id),

  );

  if (!player) {

    return undefined;

  }

  const row = database

    .prepare(

      "SELECT * FROM cards WHERE label = ?",

    )

    .get(player.cardLabel);

  return row

    ? readCard(row as Record<string, unknown>)

    : undefined;

}

export function upsertTelegramUser(

  telegramId: string,

  firstName: string,

  username?: string,

): void {

  database

    .prepare(`

      INSERT INTO telegram_users

        (

          telegram_id,

          first_name,

          username,

          created_at

        )

      VALUES

        (?, ?, ?, ?)

      ON CONFLICT(telegram_id)

      DO UPDATE SET

        first_name = excluded.first_name,

        username = excluded.username

    `)

    .run(

      telegramId,

      firstName,

      username ?? null,

      now(),

    );

  database

    .prepare(`

      INSERT OR IGNORE INTO telegram_wallets

        (telegram_id, balance, currency)

      VALUES

        (?, 2500, 'ETB')

    `)

    .run(telegramId);

  database

    .prepare(`

      INSERT OR IGNORE INTO telegram_sessions

        (telegram_id, state, updated_at)

      VALUES

        (?, 'menu', ?)

    `)

    .run(telegramId, now());

}

export function hasTelegramUser(

  telegramId: string,

): boolean {

  const row = database

    .prepare(`

      SELECT telegram_id

      FROM telegram_users

      WHERE telegram_id = ?

    `)

    .get(telegramId);

  return Boolean(row);

}

export function setTelegramLanguage(

  telegramId: string,

  language: "en" | "am",

): void {

  database

    .prepare(`

      UPDATE telegram_users

      SET language = ?

      WHERE telegram_id = ?

    `)

    .run(language, telegramId);

}

export function getTelegramLanguage(

  telegramId: string,

): "en" | "am" {

  const row = database

    .prepare(`

      SELECT language

      FROM telegram_users

      WHERE telegram_id = ?

    `)

    .get(telegramId);

  return row &&

    (row as Record<string, unknown>)

      .language === "am"

    ? "am"

    : "en";

}

export type TelegramSessionState =

  | "menu"

  | "create_name"

  | "create_category"

  | "join_code"

  | "join_category";

export function setTelegramSession(

  telegramId: string,

  state: TelegramSessionState,

  gameId?: string,

): void {

  database

    .prepare(`

      INSERT INTO telegram_sessions

        (

          telegram_id,

          state,

          game_id,

          updated_at

        )

      VALUES

        (?, ?, ?, ?)

      ON CONFLICT(telegram_id)

      DO UPDATE SET

        state = excluded.state,

        game_id = excluded.game_id,

        updated_at = excluded.updated_at

    `)

    .run(

      telegramId,

      state,

      gameId ?? null,

      now(),

    );

}

export function getTelegramSession(

  telegramId: string,

): {

  state: TelegramSessionState;

  gameId?: string;

} {

  const row = database

    .prepare(`

      SELECT state, game_id

      FROM telegram_sessions

      WHERE telegram_id = ?

    `)

    .get(telegramId) as

    | Record<string, unknown>

    | undefined;

  return {

    state:

      (row?.state as

        | TelegramSessionState

        | undefined) ?? "menu",

    gameId: row?.game_id

      ? String(row.game_id)

      : undefined,

  };

}

export function getTelegramWallet(

  telegramId: string,

): BingoWallet {

  const wallet = database

    .prepare(`

      SELECT balance, currency

      FROM telegram_wallets

      WHERE telegram_id = ?

    `)

    .get(telegramId) as

    | Record<string, unknown>

    | undefined;

  const entries = database

    .prepare(`

      SELECT

        id,

        type,

        amount,

        method,

        status,

        created_at

      FROM telegram_wallet_entries

      WHERE telegram_id = ?

      ORDER BY created_at DESC

    `)

    .all(telegramId)

    .map((row) => {

      const entry =

        row as Record<string, unknown>;

      return {

        id: String(entry.id),

        type: entry.type as

          | "deposit"

          | "withdrawal",

        amount: Number(entry.amount),

        method:

          entry.method as WalletMethod,

        status: entry.status as

          | "demo"

          | "pending",

        createdAt: String(

          entry.created_at,

        ),

      };

    });

  return {

    balance: Number(

      wallet?.balance ?? 2500,

    ),

    currency: String(

      wallet?.currency ?? "ETB",

    ),

    entries,

  };

}

export function telegramWalletAction(

  telegramId: string,

  type: "deposit" | "withdrawal",

  amount: number,

  method: WalletMethod,

): BingoWallet {

  if (!Number.isFinite(amount) || amount <= 0) {

    throw new Error(

      "Amount must be greater than zero",

    );

  }

  const wallet =

    getTelegramWallet(telegramId);

  const nextBalance =

    type === "deposit"

      ? wallet.balance + amount

      : wallet.balance - amount;

  if (nextBalance < 0) {

    throw new Error(

      "Demo balance is too low for this withdrawal",

    );

  }

  database

    .prepare(`

      INSERT OR IGNORE INTO telegram_wallets

        (telegram_id, balance, currency)

      VALUES

        (?, ?, 'ETB')

    `)

    .run(

      telegramId,

      nextBalance,

    );

  database

    .prepare(`

      UPDATE telegram_wallets

      SET balance = ?

      WHERE telegram_id = ?

    `)

    .run(

      nextBalance,

      telegramId,

    );

  database

    .prepare(`

      INSERT INTO telegram_wallet_entries

        (

          id,

          telegram_id,

          type,

          amount,

          method,

          status,

          created_at

        )

      VALUES

        (?, ?, ?, ?, ?, 'demo', ?)

    `)

    .run(

      randomId("wallet"),

      telegramId,

      type,

      amount,

      method,

      now(),

    );

  return getTelegramWallet(

    telegramId,

  );

}

/**

 * Start:

 * 45-second lobby/countdown.

 *

 * Once live:

 * every call uses a 3.5-second interval.

 */

export function advanceGame(

  id: string,

  action: BingoAction,

): BingoGame | undefined {

  const game = getGame(id);

  if (!game) {

    return undefined;

  }

  if (action === "start") {

    if (game.status === "waiting") {

      /*

       * First start opens the 45-second lobby.

       * A second start after the lobby can begin the live phase.

       */

      if (

        game.calledNumbers.length === 0 &&

        game.nextCallIn > CALL_INTERVAL_SECONDS

      ) {

        game.nextCallIn =

          LOBBY_SECONDS;

      } else {

        game.status = "live";

        game.nextCallIn =

          CALL_INTERVAL_SECONDS;

        game.players.forEach((player) => {

          database

            .prepare(`

              UPDATE cards

              SET

                status = 'in-play',

                marked = '[]'

              WHERE label = ?

            `)

            .run(player.cardLabel);

        });

      }

    }

  }

  if (

    action === "pause" &&

    game.status === "live"

  ) {

    game.status = "waiting";

  }

  if (action === "reset") {

    game.status = "waiting";

    game.calledNumbers = [];

    game.currentNumber = 0;

    game.nextCallIn = LOBBY_SECONDS;

    game.winnerCount = 0;

    database

      .prepare(`

        DELETE FROM game_winners

        WHERE game_id = ?

      `)

      .run(game.id);

    game.players.forEach((player) => {

      database

        .prepare(`

          UPDATE cards

          SET

            status = 'reserved',

            marked = '[]'

          WHERE label = ?

        `)

        .run(player.cardLabel);

    });

  }

  if (

    action === "call" &&

    game.status === "live"

  ) {

    const uncalled =

      Array.from(

        { length: 75 },

        (_, index) => index + 1,

      ).filter(

        (number) =>

          !game.calledNumbers.includes(

            number,

          ),

      );

    const number =

      shuffle(uncalled)[0];

    if (number) {

      game.calledNumbers.push(number);

      game.currentNumber = number;

      game.nextCallIn =

        CALL_INTERVAL_SECONDS;

      game.players.forEach((player) => {

        const cardRow = database

          .prepare(`

            SELECT *

            FROM cards

            WHERE label = ?

          `)

          .get(player.cardLabel);

        if (!cardRow) {

          return;

        }

        const card = readCard(

          cardRow as Record<string, unknown>,

        );

        if (

          !card.marked.includes(number) &&

          card.numbers.includes(number)

        ) {

          card.marked.push(number);

          database

            .prepare(`

              UPDATE cards

              SET

                marked = ?,

                status = 'in-play'

              WHERE id = ?

            `)

            .run(

              JSON.stringify(card.marked),

              card.id,

            );

        }

      });

      const winners =

        settleWinners(game);

      if (winners.length > 0) {

        game.winnerCount =

          winners.length;

        game.status =

          "completed";

        game.nextCallIn = 0;

        game.players.forEach(

          (player) => {

            database

              .prepare(`

                UPDATE cards

                SET status = 'available'

                WHERE label = ?

              `)

              .run(player.cardLabel);

          },

        );

      }

    }

  }

  if (action === "claim") {

    const winners =

      settleWinners(game);

    if (winners.length > 0) {

      game.winnerCount =

        winners.length;

    } else {

      game.winnerCount =

        Math.max(1, game.winnerCount);

    }

    game.status = "completed";

    game.nextCallIn = 0;

  }

  writeGame(game);

  return game;

}

export function getWallet(): BingoWallet {

  const wallet = database

    .prepare(

      "SELECT * FROM wallet WHERE id = 1",

    )

    .get() as Record<string, unknown>;

  const entries = database

    .prepare(`

      SELECT *

      FROM wallet_entries

      ORDER BY created_at DESC

    `)

    .all()

    .map((row) => {

      const entry =

        row as Record<string, unknown>;

      return {

        id: String(entry.id),

        type: entry.type as

          | "deposit"

          | "withdrawal",

        amount: Number(entry.amount),

        method:

          entry.method as WalletMethod,

        status:

          entry.status as

            | "demo"

            | "pending",

        createdAt: String(

          entry.created_at,

        ),

      };

    });

  return {

    balance: Number(wallet.balance),

    currency: String(wallet.currency),

    entries,

  };

}

export function walletAction(

  type: "deposit" | "withdrawal",

  amount: number,

  method: WalletMethod,

): BingoWallet {

  if (!Number.isFinite(amount) || amount <= 0) {

    throw new Error(

      "Amount must be greater than zero",

    );

  }

  const wallet = getWallet();

  const nextBalance =

    type === "deposit"

      ? wallet.balance + amount

      : wallet.balance - amount;

  if (nextBalance < 0) {

    throw new Error(

      "Demo balance is too low for this withdrawal",

    );

  }

  database

    .prepare(`

      UPDATE wallet

      SET balance = ?

      WHERE id = 1

    `)

    .run(nextBalance);

  database

    .prepare(`

      INSERT INTO wallet_entries

        (

          id,

          type,

          amount,

          method,

          status,

          created_at

        )

      VALUES

        (?, ?, ?, ?, 'demo', ?)

    `)

    .run(

      randomId("wallet"),

      type,

      amount,

      method,

      now(),

    );

  return getWallet();

}

export function getActivities(): BingoActivity[] {

  return database

    .prepare(`

      SELECT *

      FROM activities

      ORDER BY rowid DESC

    `)

    .all()

    .map((row) => {

      const activity =

        row as Record<string, unknown>;

      return {

        id: String(activity.id),

        title: String(activity.title),

        detail: String(activity.detail),

        time: String(activity.time),

        tone:

          activity.tone as BingoActivity["tone"],

      };

    });

}

/**

 * Useful game constants for the API/bot.

 */

export function getBingoConfig() {

  return {

    cardPrice: CARD_PRICE,

    prizePerCard: PRIZE_PER_CARD,

    lobbySeconds: LOBBY_SECONDS,

    callIntervalSeconds:

      CALL_INTERVAL_SECONDS,

    totalCards: 400,

    totalNumbers: 75,

    winningLines: 2,

  };

}

export function getGamePrizePool(

  gameId: string,

): number {

  const game = getGame(gameId);

  if (!game) {

    return 0;

  }

  return getPrizePool(game);

}

export function getGameCardCount(

  gameId: string,

): number {

  const game = getGame(gameId);

  if (!game) {

    return 0;

  }

  return getCardCount(game);

}

export function getGameWinners(

  gameId: string,

): Array<{

  telegramId: string;

  playerId: string;

  prize: number;

  createdAt: string;

}> {

  return database

    .prepare(`

      SELECT

        telegram_id,

        player_id,

        prize,

        created_at

      FROM game_winners

      WHERE game_id = ?

      ORDER BY created_at ASC

    `)

    .all(gameId)

    .map((row) => {

      const item =

        row as Record<string, unknown>;

      return {

        telegramId: String(

          item.telegram_id,

        ),

        playerId: String(

          item.player_id,

        ),

        prize: Number(item.prize),

        createdAt: String(

          item.created_at,

        ),

      };

    });

}
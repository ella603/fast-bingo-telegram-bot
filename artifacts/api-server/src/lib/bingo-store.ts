import { mkdirSync } from "node:fs";

import path from "node:path";

import { DatabaseSync } from "node:sqlite";

export type BingoCategory =

  | "normal"

  | "vip"

  | "vvip";

export type BingoGameStatus =

  | "waiting"

  | "live"

  | "completed";

export type BingoAction =

  | "start"

  | "call"

  | "pause"

  | "reset"

  | "claim";

export type WalletMethod =

  | "telebirr"

  | "ebirr"

  | "mpesa";

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

  status:

    | "available"

    | "in-play"

    | "reserved";

  numbers: number[];

  marked: number[];

};

export type BingoActivity = {

  id: string;

  title: string;

  detail: string;

  time: string;

  tone:

    | "success"

    | "info"

    | "warning"

    | "neutral";

};

export type BingoWallet = {

  balance: number;

  currency: string;

  entries: Array<{

    id: string;

    type:

      | "deposit"

      | "withdrawal";

    amount: number;

    method: WalletMethod;

    status:

      | "pending"

      | "completed";

    createdAt: string;

  }>;

};

/* =========================================================

   FAST BINGO — DEMO PAYMENT DISPLAY SETTINGS

   CHANGE ONLY THE VALUES BELOW.

   This is DISPLAY / DEMO configuration only.

   It does NOT transfer real money.

   ========================================================= */

export const PAYMENT_DISPLAY = {

  telebirr: {

    name: "Hanza",

    number: "0999960421",

  },

  ebirr: {

    name: "Belay",

    number: "0999960421",

  },

  mpesa: {

    name: "Gemechu",

    number: "0786192665",

  },

} as const;

/* =========================================================

   WALLET SETTINGS

   ========================================================= */

const MIN_DEPOSIT_AMOUNT = 50;

const REGISTRATION_BONUS = 20;

const DEPOSIT_BONUS_PERCENT = 5;

const INITIAL_PLAY_BALANCE = 0;

const INITIAL_MAIN_BALANCE = 0;

/* =========================================================

   BINGO SETTINGS

   ========================================================= */

const CARD_PRICE = 10;

const PRIZE_PER_CARD = 8;

const LOBBY_SECONDS = 45;

const CALL_INTERVAL_SECONDS = 3.5;

const DISPLAY_CALL_INTERVAL_SECONDS = 3;

const MAX_CARDS_PER_USER = 4;

const TOTAL_CARDS = 400;

const TOTAL_NUMBERS = 75;

const WINNING_LINES = 2;

/* =========================================================

   DATABASE

   ========================================================= */

const dataDir = path.resolve(

  process.cwd(),

  "data",

);

mkdirSync(dataDir, {

  recursive: true,

});

const database = new DatabaseSync(

  path.join(

    dataDir,

    "fast-bingo.sqlite",

  ),

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

    balance REAL NOT NULL DEFAULT 0,

    currency TEXT NOT NULL DEFAULT 'ETB',

    main_balance REAL NOT NULL DEFAULT 0,

    play_balance REAL NOT NULL DEFAULT 0,

    registration_bonus_received INTEGER NOT NULL DEFAULT 0

  );

  CREATE TABLE IF NOT EXISTS telegram_wallet_entries (

    id TEXT PRIMARY KEY,

    telegram_id TEXT NOT NULL,

    type TEXT NOT NULL,

    amount REAL NOT NULL,

    method TEXT NOT NULL,

    status TEXT NOT NULL,

    created_at TEXT NOT NULL,

    balance_type TEXT NOT NULL DEFAULT 'play',

    bonus REAL NOT NULL DEFAULT 0

  );

  CREATE TABLE IF NOT EXISTS deposit_requests (

    id TEXT PRIMARY KEY,

    telegram_id TEXT NOT NULL,

    amount REAL NOT NULL,

    method TEXT NOT NULL,

    status TEXT NOT NULL DEFAULT 'pending',

    bonus REAL NOT NULL DEFAULT 0,

    created_at TEXT NOT NULL,

    reviewed_at TEXT

  );

  CREATE TABLE IF NOT EXISTS withdrawal_requests (

    id TEXT PRIMARY KEY,

    telegram_id TEXT NOT NULL,

    amount REAL NOT NULL,

    method TEXT NOT NULL,

    status TEXT NOT NULL DEFAULT 'pending',

    created_at TEXT NOT NULL,

    reviewed_at TEXT

  );

  CREATE TABLE IF NOT EXISTS games_admin (

    id INTEGER PRIMARY KEY CHECK (id = 1),

    updated_at TEXT

  );

  CREATE TABLE IF NOT EXISTS game_hosts (

    game_id TEXT PRIMARY KEY,

    telegram_id TEXT NOT NULL

  );

  CREATE TABLE IF NOT EXISTS game_player_links (

    game_id TEXT NOT NULL,

    telegram_id TEXT NOT NULL,

    player_id TEXT NOT NULL,

    PRIMARY KEY (game_id, telegram_id, player_id)

  );

  CREATE TABLE IF NOT EXISTS game_winners (

    game_id TEXT NOT NULL,

    telegram_id TEXT NOT NULL,

    player_id TEXT NOT NULL,

    prize REAL NOT NULL DEFAULT 0,

    created_at TEXT NOT NULL,

    PRIMARY KEY (game_id, telegram_id, player_id)

  );

`);

/* =========================================================

   DATABASE MIGRATION HELPERS

   ========================================================= */

function getTableColumns(

  table: string,

): Array<Record<string, unknown>> {

  return database

    .prepare(

      `PRAGMA table_info(${table})`,

    )

    .all() as Array<

    Record<string, unknown>

  >;

}

function hasColumn(

  table: string,

  column: string,

): boolean {

  return getTableColumns(table).some(

    (item) =>

      String(item.name) === column,

  );

}

function addColumnIfMissing(

  table: string,

  column: string,

  definition: string,

): void {

  if (!hasColumn(table, column)) {

    database.exec(

      `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,

    );

  }

}

/* =========================================================

   WALLET DATABASE MIGRATION

   ========================================================= */

function migrateWalletTables(): void {

  addColumnIfMissing(

    "telegram_wallets",

    "main_balance",

    "REAL NOT NULL DEFAULT 0",

  );

  addColumnIfMissing(

    "telegram_wallets",

    "play_balance",

    "REAL NOT NULL DEFAULT 0",

  );

  addColumnIfMissing(

    "telegram_wallets",

    "registration_bonus_received",

    "INTEGER NOT NULL DEFAULT 0",

  );

  addColumnIfMissing(

    "telegram_wallet_entries",

    "balance_type",

    "TEXT NOT NULL DEFAULT 'play'",

  );

  addColumnIfMissing(

    "telegram_wallet_entries",

    "bonus",

    "REAL NOT NULL DEFAULT 0",

  );

  /*

   * Existing old balance becomes Play Balance.

   * This keeps old users' existing demo balance.

   */

  database.exec(`

    UPDATE telegram_wallets

    SET play_balance = balance

    WHERE

      play_balance = 0

      AND balance != 0

  `);

}

/* =========================================================

   OLD DATABASE MIGRATION

   ========================================================= */

function migrateGamePlayerLinks(): void {

  const columns = database

    .prepare(

      "PRAGMA table_info(game_player_links)",

    )

    .all() as Array<

    Record<string, unknown>

  >;

  const primaryKeys =

    columns.filter(

      (column) =>

        Number(column.pk) > 0,

    );

  const alreadySupportsMultipleCards =

    primaryKeys.length === 3 &&

    primaryKeys.some(

      (column) =>

        String(column.name) ===

        "game_id",

    ) &&

    primaryKeys.some(

      (column) =>

        String(column.name) ===

        "telegram_id",

    ) &&

    primaryKeys.some(

      (column) =>

        String(column.name) ===

        "player_id",

    );

  if (

    alreadySupportsMultipleCards

  ) {

    return;

  }

  database.exec(`

    ALTER TABLE game_player_links

    RENAME TO game_player_links_old;

    CREATE TABLE game_player_links (

      game_id TEXT NOT NULL,

      telegram_id TEXT NOT NULL,

      player_id TEXT NOT NULL,

      PRIMARY KEY (

        game_id,

        telegram_id,

        player_id

      )

    );

    INSERT OR IGNORE INTO game_player_links

      (

        game_id,

        telegram_id,

        player_id

      )

    SELECT

      game_id,

      telegram_id,

      player_id

    FROM game_player_links_old;

    DROP TABLE game_player_links_old;

  `);

}

function migrateGameWinners(): void {

  const columns = database

    .prepare(

      "PRAGMA table_info(game_winners)",

    )

    .all() as Array<

    Record<string, unknown>

  >;

  const primaryKeys =

    columns.filter(

      (column) =>

        Number(column.pk) > 0,

    );

  const supportsMultipleWinnerCards =

    primaryKeys.length === 3 &&

    primaryKeys.some(

      (column) =>

        String(column.name) ===

        "game_id",

    ) &&

    primaryKeys.some(

      (column) =>

        String(column.name) ===

        "telegram_id",

    ) &&

    primaryKeys.some(

      (column) =>

        String(column.name) ===

        "player_id",

    );

  if (

    supportsMultipleWinnerCards

  ) {

    return;

  }

  database.exec(`

    ALTER TABLE game_winners

    RENAME TO game_winners_old;

    CREATE TABLE game_winners (

      game_id TEXT NOT NULL,

      telegram_id TEXT NOT NULL,

      player_id TEXT NOT NULL,

      prize REAL NOT NULL DEFAULT 0,

      created_at TEXT NOT NULL,

      PRIMARY KEY (

        game_id,

        telegram_id,

        player_id

      )

    );

    INSERT OR IGNORE INTO game_winners

      (

        game_id,

        telegram_id,

        player_id,

        prize,

        created_at

      )

    SELECT

      game_id,

      telegram_id,

      player_id,

      prize,

      created_at

    FROM game_winners_old;

    DROP TABLE game_winners_old;

  `);

}

migrateGamePlayerLinks();

migrateGameWinners();

migrateWalletTables();

/* =========================================================

   HELPERS

   ========================================================= */

const now = () =>

  new Date().toISOString();

const randomId = (

  prefix: string,

) =>

  `${prefix}-${Math.random()

    .toString(36)

    .slice(2, 8)}`;

function shuffle<T>(

  items: T[],

): T[] {

  const copy = [...items];

  for (

    let i = copy.length - 1;

    i > 0;

    i -= 1

  ) {

    const j = Math.floor(

      Math.random() * (i + 1),

    );

    [

      copy[i],

      copy[j],

    ] = [

      copy[j],

      copy[i],

    ];

  }

  return copy;

}

/* =========================================================

   CARD GENERATION

   ========================================================= */

function makeCardNumbers(): number[] {

  const ranges: Array<

    [number, number]

  > = [

    [1, 15],

    [16, 30],

    [31, 45],

    [46, 60],

    [61, 75],

  ];

  const columns: number[][] = [];

  for (

    const [min, max] of ranges

  ) {

    const pool = Array.from(

      {

        length:

          max - min + 1,

      },

      (_, index) =>

        min + index,

    );

    const selected = shuffle(

      pool,

    )

      .slice(0, 5)

      .sort(

        (a, b) => a - b,

      );

    columns.push(

      selected,

    );

  }

  return Array.from(

    { length: 5 },

    (_, row) =>

      Array.from(

        { length: 5 },

        (_, column) => {

          if (

            row === 2 &&

            column === 2

          ) {

            return 0;

          }

          return columns[

            column

          ][row];

        },

      ),

  ).flat();

}

function cardSignature(

  numbers: number[],

): string {

  return numbers.join(",");

}

function seedCards(): void {

  const rows =

    database

      .prepare(

        "SELECT id, numbers FROM cards ORDER BY id",

      )

      .all() as Array<

      Record<string, unknown>

    >;

  const signatures =

    new Set<string>();

  for (const row of rows) {

    try {

      const numbers =

        JSON.parse(

          String(row.numbers),

        ) as number[];

      signatures.add(

        cardSignature(numbers),

      );

    } catch {

      // Regenerate invalid cards.

    }

  }

  if (

    rows.length >= TOTAL_CARDS &&

    signatures.size >= TOTAL_CARDS

  ) {

    return;

  }

  database.exec(

    "DELETE FROM cards",

  );

  const insert =

    database.prepare(`

      INSERT INTO cards

        (

          id,

          label,

          category,

          status,

          numbers,

          marked

        )

      VALUES

        (

          ?,

          ?,

          ?,

          'available',

          ?,

          '[]'

        )

    `);

  const categories:

    BingoCategory[] = [

      ...Array(360).fill(

        "normal",

      ),

      ...Array(32).fill(

        "vip",

      ),

      ...Array(8).fill(

        "vvip",

      ),

    ];

  const unique =

    new Set<string>();

  let index = 0;

  while (

    index < TOTAL_CARDS

  ) {

    const numbers =

      makeCardNumbers();

    const signature =

      cardSignature(

        numbers,

      );

    if (

      unique.has(signature)

    ) {

      continue;

    }

    unique.add(

      signature,

    );

    index += 1;

    insert.run(

      `card-${String(

        index,

      ).padStart(3, "0")}`,

      `FB-${String(

        index,

      ).padStart(3, "0")}`,

      categories[

        index - 1

      ] ?? "normal",

      JSON.stringify(

        numbers,

      ),

    );

  }

}

/* =========================================================

   WALLET / ACTIVITY SEED

   ========================================================= */

function seedWallet(): void {

  database

    .prepare(`

      INSERT OR IGNORE INTO wallet

        (

          id,

          balance,

          currency

        )

      VALUES

        (

          1,

          0,

          'ETB'

        )

    `)

    .run();

}

function seedActivities(): void {

  const count =

    Number(

      (

        database

          .prepare(

            "SELECT COUNT(*) as count FROM activities",

          )

          .get() as {

          count: number;

        }

      ).count,

    );

  if (count > 0) {

    return;

  }

  const insert =

    database.prepare(`

      INSERT INTO activities

        (

          id,

          title,

          detail,

          time,

          tone

        )

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

    "A player completed two lines",

    "8 min ago",

    "success",

  );

  insert.run(

    "activity-3",

    "Balance added",

    "Demo wallet activity",

    "21 min ago",

    "neutral",

  );

}

/* =========================================================

   READ / WRITE

   ========================================================= */

function readCard(

  row: Record<string, unknown>,

): BingoCard {

  return {

    id: String(row.id),

    label: String(row.label),

    category:

      row.category as BingoCategory,

    status:

      row.status as BingoCard["status"],

    numbers:

      JSON.parse(

        String(row.numbers),

      ) as number[],

    marked:

      JSON.parse(

        String(row.marked),

      ) as number[],

  };

}

function readGame(

  row: Record<string, unknown>,

): BingoGame {

  return {

    id: String(row.id),

    name: String(row.name),

    status:

      row.status as BingoGameStatus,

    hostName: String(

      row.host_name,

    ),

    players:

      JSON.parse(

        String(row.players),

      ) as BingoPlayer[],

    calledNumbers:

      JSON.parse(

        String(

          row.called_numbers,

        ),

      ) as number[],

    currentNumber:

      Number(

        row.current_number,

      ),

    nextCallIn:

      Number(

        row.next_call_in,

      ),

    shareCode: String(

      row.share_code,

    ),

    winnerCount:

      Number(

        row.winner_count,

      ),

    startedAt: String(

      row.started_at,

    ),

  };

}

function writeGame(

  game: BingoGame,

): void {

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

      JSON.stringify(

        game.players,

      ),

      JSON.stringify(

        game.calledNumbers,

      ),

      game.currentNumber,

      game.nextCallIn,

      game.winnerCount,

      game.id,

    );

}

/* =========================================================

   BINGO WIN RULE

   ========================================================= */

function countCompletedLines(

  card: BingoCard,

  calledNumbers: number[],

): number {

  const called =

    new Set(

      calledNumbers,

    );

  const grid =

    card.numbers.map(

      (value) =>

        value === 0 ||

        called.has(value),

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

  return lines.filter(

    (line) =>

      line.every(

        (index) =>

          grid[index],

      ),

  ).length;

}

function cardHasWin(

  card: BingoCard,

  calledNumbers: number[],

): boolean {

  return (

    countCompletedLines(

      card,

      calledNumbers,

    ) >= WINNING_LINES

  );

}

/* =========================================================

   CARD / PLAYER HELPERS

   ========================================================= */

function getPlayersForTelegramUser(

  gameId: string,

  telegramId: string,

): BingoPlayer[] {

  const game =

    getGame(gameId);

  if (!game) {

    return [];

  }

  const links =

    database

      .prepare(`

        SELECT player_id

        FROM game_player_links

        WHERE

          game_id = ?

          AND telegram_id = ?

        ORDER BY rowid ASC

      `)

      .all(

        gameId,

        telegramId,

      ) as Array<

      Record<string, unknown>

    >;

  const ids =

    new Set(

      links.map(

        (row) =>

          String(

            row.player_id,

          ),

      ),

    );

  return game.players.filter(

    (player) =>

      ids.has(player.id),

  );

}

function countTelegramCards(

  gameId: string,

  telegramId: string,

): number {

  return Number(

    (

      database

        .prepare(`

          SELECT COUNT(*) as count

          FROM game_player_links

          WHERE

            game_id = ?

            AND telegram_id = ?

        `)

        .get(

          gameId,

          telegramId,

        ) as {

        count: number;

      }

    ).count,

  );

}

function releasePlayerCards(

  game: BingoGame,

): void {

  for (

    const player of game.players

  ) {

    database

      .prepare(`

        UPDATE cards

        SET

          status = 'available',

          marked = '[]'

        WHERE label = ?

      `)

      .run(

        player.cardLabel,

      );

  }

}

/* =========================================================

   PRIZE POOL

   ========================================================= */

function getPrizePool(

  game: BingoGame,

): number {

  return (

    game.players.length *

    PRIZE_PER_CARD

  );

}

function getCardCount(

  game: BingoGame,

): number {

  return game.players.length;

}

/* =========================================================

   WINNER SETTLEMENT

   ========================================================= */

function settleWinners(

  game: BingoGame,

): string[] {

  const winnerRows:

    Array<{

      telegramId: string;

      playerId: string;

    }> = [];

  for (

    const player of game.players

  ) {

    const cardRow =

      database

        .prepare(

          "SELECT * FROM cards WHERE label = ?",

        )

        .get(

          player.cardLabel,

        );

    if (!cardRow) {

      continue;

    }

    const card =

      readCard(

        cardRow as Record<

          string,

          unknown

        >,

      );

    if (

      !cardHasWin(

        card,

        game.calledNumbers,

      )

    ) {

      continue;

    }

    const link =

      database

        .prepare(`

          SELECT telegram_id

          FROM game_player_links

          WHERE

            game_id = ?

            AND player_id = ?

        `)

        .get(

          game.id,

          player.id,

        ) as

        | Record<

            string,

            unknown

          >

        | undefined;

    if (!link) {

      continue;

    }

    winnerRows.push({

      telegramId:

        String(

          link.telegram_id,

        ),

      playerId:

        player.id,

    });

  }

  if (

    winnerRows.length === 0

  ) {

    return [];

  }

  const unsettled =

    winnerRows.filter(

      (winner) => {

        const row =

          database

            .prepare(`

              SELECT 1

              FROM game_winners

              WHERE

                game_id = ?

                AND telegram_id = ?

                AND player_id = ?

              LIMIT 1

            `)

            .get(

              game.id,

              winner.telegramId,

              winner.playerId,

            );

        return !row;

      },

    );

  if (

    unsettled.length === 0

  ) {

    return winnerRows.map(

      (winner) =>

        winner.playerId,

    );

  }

  const totalPrize =

    getPrizePool(game);

  /*

   * IMPORTANT:

   * All winners share the same prize pool equally.

   */

  const prizePerWinner =

    Number(

      (

        totalPrize /

        winnerRows.length

      ).toFixed(2),

    );

  for (

    const winner of unsettled

  ) {

    ensureTelegramWallet(

      winner.telegramId,

    );

    database

      .prepare(`

        UPDATE telegram_wallets

        SET

          play_balance =

            play_balance + ?,

          balance =

            play_balance + ?

        WHERE telegram_id = ?

      `)

      .run(

        prizePerWinner,

        prizePerWinner,

        winner.telegramId,

      );

    database

      .prepare(`

        INSERT INTO

          telegram_wallet_entries

          (

            id,

            telegram_id,

            type,

            amount,

            method,

            status,

            created_at,

            balance_type,

            bonus

          )

        VALUES

          (

            ?,

            ?,

            'deposit',

            ?,

            'telebirr',

            'completed',

            ?,

            'play',

            0

          )

      `)

      .run(

        randomId("win"),

        winner.telegramId,

        prizePerWinner,

        now(),

      );

    database

      .prepare(`

        INSERT OR IGNORE INTO

          game_winners

          (

            game_id,

            telegram_id,

            player_id,

            prize,

            created_at

          )

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

  return winnerRows.map(

    (winner) =>

      winner.playerId,

  );

}

/* =========================================================

   AUTOMATIC GAME SEED

   ========================================================= */

function createLobbyGame(): BingoGame {

  const id =

    randomId("game");

  const shareCode =

    `FB-${Math.random()

      .toString(36)

      .slice(2, 6)

      .toUpperCase()}`;

  const game: BingoGame = {

    id,

    name: "Fast Bingo",

    status: "waiting",

    hostName:

      "Fast Bingo",

    players: [],

    calledNumbers: [],

    currentNumber: 0,

    nextCallIn:

      LOBBY_SECONDS,

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

      JSON.stringify(

        game.players,

      ),

      JSON.stringify(

        game.calledNumbers,

      ),

      game.currentNumber,

      game.nextCallIn,

      game.shareCode,

      game.winnerCount,

      game.startedAt,

    );

  return game;

}

function seedGame(): void {

  const count =

    Number(

      (

        database

          .prepare(

            "SELECT COUNT(*) as count FROM games",

          )

          .get() as {

          count: number;

        }

      ).count,

    );

  if (count > 0) {

    return;

  }

  createLobbyGame();

}

seedCards();

seedWallet();

seedActivities();

seedGame();

/* =========================================================

   TELEGRAM WALLET INTERNAL HELPERS

   ========================================================= */

function ensureTelegramWallet(

  telegramId: string,

): void {

  database

    .prepare(`

      INSERT OR IGNORE INTO

        telegram_wallets

        (

          telegram_id,

          balance,

          currency,

          main_balance,

          play_balance,

          registration_bonus_received

        )

      VALUES

        (?, ?, 'ETB', ?, ?, 0)

    `)

    .run(

      telegramId,

      INITIAL_PLAY_BALANCE,

      INITIAL_MAIN_BALANCE,

      INITIAL_PLAY_BALANCE,

    );

  /*

   * Keep old "balance" compatible with Play Balance.

   */

  database

    .prepare(`

      UPDATE telegram_wallets

      SET balance = play_balance

      WHERE telegram_id = ?

    `)

    .run(

      telegramId,

    );

}

function giveRegistrationBonus(

  telegramId: string,

): void {

  ensureTelegramWallet(

    telegramId,

  );

  const wallet =

    database

      .prepare(`

        SELECT

          registration_bonus_received

        FROM telegram_wallets

        WHERE telegram_id = ?

      `)

      .get(

        telegramId,

      ) as

      | Record<

          string,

          unknown

        >

      | undefined;

  if (

    Number(

      wallet?.registration_bonus_received ??

        0,

    ) === 1

  ) {

    return;

  }

  database

    .prepare(`

      UPDATE telegram_wallets

      SET

        play_balance =

          play_balance + ?,

        balance =

          play_balance + ?,

        registration_bonus_received = 1

      WHERE telegram_id = ?

    `)

    .run(

      REGISTRATION_BONUS,

      REGISTRATION_BONUS,

      telegramId,

    );

  database

    .prepare(`

      INSERT INTO

        telegram_wallet_entries

        (

          id,

          telegram_id,

          type,

          amount,

          method,

          status,

          created_at,

          balance_type,

          bonus

        )

      VALUES

        (

          ?,

          ?,

          'deposit',

          ?,

          'telebirr',

          'completed',

          ?,

          'play',

          ?

        )

    `)

    .run(

      randomId("signup"),

      telegramId,

      REGISTRATION_BONUS,

      now(),

      REGISTRATION_BONUS,

    );

}

/* =========================================================

   PUBLIC GAME FUNCTIONS

   ========================================================= */

export function getCards(

  category?: BingoCategory,

  limit = TOTAL_CARDS,

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

        .all(

          category,

          limit,

        )

    : database

        .prepare(`

          SELECT *

          FROM cards

          ORDER BY id

          LIMIT ?

        `)

        .all(limit);

  return rows.map(

    (row) =>

      readCard(

        row as Record<

          string,

          unknown

        >,

      ),

  );

}

export function getGames(): BingoGame[] {

  return database

    .prepare(`

      SELECT *

      FROM games

      ORDER BY started_at DESC

    `)

    .all()

    .map(

      (row) =>

        readGame(

          row as Record<

            string,

            unknown

          >,

        ),

    );

}

export function getGame(

  id: string,

): BingoGame | undefined {

  const row =

    database

      .prepare(

        "SELECT * FROM games WHERE id = ?",

      )

      .get(id);

  return row

    ? readGame(

        row as Record<

          string,

          unknown

        >,

      )

    : undefined;

}

export function getCurrentAutomaticGame():

  BingoGame {

  const row =

    database

      .prepare(`

        SELECT *

        FROM games

        WHERE status != 'completed'

        ORDER BY

          CASE

            WHEN status = 'waiting'

            THEN 0

            ELSE 1

          END,

          started_at DESC

        LIMIT 1

      `)

      .get();

  if (row) {

    return readGame(

      row as Record<

        string,

        unknown

      >,

    );

  }

  return createLobbyGame();

}

export function createGame(

  name: string,

  category: BingoCategory,

): BingoGame {

  const id =

    randomId("game");

  const shareCode =

    `FB-${Math.random()

      .toString(36)

      .slice(2, 6)

      .toUpperCase()}`;

  const card =

    getCards(

      category,

      TOTAL_CARDS,

    ).find(

      (item) =>

        item.status ===

        "available",

    ) ??

    getCards(

      "normal",

      TOTAL_CARDS,

    ).find(

      (item) =>

        item.status ===

        "available",

    );

  if (!card) {

    throw new Error(

      "No Bingo card available",

    );

  }

  const player:

    BingoPlayer = {

    id: randomId(

      "player",

    ),

    name: "You",

    initials: "YO",

    category,

    cardLabel:

      card.label,

    joinedAt: now(),

  };

  const game:

    BingoGame = {

    id,

    name,

    status: "waiting",

    hostName: "You",

    players: [player],

    calledNumbers: [],

    currentNumber: 0,

    nextCallIn:

      LOBBY_SECONDS,

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

      JSON.stringify(

        game.players,

      ),

      JSON.stringify(

        game.calledNumbers,

      ),

      game.currentNumber,

      game.nextCallIn,

      game.shareCode,

      game.winnerCount,

      game.startedAt,

    );

  database

    .prepare(`

      UPDATE cards

      SET

        status = 'reserved',

        marked = '[]'

      WHERE id = ?

    `)

    .run(card.id);

  return game;

}

/* =========================================================

   TELEGRAM GAME

   ========================================================= */

export function createTelegramGame(

  name: string,

  category: BingoCategory,

  telegramId: string,

  hostName: string,

): BingoGame {

  const game =

    createGame(

      name,

      category,

    );

  game.hostName =

    hostName;

  game.players[0].name =

    hostName;

  game.players[0].initials =

    hostName

      .slice(0, 2)

      .toUpperCase();

  writeGame(game);

  database

    .prepare(`

      INSERT OR REPLACE INTO

        game_hosts

        (

          game_id,

          telegram_id

        )

      VALUES

        (?, ?)

    `)

    .run(

      game.id,

      telegramId,

    );

  database

    .prepare(`

      INSERT OR IGNORE INTO

        game_player_links

        (

          game_id,

          telegram_id,

          player_id

        )

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

/* =========================================================

   JOIN WITH ONE CARD

   ========================================================= */

export function joinTelegramGame(

  gameId: string,

  telegramId: string,

  playerName: string,

  category: BingoCategory,

): BingoGame | undefined {

  const game =

    getGame(gameId);

  if (

    !game ||

    game.status !==

      "waiting"

  ) {

    return undefined;

  }

  const existingCount =

    countTelegramCards(

      gameId,

      telegramId,

    );

  if (

    existingCount >=

    MAX_CARDS_PER_USER

  ) {

    throw new Error(

      `Maximum ${MAX_CARDS_PER_USER} cards allowed`,

    );

  }

  const wallet =

    getTelegramWallet(

      telegramId,

    );

  if (

    wallet.balance <

    CARD_PRICE

  ) {

    throw new Error(

      `Insufficient balance for a card`,

    );

  }

  const card =

    getCards(

      category,

      TOTAL_CARDS,

    ).find(

      (item) =>

        item.status ===

        "available",

    ) ??

    getCards(

      "normal",

      TOTAL_CARDS,

    ).find(

      (item) =>

        item.status ===

        "available",

    );

  if (!card) {

    throw new Error(

      "No available Bingo card",

    );

  }

  database

    .prepare(`

      UPDATE telegram_wallets

      SET

        play_balance =

          play_balance - ?,

        balance =

          play_balance - ?

      WHERE telegram_id = ?

    `)

    .run(

      CARD_PRICE,

      CARD_PRICE,

      telegramId,

    );

  database

    .prepare(`

      INSERT INTO

        telegram_wallet_entries

        (

          id,

          telegram_id,

          type,

          amount,

          method,

          status,

          created_at,

          balance_type,

          bonus

        )

      VALUES

        (

          ?,

          ?,

          'withdrawal',

          ?,

          'telebirr',

          'completed',

          ?,

          'play',

          0

        )

    `)

    .run(

      randomId("card"),

      telegramId,

      CARD_PRICE,

      now(),

    );

  const player:

    BingoPlayer = {

    id: randomId(

      "player",

    ),

    name: playerName,

    initials:

      playerName

        .slice(0, 2)

        .toUpperCase(),

    category,

    cardLabel:

      card.label,

    joinedAt: now(),

  };

  game.players.push(

    player,

  );

  writeGame(game);

  database

    .prepare(`

      UPDATE cards

      SET

        status = 'reserved',

        marked = '[]'

      WHERE id = ?

    `)

    .run(card.id);

  database

    .prepare(`

      INSERT INTO

        game_player_links

        (

          game_id,

          telegram_id,

          player_id

        )

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

/* =========================================================

   SELECT / REPLACE ONE CARD

   ========================================================= */

export function selectTelegramCard(

  gameId: string,

  telegramId: string,

  cardId: string,

): BingoGame | undefined {

  const game =

    getGame(gameId);

  if (

    !game ||

    game.status !==

      "waiting"

  ) {

    return undefined;

  }

  const players =

    getPlayersForTelegramUser(

      gameId,

      telegramId,

    );

  if (

    players.length === 0

  ) {

    return undefined;

  }

  const cardRow =

    database

      .prepare(

        "SELECT * FROM cards WHERE id = ?",

      )

      .get(

        cardId,

      ) as

      | Record<

          string,

          unknown

        >

      | undefined;

  if (!cardRow) {

    return undefined;

  }

  const card =

    readCard(

      cardRow,

    );

  if (

    card.status !==

    "available"

  ) {

    return undefined;

  }

  const player =

    players[0];

  const oldCard =

    database

      .prepare(

        "SELECT * FROM cards WHERE label = ?",

      )

      .get(

        player.cardLabel,

      );

  if (oldCard) {

    database

      .prepare(`

        UPDATE cards

        SET

          status = 'available',

          marked = '[]'

        WHERE label = ?

      `)

      .run(

        player.cardLabel,

      );

  }

  player.cardLabel =

    card.label;

  writeGame(game);

  database

    .prepare(`

      UPDATE cards

      SET

        status = 'reserved',

        marked = '[]'

      WHERE id = ?

    `)

    .run(

      card.id,

    );

  return game;

}

/* =========================================================

   TELEGRAM CARDS

   ========================================================= */

export function getTelegramCards(

  gameId: string,

  telegramId: string,

): BingoCard[] {

  const players =

    getPlayersForTelegramUser(

      gameId,

      telegramId,

    );

  if (

    players.length === 0

  ) {

    return [];

  }

  const cards:

    BingoCard[] = [];

  for (

    const player of players

  ) {

    const row =

      database

        .prepare(

          "SELECT * FROM cards WHERE label = ?",

        )

        .get(

          player.cardLabel,

        );

    if (row) {

      cards.push(

        readCard(

          row as Record<

            string,

            unknown

          >,

        ),

      );

    }

  }

  return cards;

}

export function getTelegramCardCount(

  gameId: string,

  telegramId: string,

): number {

  return countTelegramCards(

    gameId,

    telegramId,

  );

}

/* =========================================================

   PARTICIPANTS

   ========================================================= */

export function getTelegramParticipants(

  gameId: string,

): string[] {

  return database

    .prepare(`

      SELECT DISTINCT

        telegram_id

      FROM game_player_links

      WHERE game_id = ?

    `)

    .all(gameId)

    .map(

      (row) =>

        String(

          (

            row as Record<

              string,

              unknown

            >

          ).telegram_id,

        ),

    );

}

export function getTelegramHost(

  gameId: string,

): string | undefined {

  const row =

    database

      .prepare(`

        SELECT telegram_id

        FROM game_hosts

        WHERE game_id = ?

      `)

      .get(

        gameId,

      );

  return row

    ? String(

        (

          row as Record<

            string,

            unknown

          >

        ).telegram_id,

      )

    : undefined;

}

export function getTelegramGame(

  telegramId: string,

): BingoGame | undefined {

  const row =

    database

      .prepare(`

        SELECT g.*

        FROM games g

        INNER JOIN game_player_links l

          ON l.game_id = g.id

        WHERE

          l.telegram_id = ?

          AND g.status != 'completed'

        ORDER BY

          g.started_at DESC

        LIMIT 1

      `)

      .get(

        telegramId,

      );

  if (row) {

    return readGame(

      row as Record<

        string,

        unknown

      >,

    );

  }

  return getCurrentAutomaticGame();

}

export function getGameByShareCode(

  shareCode: string,

): BingoGame | undefined {

  const row =

    database

      .prepare(`

        SELECT *

        FROM games

        WHERE

          UPPER(share_code) =

          UPPER(?)

      `)

      .get(

        shareCode.trim(),

      );

  return row

    ? readGame(

        row as Record<

          string,

          unknown

        >,

      )

    : undefined;

}

export function getTelegramCard(

  gameId: string,

  telegramId: string,

): BingoCard | undefined {

  return getTelegramCards(

    gameId,

    telegramId,

  )[0];

}

/* =========================================================

   TELEGRAM USER

   ========================================================= */

export function upsertTelegramUser(

  telegramId: string,

  firstName: string,

  username?: string,

): void {

  const isNew =

    !hasTelegramUser(

      telegramId,

    );

  database

    .prepare(`

      INSERT INTO

        telegram_users

        (

          telegram_id,

          first_name,

          username,

          created_at

        )

      VALUES

        (?, ?, ?, ?)

      ON CONFLICT(

        telegram_id

      )

      DO UPDATE SET

        first_name =

          excluded.first_name,

        username =

          excluded.username

    `)

    .run(

      telegramId,

      firstName,

      username ??

        null,

      now(),

    );

  ensureTelegramWallet(

    telegramId,

  );

  /*

   * Only a genuinely new Telegram

   * account receives the 20 ETB

   * demo registration bonus.

   */

  if (isNew) {

    giveRegistrationBonus(

      telegramId,

    );

  }

  database

    .prepare(`

      INSERT OR IGNORE INTO

        telegram_sessions

        (

          telegram_id,

          state,

          updated_at

        )

      VALUES

        (?, 'menu', ?)

    `)

    .run(

      telegramId,

      now(),

    );

}

export function hasTelegramUser(

  telegramId: string,

): boolean {

  const row =

    database

      .prepare(`

        SELECT telegram_id

        FROM telegram_users

        WHERE telegram_id = ?

      `)

      .get(

        telegramId,

      );

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

    .run(

      language,

      telegramId,

    );

}

export function getTelegramLanguage(

  telegramId: string,

): "en" | "am" {

  const row =

    database

      .prepare(`

        SELECT language

        FROM telegram_users

        WHERE telegram_id = ?

      `)

      .get(

        telegramId,

      );

  return row &&

    (

      row as Record<

        string,

        unknown

      >

    ).language ===

      "am"

    ? "am"

    : "en";

}

/* =========================================================

   SESSION

   ========================================================= */

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

      INSERT INTO

        telegram_sessions

        (

          telegram_id,

          state,

          game_id,

          updated_at

        )

      VALUES

        (?, ?, ?, ?)

      ON CONFLICT(

        telegram_id

      )

      DO UPDATE SET

        state =

          excluded.state,

        game_id =

          excluded.game_id,

        updated_at =

          excluded.updated_at

    `)

    .run(

      telegramId,

      state,

      gameId ??

        null,

      now(),

    );

}

export function getTelegramSession(

  telegramId: string,

): {

  state: TelegramSessionState;

  gameId?: string;

} {

  const row =

    database

      .prepare(`

        SELECT

          state,

          game_id

        FROM telegram_sessions

        WHERE telegram_id = ?

      `)

      .get(

        telegramId,

      ) as

      | Record<

          string,

          unknown

        >

      | undefined;

  return {

    state:

      (

        row?.state as

          | TelegramSessionState

          | undefined

      ) ?? "menu",

    gameId:

      row?.game_id

        ? String(

            row.game_id,

          )

        : undefined,

  };

}

/* =========================================================

   TELEGRAM WALLET

   ========================================================= */

export function getTelegramWallet(

  telegramId: string,

): BingoWallet {

  ensureTelegramWallet(

    telegramId,

  );

  const wallet =

    database

      .prepare(`

        SELECT

          play_balance,

          currency

        FROM telegram_wallets

        WHERE telegram_id = ?

      `)

      .get(

        telegramId,

      ) as

      | Record<

          string,

          unknown

        >

      | undefined;

  const entries =

    database

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

        ORDER BY

          created_at DESC

      `)

      .all(

        telegramId,

      )

      .map(

        (row) => {

          const entry =

            row as Record<

              string,

              unknown

            >;

          return {

            id: String(

              entry.id,

            ),

            type:

              entry.type as

                | "deposit"

                | "withdrawal",

            amount:

              Number(

                entry.amount,

              ),

            method:

              entry.method as WalletMethod,

            status:

              entry.status as

                | "completed"

                | "pending",

            createdAt:

              String(

                entry.created_at,

              ),

          };

        },

      );

  return {

    balance: Number(

      wallet?.play_balance ??

        INITIAL_PLAY_BALANCE,

    ),

    currency: String(

      wallet?.currency ??

        "ETB",

    ),

    entries,

  };

}

/* =========================================================

   BALANCE DETAILS

   ========================================================= */

export function getTelegramBalances(

  telegramId: string,

): {

  mainBalance: number;

  playBalance: number;

  currency: string;

} {

  ensureTelegramWallet(

    telegramId,

  );

  const row =

    database

      .prepare(`

        SELECT

          main_balance,

          play_balance,

          currency

        FROM telegram_wallets

        WHERE telegram_id = ?

      `)

      .get(

        telegramId,

      ) as

      | Record<

          string,

          unknown

        >

      | undefined;

  return {

    mainBalance:

      Number(

        row?.main_balance ??

          0,

      ),

    playBalance:

      Number(

        row?.play_balance ??

          0,

      ),

    currency:

      String(

        row?.currency ??

          "ETB",

      ),

  };

}

/* =========================================================

   PAYMENT METHODS

   ========================================================= */

export function getPaymentMethods() {

  return {

    telebirr: {

      name:

        PAYMENT_DISPLAY.Hanza,

      number:

        PAYMENT_DISPLAY.0999960421,

      minDeposit:

        MIN_DEPOSIT_AMOUNT,

    },

    ebirr: {

      name:

        PAYMENT_DISPLAY.Tesema,

      number:

        PAYMENT_DISPLAY.0999960421,

      minDeposit:

        MIN_DEPOSIT_AMOUNT,

    },

    mpesa: {

      name:

        PAYMENT_DISPLAY.Gemechu,

      number:

        PAYMENT_DISPLAY.0786192665,

      minDeposit:

        MIN_DEPOSIT_AMOUNT,

    },

  };

}

/* =========================================================

   DEMO DEPOSIT REQUEST

   ========================================================= */

export function createDepositRequest(

  telegramId: string,

  amount: number,

  method: WalletMethod,

): {

  id: string;

  status: "pending";

  amount: number;

  bonus: number;

  totalAfterApproval: number;

} {

  if (

    !Number.isFinite(

      amount,

    ) ||

    amount < MIN_DEPOSIT_AMOUNT

  ) {

    throw new Error(

      `Minimum deposit is ${MIN_DEPOSIT_AMOUNT} ETB`,

    );

  }

  const requestId =

    randomId("deposit");

  const bonus =

    Number(

      (

        amount *

        (DEPOSIT_BONUS_PERCENT /

          100)

      ).toFixed(2),

    );

  database

    .prepare(`

      INSERT INTO deposit_requests

        (

          id,

          telegram_id,

          amount,

          method,

          status,

          bonus,

          created_at

        )

      VALUES

        (?, ?, ?, ?, 'pending', ?, ?)

    `)

    .run(

      requestId,

      telegramId,

      amount,

      method,

      bonus,

      now(),

    );

  return {

    id: requestId,

    status: "pending",

    amount,

    bonus,

    totalAfterApproval:

      amount + bonus,

  };

}

/* =========================================================

   DEMO ADMIN — APPROVE DEPOSIT

   ========================================================= */

export function approveDepositRequest(

  requestId: string,

): {

  ok: boolean;

  amount?: number;

  bonus?: number;

  total?: number;

} {

  const request =

    database

      .prepare(`

        SELECT *

        FROM deposit_requests

        WHERE id = ?

      `)

      .get(

        requestId,

      ) as

      | Record<

          string,

          unknown

        >

      | undefined;

  if (!request) {

    return {

      ok: false,

    };

  }

  if (

    String(

      request.status,

    ) !== "pending"

  ) {

    return {

      ok: false,

    };

  }

  const telegramId =

    String(

      request.telegram_id,

    );

  const amount =

    Number(

      request.amount,

    );

  const bonus =

    Number(

      request.bonus,

    );

  ensureTelegramWallet(

    telegramId,

  );

  const total =

    amount + bonus;

  database

    .prepare(`

      UPDATE telegram_wallets

      SET main_balance =

        main_balance + ?

      WHERE telegram_id = ?

    `)

    .run(

      total,

      telegramId,

    );

  database

    .prepare(`

      UPDATE deposit_requests

      SET

        status = 'completed',

        reviewed_at = ?

      WHERE id = ?

    `)

    .run(

      now(),

      requestId,

    );

  database

    .prepare(`

      INSERT INTO

        telegram_wallet_entries

        (

          id,

          telegram_id,

          type,

          amount,

          method,

          status,

          created_at,

          balance_type,

          bonus

        )

      VALUES

        (

          ?,

          ?,

          'deposit',

          ?,

          ?,

          'completed',

          ?,

          'main',

          ?

        )

    `)

    .run(

      randomId("deposit"),

      telegramId,

      amount,

      String(

        request.method,

      ) as WalletMethod,

      now(),

      bonus,

    );

  return {

    ok: true,

    amount,

    bonus,

    total,

  };

}

/* =========================================================

   DEMO WITHDRAWAL REQUEST

   ========================================================= */

export function createWithdrawalRequest(

  telegramId: string,

  amount: number,

  method: WalletMethod,

): {

  id: string;

  status: "pending";

  amount: number;

} {

  if (

    !Number.isFinite(

      amount,

    ) ||

    amount <= 0

  ) {

    throw new Error(

      "Amount must be greater than zero",

    );

  }

  ensureTelegramWallet(

    telegramId,

  );

  const wallet =

    getTelegramBalances(

      telegramId,

    );

  /*

   * Withdrawal is allowed ONLY

   * from Play Balance.

   */

  if (

    amount >

    wallet.playBalance

  ) {

    throw new Error(

      "Insufficient Play Balance",

    );

  }

  /*

   * Reserve the requested amount

   * immediately so it cannot be

   * withdrawn twice.

   */

  database

    .prepare(`

      UPDATE telegram_wallets

      SET

        play_balance =

          play_balance - ?,

        balance =

          play_balance - ?

      WHERE telegram_id = ?

    `)

    .run(

      amount,

      amount,

      telegramId,

    );

  const requestId =

    randomId("withdraw");

  database

    .prepare(`

      INSERT INTO withdrawal_requests

        (

          id,

          telegram_id,

          amount,

          method,

          status,

          created_at

        )

      VALUES

        (

          ?,

          ?,

          ?,

          ?,

          'pending',

          ?

        )

    `)

    .run(

      requestId,

      telegramId,

      amount,

      method,

      now(),

    );

  database

    .prepare(`

      INSERT INTO

        telegram_wallet_entries

        (

          id,

          telegram_id,

          type,

          amount,

          method,

          status,

          created_at,

          balance_type,

          bonus

        )

      VALUES

        (

          ?,

          ?,

          'withdrawal',

          ?,

          ?,

          'pending',

          ?,

          'play',

          0

        )

    `)

    .run(

      randomId("withdraw"),

      telegramId,

      amount,

      method,

      now(),

    );

  return {

    id: requestId,

    status: "pending",

    amount,

  };

}

/* =========================================================

   DEMO ADMIN — APPROVE WITHDRAWAL

   ========================================================= */

export function approveWithdrawalRequest(

  requestId: string,

): boolean {

  const request =

    database

      .prepare(`

        SELECT *

        FROM withdrawal_requests

        WHERE id = ?

      `)

      .get(

        requestId,

      ) as

      | Record<

          string,

          unknown

        >

      | undefined;

  if (!request) {

    return false;

  }

  if (

    String(

      request.status,

    ) !== "pending"

  ) {

    return false;

  }

  database

    .prepare(`

      UPDATE withdrawal_requests

      SET

        status = 'completed',

        reviewed_at = ?

      WHERE id = ?

    `)

    .run(

      now(),

      requestId,

    );

  database

    .prepare(`

      UPDATE telegram_wallet_entries

      SET status = 'completed'

      WHERE

        telegram_id = ?

        AND amount = ?

        AND type = 'withdrawal'

        AND status = 'pending'

    `)

    .run(

      String(

        request.telegram_id,

      ),

      Number(

        request.amount,

      ),

    );

  return true;

}

/* =========================================================

   TELEGRAM WALLET ACTION

   ========================================================= */

export function telegramWalletAction(

  telegramId: string,

  type:

    | "deposit"

    | "withdrawal",

  amount: number,

  method: WalletMethod,

): BingoWallet {

  if (

    type === "deposit"

  ) {

    /*

     * Deposit is now a pending

     * demo request.

     */

    createDepositRequest(

      telegramId,

      amount,

      method,

    );

    return getTelegramWallet(

      telegramId,

    );

  }

  /*

   * Withdrawal uses Play Balance.

   */

  createWithdrawalRequest(

    telegramId,

    amount,

    method,

  );

  return getTelegramWallet(

    telegramId,

  );

}

/* =========================================================

   GAME ADVANCE

   ========================================================= */

export function advanceGame(

  id: string,

  action: BingoAction,

): BingoGame | undefined {

  const game =

    getGame(id);

  if (!game) {

    return undefined;

  }

  /* -------------------------------------------------------

     START

     ------------------------------------------------------- */

  if (

    action === "start" &&

    game.status ===

      "waiting"

  ) {

    if (

      game.calledNumbers

        .length === 0

    ) {

      const elapsed =

        (

          Date.now() -

          new Date(

            game.startedAt,

          ).getTime()

        ) / 1000;

      if (

        elapsed >=

        LOBBY_SECONDS

      ) {

        game.status =

          "live";

        game.nextCallIn =

          DISPLAY_CALL_INTERVAL_SECONDS;

        for (

          const player of game.players

        ) {

          database

            .prepare(`

              UPDATE cards

              SET

                status = 'in-play',

                marked = '[]'

              WHERE label = ?

            `)

            .run(

              player.cardLabel,

            );

        }

      } else {

        game.nextCallIn =

          Math.max(

            1,

            Math.ceil(

              LOBBY_SECONDS -

                elapsed,

            ),

          );

      }

    }

  }

  /* -------------------------------------------------------

     PAUSE

     ------------------------------------------------------- */

  if (

    action === "pause" &&

    game.status === "live"

  ) {

    game.status =

      "waiting";

  }

  /* -------------------------------------------------------

     RESET

     ------------------------------------------------------- */

  if (

    action === "reset"

  ) {

    game.status =

      "waiting";

    game.calledNumbers =

      [];

    game.currentNumber =

      0;

    game.nextCallIn =

      LOBBY_SECONDS;

    game.winnerCount =

      0;

    database

      .prepare(`

        DELETE FROM game_winners

        WHERE game_id = ?

      `)

      .run(

        game.id,

      );

    game.startedAt =

      now();

    for (

      const player of game.players

    ) {

      database

        .prepare(`

          UPDATE cards

          SET

            status = 'reserved',

            marked = '[]'

          WHERE label = ?

        `)

        .run(

          player.cardLabel,

        );

    }

  }

  /* -------------------------------------------------------

     CALL

     ------------------------------------------------------- */

  if (

    action === "call" &&

    game.status === "live"

  ) {

    const uncalled =

      Array.from(

        {

          length:

            TOTAL_NUMBERS,

        },

        (_, index) =>

          index + 1,

      ).filter(

        (number) =>

          !game.calledNumbers.includes(

            number,

          ),

      );

    const number =

      shuffle(

        uncalled,

      )[0];

    if (

      number !== undefined

    ) {

      game.calledNumbers.push(

        number,

      );

      game.currentNumber =

        number;

      game.nextCallIn =

        DISPLAY_CALL_INTERVAL_SECONDS;

      for (

        const player of game.players

      ) {

        const cardRow =

          database

            .prepare(`

              SELECT *

              FROM cards

              WHERE label = ?

            `)

            .get(

              player.cardLabel,

            );

        if (!cardRow) {

          continue;

        }

        const card =

          readCard(

            cardRow as Record<

              string,

              unknown

            >,

          );

        if (

          card.numbers.includes(

            number,

          ) &&

          !card.marked.includes(

            number,

          )

        ) {

          card.marked.push(

            number,

          );

          database

            .prepare(`

              UPDATE cards

              SET

                marked = ?,

                status = 'in-play'

              WHERE id = ?

            `)

            .run(

              JSON.stringify(

                card.marked,

              ),

              card.id,

            );

        }

      }

      const winners =

        settleWinners(

          game,

        );

      if (

        winners.length > 0

      ) {

        game.winnerCount =

          winners.length;

        game.status =

          "completed";

        game.nextCallIn =

          0;

        releasePlayerCards(

          game,

        );

      }

      if (

        game.calledNumbers

          .length >=

          TOTAL_NUMBERS &&

        game.status !==

          "completed"

      ) {

        game.status =

          "completed";

        game.nextCallIn =

          0;

        releasePlayerCards(

          game,

        );

      }

    }

  }

  /* -------------------------------------------------------

     CLAIM

     ------------------------------------------------------- */

  if (

    action === "claim"

  ) {

    const winners =

      settleWinners(

        game,

      );

    if (

      winners.length > 0

    ) {

      game.winnerCount =

        winners.length;

    }

    game.status =

      "completed";

    game.nextCallIn =

      0;

    releasePlayerCards(

      game,

    );

  }

  writeGame(game);

  return game;

}

/* =========================================================

   AUTOMATIC ROUND SUPPORT

   ========================================================= */

export function ensureNextAutomaticGame(

  completedGameId?: string,

): BingoGame {

  const active =

    getGames().find(

      (game) =>

        game.status !==

        "completed",

    );

  if (active) {

    return active;

  }

  return createLobbyGame();

}

export function advanceAutomaticGame(

  gameId: string,

): BingoGame | undefined {

  const game =

    getGame(gameId);

  if (!game) {

    return undefined;

  }

  if (

    game.status ===

    "waiting"

  ) {

    return advanceGame(

      game.id,

      "start",

    );

  }

  if (

    game.status ===

    "completed"

  ) {

    return ensureNextAutomaticGame(

      game.id,

    );

  }

  return advanceGame(

    game.id,

    "call",

  );

}

/* =========================================================

   GLOBAL WALLET

   ========================================================= */

export function getWallet(): BingoWallet {

  const wallet =

    database

      .prepare(

        "SELECT * FROM wallet WHERE id = 1",

      )

      .get() as Record<

      string,

      unknown

    >;

  const entries =

    database

      .prepare(`

        SELECT *

        FROM wallet_entries

        ORDER BY created_at DESC

      `)

      .all()

      .map(

        (row) => {

          const entry =

            row as Record<

              string,

              unknown

            >;

          return {

            id: String(

              entry.id,

            ),

            type:

              entry.type as

                | "deposit"

                | "withdrawal",

            amount:

              Number(

                entry.amount,

              ),

            method:

              entry.method as WalletMethod,

            status:

              entry.status as

                | "completed"

                | "pending",

            createdAt:

              String(

                entry.created_at,

              ),

          };

        },

      );

  return {

    balance:

      Number(

        wallet.balance,

      ),

    currency:

      String(

        wallet.currency,

      ),

    entries,

  };

}

export function walletAction(

  type:

    | "deposit"

    | "withdrawal",

  amount: number,

  method: WalletMethod,

): BingoWallet {

  if (

    !Number.isFinite(

      amount,

    ) ||

    amount <= 0

  ) {

    throw new Error(

      "Amount must be greater than zero",

    );

  }

  const wallet =

    getWallet();

  const nextBalance =

    type === "deposit"

      ? wallet.balance +

        amount

      : wallet.balance -

        amount;

  if (

    nextBalance < 0

  ) {

    throw new Error(

      "Insufficient balance for this withdrawal",

    );

  }

  database

    .prepare(`

      UPDATE wallet

      SET balance = ?

      WHERE id = 1

    `)

    .run(

      nextBalance,

    );

  database

    .prepare(`

      INSERT INTO

        wallet_entries

        (

          id,

          type,

          amount,

          method,

          status,

          created_at

        )

      VALUES

        (

          ?,

          ?,

          ?,

          ?,

          'completed',

          ?

        )

    `)

    .run(

      randomId(

        "wallet",

      ),

      type,

      amount,

      method,

      now(),

    );

  return getWallet();

}

/* =========================================================

   ACTIVITIES

   ========================================================= */

export function getActivities():

  BingoActivity[] {

  return database

    .prepare(`

      SELECT *

      FROM activities

      ORDER BY rowid DESC

    `)

    .all()

    .map(

      (row) => {

        const activity =

          row as Record<

            string,

            unknown

          >;

        return {

          id: String(

            activity.id,

          ),

          title: String(

            activity.title,

          ),

          detail: String(

            activity.detail,

          ),

          time: String(

            activity.time,

          ),

          tone:

            activity.tone as BingoActivity["tone"],

        };

      },

    );

}

/* =========================================================

   CONFIG

   ========================================================= */

export function getBingoConfig() {

  return {

    cardPrice:

      CARD_PRICE,

    prizePerCard:

      PRIZE_PER_CARD,

    lobbySeconds:

      LOBBY_SECONDS,

    callIntervalSeconds:

      CALL_INTERVAL_SECONDS,

    totalCards:

      TOTAL_CARDS,

    totalNumbers:

      TOTAL_NUMBERS,

    winningLines:

      WINNING_LINES,

    maxCardsPerUser:

      MAX_CARDS_PER_USER,

    minDepositAmount:

      MIN_DEPOSIT_AMOUNT,

    registrationBonus:

      REGISTRATION_BONUS,

    depositBonusPercent:

      DEPOSIT_BONUS_PERCENT,

    paymentMethods:

      getPaymentMethods(),

  };

}

export function getGamePrizePool(

  gameId: string,

): number {

  const game =

    getGame(gameId);

  if (!game) {

    return 0;

  }

  return getPrizePool(

    game,

  );

}

export function getGameCardCount(

  gameId: string,

): number {

  const game =

    getGame(gameId);

  if (!game) {

    return 0;

  }

  return getCardCount(

    game,

  );

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

    .map(

      (row) => {

        const item =

          row as Record<

            string,

            unknown

          >;

        return {

          telegramId:

            String(

              item.telegram_id,

            ),

          playerId:

            String(

              item.player_id,

            ),

          prize:

            Number(

              item.prize,

            ),

          createdAt:

            String(

              item.created_at,

            ),

        };

      },

    );

}

/* =========================================================

   ADMIN / DEMO REQUEST READERS

   ========================================================= */

export function getPendingDeposits() {

  return database

    .prepare(`

      SELECT

        id,

        telegram_id,

        amount,

        method,

        status,

        bonus,

        created_at,

        reviewed_at

      FROM deposit_requests

      WHERE status = 'pending'

      ORDER BY created_at ASC

    `)

    .all();

}

export function getPendingWithdrawals() {

  return database

    .prepare(`

      SELECT

        id,

        telegram_id,

        amount,

        method,

        status,

        created_at,

        reviewed_at

      FROM withdrawal_requests

      WHERE status = 'pending'

      ORDER BY created_at ASC

    `)

    .all();

}

/* =========================================================

   DEMO ADMIN BALANCE VIEW

   ========================================================= */

export function getUserBalances(

  telegramId: string,

) {

  return getTelegramBalances(

    telegramId,

  );

}

/* =========================================================

   EXPORT DATABASE-LEVEL CONSTANTS

   ========================================================= */

export const FAST_BINGO_WALLET_CONFIG = {

  minDeposit:

    MIN_DEPOSIT_AMOUNT,

  registrationBonus:

    REGISTRATION_BONUS,

  depositBonusPercent:

    DEPOSIT_BONUS_PERCENT,

  initialMainBalance:

    INITIAL_MAIN_BALANCE,

  initialPlayBalance:

    INITIAL_PLAY_BALANCE,

};

/* =========================================================

   END

   ========================================================= */

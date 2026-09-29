
import { DurableObject } from "cloudflare:workers";

const APP_NAME = "Fast Bingo";

const LOBBY_SECONDS = 45;

const BALL_INTERVAL = 3500;

const TOTAL_BALLS = 75;

const MAX_CARDS_PER_PLAYER = 4;

const CARD_COUNT = 400;

const CARD_PRICE = 10;

const JACKPOT_PER_CARD = 8;

const PLAY_BALANCE_START = 0;

/* =========================================================

   FAST BINGO — PAYMENT DISPLAY SETTINGS

   CHANGE ONLY THE VALUES BELOW.

   These are display/demo settings only.

   ========================================================= */

const PAYMENT_DISPLAY = {

  telebirr: {

    name: "Hanza",

    number: "0999960421"

  },

  ebirr: {

    name: "Belay",

    number: "0999960421"

  },

  mpesa: {

    name: "Gemechu",

    number: "0786192665"

  }

};

function json(data, status = 200) {

  return new Response(JSON.stringify(data), {

    status,

    headers: {

      "content-type": "application/json; charset=utf-8",

      "cache-control": "no-store"

    }

  });

}

function html(body) {

  return new Response(body, {

    headers: {

      "content-type": "text/html; charset=utf-8",

      "cache-control": "no-store"

    }

  });

}

function shuffle(arr, seed) {

  const a = arr.slice();

  let s = seed >>> 0;

  for (let i = a.length - 1; i > 0; i--) {

    s = (s * 1664525 + 1013904223) >>> 0;

    const j = s % (i + 1);

    const tmp = a[i];

    a[i] = a[j];

    a[j] = tmp;

  }

  return a;

}

function ballLetter(n) {

  if (n >= 1 && n <= 15) return "B";

  if (n >= 16 && n <= 30) return "I";

  if (n >= 31 && n <= 45) return "N";

  if (n >= 46 && n <= 60) return "G";

  return "O";

}

function makeCard(number) {

  const ranges = [

    [1, 15],

    [16, 30],

    [31, 45],

    [46, 60],

    [61, 75]

  ];

  const columns = [];

  for (let c = 0; c < 5; c++) {

    const values = [];

    for (

      let n = ranges[c][0];

      n <= ranges[c][1];

      n++

    ) {

      values.push(n);

    }

    columns.push(

      shuffle(

        values,

        100000 + number * 7919 + c * 97

      ).slice(0, 5)

    );

  }

  const grid = [];

  for (let r = 0; r < 5; r++) {

    grid[r] = [];

    for (let c = 0; c < 5; c++) {

      grid[r][c] = columns[c][r];

    }

  }

  grid[2][2] = "FREE";

  return {

    number,

    grid

  };

}

function makeBallOrder(gameNumber) {

  return shuffle(

    Array.from(

      { length: TOTAL_BALLS },

      (_, i) => i + 1

    ),

    900001 + gameNumber * 104729

  );

}

function isValidBallOrder(value) {

  if (typeof value !== "string") return false;

  try {

    const order = JSON.parse(value);

    if (

      !Array.isArray(order) ||

      order.length !== TOTAL_BALLS

    ) {

      return false;

    }

    const unique = new Set(order);

    if (unique.size !== TOTAL_BALLS) {

      return false;

    }

    return order.every(

      (n) =>

        Number.isInteger(n) &&

        n >= 1 &&

        n <= TOTAL_BALLS

    );

  } catch (_) {

    return false;

  }

}

function hasTwoLines(card, called) {

  const calledSet = new Set(called);

  const rows = [];

  const cols = [];

  for (let r = 0; r < 5; r++) {

    let ok = true;

    for (let c = 0; c < 5; c++) {

      const v = card.grid[r][c];

      if (

        v !== "FREE" &&

        !calledSet.has(v)

      ) {

        ok = false;

        break;

      }

    }

    if (ok) rows.push(r);

  }

  for (let c = 0; c < 5; c++) {

    let ok = true;

    for (let r = 0; r < 5; r++) {

      const v = card.grid[r][c];

      if (

        v !== "FREE" &&

        !calledSet.has(v)

      ) {

        ok = false;

        break;

      }

    }

    if (ok) cols.push(c);

  }

  return rows.length + cols.length >= 2;

}

function getTelegramUser(request) {

  const raw = request.headers.get(

    "x-telegram-user"

  );

  if (raw) {

    try {

      const user = JSON.parse(raw);

      if (user && user.id !== undefined) {

        return {

          id: String(user.id),

          first_name: user.first_name || "Player",

          username: user.username || ""

        };

      }

    } catch (_) {}

  }

  return {

    id: "guest",

    first_name: "Guest",

    username: ""

  };

}

/* =========================================================

   LOGIN / REGISTRATION AUTH

   ========================================================= */

const LOGIN_CODE_MIN = 100000;

const LOGIN_CODE_MAX = 999999;

const LOGIN_CODE_TTL = 5 * 60 * 1000;

const FIRST_REGISTRATION_BONUS = 20;

async function hashLoginCode(code) {

  const data =

    new TextEncoder().encode(

      String(code)

    );

  const digest =

    await crypto.subtle.digest(

      "SHA-256",

      data

    );

  return Array.from(

    new Uint8Array(digest)

  )

    .map(

      b =>

        b.toString(16).padStart(2, "0")

    )

    .join("");

}

async function sendLoginCode(

  userId,

  code,

  env

) {

  const apiKey =

    String(

      env.LOGIN_API_KEY || ""

    );

  if (!apiKey) {

    throw new Error(

      "LOGIN_API_KEY is not configured"

    );

  }

  const response =

    await fetch(

      "https://fast-bingo-telegram-bot.dagnaeli21.workers.dev/send-login-password",

      {

        method: "POST",

        headers: {

          "content-type":

            "application/json",

          "x-login-api-key":

            apiKey

        },

        body: JSON.stringify({

          userId: String(userId),

          password: String(code)

        })

      }

    );

  const responseText =

    await response.text();

  let result = null;

  try {

    result =

      JSON.parse(

        responseText

      );

  } catch (_) {

    result = {

      ok: false,

      error:

        responseText ||

        "INVALID_RESPONSE"

    };

  }

  if (

    !response.ok ||

    !result ||

    result.ok !== true

  ) {

    console.error(

      "LOGIN_CODE_API_ERROR:",

      JSON.stringify({

        httpStatus: response.status,

        result

      })

    );

    throw new Error(

      result?.message ||

      result?.error ||

      `Login API failed with HTTP ${response.status}`

    );

  }

  return result;

}

class GameScheduler extends DurableObject {

  constructor(ctx, env) {

    super(ctx, env);

    this.ctx = ctx;

    this.env = env;

    /*

     * IMPORTANT:

     * Do not blindly replace an existing alarm from

     * the constructor. Cloudflare may construct the

     * Durable Object immediately before an alarm fires.

     */

    ctx.blockConcurrencyWhile(

      async () => {

        await this.init();

      }

    );

  }

  async init() {

    const sql = this.ctx.storage.sql;

    sql.exec(`

      CREATE TABLE IF NOT EXISTS state (

        id INTEGER PRIMARY KEY,

        game_number INTEGER NOT NULL,

        status TEXT NOT NULL,

        lobby_ends_at INTEGER,

        started_at INTEGER,

        ball_index INTEGER NOT NULL,

        ball_order TEXT NOT NULL

      )

    `);

    /* STATE TABLE MIGRATION */

    const stateColumns =

      sql.exec(`

        PRAGMA table_info(state)

      `).toArray();

    const hasGameNumber =

      stateColumns.some(

        c => c.name === "game_number"

      );

    const hasStatus =

      stateColumns.some(

        c => c.name === "status"

      );

    const hasLobbyEndsAt =

      stateColumns.some(

        c => c.name === "lobby_ends_at"

      );

    const hasStartedAt =

      stateColumns.some(

        c => c.name === "started_at"

      );

    const hasBallIndex =

      stateColumns.some(

        c => c.name === "ball_index"

      );

    const hasBallOrder =

      stateColumns.some(

        c => c.name === "ball_order"

      );

    if (!hasGameNumber) {

      sql.exec(`

        ALTER TABLE state

        ADD COLUMN game_number INTEGER

      `);

    }

    if (!hasStatus) {

      sql.exec(`

        ALTER TABLE state

        ADD COLUMN status TEXT

      `);

    }

    if (!hasLobbyEndsAt) {

      sql.exec(`

        ALTER TABLE state

        ADD COLUMN lobby_ends_at INTEGER

      `);

    }

    if (!hasStartedAt) {

      sql.exec(`

        ALTER TABLE state

        ADD COLUMN started_at INTEGER

      `);

    }

    if (!hasBallIndex) {

      sql.exec(`

        ALTER TABLE state

        ADD COLUMN ball_index INTEGER

      `);

    }

    if (!hasBallOrder) {

      sql.exec(`

        ALTER TABLE state

        ADD COLUMN ball_order TEXT

      `);

    }
     
sql.exec(`

  CREATE TABLE IF NOT EXISTS users (

    user_id TEXT PRIMARY KEY,

    first_name TEXT,

    username TEXT,

    created_at INTEGER NOT NULL,

    updated_at INTEGER NOT NULL

  )

`);

/* =========================================================

   USER AUTH TABLE

   ========================================================= */

sql.exec(`

  CREATE TABLE IF NOT EXISTS user_auth (

    user_id TEXT PRIMARY KEY,

    login_code_hash TEXT,

    login_code_expires_at INTEGER,

    created_at INTEGER NOT NULL,

    last_login_at INTEGER,

    bonus_given INTEGER NOT NULL DEFAULT 0

  )

`);
     
sql.exec(`

  CREATE TABLE IF NOT EXISTS wallet_requests (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    user_id TEXT NOT NULL,

    type TEXT NOT NULL,

    method TEXT,

    amount REAL NOT NULL,

    status TEXT NOT NULL DEFAULT 'pending',

    screenshot_data TEXT,

    screenshot_mime TEXT,

    created_at INTEGER NOT NULL,

    reviewed_at INTEGER,

    reviewed_by TEXT

  )

`);

sql.exec(`

  CREATE INDEX IF NOT EXISTS idx_wallet_requests_status

  ON wallet_requests(status)

`);

sql.exec(`

  CREATE INDEX IF NOT EXISTS idx_wallet_requests_user

  ON wallet_requests(user_id)

`);

sql.exec(`

  CREATE TABLE IF NOT EXISTS app_control (

    id INTEGER PRIMARY KEY,

    paused INTEGER NOT NULL DEFAULT 0

  )

`);

sql.exec(`

  INSERT OR IGNORE INTO app_control

  (id, paused)

  VALUES (1, 0)

`);

/* =========================================================

   BALANCES TABLE

   ========================================================= */

const balanceTableInfo =

  sql.exec(`

    PRAGMA table_info(balances)

  `).toArray();

if (balanceTableInfo.length === 0) {

  sql.exec(`

    CREATE TABLE IF NOT EXISTS balances (

      user_id TEXT PRIMARY KEY,

      balance REAL NOT NULL,

      main_balance REAL NOT NULL DEFAULT 0,

      play_balance REAL

    )

  `);

} else {

  const hasUserId =

    balanceTableInfo.some(

      c => c.name === "user_id"

    );

  const hasBalance =

    balanceTableInfo.some(

      c => c.name === "balance"

    );

  const hasMainBalance =

    balanceTableInfo.some(

      c => c.name === "main_balance"

    );

  const hasPlayBalance =

    balanceTableInfo.some(

      c => c.name === "play_balance"

    );

  /*

   * Existing database is missing user_id.

   *

   * Rebuild the table while preserving

   * existing balance values where possible.

   */

  if (!hasUserId) {

    sql.exec(`

      ALTER TABLE balances

      RENAME TO balances_old

    `);

    sql.exec(`

      CREATE TABLE balances (

        user_id TEXT PRIMARY KEY,

        balance REAL NOT NULL,

        main_balance REAL NOT NULL DEFAULT 0,

        play_balance REAL

      )

    `);

    /*

     * Old table has no user_id, so old rows

     * cannot safely be mapped to Telegram users.

     *

     * Keep the old table temporarily instead

     * of deleting data automatically.

     */

  } else {

    if (!hasMainBalance) {

      sql.exec(`

        ALTER TABLE balances

        ADD COLUMN main_balance

        REAL NOT NULL DEFAULT 0

      `);

    }

    if (!hasPlayBalance) {

      sql.exec(`

        ALTER TABLE balances

        ADD COLUMN play_balance REAL

      `);

      sql.exec(`

        UPDATE balances

        SET play_balance = balance

        WHERE play_balance IS NULL

      `);

    }

  }

}

/* =========================================================

   SELECTED CARDS

   ========================================================= */

sql.exec(`

  CREATE TABLE IF NOT EXISTS selected_cards (

    game_number INTEGER NOT NULL,

    user_id TEXT NOT NULL,

    card_number INTEGER NOT NULL,

    selected_at INTEGER NOT NULL,

    PRIMARY KEY (

      game_number,

      user_id,

      card_number

    )

  )

`);

/* =========================================================

   TRANSACTIONS

   ========================================================= */

sql.exec(`

  CREATE TABLE IF NOT EXISTS transactions (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    user_id TEXT NOT NULL,

    type TEXT NOT NULL,

    method TEXT,

    amount REAL NOT NULL,

    simulated INTEGER NOT NULL,

    created_at INTEGER NOT NULL

  )

`);

    let existing = sql

      .exec(

        "SELECT * FROM state WHERE id = 1"

      )

      .toArray();

    if (!existing.length) {

      const now = Date.now();

      const ends =

        now + LOBBY_SECONDS * 1000;

      const order = makeBallOrder(1);

      sql.exec(

        `

        INSERT INTO state

        (

          id,

          game_number,

          status,

          lobby_ends_at,

          started_at,

          ball_index,

          ball_order

        )

        VALUES

        (1, ?, 'lobby', ?, NULL, -1, ?)

        `,

        1,

        ends,

        JSON.stringify(order)

      );

      await this.scheduleNext(

        LOBBY_SECONDS * 1000

      );

      return;

    }

    let state = existing[0];

    /*

     * Repair invalid state if necessary.

     */

    if (

      state.status !== "lobby" &&

      state.status !== "live"

    ) {

      const nextGame =

        Number(state.game_number || 0) + 1;

      const now = Date.now();

      const ends =

        now + LOBBY_SECONDS * 1000;

      sql.exec(

        `

        UPDATE state

        SET

          game_number = ?,

          status = 'lobby',

          lobby_ends_at = ?,

          started_at = NULL,

          ball_index = -1,

          ball_order = ?

        WHERE id = 1

        `,

        nextGame,

        ends,

        JSON.stringify(

          makeBallOrder(nextGame)

        )

      );

      state = this.getState();

    }

    /*

     * Repair an invalid/missing ball order.

     */

    if (

      state &&

      !isValidBallOrder(state.ball_order)

    ) {

      const gameNumber =

        Number(state.game_number || 1);

      sql.exec(

        `

        UPDATE state

        SET ball_order = ?

        WHERE id = 1

        `,

        JSON.stringify(

          makeBallOrder(gameNumber)

        )

      );

      state = this.getState();

    }

    /*

     * CRITICAL FIX:

     * If this constructor was created because an alarm

     * is already scheduled, do not replace that alarm.

     */

    const existingAlarm =

      await this.ctx.storage.getAlarm();

    if (existingAlarm !== null) {

      return;

    }

    if (!state) {

      await this.createFreshLobby();

      return;

    }

    if (state.status === "lobby") {

      const ends =

        Number(state.lobby_ends_at || 0);

      const remaining =

        ends > Date.now()

          ? ends - Date.now()

          : 1000;

      await this.scheduleNext(

        remaining

      );

      return;

    }

    /*

     * Live game:

     * make sure the scheduler continues.

     */

    const index =

      Number(state.ball_index);

    if (

      !Number.isInteger(index) ||

      index < 0 ||

      index >= TOTAL_BALLS

    ) {

      sql.exec(`

        UPDATE state

        SET ball_index = 0

        WHERE id = 1

      `);

    }

    await this.scheduleNext(

      BALL_INTERVAL

    );

  }

  getState() {

    const rows =

      this.ctx.storage.sql

        .exec(

          "SELECT * FROM state WHERE id = 1"

        )

        .toArray();

    return rows[0] || null;

  }

  getCalledBalls(state) {

    if (!state) return [];

    let order = [];

    try {

      order = JSON.parse(

        state.ball_order

      );

    } catch (_) {

      return [];

    }

    if (

      state.status !== "live" ||

      Number(state.ball_index) < 0

    ) {

      return [];

    }

    return order.slice(

      0,

      Number(state.ball_index) + 1

    );

  }

  async scheduleNext(ms) {

    const delay = Math.max(

      1000,

      Number(ms) || 1000

    );

    await this.ctx.storage.setAlarm(

      Date.now() + delay

    );

  }

  async createFreshLobby(gameNumber = 1) {

    const now = Date.now();

    const lobbyEnds =

      now + LOBBY_SECONDS * 1000;

    const order =

      makeBallOrder(gameNumber);

    const state =

      this.getState();

    if (!state) {

      this.ctx.storage.sql.exec(

        `

        INSERT INTO state

        (

          id,

          game_number,

          status,

          lobby_ends_at,

          started_at,

          ball_index,

          ball_order

        )

        VALUES

        (1, ?, 'lobby', ?, NULL, -1, ?)

        `,

        gameNumber,

        lobbyEnds,

        JSON.stringify(order)

      );

    } else {

      this.ctx.storage.sql.exec(

        `

        UPDATE state

        SET

          game_number = ?,

          status = 'lobby',

          lobby_ends_at = ?,

          started_at = NULL,

          ball_index = -1,

          ball_order = ?

        WHERE id = 1

        `,

        gameNumber,

        lobbyEnds,

        JSON.stringify(order)

      );

    }

    await this.scheduleNext(

      LOBBY_SECONDS * 1000

    );

  }

  async recoverScheduler() {

    try {

      const state =

        this.getState();

      if (!state) {

        await this.createFreshLobby(1);

        return;

      }

      if (state.status === "lobby") {

        const ends =

          Number(

            state.lobby_ends_at || 0

          );

        const remaining =

          ends > Date.now()

            ? ends - Date.now()

            : 1000;

        await this.scheduleNext(

          remaining

        );

        return;

      }

      if (state.status === "live") {

        let index =

          Number(state.ball_index);

        if (

          !Number.isInteger(index) ||

          index < 0

        ) {

          this.ctx.storage.sql.exec(`

            UPDATE state

            SET

              status = 'live',

              started_at = COALESCE(

                started_at,

                ?

              ),

              ball_index = 0,

              lobby_ends_at = NULL

            WHERE id = 1

          `, Date.now());

          index = 0;

        }

        if (

          index >= TOTAL_BALLS

        ) {

          await this.startNextGame();

          return;

        }

        await this.scheduleNext(

          2000

        );

        return;

      }

      await this.createFreshLobby(

        Number(state.game_number || 0) + 1

      );

    } catch (recoveryError) {

      console.error(

        "Fast Bingo scheduler recovery failed:",

        recoveryError

      );

      /*

       * Last retry path.

       * This keeps the scheduler alive instead of

       * allowing the alarm retry counter to exhaust.

       */

      try {

        await this.ctx.storage.setAlarm(

          Date.now() + 5000

        );

      } catch (_) {}

    }

  }

  async alarm(alarmInfo) {

    try {

      const state =

        this.getState();

      if (!state) {

        await this.createFreshLobby(1);

        return;

      }

      const now = Date.now();

      /*

       * LOBBY -> LIVE

       *

       * The first ball is called immediately.

       * Therefore the UI goes directly to 1 / 75

       * instead of staying at 0 / 75.

       */

      if (state.status === "lobby") {

        const ends =

          Number(

            state.lobby_ends_at || 0

          );

        if (now < ends) {

          await this.scheduleNext(

            ends - now

          );

          return;

        }

        let order = [];

        if (

          isValidBallOrder(

            state.ball_order

          )

        ) {

          order =

            JSON.parse(

              state.ball_order

            );

        } else {

          order =

            makeBallOrder(

              Number(

                state.game_number || 1

              )

            );

        }

        this.ctx.storage.sql.exec(

          `

          UPDATE state

          SET

            status = 'live',

            started_at = ?,

            ball_index = 0,

            lobby_ends_at = NULL,

            ball_order = ?

          WHERE id = 1

          `,

          now,

          JSON.stringify(order)

        );

        await this.scheduleNext(

          BALL_INTERVAL

        );

        return;

      }

      /*

       * LIVE GAME

       */

      if (state.status === "live") {

        let currentIndex =

          Number(state.ball_index);

        if (

          !Number.isInteger(

            currentIndex

          ) ||

          currentIndex < 0

        ) {

          this.ctx.storage.sql.exec(

            `

            UPDATE state

            SET

              ball_index = 0,

              started_at = COALESCE(

                started_at,

                ?

              ),

              lobby_ends_at = NULL

            WHERE id = 1

            `,

            now

          );

          await this.scheduleNext(

            BALL_INTERVAL

          );

          return;

        }

        /*

         * After ball 75, immediately create the

         * next 45-second lobby.

         */

        if (

          currentIndex >=

          TOTAL_BALLS - 1

        ) {

          await this.startNextGame();

          return;

        }

        /*

         * Call next ball.

         */

        const nextIndex =

          currentIndex + 1;

        this.ctx.storage.sql.exec(

          `

          UPDATE state

          SET ball_index = ?

          WHERE id = 1

          `,

          nextIndex

        );

        await this.scheduleNext(

          BALL_INTERVAL

        );

        return;

      }

      /*

       * Unknown status:

       * recover into a fresh lobby.

       */

      await this.createFreshLobby(

        Number(

          state.game_number || 0

        ) + 1

      );

    } catch (error) {

      console.error(

        "Fast Bingo alarm error:",

        error?.message || String(error),

        error?.stack || "",

        "retry:",

        alarmInfo?.retryCount || 0

   );

      /*

       * Do not let Cloudflare's limited alarm retries

       * permanently stop the 24/7 game loop.

       */

      await this.recoverScheduler();

    }

  }

  async startNextGame() {

    const current =

      this.getState();

    const nextGame =

      Number(

        current?.game_number || 0

      ) + 1;

    const now = Date.now();

    const lobbyEnds =

      now + LOBBY_SECONDS * 1000;

    const order =

      makeBallOrder(nextGame);

    /*

     * Remove old card selections.

     * Current/new game selections remain available.

     */

    this.ctx.storage.sql.exec(

      `

      DELETE FROM selected_cards

      WHERE game_number < ?

      `,

      nextGame

    );

    this.ctx.storage.sql.exec(

      `

      UPDATE state

      SET

        game_number = ?,

        status = 'lobby',

        lobby_ends_at = ?,

        started_at = NULL,

        ball_index = -1,

        ball_order = ?

      WHERE id = 1

      `,

      nextGame,

      lobbyEnds,

      JSON.stringify(order)

    );

    await this.scheduleNext(

      LOBBY_SECONDS * 1000

    );

  }

  getJackpot(gameNumber) {

    const row =

      this.ctx.storage.sql

        .exec(

          `

          SELECT COUNT(*) AS count

          FROM selected_cards

          WHERE game_number = ?

          `,

          gameNumber

        )

        .toArray()[0];

    const count =

      Number(row?.count || 0);

    return {

      selectedCount: count,

      jackpot:

        count * JACKPOT_PER_CARD

    };

  }

  getGameResponse() {

    const state =

      this.getState();

    if (!state) {

      return {

        status: "lobby",

        gameNumber: 1,

        lobbyRemaining:

          LOBBY_SECONDS,

        calledBalls: [],

        calledCount: 0,

        currentBall: null,

        currentLetter: null,

        selectedCount: 0,

        jackpot: 0

      };

    }

    const calledBalls =

      this.getCalledBalls(state);

    let order = [];

    try {

      order =

        JSON.parse(

          state.ball_order

        );

    } catch (_) {

      order =

        makeBallOrder(

          Number(

            state.game_number || 1

          )

        );

    }

    const currentBall =

      state.status === "live" &&

      Number(state.ball_index) >= 0

        ? order[

            Number(state.ball_index)

          ]

        : null;

    const lobbyRemaining =

      state.status === "lobby"

        ? Math.max(

            0,

            Math.ceil(

              (

                Number(

                  state.lobby_ends_at || 0

                ) - Date.now()

              ) / 1000

            )

          )

        : 0;

    const jackpot =

      this.getJackpot(

        state.game_number

      );

    return {

      status: state.status,

      gameNumber:

        Number(state.game_number),

      lobbyRemaining,

      calledBalls,

      calledCount:

        calledBalls.length,

      currentBall,

      currentLetter:

        currentBall

          ? ballLetter(currentBall)

          : null,

      selectedCount:

        jackpot.selectedCount,

      jackpot:

        jackpot.jackpot

    };

  }

  async selectCards(userId, cards) {

    const state =

      this.getState();

    if (!state) {

      return {

        ok: false,

        error: "NO_GAME"

      };

    }

    if (

      state.status !== "lobby"

    ) {

      return {

        ok: false,

        error: "GAME_IN_PROGRESS"

      };

    }

    let clean =

      Array.isArray(cards)

        ? cards

            .map(Number)

            .filter(

              (n) =>

                Number.isInteger(n) &&

                n >= 1 &&

                n <= CARD_COUNT

            )

        : [];

    clean = [

      ...new Set(clean)

    ];

    if (

      clean.length >

      MAX_CARDS_PER_PLAYER

    ) {

      return {

        ok: false,

        error: "MAX_CARDS"

      };

    }

    this.ctx.storage.sql.exec(

      `

      DELETE FROM selected_cards

      WHERE game_number = ?

      AND user_id = ?

      `,

      state.game_number,

      userId

    );

    const now = Date.now();

    for (const card of clean) {

      this.ctx.storage.sql.exec(

        `

        INSERT OR IGNORE INTO

        selected_cards

        (

          game_number,

          user_id,

          card_number,

          selected_at

        )

        VALUES (?, ?, ?, ?)

        `,

        state.game_number,

        userId,

        card,

        now

      );

    }

    return {

      ok: true,

      selected: clean,

      ...this.getJackpot(

        state.game_number

      )

    };

  }

  getUserCards(userId) {

    const state =

      this.getState();

    if (!state) return [];

    const rows =

      this.ctx.storage.sql

        .exec(

          `

          SELECT card_number

          FROM selected_cards

          WHERE game_number = ?

          AND user_id = ?

          ORDER BY card_number

          `,

          state.game_number,

          userId

        )

        .toArray();

    return rows.map(

      (row) =>

        Number(row.card_number)

    );

  }
   
  /* =========================================================

     BALANCES

     ========================================================= */

  async ensureBalanceRow(userId) {

    const sql = this.ctx.storage.sql;

    let row = sql.exec(`

      SELECT user_id, balance, main_balance, play_balance

      FROM balances

      WHERE user_id = ?

    `, userId).toArray()[0];

    if (!row) {

      sql.exec(`

        INSERT INTO balances

        (

          user_id,

          balance,

          main_balance,

          play_balance

        )

        VALUES (?, ?, ?, ?)

      `,

        userId,

        PLAY_BALANCE_START,

        0,

        PLAY_BALANCE_START

      );

      row = {

        user_id: userId,

        balance: PLAY_BALANCE_START,

        main_balance: 0,

        play_balance: PLAY_BALANCE_START

      };

    }

    return row;

  }

  getBalances(userId) {

    const sql = this.ctx.storage.sql;

    let row = sql.exec(`

      SELECT

        user_id,

        balance,

        main_balance,

        play_balance

      FROM balances

      WHERE user_id = ?

    `, userId).toArray()[0];

    if (!row) {

      sql.exec(`

        INSERT INTO balances

        (

          user_id,

          balance,

          main_balance,

          play_balance

        )

        VALUES (?, ?, ?, ?)

      `,

        userId,

        PLAY_BALANCE_START,

        0,

        PLAY_BALANCE_START

      );

      return {

        mainBalance: 0,

        playBalance: PLAY_BALANCE_START

      };

    }

    return {

      mainBalance: Number(row.main_balance || 0),

      playBalance:

        row.play_balance === null ||

        row.play_balance === undefined

          ? Number(row.balance || 0)

          : Number(row.play_balance || 0)

    };

  }

  getBalance(userId) {

    return this.getBalances(userId).playBalance;

  }

/* =========================================================

   LOGIN STATUS

   ========================================================= */

getAuth(userId) {

  return this.ctx.storage.sql

    .exec(`

      SELECT

        user_id,

        login_code_hash,

        login_code_expires_at,

        created_at,

        last_login_at,

        bonus_given

      FROM user_auth

      WHERE user_id = ?

    `, String(userId))

    .toArray()[0] || null;

}

isRegistered(userId) {

  return !!this.getAuth(userId);

}
   
  async saveTelegramUser(user) {

    if (!user || !user.id) return;

    const sql = this.ctx.storage.sql;

    const now = Date.now();

    sql.exec(`

      INSERT INTO users

      (

        user_id,

        first_name,

        username,

        created_at,

        updated_at

      )

      VALUES (?, ?, ?, ?, ?)

      ON CONFLICT(user_id)

      DO UPDATE SET

        first_name = excluded.first_name,

        username = excluded.username,

        updated_at = excluded.updated_at

    `,

      String(user.id),

      String(user.first_name || "Player"),

      String(user.username || ""),

      now,

      now

    );

  }

/* =========================================================

   LOGIN REQUEST / VERIFY

   ========================================================= */

async registerNewUser(user) {

  if (

    !user ||

    !user.id ||

    user.id === "guest"

  ) {

    return {

      ok: false,

      error: "TELEGRAM_USER_REQUIRED"

    };

  }

  const userId =

    String(user.id);

  const now =

    Date.now();

  /*

   * Check whether this Telegram user

   * has already completed registration.

   */

  const existing =

    this.getAuth(userId);

  if (

    existing &&

    Number(existing.bonus_given || 0) === 1

  ) {

    const balances =

      await this.ensureBalanceRow(userId);

    return {

      ok: true,

      authenticated: true,

      registered: true,

      alreadyRegistered: true,

      mainBalance:

        Number(balances.main_balance || 0),

      playBalance:

        Number(balances.play_balance || 0)

    };

  }

  /*

   * Save Telegram user.

   */

  await this.saveTelegramUser(user);

  /*

   * Make sure balance row exists.

   */

  await this.ensureBalanceRow(userId);

  /*

   * Read current balance.

   */

  const balances =

    this.getBalances(userId);

  const currentPlay =

    Number(

      balances.playBalance || 0

    );

  const bonus =

    FIRST_REGISTRATION_BONUS;

  const nextPlay =

    currentPlay + bonus;

  /*

   * Put the 20 ETB bonus into

   * PLAY BALANCE only.

   */

  this.ctx.storage.sql.exec(`

    UPDATE balances

    SET

      balance = ?,

      play_balance = ?

    WHERE user_id = ?

  `,

    nextPlay,

    nextPlay,

    userId

  );

  /*

   * Create / complete registration.

   */

  this.ctx.storage.sql.exec(`

    INSERT INTO user_auth

    (

      user_id,

      login_code_hash,

      login_code_expires_at,

      created_at,

      last_login_at,

      bonus_given

    )

    VALUES (?, NULL, NULL, ?, ?, 1)

    ON CONFLICT(user_id)

    DO UPDATE SET

      bonus_given = 1,

      last_login_at = excluded.last_login_at,

      login_code_hash = NULL,

      login_code_expires_at = NULL

  `,

    userId,

    now,

    now

  );

  /*

   * Record the one-time registration bonus.

   */

  this.ctx.storage.sql.exec(`

    INSERT INTO transactions

    (

      user_id,

      type,

      method,

      amount,

      simulated,

      created_at

    )

    VALUES (

      ?,

      'registration_bonus',

      NULL,

      ?,

      1,

      ?

    )

  `,

    userId,

    bonus,

    now

  );

  const finalBalances =

    this.getBalances(userId);

  return {

    ok: true,

    authenticated: true,

    registered: true,

    firstRegistrationBonus: bonus,

    mainBalance:

      finalBalances.mainBalance,

    playBalance:

      finalBalances.playBalance

  };

}
   
  /* =========================================================

     WALLET — DEMO / PLAY-MONEY ONLY

     ========================================================= */

  async walletRequest(userId, body) {

    const amount = Number(body?.amount || 0);

    const type =

      body?.type === "withdraw"

        ? "withdraw"

        : "deposit";

    const method =

      String(body?.method || "Telebirr");

    if (!Number.isFinite(amount) || amount < 50) {

      return {

        ok: false,

        error: "MINIMUM_AMOUNT",

        minimum: 50

      };

    }

    await this.ensureBalanceRow(userId);

    const balances =

      this.getBalances(userId);

    /* =====================================================

       WITHDRAW

       Must have MORE THAN 100 ETB Play Balance.

       ===================================================== */

    if (type === "withdraw") {

      if (balances.playBalance <= 100) {

        return {

          ok: false,

          error: "PLAY_BALANCE_TOO_LOW",

          minimumBalance: 100

        };

      }

      if (amount > balances.playBalance) {

        return {

          ok: false,

          error: "INSUFFICIENT_BALANCE",

          balance: balances.playBalance

        };

      }

      const nextPlay =

        balances.playBalance - amount;

      this.ctx.storage.sql.exec(`

        UPDATE balances

        SET

          balance = ?,

          play_balance = ?

        WHERE user_id = ?

      `,

        nextPlay,

        nextPlay,

        userId

      );

      this.ctx.storage.sql.exec(`

        INSERT INTO wallet_requests

        (

          user_id,

          type,

          method,

          amount,

          status,

          screenshot_data,

          screenshot_mime,

          created_at

        )

        VALUES (?, 'withdraw', ?, ?, 'pending', NULL, NULL, ?)

      `,

        userId,

        method,

        amount,

        Date.now()

      );

      this.ctx.storage.sql.exec(`

        INSERT INTO transactions

        (

          user_id,

          type,

          method,

          amount,

          simulated,

          created_at

        )

        VALUES (?, 'withdraw', ?, ?, 1, ?)

      `,

        userId,

        method,

        amount,

        Date.now()

      );

      return {

        ok: true,

        simulated: true,

        pending: true,

        type: "withdraw",

        mainBalance: balances.mainBalance,

        playBalance: nextPlay

      };

    }

    /* =====================================================

       DEPOSIT

       Deposit DOES NOT immediately change balance.

       Admin confirmation adds it to Main Balance.

       ===================================================== */

    const screenshot =

      body?.screenshot || null;

    const screenshotMime =

      String(body?.screenshotMime || "");

    if (!screenshot) {

      return {

        ok: false,

        error: "SCREENSHOT_REQUIRED"

      };

    }

    if (

      typeof screenshot !== "string" ||

      screenshot.length > 450000

    ) {

      return {

        ok: false,

        error: "SCREENSHOT_TOO_LARGE"

      };

    }

    this.ctx.storage.sql.exec(`

      INSERT INTO wallet_requests

      (

        user_id,

        type,

        method,

        amount,

        status,

        screenshot_data,

        screenshot_mime,

        created_at

      )

      VALUES (?, 'deposit', ?, ?, 'pending', ?, ?, ?)

    `,

      userId,

      method,

      amount,

      screenshot,

      screenshotMime,

      Date.now()

    );

    this.ctx.storage.sql.exec(`

      INSERT INTO transactions

      (

        user_id,

        type,

        method,

        amount,

        simulated,

        created_at

      )

      VALUES (?, 'deposit_request', ?, ?, 1, ?)

    `,

      userId,

      method,

      amount,

      Date.now()

    );

    return {

      ok: true,

      simulated: true,

      pending: true,

      type: "deposit",

      mainBalance: balances.mainBalance,

      playBalance: balances.playBalance

    };

  }

/* =========================================================

   ADMIN AUTH

   ========================================================= */

isAdmin(request) {

  const expected =

    String(this.env.ADMIN_KEY || "");

  if (!expected) {

    return false;

  }

  const adminHeader =

    request.headers.get(

      "x-admin-key"

    ) || "";

  if (

    adminHeader === expected

  ) {

    return true;

  }

  const auth =

    request.headers.get(

      "authorization"

    ) || "";

  if (

    auth.startsWith("Bearer ")

  ) {

    return (

      auth.slice(7) === expected

    );

  }

  return false;

}
   
  /* =========================================================

     ADMIN SUMMARY

     ========================================================= */

  getAdminSummary() {

    const sql = this.ctx.storage.sql;

    const users =

      Number(

        sql.exec(`

          SELECT COUNT(*) AS count

          FROM users

        `).toArray()[0]?.count || 0

      );

    const pendingDeposits =

      Number(

        sql.exec(`

          SELECT COUNT(*) AS count

          FROM wallet_requests

          WHERE type = 'deposit'

          AND status = 'pending'

        `).toArray()[0]?.count || 0

      );

    const pendingWithdrawals =

      Number(

        sql.exec(`

          SELECT COUNT(*) AS count

          FROM wallet_requests

          WHERE type = 'withdraw'

          AND status = 'pending'

        `).toArray()[0]?.count || 0

      );

    const depositTotal =

      Number(

        sql.exec(`

          SELECT COALESCE(SUM(amount),0) AS total

          FROM wallet_requests

          WHERE type = 'deposit'

          AND status = 'pending'

        `).toArray()[0]?.total || 0

      );

    const withdrawalTotal =

      Number(

        sql.exec(`

          SELECT COALESCE(SUM(amount),0) AS total

          FROM wallet_requests

          WHERE type = 'withdraw'

          AND status = 'pending'

        `).toArray()[0]?.total || 0

      );

    const state =

      this.getState();

    return {

      ok: true,

      users,

      pendingDeposits,

      pendingWithdrawals,

      pendingDepositAmount: depositTotal,

      pendingWithdrawalAmount: withdrawalTotal,

      game: state

        ? {

            gameNumber: Number(state.game_number),

            status: state.status,

            ballIndex: Number(state.ball_index)

          }

        : null

    };

  }

  /* =========================================================

     ADMIN USERS

     ========================================================= */

  getAdminUsers() {

    const rows =

      this.ctx.storage.sql.exec(`

        SELECT

          u.user_id,

          u.first_name,

          u.username,

          u.created_at,

          u.updated_at,

          COALESCE(b.main_balance,0) AS main_balance,

          COALESCE(

            b.play_balance,

            b.balance,

            0

          ) AS play_balance

        FROM users u

        LEFT JOIN balances b

          ON b.user_id = u.user_id

        ORDER BY u.updated_at DESC

      `).toArray();

    return rows.map(row => ({

      userId: String(row.user_id),

      firstName: String(row.first_name || "Player"),

      username: String(row.username || ""),

      mainBalance: Number(row.main_balance || 0),

      playBalance: Number(row.play_balance || 0),

      createdAt: Number(row.created_at || 0),

      updatedAt: Number(row.updated_at || 0)

    }));

  }

  /* =========================================================

     ADMIN WALLET REQUESTS

     ========================================================= */

  getAdminRequests() {

    const rows =

      this.ctx.storage.sql.exec(`

        SELECT

          wr.id,

          wr.user_id,

          wr.type,

          wr.method,

          wr.amount,

          wr.status,

          wr.screenshot_data,

          wr.screenshot_mime,

          wr.created_at,

          wr.reviewed_at,

          wr.reviewed_by,

          COALESCE(u.first_name,'Player') AS first_name,

          COALESCE(u.username,'') AS username

        FROM wallet_requests wr

        LEFT JOIN users u

          ON u.user_id = wr.user_id

        ORDER BY

          CASE

            WHEN wr.status = 'pending'

            THEN 0

            ELSE 1

          END,

          wr.created_at DESC

        LIMIT 200

      `).toArray();

    return rows.map(row => ({

      id: Number(row.id),

      userId: String(row.user_id),

      firstName: String(row.first_name || "Player"),

      username: String(row.username || ""),

      type: String(row.type),

      method: String(row.method || ""),

      amount: Number(row.amount || 0),

      status: String(row.status),

      screenshot:

        row.screenshot_data

          ? String(row.screenshot_data)

          : null,

      screenshotMime:

        row.screenshot_mime

          ? String(row.screenshot_mime)

          : null,

      createdAt: Number(row.created_at || 0),

      reviewedAt:

        row.reviewed_at

          ? Number(row.reviewed_at)

          : null,

      reviewedBy:

        row.reviewed_by

          ? String(row.reviewed_by)

          : null

    }));

  }

  /* =========================================================

     ADMIN CONFIRM / REJECT

     ========================================================= */

  async adminRequestAction(

    requestId,

    action,

    adminKey

  ) {

    const sql = this.ctx.storage.sql;

    const row =

      sql.exec(`

        SELECT *

        FROM wallet_requests

        WHERE id = ?

      `, requestId).toArray()[0];

    if (!row) {

      return {

        ok: false,

        error: "REQUEST_NOT_FOUND"

      };

    }

    if (row.status !== "pending") {

      return {

        ok: false,

        error: "REQUEST_ALREADY_REVIEWED",

        status: row.status

      };

    }

    const userId =

      String(row.user_id);

    const amount =

      Number(row.amount || 0);

    const type =

      String(row.type);

    const finalStatus =

      action === "confirm"

        ? "confirmed"

        : "rejected";

    await this.ensureBalanceRow(userId);

    const balances =

      this.getBalances(userId);

    /* =====================================================

       CONFIRM DEPOSIT

       → Main Balance

       ===================================================== */

    if (

      type === "deposit" &&

      action === "confirm"

    ) {

      const nextMain =

        balances.mainBalance + amount;

      sql.exec(`

        UPDATE balances

        SET main_balance = ?

        WHERE user_id = ?

      `,

        nextMain,

        userId

      );

    }

    /* =====================================================

       REJECT WITHDRAW

       → refund Play Balance

       ===================================================== */

    if (

      type === "withdraw" &&

      action === "reject"

    ) {

      const nextPlay =

        balances.playBalance + amount;

      sql.exec(`

        UPDATE balances

        SET

          balance = ?,

          play_balance = ?

        WHERE user_id = ?

      `,

        nextPlay,

        nextPlay,

        userId

      );

    }

    sql.exec(`

      UPDATE wallet_requests

      SET

        status = ?,

        reviewed_at = ?,

        reviewed_by = ?

      WHERE id = ?

    `,

      finalStatus,

      Date.now(),

      adminKey,

      requestId

    );

    return {

      ok: true,

      requestId: Number(requestId),

      status: finalStatus,

      type,

      amount,

      balance: this.getBalances(userId)

    };

  }

  /* =========================================================

     ADMIN — DEMO BALANCE MANAGEMENT

     ========================================================= */

  async adminSetBalance(

    userId,

    balanceType,

    amount

  ) {

    const cleanUser =

      String(userId || "");

    const value =

      Number(amount);

    if (!cleanUser) {

      return {

        ok: false,

        error: "USER_REQUIRED"

      };

    }

    if (

      !Number.isFinite(value) ||

      value < 0

    ) {

      return {

        ok: false,

        error: "INVALID_AMOUNT"

      };

    }

    await this.ensureBalanceRow(

      cleanUser

    );

    if (

      balanceType !== "main" &&

      balanceType !== "play"

    ) {

      return {

        ok: false,

        error: "INVALID_BALANCE_TYPE"

      };

    }

    if (balanceType === "main") {

      this.ctx.storage.sql.exec(`

        UPDATE balances

        SET main_balance = ?

        WHERE user_id = ?

      `,

        value,

        cleanUser

      );

    } else {

      this.ctx.storage.sql.exec(`

        UPDATE balances

        SET

          balance = ?,

          play_balance = ?

        WHERE user_id = ?

      `,

        value,

        value,

        cleanUser

      );

    }

    return {

      ok: true,

      userId: cleanUser,

      ...this.getBalances(cleanUser)

    };

  }

  /* =========================================================

     ADMIN — GAME CONTROL

     ========================================================= */

  getAppPaused() {

    const row =

      this.ctx.storage.sql.exec(`

        SELECT paused

        FROM app_control

        WHERE id = 1

      `).toArray()[0];

    return Number(row?.paused || 0) === 1;

  }

  async adminGameControl(action) {

    const sql =

      this.ctx.storage.sql;

    if (action === "pause") {

      sql.exec(`

        UPDATE app_control

        SET paused = 1

        WHERE id = 1

      `);

      try {

        await this.ctx.storage.deleteAlarm();

      } catch (_) {}

      return {

        ok: true,

        paused: true

      };

    }

    if (action === "resume") {

      sql.exec(`

        UPDATE app_control

        SET paused = 0

        WHERE id = 1

      `);

      const state =

        this.getState();

      if (!state) {

        await this.createFreshLobby(1);

      } else if (

        state.status === "lobby"

      ) {

        const remaining =

          Math.max(

            1000,

            Number(state.lobby_ends_at || 0)

              - Date.now()

          );

        await this.scheduleNext(

          remaining

        );

      } else {

        await this.scheduleNext(

          BALL_INTERVAL

        );

      }

      return {

        ok: true,

        paused: false

      };

    }

    if (action === "reset") {

      const current =

        this.getState();

      const nextGame =

        Number(

          current?.game_number || 0

        ) + 1;

      sql.exec(`

        DELETE FROM selected_cards

      `);

      await this.createFreshLobby(

        nextGame

      );

      return {

        ok: true,

        paused: this.getAppPaused(),

        gameNumber: nextGame

      };

    }

    return {

      ok: false,

      error: "INVALID_ACTION"

    };

  }

  /* =========================================================

     CLAIM

     ========================================================= */

  async claim(userId) {

    const state =

      this.getState();

    if (!state) {

      return {

        ok: true,

        winner: false

      };

    }

    const called =

      this.getCalledBalls(state);

    const cards =

      this.getUserCards(userId);

    for (const number of cards) {

      const card =

        makeCard(number);

      if (

        hasTwoLines(

          card,

          called

        )

      ) {

        return {

          ok: true,

          winner: true,

          card: number

        };

      }

    }

    return {

      ok: true,

      winner: false

    };

  }

  /* =========================================================

     DURABLE OBJECT FETCH

     ========================================================= */

  async fetch(request) {

    const url =

      new URL(request.url);

    const user =

      getTelegramUser(request);

    /*

     * Register every Telegram user who

     * interacts with the Mini App.

     */

    await this.saveTelegramUser(

      user

    );

    /* =========================================================

   LOGIN API

   ========================================================= */

if (

  url.pathname === "/do/auth/status" &&

  request.method === "GET"

) {

  const auth =

    this.getAuth(user.id);

  const registered =

    !!auth &&

    Number(auth.bonus_given || 0) === 1;

  return json({

    ok: true,

    authenticated: registered,

    registered

  });

}

if (

  url.pathname === "/do/auth/register" &&

  request.method === "POST"

) {

  return json(

    await this.registerNewUser(user)

  );

}
     
    /* =====================================================

       GAME

       ===================================================== */

    if (

      url.pathname === "/do/game"

    ) {

      return json(

        this.getGameResponse()

      );

    }

    if (

      url.pathname === "/do/cards"

    ) {

      return json({

        ok: true,

        count: CARD_COUNT,

        cards:

          Array.from(

            {

              length: CARD_COUNT

            },

            (_, i) => ({

              number: i + 1,

              available: true

            })

          )

      });

    }

    if (

      url.pathname === "/do/user-cards"

    ) {

      return json({

        ok: true,

        selected:

          this.getUserCards(

            user.id

          )

      });

    }

    if (

      url.pathname === "/do/select-cards" &&

      request.method === "POST"

    ) {

      let body = {};

      try {

        body =

          await request.json();

      } catch (_) {}

      return json(

        await this.selectCards(

          user.id,

          body.cards

        )

      );

    }

    /* =====================================================

       BALANCE

       ===================================================== */

    if (

      url.pathname === "/do/balance"

    ) {

      const balances =

        this.getBalances(

          user.id

        );

      return json({

        ok: true,

        /*

         * Old "balance" field remains

         * for compatibility with the

         * existing Mini App.

         */

        balance:

          balances.playBalance,

        mainBalance:

          balances.mainBalance,

        playBalance:

          balances.playBalance

      });

    }

    /* =====================================================

       WALLET

       ===================================================== */

    if (

      url.pathname === "/do/wallet" &&

      request.method === "POST"

    ) {

      const contentType =

        request.headers.get("content-type") || "";

      /*

       * Deposit screenshot uses

       * multipart/form-data.

       */

      if (

        contentType.includes("multipart/form-data")

      ) {

        let form;

        try {

          form =

            await request.formData();

        } catch (_) {

          return json({

            ok: false,

            error: "INVALID_FORM"

          });

        }

        const type =

          String(

            form.get("type") || "deposit"

          );

        const method =

          String(

            form.get("method") || "Telebirr"

          );

        const amount =

          Number(

            form.get("amount") || 0

          );

        let screenshot =

          form.get("screenshot");

        if (

          type !== "deposit"

        ) {

          return json(

            await this.walletRequest(

              user.id,

              {

                type,

                method,

                amount

              }

            )

          );

        }

        if (

          !screenshot ||

          typeof screenshot.arrayBuffer !==

            "function"

        ) {

          return json({

            ok: false,

            error: "SCREENSHOT_REQUIRED"

          });

        }

        const MAX_SCREENSHOT_BYTES =

          300 * 1024;

        if (

          screenshot.size >

          MAX_SCREENSHOT_BYTES

        ) {

          return json({

            ok: false,

            error: "SCREENSHOT_TOO_LARGE",

            maxBytes:

              MAX_SCREENSHOT_BYTES

          });

        }

        const buffer =

          await screenshot.arrayBuffer();

        const bytes =

          new Uint8Array(buffer);

        let binary = "";

        const CHUNK =

          0x8000;

        for (

          let i = 0;

          i < bytes.length;

          i += CHUNK

        ) {

          binary +=

            String.fromCharCode(

              ...bytes.subarray(

                i,

                i + CHUNK

              )

            );

        }

        const base64 =

          btoa(binary);

        const mime =

          screenshot.type ||

          "image/jpeg";

        const dataUrl =

          `data:${mime};base64,${base64}`;

        try {

          return json(

            await this.walletRequest(

              user.id,

              {

                type: "deposit",

                method,

                amount,

                screenshot: dataUrl,

                screenshotMime: mime

              }

            )

          );

        } catch (error) {

          console.error(

            "DEPOSIT_ERROR:",

            error

          );

          return json({

            ok: false,

            error: "DEPOSIT_SERVER_ERROR",

            message: String(

              error?.message ||

              error ||

              "Unknown error"

            )

          }, 500);

        }

      }

      /*

       * Normal JSON request:

       * mainly withdrawal.

       */

      let body = {};

      try {

        body =

          await request.json();

      } catch (_) {}

      return json(

        await this.walletRequest(

          user.id,

          body

        )

      );

    }

    /* =====================================================

       CLAIM

       ===================================================== */

    if (

      url.pathname === "/do/claim"

    ) {

      return json(

        await this.claim(

          user.id

        )

      );

    }

    /* =====================================================

       ADMIN AUTH

       ===================================================== */

    if (

      url.pathname.startsWith(

        "/do/admin/"

      )

    ) {

      if (

        !this.isAdmin(request)

      ) {

        return json(

          {

            ok: false,

            error: "UNAUTHORIZED"

          },

          401

        );

      }

      const adminKey =

        request.headers.get(

          "x-admin-key"

        ) || "admin";

      /* SUMMARY */

      if (

        url.pathname ===

        "/do/admin/summary"

      ) {

        return json(

          this.getAdminSummary()

        );

      }

      /* USERS */

      if (

        url.pathname ===

        "/do/admin/users"

      ) {

        return json({

          ok: true,

          users:

            this.getAdminUsers()

        });

      }

      /* REQUESTS */

      if (

        url.pathname ===

        "/do/admin/requests"

      ) {

        return json({

          ok: true,

          requests:

            this.getAdminRequests()

        });

      }

      /* CONFIRM / REJECT */

      if (

        url.pathname ===

          "/do/admin/request-action" &&

        request.method === "POST"

      ) {

        let body = {};

        try {

          body =

            await request.json();

        } catch (_) {}

        const requestId =

          Number(

            body.requestId

          );

        const action =

          body.action === "confirm"

            ? "confirm"

            : body.action === "reject"

              ? "reject"

              : "";

        if (

          !Number.isInteger(

            requestId

          ) ||

          !action

        ) {

          return json({

            ok: false,

            error: "INVALID_ACTION"

          });

        }

        return json(

          await this.adminRequestAction(

            requestId,

            action,

            adminKey

          )

        );

      }

      /* SET DEMO BALANCE */

      if (

        url.pathname ===

          "/do/admin/set-balance" &&

        request.method === "POST"

      ) {

        let body = {};

        try {

          body =

            await request.json();

        } catch (_) {}

        return json(

          await this.adminSetBalance(

            String(

              body.userId || ""

            ),

            String(

              body.balanceType || ""

            ),

            Number(

              body.amount

            )

          )

        );

      }

      /* GAME CONTROL */

      if (

        url.pathname ===

          "/do/admin/control" &&

        request.method === "POST"

      ) {

        let body = {};

        try {

          body =

            await request.json();

        } catch (_) {}

        return json(

          await this.adminGameControl(

            String(

              body.action || ""

            )

          )

        );

      }

    }

  }

}

/* =========================================================

   MINI APP HTML

   ========================================================= */

function pageHtml() {

  return String.raw`<!DOCTYPE html>

<html lang="am">

<head>

<meta charset="UTF-8">

<meta name="viewport"

  content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">

<meta name="theme-color" content="#07090d">

<title>Fast Bingo</title>

<style>

:root{

  --bg:#07090d;

  --surface:#10141c;

  --surface2:#151b25;

  --surface3:#1b2230;

  --line:#293243;

  --text:#fff;

  --muted:#8993a4;

  --red:#e50914;

  --red2:#ff3038;

  --green:#26d07c;

  --gold:#ffc857;

  --blue:#4da3ff;

}

*{

  box-sizing:border-box;

  -webkit-tap-highlight-color:transparent;

}

html,body{

  margin:0;

  padding:0;

  background:var(--bg);

  color:var(--text);

  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;

}

body{

  min-height:100vh;

  padding-bottom:82px;

}

button,

input,

select{

  font:inherit;

}

button{

  cursor:pointer;

}

.app{

  width:100%;

  max-width:720px;

  margin:0 auto;

  padding:12px 12px 90px;

}

.topbar{

  position:sticky;

  top:0;

  z-index:30;

  margin:-12px -12px 0;

  padding:12px;

  background:rgba(7,9,13,.96);

  backdrop-filter:blur(16px);

  border-bottom:1px solid rgba(255,255,255,.05);

}

.topbar-row{

  display:flex;

  align-items:center;

  gap:10px;

}

.logo-ball{

  width:40px;

  height:40px;

  border-radius:50%;

  background:linear-gradient(145deg,var(--red2),var(--red));

  display:flex;

  align-items:center;

  justify-content:center;

  font-weight:900;

  font-size:18px;

  box-shadow:0 8px 24px rgba(229,9,20,.28);

}

.brand{

  flex:1;

  min-width:0;

}

.brand-title{

  font-size:18px;

  line-height:20px;

  font-weight:900;

  letter-spacing:.4px;

}

.brand-sub{

  color:var(--muted);

  font-size:9px;

  letter-spacing:1.3px;

  margin-top:2px;

}

.language-mini{

  display:flex;

  border:1px solid var(--line);

  border-radius:9px;

  overflow:hidden;

}

.language-mini button{

  border:0;

  background:transparent;

  color:var(--muted);

  padding:7px 8px;

  font-size:11px;

  font-weight:800;

}

.language-mini button.active{

  color:#fff;

  background:var(--red);

}

.balance-area{

  margin-top:10px;

  display:grid;

  grid-template-columns:1fr 1fr;

  gap:8px;

}

.balance-box{

  background:linear-gradient(145deg,#111721,#0d1118);

  border:1px solid var(--line);

  border-radius:12px;

  padding:8px 10px;

}

.balance-label{

  color:var(--muted);

  font-size:9px;

}

.balance-value{

  margin-top:2px;

  font-weight:900;

  font-size:14px;

}

.hero{

  margin-top:14px;

}

.status-box{

  position:relative;

  overflow:hidden;

  border-radius:18px;

  padding:17px;

  background:

    radial-gradient(circle at 100% 0%,rgba(229,9,20,.28),transparent 40%),

    linear-gradient(145deg,#171c26,#0e1219);

  border:1px solid #30394a;

  box-shadow:0 12px 35px rgba(0,0,0,.25);

}

.status-box.lobby{

  border-color:rgba(255,200,87,.35);

}

.status-box.live{

  border-color:rgba(38,208,124,.28);

}

.status-top{

  display:flex;

  align-items:center;

  justify-content:space-between;

  gap:10px;

}

.status-pill{

  display:inline-flex;

  align-items:center;

  gap:6px;

  padding:5px 9px;

  border-radius:999px;

  background:#0a0e14;

  border:1px solid var(--line);

  font-size:10px;

  font-weight:900;

}

.status-dot{

  width:7px;

  height:7px;

  border-radius:50%;

  background:var(--gold);

}

.live .status-dot{

  background:var(--green);

  box-shadow:0 0 10px rgba(38,208,124,.7);

}

.game-no{

  color:var(--muted);

  font-size:10px;

  font-weight:700;

}

.status-title{

  font-size:20px;

  font-weight:900;

  margin-top:14px;

}

.status-message{

  color:#b3bccb;

  font-size:12px;

  margin-top:5px;

}

.jackpot{

  margin-top:15px;

  padding:13px 14px;

  border-radius:14px;

  background:

    linear-gradient(135deg,

      rgba(229,9,20,.17),

      rgba(255,200,87,.08));

  border:1px solid rgba(255,200,87,.28);

}

.jackpot-label{

  color:#d8c48d;

  font-size:10px;

  font-weight:800;

}

.jackpot-row{

  display:flex;

  align-items:flex-end;

  justify-content:space-between;

  gap:10px;

}

.jackpot-value{

  font-size:27px;

  line-height:30px;

  font-weight:950;

  letter-spacing:-.7px;

}

.countdown{

  color:#fff;

  font-size:18px;

  font-weight:950;

}

.countdown small{

  color:var(--muted);

  font-size:9px;

  font-weight:700;

}

.live-message{

  display:none;

  margin-top:15px;

  padding:14px;

  border-radius:12px;

  background:rgba(38,208,124,.08);

  border:1px solid rgba(38,208,124,.2);

  color:#d8ffe9;

  font-weight:800;

  font-size:13px;

  line-height:20px;

}

.live .live-message{

  display:block;

}

.live .jackpot,

.live .lobby-selection{

  display:none;

}

.current-ball{

  margin-top:15px;

  display:flex;

  align-items:center;

  gap:12px;

}

.ball{

  width:68px;

  height:68px;

  border-radius:50%;

  display:flex;

  flex-direction:column;

  align-items:center;

  justify-content:center;

  background:

    radial-gradient(circle at 32% 25%,#fff,#f1f1f1 12%,#e50914 14%,#97040b 80%);

  color:#fff;

  box-shadow:

    inset -7px -9px 14px rgba(0,0,0,.28),

    0 12px 28px rgba(229,9,20,.28);

}

.ball-letter{

  font-size:10px;

  font-weight:900;

}

.ball-number{

  font-size:22px;

  line-height:22px;

  font-weight:950;

}

.ball-info{

  color:var(--muted);

  font-size:10px;

}

.recent{

  margin-top:13px;

  display:flex;

  gap:6px;

  overflow:hidden;

}

.mini-ball{

  min-width:29px;

  height:29px;

  border-radius:50%;

  background:#202733;

  border:1px solid #323c4c;

  display:flex;

  align-items:center;

  justify-content:center;

  font-size:10px;

  font-weight:800;

}

.mini-ball.latest{

  background:var(--red);

  border-color:var(--red2);

}

.selection-panel{

  margin-top:13px;

  background:var(--surface);

  border:1px solid var(--line);

  border-radius:17px;

  padding:14px;

}

.selection-head{

  display:flex;

  justify-content:space-between;

  align-items:center;

  gap:10px;

}

.selection-title{

  font-size:14px;

  font-weight:900;

}

.selection-title span{

  color:var(--gold);

}

.selection-count{

  font-size:12px;

  color:#dce2eb;

  font-weight:900;

  white-space:nowrap;

}

.card-grid{

  margin-top:12px;

  display:grid;

  grid-template-columns:repeat(10,minmax(0,1fr));

  gap:5px;

}

.card-select{

  min-width:0;

  height:31px;

  padding:0;

  border-radius:7px;

  border:1px solid #2a3444;

  background:#141a23;

  color:#aeb8c8;

  font-size:9px;

  font-weight:800;

}

.card-select:active{

  transform:scale(.95);

}

.card-select.selected{

  background:var(--red);

  border-color:#ff4b52;

  color:#fff;

  box-shadow:0 4px 12px rgba(229,9,20,.25);

}

.selected-previews{

  margin-top:13px;

}

.selected-previews-title{

  color:var(--muted);

  font-size:10px;

  font-weight:800;

  margin-bottom:8px;

}

.preview-grid{

  display:grid;

  grid-template-columns:repeat(2,minmax(0,1fr));

  gap:8px;

}

.bingo-card{

  background:#0d1118;

  border:1px solid #303949;

  border-radius:12px;

  padding:7px;

}

.bingo-card-head{

  display:flex;

  align-items:center;

  justify-content:space-between;

  margin-bottom:6px;

}

.card-number-label{

  color:#b7c0ce;

  font-size:9px;

  font-weight:900;

}

.card-state{

  color:var(--green);

  font-size:10px;

}

.bingo-grid{

  display:grid;

  grid-template-columns:repeat(5,1fr);

  gap:3px;

}

.bingo-cell{

  aspect-ratio:1;

  border-radius:4px;

  background:#181f2a;

  display:flex;

  align-items:center;

  justify-content:center;

  font-size:8px;

  font-weight:850;

  color:#c5ccd7;

}

.bingo-cell.called{

  background:rgba(229,9,20,.85);

  color:#fff;

}

.bingo-cell.free{

  background:#252d39;

  color:var(--gold);

  font-size:7px;

}

.panels{

  margin-top:13px;

}

.panel{

  background:var(--surface);

  border:1px solid var(--line);

  border-radius:17px;

  padding:15px;

  margin-bottom:12px;

}

.panel-title{

  font-size:14px;

  font-weight:900;

}

.panel-sub{

  color:var(--muted);

  font-size:10px;

  line-height:16px;

  margin-top:3px;

}

.info-grid{

  display:grid;

  grid-template-columns:1fr 1fr;

  gap:8px;

  margin-top:12px;

}

.info-box{

  background:#0d1118;

  border:1px solid #252e3d;

  border-radius:11px;

  padding:10px;

}

.info-box-title{

  font-size:10px;

  font-weight:900;

}

.info-box-text{

  color:var(--muted);

  font-size:8px;

  line-height:13px;

  margin-top:4px;

}

.called-grid{

  margin-top:12px;

  display:grid;

  grid-template-columns:repeat(15,1fr);

  gap:4px;

}

.called-number{

  aspect-ratio:1;

  border-radius:5px;

  background:#161c25;

  border:1px solid #252e3c;

  display:flex;

  align-items:center;

  justify-content:center;

  color:#667184;

  font-size:8px;

  font-weight:800;

}

.called-number.active{

  background:var(--red);

  border-color:var(--red2);

  color:#fff;

}

.primary-btn{

  width:100%;

  border:0;

  border-radius:12px;

  padding:12px;

  background:linear-gradient(135deg,var(--red2),var(--red));

  color:#fff;

  font-weight:950;

  font-size:12px;

  box-shadow:0 8px 22px rgba(229,9,20,.2);

}

.secondary-btn{

  width:100%;

  border:1px solid var(--line);

  border-radius:12px;

  padding:11px;

  background:#151b25;

  color:#fff;

  font-weight:850;

}

.wallet-balance{

  margin-top:12px;

  padding:15px;

  border-radius:14px;

  background:linear-gradient(135deg,#171e29,#0d1219);

  border:1px solid var(--line);

  display:flex;

  justify-content:space-between;

  align-items:center;

}

.wallet-label{

  color:var(--muted);

  font-size:9px;

}

.wallet-value{

  font-size:23px;

  font-weight:950;

  margin-top:3px;

}

.type-toggle{

  display:grid;

  grid-template-columns:1fr 1fr;

  gap:7px;

  margin-top:12px;

}

.type-btn{

  border:1px solid var(--line);

  border-radius:10px;

  background:#121821;

  color:#8e99aa;

  padding:10px;

  font-size:10px;

  font-weight:900;

}

.type-btn.active{

  background:var(--red);

  color:#fff;

  border-color:var(--red2);

}

.payment-methods{

  display:grid;

  grid-template-columns:repeat(3,1fr);

  gap:8px;

  margin-top:12px;

}

.payment-card{

  border:1px solid var(--line);

  border-radius:12px;

  background:#0d1219;

  padding:10px;

  text-align:left;

}

.payment-card.active{

  border-color:var(--red2);

  background:#17141a;

}

.payment-name{

  font-size:11px;

  font-weight:950;

}

.payment-owner{

  color:#cbd2dd;

  font-size:9px;

  margin-top:5px;

  white-space:nowrap;

  overflow:hidden;

  text-overflow:ellipsis;

}

.payment-number{

  color:var(--muted);

  font-size:9px;

  margin-top:3px;

}

.field{

  margin-top:10px;

}

.field label{

  display:block;

  color:var(--muted);

  font-size:9px;

  margin-bottom:5px;

}

.field input,

.field select{

  width:100%;

  border:1px solid var(--line);

  border-radius:10px;

  background:#0c1118;

  color:#fff;

  padding:11px;

  outline:none;

}

.note{

  display:none;

}

.language-buttons{

  display:grid;

  grid-template-columns:1fr 1fr;

  gap:8px;

  margin-top:12px;

}

.language-btn{

  border:1px solid var(--line);

  border-radius:10px;

  padding:11px;

  background:#121821;

  color:#9ba5b4;

  font-size:11px;

  font-weight:900;

}

.language-btn.active{

  background:var(--red);

  border-color:var(--red2);

  color:#fff;

}

.simple-page{

  text-align:center;

  padding:35px 12px;

}

.simple-icon{

  font-size:34px;

}

.simple-title{

  font-size:18px;

  font-weight:950;

  margin-top:10px;

}

.simple-text{

  color:var(--muted);

  font-size:11px;

  line-height:18px;

  margin-top:6px;

}

.bottom-nav{

  position:fixed;

  left:0;

  right:0;

  bottom:0;

  z-index:50;

  background:rgba(10,13,18,.97);

  border-top:1px solid #222a36;

  backdrop-filter:blur(18px);

}

.bottom-inner{

  max-width:720px;

  margin:auto;

  display:grid;

  grid-template-columns:repeat(4,1fr);

}

.bottom-btn{

  border:0;

  background:transparent;

  color:#707b8d;

  padding:8px 4px 9px;

  font-size:10px;

  font-weight:850;

}

.bottom-btn.active{

  color:#fff;

}

.bottom-btn.active .nav-icon{

  color:var(--red2);

}

.nav-icon{

  font-size:17px;

  line-height:19px;

}

.section{

  display:none;

}

.section.active{

  display:block;

}

.toast{

  position:fixed;

  left:50%;

  bottom:86px;

  transform:translate(-50%,20px);

  opacity:0;

  pointer-events:none;

  z-index:100;

  background:#202733;

  color:#fff;

  border:1px solid #3a4557;

  border-radius:10px;

  padding:10px 14px;

  font-size:10px;

  font-weight:800;

  transition:.22s;

  max-width:85%;

  text-align:center;

}

.toast.show{

  opacity:1;

  transform:translate(-50%,0);

}

@media(max-width:420px){

  .card-grid{

    gap:4px;

  }

  .card-select{

    height:29px;

    font-size:8px;

  }

  .called-grid{

    gap:3px;

  }

  .called-number{

    font-size:7px;

  }

  .preview-grid{

    grid-template-columns:1fr;

  }

  .payment-methods{

    grid-template-columns:1fr;

  }

}

</style>

</head>

<body>

<div class="app">

<header class="topbar">

  <div class="topbar-row">

    <div class="logo-ball">8</div>

    <div class="brand">

      <div class="brand-title">

        FAST BINGO

      </div>

      <div class="brand-sub"

           id="brandSub">

        75 BALL • LIVE BINGO

      </div>

    </div>

    <div class="language-mini">

      <button id="miniAm"

              class="active">

        አማ

      </button>

      <button id="miniEn">

        EN

      </button>

    </div>

  </div>

  <div class="balance-area">

    <div class="balance-box">

      <div class="balance-label">

        Play Balance

      </div>

      <div class="balance-value"

           id="topBalance">

        00.00 ETB

      </div>

    </div>

    <div class="balance-box">

      <div class="balance-label"

           id="mainBalanceLabel">

        ዋና ሂሳብ

      </div>

      <div class="balance-value">

        <span id="mainBalance">

          00.00

        </span>

        ETB

      </div>

    </div>

  </div>

</header>

<main>

<section

  id="section-home"

  class="section active"

>

  <div class="hero">

    <div

      class="status-box lobby"

      id="statusBox"

    >

      <div class="status-top">

        <div class="status-pill">

          <span

            class="status-dot"

            id="statusDot"

          ></span>

          <span id="statusText">

            በመጠበቅ ላይ

          </span>

        </div>

        <div

          class="game-no"

          id="gameNumber"

        >

          GAME #1

        </div>

      </div>

      <div

        class="status-title"

        id="statusTitle"

      >

        ካርቴላ ይምረጡ

      </div>

      <div

        class="status-message"

        id="statusMessage"

      >

        45 ሰከንድ ውስጥ ቀጣዩ ጨዋታ ይጀምራል።

      </div>

      <div class="jackpot">

        <div class="jackpot-label">

          ደራሽ

        </div>

        <div class="jackpot-row">

          <div

            class="jackpot-value"

            id="jackpotValue"

          >

            00 ETB

          </div>

          <div

            class="countdown"

            id="countdown"

          >

            45s

          </div>

        </div>

      </div>

      <div class="live-message"

           id="liveMessage">

        ጨዋታው ጀምሯል።

        ቀጣዩን ዙር ይጠብቁ።

      </div>

      <div class="current-ball"

           id="currentBallArea">

        <div class="ball">

          <div

            class="ball-letter"

            id="ballLetter"

          >

            B

          </div>

          <div

            class="ball-number"

            id="ballNumber"

          >

            —

          </div>

        </div>

        <div class="ball-info">

          <div>

            CURRENT BALL

          </div>

          <div

            id="calledInfo"

            style="margin-top:5px"

          >

            0 / 75

          </div>

        </div>

      </div>

      <div

        class="recent"

        id="recentBalls"

      ></div>

    </div>

  </div>

  <div class="selection-panel"

       id="selectionPanel">

    <div class="selection-head">

      <div class="selection-title">

        ካርቴላ ይምረጡ

        <span>( 10 ብር )</span>

      </div>

      <div

        class="selection-count"

        id="selectionCount"

      >

        0/4

      </div>

    </div>

    <div

      class="card-grid"

      id="cardGrid"

    ></div>

  </div>

  <div

    class="selected-previews"

    id="selectedPreviewArea"

  >

    <div class="selected-previews-title">

      የመረጡት ካርዶች

    </div>

    <div

      class="preview-grid"

      id="previewGrid"

    ></div>

  </div>

  <div class="panel"

       style="margin-top:13px">

    <div

      class="panel-title"

      id="rulesTitle"

    >

      Fast Bingo

    </div>

    <div

      class="panel-sub"

      id="rulesText"

    >

      75 Ball Bingo • B 1–15 • I 16–30 • N 31–45 • G 46–60 • O 61–75

    </div>

  </div>

</section>

<section

  id="section-rank"

  class="section"

>

  <div class="panel simple-page">

    <div class="simple-icon">

      🏆

    </div>

    <div class="simple-title"

         id="rankTitle">

      ደረጃ

    </div>

    <div class="simple-text"

         id="rankText">

      የFast Bingo ደረጃዎ እዚህ ይታያል።

    </div>

  </div>

</section>

<section

  id="section-profile"

  class="section"

>

  <div class="panel simple-page">

    <div class="simple-icon">

      👤

    </div>

    <div class="simple-title"

         id="profileTitle">

      ፕሮፋይል

    </div>

    <div class="simple-text"

         id="profileText">

      የTelegram መለያዎ መረጃ እዚህ ይታያል።

    </div>

    <div

      class="wallet-balance"

      style="text-align:left"

    >

      <div>

        <div class="wallet-label">

          PLAYER

        </div>

        <div

          class="wallet-value"

          id="playerName"

          style="font-size:17px"

        >

          Guest

        </div>

      </div>

    </div>

  </div>

</section>

<section

  id="section-wallet"

  class="section"

>

  <div class="panel">

    <div

      class="panel-title"

      id="walletTitle"

    >

      ቦርሳ

    </div>

    <div class="payment-methods">

      <button

        type="button"

        class="payment-card active"

        data-method="Telebirr"

      >

        <div class="payment-name">

          Telebirr

        </div>

        <div

          class="payment-owner"

          id="telebirrOwner"

        >

          Hanza

        </div>

        <div

          class="payment-number"

          id="telebirrNumber"

        >

          0999960421

        </div>

      </button>

      <button

        type="button"

        class="payment-card"

        data-method="eBirr"

      >

        <div class="payment-name">

          E-Birr

        </div>

        <div

          class="payment-owner"

          id="ebirrOwner"

        >

          Belay

        </div>

        <div

          class="payment-number"

          id="ebirrNumber"

        >

          0999960421

        </div>

      </button>

      <button

        type="button"

        class="payment-card"

        data-method="M-PESA"

      >

        <div class="payment-name">

          M-PESA

        </div>

        <div

          class="payment-owner"

          id="mpesaOwner"

        >

          Gemechu

        </div>

        <div

          class="payment-number"

          id="mpesaNumber"

        >

          0786192665

        </div>

      </button>

    </div>

    <div class="wallet-balance">

      <div>

        <div class="wallet-label">

          PLAY BALANCE

        </div>

        <div

          class="wallet-value"

          id="walletBalance"

        >

          00.00 ETB

        </div>

      </div>

      <div style="font-size:24px">

        💰

      </div>

    </div>

    <div class="type-toggle">

      <button

        class="type-btn active"

        id="depositBtn"

      >

        + ገቢ

      </button>

      <button

        class="type-btn"

        id="withdrawBtn"

      >

        − ወጪ

      </button>

    </div>

    <div class="field">

      <label id="amountLabel">

        መጠን

      </label>

      <input

        id="walletAmount"

        type="number"

        min="50"

        max="100000"

        placeholder="50"

      >

    </div>

    <div

      class="field"

      id="walletScreenshotField"

    >

      <label>

        የክፍያ Screenshot

      </label>

      <input

        id="walletScreenshot"

        type="file"

        accept="image/jpeg,image/png,image/webp"

      >

      <div

        style="

          color:#8993a4;

          font-size:8px;

          margin-top:5px;

          line-height:13px;

        "

      >

        Deposit ሲያደርጉ የክፍያ Screenshot ያስገቡ።

        Maximum 300 KB.

      </div>

    </div>

    <button

      class="primary-btn"

      id="walletSubmit"

      style="margin-top:10px"

    >

      ገቢ አድርግ

    </button>

  </div>

  <div class="panel">

    <div

      class="panel-title"

      id="languageTitle"

    >

      ቋንቋ

    </div>

    <div

      class="panel-sub"

      id="languageSub"

    >

      የመተግበሪያውን ቋንቋ ይምረጡ።

    </div>

    <div class="language-buttons">

      <button

        class="language-btn active"

        id="amBtn"

      >

        አማርኛ

      </button>

      <button

        class="language-btn"

        id="enBtn"

      >

        English

      </button>

    </div>

  </div>

</section>

</main>

</div>

<div class="bottom-nav">

  <div class="bottom-inner">

    <button

      class="bottom-btn active"

      data-section="home"

    >

      <div class="nav-icon">⌂</div>

      <span id="navHome">

        መነሻ

      </span>

    </button>

    <button

      class="bottom-btn"

      data-section="rank"

    >

      <div class="nav-icon">♛</div>

      <span id="navRank">

        ደረጃ

      </span>

    </button>

    <button

      class="bottom-btn"

      data-section="profile"

    >

      <div class="nav-icon">◉</div>

      <span id="navProfile">

        ፕሮፋይል

      </span>

    </button>

    <button

      class="bottom-btn"

      data-section="wallet"

    >

      <div class="nav-icon">▣</div>

      <span id="navWallet">

        ቦርሳ

      </span>

    </button>

  </div>

</div>

<div

  class="toast"

  id="toast"

></div>

<!-- Telegram WebApp SDK MUST load before the app script -->

<script src="https://telegram.org/js/telegram-web-app.js"></script>

<script>

(function(){

  var tg =

    window.Telegram &&

    window.Telegram.WebApp

      ? window.Telegram.WebApp

      : null;

  if(tg){

    try{

      tg.ready();

      tg.expand();

    }catch(e){}

  }

var telegramUser = {

  id:"guest",

  first_name:"Guest",

  username:""

};

var userHeader = "";

function refreshTelegramUser(){

  var liveUser = null;

  /* 1. Telegram WebApp user */

  if(

    tg &&

    tg.initDataUnsafe &&

    tg.initDataUnsafe.user &&

    tg.initDataUnsafe.user.id

  ){

    liveUser =

      tg.initDataUnsafe.user;

  }

  /* 2. Fallback: read user from Telegram initData */

  if(

    !liveUser &&

    tg &&

    tg.initData

  ){

    try{

      var params =

        new URLSearchParams(

          tg.initData

        );

      var userData =

        params.get("user");

      if(userData){

        liveUser =

          JSON.parse(

            userData

          );

      }

    }catch(e){

      console.error(

        "Telegram user parse error:",

        e

      );

    }

  }

  /* 3. Save Telegram user */

  if(

    liveUser &&

    liveUser.id

  ){

    telegramUser =

      liveUser;

  }

  /* 4. Send current user to API */

  userHeader =

    JSON.stringify(

      telegramUser

    );

  return telegramUser;

}

refreshTelegramUser();

  var selected = [];

  var currentGame = null;

  var walletType = "deposit";

  var selectedPaymentMethod =

    "Telebirr";

  var language = "am";

  var mainBalance = 0;

  var playBalance = 0;

  var lobbyDeadline = 0;

  var cardCache = {};

  var cardSignatures = {};

  var translations = {

    am:{

      brandSub:"75 BALL • LIVE BINGO",

      mainBalance:"ዋና ሂሳብ",

      lobby:"በመጠበቅ ላይ",

      live:"LIVE",

      lobbyTitle:"ካርቴላ ይምረጡ",

      liveTitle:"ጨዋታው ጀምሯል",

      lobbyMessage:"45 ሰከንድ ውስጥ ቀጣዩ ጨዋታ ይጀምራል።",

      liveMessage:"ጨዋታው ጀምሯል። ቀጣዩን ዙር ይጠብቁ።",

      jackpot:"ደራሽ",

      select:"ካርቴላ ይምረጡ",

      price:"10 ብር",

      selected:"የመረጡት ካርዶች",

      rules:"Fast Bingo",

      rulesText:"75 Ball Bingo • B 1–15 • I 16–30 • N 31–45 • G 46–60 • O 61–75",

      home:"መነሻ",

      rank:"ደረጃ",

      profile:"ፕሮፋይል",

      wallet:"ቦርሳ",

      rankText:"የFast Bingo ደረጃዎ እዚህ ይታያል።",

      profileText:"የTelegram መለያዎ መረጃ እዚህ ይታያል።",

      method:"ዘዴ",

      amount:"መጠን",

      deposit:"+ ገቢ",

      withdraw:"− ወጪ",

      depositAction:"ገቢ አድርግ",

      withdrawAction:"ወጪ አድርግ",

      language:"ቋንቋ",

      languageSub:"የመተግበሪያውን ቋንቋ ይምረጡ።",

      saved:"ካርዶችዎ ተቀምጠዋል።",

      lobbyOnly:"ካርድ መምረጥ የሚቻለው Lobby ጊዜ ብቻ ነው።",

      maxCards:"እስከ 4 ካርዶች ብቻ መምረጥ ይችላሉ።",

      gameProgress:"ጨዋታው ጀምሯል። ቀጣዩን ዙር ይጠብቁ።",

      invalidAmount:"ትክክለኛ መጠን ያስገቡ።",

      minimum:"ዝቅተኛው መጠን 50 ብር ነው።",

      insufficient:"❌ ለመጫወት በቂ ሂሳብ የለዎትም። ተቀማጭ ገቢ ያድርጉ እና ጨዋታውን ይቀጥሉ።",

      balanceUpdated:"ሂሳቡ ተዘምኗል።",

      winner:"🎉 Bingo! አሸናፊ ካርድ ተገኝቷል።",

      notWinner:"እስካሁን 2 መስመር ያሟላ ካርድ የለም።"

    },

    en:{

      brandSub:"75 BALL • LIVE BINGO",

      mainBalance:"Main Balance",

      lobby:"LOBBY",

      live:"LIVE",

      lobbyTitle:"Choose your cards",

      liveTitle:"GAME STARTED",

      lobbyMessage:"The next game starts after the 45-second lobby.",

      liveMessage:"Game has started. Wait for the next round.",

      jackpot:"JACKPOT",

      select:"Choose Cards",

      price:"10 ETB",

      selected:"Selected Cards",

      rules:"Fast Bingo",

      rulesText:"75 Ball Bingo • B 1–15 • I 16–30 • N 31–45 • G 46–60 • O 61–75",

      home:"HOME",

      rank:"RANK",

      profile:"PROFILE",

      wallet:"WALLET",

      rankText:"Your Fast Bingo rank will appear here.",

      profileText:"Your Telegram profile information appears here.",

      method:"Method",

      amount:"Amount",

      deposit:"+ DEPOSIT",

      withdraw:"− WITHDRAW",

      depositAction:"ADD BALANCE",

      withdrawAction:"WITHDRAW",

      language:"Language",

      languageSub:"Choose your application language.",

      saved:"Your cards have been saved.",

      lobbyOnly:"Cards can only be selected during the lobby.",

      maxCards:"You can select up to 4 cards.",

      gameProgress:"Game has started. Wait for the next round.",

      invalidAmount:"Enter a valid amount.",

      minimum:"Minimum amount is 50 ETB.",

      insufficient:"❌ Insufficient balance. Please deposit funds and continue the game.",

      balanceUpdated:"Balance updated.",

      winner:"🎉 Bingo! Winning card found.",

      notWinner:"No card has completed 2 lines yet."

    }

  };

  function t(key){

    return translations[language][key] ||

      translations.en[key] ||

      key;

  }

  /* =======================================================

   LOGIN / FIRST REGISTRATION SCREEN

   ======================================================= */

var loginReady = false;

var loginBusy = false;

function addLoginStyles(){

  if(

    document.getElementById(

      "fastBingoLoginStyles"

    )

  ){

    return;

  }

  var style =

    document.createElement("style");

  style.id =

    "fastBingoLoginStyles";

  style.textContent = ${String.fromCharCode(96)}

    #fastBingoLogin{

      position:fixed;

      inset:0;

      z-index:999999;

      background:#070b16;

      display:flex;

      align-items:center;

      justify-content:center;

      padding:22px;

    }

    #fastBingoLogin .login-box{

      width:100%;

      max-width:420px;

      background:#101827;

      border:1px solid rgba(255,255,255,.10);

      border-radius:22px;

      padding:30px 22px;

      box-shadow:0 20px 60px rgba(0,0,0,.45);

      text-align:center;

    }

    #fastBingoLogin .login-title{

      font-size:28px;

      font-weight:800;

      color:#fff;

      margin-bottom:12px;

    }

    #fastBingoLogin .login-subtitle{

      color:#cbd5e1;

      font-size:15px;

      line-height:1.8;

      margin-bottom:10px;

    }

    #fastBingoLogin .login-bonus{

      color:#22c55e;

      font-size:18px;

      font-weight:800;

      line-height:1.7;

      margin:14px 0 22px;

    }

    #fastBingoLogin .login-button{

      width:100%;

      border:0;

      border-radius:14px;

      padding:16px;

      background:#e11d48;

      color:#fff;

      font-size:17px;

      font-weight:800;

      cursor:pointer;

      margin-top:4px;

    }

    #fastBingoLogin .login-button:disabled{

      opacity:.55;

      cursor:not-allowed;

    }

    #fastBingoLogin .login-message{

      min-height:22px;

      margin-top:14px;

      color:#cbd5e1;

      font-size:13px;

      line-height:1.5;

    }

  ${String.fromCharCode(96)};

  document.head.appendChild(style);

}

function createLoginScreen(){

  if(

    document.getElementById(

      "fastBingoLogin"

    )

  ){

    return;

  }

  addLoginStyles();

  var overlay =

    document.createElement("div");

  overlay.id =

    "fastBingoLogin";

  overlay.innerHTML =

  ${String.fromCharCode(96)}

    <div class="login-box">

      <div class="login-title">

        Fast Bingo

      </div>

      <div class="login-subtitle">

        🎉 Fast Bingo ቤተሰብ ይሁኑ!

      </div>

      <div class="login-bonus">

        የመጀመሪያ ምዝገባ<br>

        20 ብር ጉርሻ ያግኙ!

      </div>

      <button

        type="button"

        class="login-button"

        id="loginJoinButton"

      >

        🎮 ይቀላቀሉ

      </button>

      <div

        class="login-message"

        id="loginMessage"

      ></div>

    </div>

  ${String.fromCharCode(96)};

  document.body.appendChild(

    overlay

  );

  document

    .getElementById(

      "loginJoinButton"

    )

    .addEventListener(

      "click",

      registerFromLogin

    );

}

function loginMessage(message){

  var el =

    document.getElementById(

      "loginMessage"

    );

  if(el){

    el.textContent =

      message || "";

  }

}

function setLoginBusy(busy){

  loginBusy = busy;

  var button =

    document.getElementById(

      "loginJoinButton"

    );

  if(button){

    button.disabled =

      busy;

  }

}

function showLoginScreen(){

  createLoginScreen();

  var overlay =

    document.getElementById(

      "fastBingoLogin"

    );

  if(overlay){

    overlay.style.display =

      "flex";

  }

  loginReady = false;

}

function hideLoginScreen(){

  var overlay =

    document.getElementById(

      "fastBingoLogin"

    );

  if(overlay){

    overlay.style.display =

      "none";

  }

  loginReady = true;

}

function registerFromLogin(){

  refreshTelegramUser();

  if(loginBusy){

    return;

  }

  if(

    !telegramUser ||

    !telegramUser.id ||

    String(telegramUser.id) === "guest"

  ){

    loginMessage(

      "እባክዎ Fast Bingo ን በTelegram ውስጥ ይክፈቱ።"

    );

    return;

  }

  setLoginBusy(true);

  loginMessage(

    "Fast Bingo ላይ እየተመዘገቡ ነው..."

  );

  var timeoutId = setTimeout(function(){

    if(loginBusy){

      setLoginBusy(false);

      loginMessage(

        "Server ምላሽ አልሰጠም። እባክዎ እንደገና ይሞክሩ።"

      );

    }

  },10000);

  api(

    "/api/auth/register",

    {

      method:"POST"

    }

  )

  .then(function(result){

    clearTimeout(timeoutId);

    if(

      result &&

      result.ok &&

      result.authenticated

    ){

      hideLoginScreen();

      loginReady = true;

      if(

        typeof loadBalance ===

        "function"

      ){

        loadBalance();

      }

      if(

        typeof loadMyCards ===

        "function"

      ){

        loadMyCards();

      }

      if(

        typeof refreshGame ===

        "function"

      ){

        refreshGame();

      }

      if(

        Number(

          result.firstRegistrationBonus || 0

        ) > 0

      ){

        if(

          typeof showToast ===

          "function"

        ){

          showToast(

            "🎉 እንኳን ወደ Fast Bingo ቤተሰብ በደህና መጡ! 20 ብር ጉርሻ በመጫወቻ ሂሳብዎ ላይ ተጨምሯል።"

          );

        }

      }

      /*

       * Start the normal Mini App refresh

       * after successful registration.

       */

      setInterval(

        refreshGame,

        1000

      );

      setInterval(

        loadBalance,

        10000

      );

      return;

    }

    loginMessage(

      (

        result &&

        (

          result.message ||

          result.error

        )

      )

        ? (

            result.message ||

            result.error

          )

        : "ምዝገባው አልተሳካም። እባክዎ እንደገና ይሞክሩ።"

    );

  })

  .catch(function(error){

    clearTimeout(timeoutId);

    console.error(

      "REGISTER ERROR:",

      error

    );

    loginMessage(

      "Server error። እባክዎ እንደገና ይሞክሩ።"

    );

  })

  .finally(function(){

    clearTimeout(timeoutId);

    setLoginBusy(false);

  });

}

  /* =======================================================

     API

     ======================================================= */

  function api(path, options){

    options = options || {};

    var headers =

      options.headers

        ? new Headers(options.headers)

        : new Headers();

    /*

      IMPORTANT:

      Send Telegram user to Durable Object.

      Do NOT send ADMIN_KEY from Mini App.

    */

    headers.set(

      "x-telegram-user",

      userHeader

    );

    if(

      options.body &&

      !(options.body instanceof FormData) &&

      !headers.has("content-type")

    ){

      headers.set(

        "content-type",

        "application/json"

      );

    }

    options.headers = headers;

    var separator =

      path.indexOf("?") >= 0

        ? "&"

        : "?";

    return fetch(

      path +

      separator +

      "_=" +

      Date.now(),

      options

    ).then(function(response){

      return response.text();

    }).then(function(text){

      try{

        return JSON.parse(text);

      }catch(error){

        return {

          ok:false,

          error:"SERVER_RESPONSE"

        };

      }

    });

  }

  /* =======================================================

     TOAST

     ======================================================= */

  function showToast(message){

    var toast =

      document.getElementById(

        "toast"

      );

    toast.textContent =

      message;

    toast.classList.add(

      "show"

    );

    clearTimeout(

      showToast.timer

    );

    showToast.timer =

      setTimeout(function(){

        toast.classList.remove(

          "show"

        );

      },2600);

  }

  /* =======================================================

     NAVIGATION

     ======================================================= */

  function showSection(name){

    document

      .querySelectorAll(".section")

      .forEach(function(section){

        section.classList.toggle(

          "active",

          section.id ===

            "section-" + name

        );

      });

    document

      .querySelectorAll(".bottom-btn")

      .forEach(function(button){

        button.classList.toggle(

          "active",

          button.dataset.section === name

        );

      });

    window.scrollTo({

      top:0,

      behavior:"smooth"

    });

  }

  document

    .querySelectorAll("[data-section]")

    .forEach(function(button){

      button.addEventListener(

        "click",

        function(){

          showSection(

            button.dataset.section

          );

        }

      );

    });

  /* =======================================================

     PAYMENT METHOD

     ======================================================= */

  document

    .querySelectorAll(".payment-card")

    .forEach(function(card){

      card.addEventListener(

        "click",

        function(){

          document

            .querySelectorAll(".payment-card")

            .forEach(function(item){

              item.classList.remove(

                "active"

              );

            });

          card.classList.add(

            "active"

          );

          selectedPaymentMethod =

            card.dataset.method;

        }

      );

    });

  /* =======================================================

     SEEDED RANDOM

     ======================================================= */

  function seededShuffle(arr, seed){

    var a =

      arr.slice();

    var s =

      seed >>> 0;

    for(

      var i=a.length-1;

      i>0;

      i--

    ){

      s =

        (

          s * 1664525 +

          1013904223

        ) >>> 0;

      var j =

        s % (i+1);

      var tmp =

        a[i];

      a[i]=a[j];

      a[j]=tmp;

    }

    return a;

  }

  /* =======================================================

     CREATE UNIQUE BINGO CARDS

     ======================================================= */

  function makeClientCard(number){

    if(cardCache[number]){

      return cardCache[number];

    }

    var ranges = [

      [1,15],

      [16,30],

      [31,45],

      [46,60],

      [61,75]

    ];

    var attempt = 0;

    while(true){

      var columns = [];

      for(

        var c=0;

        c<5;

        c++

      ){

        var values=[];

        for(

          var n=ranges[c][0];

          n<=ranges[c][1];

          n++

        ){

          values.push(n);

        }

        columns.push(

          seededShuffle(

            values,

            100000 +

            number * 7919 +

            attempt * 104729 +

            c * 97

          ).slice(0,5)

        );

      }

      var grid=[];

      for(

        var r=0;

        r<5;

        r++

      ){

        grid[r]=[];

        for(

          var cc=0;

          cc<5;

          cc++

        ){

          grid[r][cc] =

            columns[cc][r];

        }

      }

      grid[2][2]="FREE";

      var signature =

        grid

          .map(function(row){

            return row.join(",");

          })

          .join("|");

      if(

        !cardSignatures[signature]

      ){

        cardSignatures[signature] =

          number;

        var card = {

          number:number,

          grid:grid

        };

        cardCache[number] =

          card;

        return card;

      }

      attempt++;

    }

  }

  function prepareAllCards(){

    for(

      var i=1;

      i<=400;

      i++

    ){

      makeClientCard(i);

    }

  }

  /* =======================================================

     RENDER BINGO CARD

     ======================================================= */

  function renderBingoCard(card){

    var html =

      '<div class="bingo-card">' +

      '<div class="bingo-card-head">' +

      '<div class="card-number-label">' +

      'CARD #' +

      card.number +

      '</div>' +

      '<div class="card-state">✓</div>' +

      '</div>' +

      '<div class="bingo-grid">';

    for(

      var r=0;

      r<5;

      r++

    ){

      for(

        var c=0;

        c<5;

        c++

      ){

        var value =

          card.grid[r][c];

        var called =

          currentGame &&

          currentGame.calledBalls &&

          value !== "FREE" &&

          currentGame.calledBalls.indexOf(

            value

          ) !== -1;

        var classes =

          "bingo-cell";

        if(value === "FREE"){

          classes +=

            " free";

        }else if(called){

          classes +=

            " called";

        }

        html +=

          '<div class="' +

          classes +

          '">' +

          value +

          "</div>";

      }

    }

    html +=

      "</div></div>";

    return html;

  }

  /* =======================================================

     RENDER 400 CARD SELECT BUTTONS

     ======================================================= */

  function renderCards(){

    var grid =

      document.getElementById(

        "cardGrid"

      );

    var html="";

    for(

      var i=1;

      i<=400;

      i++

    ){

      var isSelected =

        selected.indexOf(i) !== -1;

      html +=

        '<button ' +

        'type="button" ' +

        'class="card-select' +

        (

          isSelected

            ? " selected"

            : ""

        ) +

        '" ' +

        'data-card="' +

        i +

        '">' +

        i +

        "</button>";

    }

    grid.innerHTML =

      html;

    grid

      .querySelectorAll(".card-select")

      .forEach(function(button){

        button.addEventListener(

          "click",

          function(){

            toggleCard(

              Number(

                button.dataset.card

              )

            );

          }

        );

      });

  }

  /* =======================================================

     RENDER SELECTED CARDS

     ======================================================= */

  function renderPreviews(){

    var grid =

      document.getElementById(

        "previewGrid"

      );

    if(!selected.length){

      grid.innerHTML =

        '<div style="' +

        'grid-column:1/-1;' +

        'color:#667184;' +

        'font-size:10px;' +

        'padding:8px 0">' +

        (

          language === "am"

            ? "ካርድ አልመረጡም።"

            : "No cards selected."

        ) +

        "</div>";

      return;

    }

    var html="";

    selected.forEach(

      function(number){

        html +=

          renderBingoCard(

            makeClientCard(number)

          );

      }

    );

    grid.innerHTML =

      html;

  }

  function updateSelectionCount(){

    document.getElementById(

      "selectionCount"

    ).textContent =

      selected.length +

      "/4";

  }

  /* =======================================================

     BALANCE CHECK

     ======================================================= */

  function hasEnoughBalance(){

    /*

      One card costs 10 ETB.

      The game can use the player's play balance.

      Main balance is also displayed and checked so

      the user is warned when neither balance is sufficient.

    */

    if(

      playBalance >= 10 ||

      mainBalance >= 10

    ){

      return true;

    }

    showToast(

      t("insufficient")

    );

    return false;

  }

  /* =======================================================

     CARD SELECTION

     ======================================================= */

  function toggleCard(number){

    if(

      !currentGame ||

      currentGame.status !== "lobby"

    ){

      showToast(

        t("lobbyOnly")

      );

      return;

    }

    var index =

      selected.indexOf(

        number

      );

    if(index >= 0){

      selected.splice(

        index,

        1

      );

    }else{

      if(selected.length >= 4){

        showToast(

          t("maxCards")

        );

        return;

      }

      /*

        Check balance before selecting

        a new paid card.

      */

      if(!hasEnoughBalance()){

        return;

      }

      selected.push(

        number

      );

      selected.sort(

        function(a,b){

          return a-b;

        }

      );

    }

    updateSelectionCount();

    renderCards();

    renderPreviews();

    saveCardsSilently();

  }

  /* =======================================================

     SAVE SELECTED CARDS

     ======================================================= */

  function saveCardsSilently(){

    api(

      "/api/select-cards",

      {

        method:"POST",

        body:JSON.stringify({

          cards:selected

        })

      }

    ).then(function(data){

      if(data.ok){

        if(

          Array.isArray(

            data.selected

          )

        ){

          selected =

            data.selected.map(

              Number

            );

        }

        updateSelectionCount();

        renderCards();

        renderPreviews();

        loadBalance();

      }else if(

        data.error ===

        "INSUFFICIENT_BALANCE"

      ){

        showToast(

          t("insufficient")

        );

      }

    }).catch(function(){});

  }

  function loadMyCards(){

    return api(

      "/api/user-cards"

    ).then(function(data){

      selected =

        Array.isArray(

          data.selected

        )

          ? data.selected.map(

              Number

            )

          : [];

      updateSelectionCount();

      renderCards();

      renderPreviews();

    });

  }

  /* =======================================================

     GAME UI

     ======================================================= */

  function updateLobbyDeadline(){

    if(

      !currentGame ||

      currentGame.status !== "lobby"

    ){

      lobbyDeadline =

        0;

      return;

    }

    var remaining =

      Number(

        currentGame.lobbyRemaining || 0

      );

    /*

      Convert server remaining seconds into

      a local deadline so the number does not

      remain frozen at 45s between requests.

    */

    lobbyDeadline =

      Date.now() +

      Math.max(

        0,

        remaining

      ) * 1000;

  }

  function updateCountdownOnly(){

    if(

      !currentGame

    ){

      return;

    }

    if(

      currentGame.status === "live"

    ){

      document.getElementById(

        "countdown"

      ).innerHTML =

        '<strong>' +

        Number(

          currentGame.calledCount || 0

        ) +

        '</strong> / 75';

      return;

    }

    var remaining =

      Math.max(

        0,

        Math.ceil(

          (

            lobbyDeadline -

            Date.now()

          ) / 1000

        )

      );

    document.getElementById(

      "countdown"

    ).innerHTML =

      '<strong>' +

      remaining +

      's</strong>';

    /*

      Once local countdown reaches zero,

      immediately refresh from Durable Object.

      The actual game start is controlled by

      the Durable Object alarm, not card selection.

    */

    if(

      remaining <= 0

    ){

      refreshGame();

    }

  }

  function updateGameUI(){

    if(!currentGame){

      return;

    }

    var live =

      currentGame.status === "live";

    var statusBox =

      document.getElementById(

        "statusBox"

      );

    statusBox.classList.toggle(

      "live",

      live

    );

    statusBox.classList.toggle(

      "lobby",

      !live

    );

    document.getElementById(

      "statusText"

    ).textContent =

      live

        ? t("live")

        : t("lobby");

    document.getElementById(

      "gameNumber"

    ).textContent =

      "GAME #" +

      currentGame.gameNumber;

    document.getElementById(

      "statusTitle"

    ).textContent =

      live

        ? t("liveTitle")

        : t("lobbyTitle");

    document.getElementById(

      "statusMessage"

    ).textContent =

      live

        ? t("liveMessage")

        : t("lobbyMessage");

    var jackpot =

      Number(

        currentGame.jackpot || 0

      );

    document.getElementById(

      "jackpotValue"

    ).textContent =

      jackpot.toLocaleString() +

      " ETB";

    if(!live){

      updateLobbyDeadline();

    }

    updateCountdownOnly();

    var ball =

      currentGame.currentBall;

    document.getElementById(

      "ballLetter"

    ).textContent =

      currentGame.currentLetter ||

      "B";

    document.getElementById(

      "ballNumber"

    ).textContent =

      ball || "—";

    document.getElementById(

      "calledInfo"

    ).textContent =

      Number(

        currentGame.calledCount || 0

      ) +

      " / 75";

    document.getElementById(

      "selectionPanel"

    ).style.display =

      live

        ? "none"

        : "block";

    document.getElementById(

      "selectedPreviewArea"

    ).style.display =

      "block";

    var recent =

      document.getElementById(

        "recentBalls"

      );

    var called =

      currentGame.calledBalls || [];

    var recentBalls =

      called

        .slice(-8)

        .reverse();

    var recentHtml="";

    recentBalls.forEach(

      function(number,index){

        recentHtml +=

          '<div class="mini-ball' +

          (

            index === 0

              ? " latest"

              : ""

          ) +

          '">' +

          number +

          "</div>";

      }

    );

    recent.innerHTML =

      recentHtml;

    renderPreviews();

  }

  /* =======================================================

     GAME REFRESH

     ======================================================= */

  function refreshGame(){

    return api(

      "/api/game"

    ).then(function(data){

      if(

        data &&

        data.status

      ){

        var previousGame =

          currentGame

            ? currentGame.gameNumber

            : null;

        currentGame =

          data;

        /*

          New game = clear only local selected

          cards if backend no longer has them.

          Existing backend-selected cards are

          loaded again below.

        */

        if(

          previousGame !== null &&

          previousGame !==

            data.gameNumber

        ){

          loadMyCards();

        }

        updateGameUI();

      }

      return data;

    }).catch(function(){

      return null;

    });

  }

  /* =======================================================

     BALANCE

     ======================================================= */

  function loadBalance(){

    return api(

      "/api/balance"

    ).then(function(data){

      mainBalance =

        Number(

          data.mainBalance !== undefined

            ? data.mainBalance

            : 0

        );

      playBalance =

        Number(

          data.playBalance !== undefined

            ? data.playBalance

            : (

                data.balance || 0

              )

        );

      var formatted =

        playBalance.toFixed(2) +

        " ETB";

      document.getElementById(

        "topBalance"

      ).textContent =

        formatted;

      document.getElementById(

        "mainBalance"

      ).textContent =

        mainBalance.toFixed(2);

      document.getElementById(

        "walletBalance"

      ).textContent =

        formatted;

    }).catch(function(){});

  }

  /* =======================================================

     WALLET TYPE

     ======================================================= */

  function setWalletType(type){

    walletType =

      type;

    document.getElementById(

      "depositBtn"

    ).classList.toggle(

      "active",

      type === "deposit"

    );

    document.getElementById(

      "withdrawBtn"

    ).classList.toggle(

      "active",

      type === "withdraw"

    );

    document.getElementById(

      "walletSubmit"

    ).textContent =

      type === "deposit"

        ? t("depositAction")

        : t("withdrawAction");

    document.getElementById(

      "walletScreenshotField"

    ).style.display =

      type === "deposit"

        ? "block"

        : "none";

  }

  /* =======================================================

     WALLET REQUEST

     ======================================================= */

  function walletRequest(){

    var amount =

      Number(

        document.getElementById(

          "walletAmount"

        ).value

      );

    if(

      !Number.isFinite(amount) ||

      amount < 50

    ){

      showToast(

        Number.isFinite(amount) &&

        amount > 0

          ? t("minimum")

          : t("invalidAmount")

      );

      return;

    }

    var formData =

      new FormData();

    formData.append(

      "method",

      selectedPaymentMethod

    );

    formData.append(

      "type",

      walletType

    );

    formData.append(

      "amount",

      String(amount)

    );

    if(

      walletType ===

      "deposit"

    ){

      var screenshot =

        document.getElementById(

          "walletScreenshot"

        ).files[0];

      if(!screenshot){

        showToast(

          language === "am"

            ? "የክፍያ Screenshot ያስገቡ።"

            : "Please upload your payment screenshot."

        );

        return;

      }

      if(

        screenshot.size >

        300 * 1024

      ){

        showToast(

          language === "am"

            ? "Screenshot ከ300 KB መብለጥ የለበትም።"

            : "Screenshot must be 300 KB or smaller."

        );

        return;

      }

      formData.append(

        "screenshot",

        screenshot

      );

    }

    api(

      "/api/wallet",

      {

        method:"POST",

        body:formData

      }

    ).then(function(data){

      if(data.ok){

        document.getElementById(

          "walletAmount"

        ).value = "";

        var screenshotInput =

          document.getElementById(

            "walletScreenshot"

          );

        if(screenshotInput){

          screenshotInput.value =

            "";

        }

        loadBalance();

        showToast(

          walletType ===

          "deposit"

            ? (

                language === "am"

                  ? "Deposit ተልኳል። እባክዎ የAdmin ማረጋገጫ ይጠብቁ።"

                  : "Deposit submitted. Please wait for admin confirmation."

              )

            : (

                language === "am"

                  ? "Withdrawal ጥያቄ ተልኳል።"

                  : "Withdrawal request submitted."

              )

        );

      }else if(

        data.error ===

        "MINIMUM_AMOUNT"

      ){

        showToast(

          t("minimum")

        );

      }else if(

        data.error ===

        "INSUFFICIENT_BALANCE"

      ){

        showToast(

          t("insufficient")

        );

      }else if(

        data.error ===

        "SCREENSHOT_REQUIRED"

      ){

        showToast(

          language === "am"

            ? "የክፍያ Screenshot ያስገቡ።"

            : "Payment screenshot is required."

        );

      }else{

        showToast(

          "Error"

        );

      }

    }).catch(function(){

      showToast(

        "Connection error"

      );

    });

  }

  /* =======================================================

     LANGUAGE

     ======================================================= */

  function setLanguage(next){

    language =

      next;

    document.documentElement.lang =

      language;

    var x =

      translations[language];

    document.getElementById(

      "brandSub"

    ).textContent =

      x.brandSub;

    document.getElementById(

      "mainBalanceLabel"

    ).textContent =

      x.mainBalance;

    document.getElementById(

      "navHome"

    ).textContent =

      x.home;

    document.getElementById(

      "navRank"

    ).textContent =

      x.rank;

    document.getElementById(

      "navProfile"

    ).textContent =

      x.profile;

    document.getElementById(

      "navWallet"

    ).textContent =

      x.wallet;

    document.getElementById(

      "statusText"

    ).textContent =

      currentGame &&

      currentGame.status === "live"

        ? x.live

        : x.lobby;

    document.getElementById(

      "statusTitle"

    ).textContent =

      currentGame &&

      currentGame.status === "live"

        ? x.liveTitle

        : x.lobbyTitle;

    document.getElementById(

      "statusMessage"

    ).textContent =

      currentGame &&

      currentGame.status === "live"

        ? x.liveMessage

        : x.lobbyMessage;

    document.querySelector(

      ".jackpot-label"

    ).textContent =

      x.jackpot;

    document.querySelector(

      ".selection-title"

    ).innerHTML =

      x.select +

      ' <span>( ' +

      x.price +

      ' )</span>';

    document.querySelector(

      ".selected-previews-title"

    ).textContent =

      x.selected;

    document.getElementById(

      "rulesTitle"

    ).textContent =

      x.rules;

    document.getElementById(

      "rulesText"

    ).textContent =

      x.rulesText;

    document.getElementById(

      "rankTitle"

    ).textContent =

      x.rank;

    document.getElementById(

      "rankText"

    ).textContent =

      x.rankText;

    document.getElementById(

      "profileTitle"

    ).textContent =

      x.profile;

    document.getElementById(

      "profileText"

    ).textContent =

      x.profileText;

    document.getElementById(

      "walletTitle"

    ).textContent =

      x.wallet;

    document.getElementById(

      "amountLabel"

    ).textContent =

      x.amount;

    document.getElementById(

      "depositBtn"

    ).textContent =

      x.deposit;

    document.getElementById(

      "withdrawBtn"

    ).textContent =

      x.withdraw;

    document.getElementById(

      "walletSubmit"

    ).textContent =

      walletType === "deposit"

        ? x.depositAction

        : x.withdrawAction;

    document.getElementById(

      "languageTitle"

    ).textContent =

      x.language;

    document.getElementById(

      "languageSub"

    ).textContent =

      x.languageSub;

    document.getElementById(

      "miniAm"

    ).classList.toggle(

      "active",

      language === "am"

    );

    document.getElementById(

      "miniEn"

    ).classList.toggle(

      "active",

      language === "en"

    );

    document.getElementById(

      "amBtn"

    ).classList.toggle(

      "active",

      language === "am"

    );

    document.getElementById(

      "enBtn"

    ).classList.toggle(

      "active",

      language === "en"

    );

    renderPreviews();

    updateGameUI();

  }

  /* =======================================================

     EVENTS

     ======================================================= */

  document.getElementById(

    "depositBtn"

  ).addEventListener(

    "click",

    function(){

      setWalletType(

        "deposit"

      );

    }

  );

  document.getElementById(

    "withdrawBtn"

  ).addEventListener(

    "click",

    function(){

      setWalletType(

        "withdraw"

      );

    }

  );

  document.getElementById(

    "walletSubmit"

  ).addEventListener(

    "click",

    walletRequest

  );

  document.getElementById(

    "amBtn"

  ).addEventListener(

    "click",

    function(){

      setLanguage("am");

      setWalletType(

        "deposit"

      );

    }

  );

  document.getElementById(

    "enBtn"

  ).addEventListener(

    "click",

    function(){

      setLanguage("en");

    }

  );

  document.getElementById(

    "miniAm"

  ).addEventListener(

    "click",

    function(){

      setLanguage("am");

    }

  );

  document.getElementById(

    "miniEn"

  ).addEventListener(

    "click",

    function(){

      setLanguage("en");

    }

  );

  document.getElementById(

    "playerName"

  ).textContent =

    telegramUser.first_name ||

    telegramUser.username ||

    "Guest";

  /* =======================================================

     LOCAL COUNTDOWN LOOP

     ======================================================= */

  setInterval(

    function(){

      if(

        currentGame &&

        currentGame.status === "lobby"

      ){

        updateCountdownOnly();

      }

    },

    250

  );

  /* =======================================================

     BOOT

     ======================================================= */

  function boot(){

  setLanguage("am");

  prepareAllCards();

  renderCards();

  renderPreviews();

  setWalletType("deposit");

  checkLoginStatus()

    .then(function(authenticated){

      if(!authenticated){

        return;

      }

      return Promise.all([

        loadBalance(),

        loadMyCards(),

        refreshGame()

      ]);

    })

    .then(function(){

      if(!loginReady){

        return;

      }

      setInterval(

        refreshGame,

        1000

      );

      setInterval(

        loadBalance,

        10000

      );

    });

}

  boot();

})();

</script>

</body>

</html>`;

}

/* =========================================================

   PROXY TO GAME SCHEDULER

   ========================================================= */

async function proxyToGame(

  request,

  env,

  path

) {

  const id =

    env.GAME_SCHEDULER.idFromName(

      "main-game"

    );

  const stub =

    env.GAME_SCHEDULER.get(id);

  const url =

    new URL(request.url);

  url.pathname =

    path.replace(

      /^\/api/,

      "/do"

    );

  const headers =

    new Headers(

      request.headers

    );

  /*

    Preserve Telegram user identity.

    This is required so the Durable Object

    does not treat every Mini App request

    as Guest.

  */

  const telegramUser =

    request.headers.get(

      "x-telegram-user"

    );

  if(telegramUser){

    headers.set(

      "x-telegram-user",

      telegramUser

    );

  }

  const proxied =

    new Request(

      url.toString(),

      {

        method:

          request.method,

        headers:

          headers,

        body:

          request.method === "GET" ||

          request.method === "HEAD"

            ? undefined

            : request.body

      }

    );

  return stub.fetch(

    proxied

  );

}

/* =========================================================

   ADMIN DASHBOARD

   ========================================================= */

function adminHtml(){

  return String.raw`<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta name="viewport"

      content="width=device-width,initial-scale=1.0">

<meta name="theme-color"

      content="#07090d">

<title>Fast Bingo Admin</title>

<style>

:root{

  --bg:#07090d;

  --surface:#10141c;

  --surface2:#151b25;

  --line:#293243;

  --text:#fff;

  --muted:#8993a4;

  --red:#e50914;

  --green:#26d07c;

  --gold:#ffc857;

}

*{

  box-sizing:border-box;

}

body{

  margin:0;

  background:var(--bg);

  color:var(--text);

  font-family:-apple-system,BlinkMacSystemFont,

  "Segoe UI",Roboto,Arial,sans-serif;

}

.app{

  max-width:900px;

  margin:auto;

  padding:18px 14px 50px;

}

.header{

  display:flex;

  justify-content:space-between;

  align-items:center;

  gap:12px;

  margin-bottom:15px;

}

.title{

  font-size:22px;

  font-weight:950;

}

.subtitle{

  color:var(--muted);

  font-size:10px;

  margin-top:3px;

}

.panel{

  background:var(--surface);

  border:1px solid var(--line);

  border-radius:15px;

  padding:14px;

  margin-bottom:12px;

}

.panel-title{

  font-size:14px;

  font-weight:900;

  margin-bottom:10px;

}

input{

  width:100%;

  padding:12px;

  border-radius:10px;

  border:1px solid var(--line);

  background:#0c1118;

  color:#fff;

  outline:none;

}

button{

  border:0;

  border-radius:10px;

  padding:10px 13px;

  font-weight:900;

  cursor:pointer;

}

button:disabled{

  opacity:.6;

  cursor:not-allowed;

}

.primary{

  background:var(--red);

  color:#fff;

}

.green{

  background:var(--green);

  color:#06130c;

}

.dark{

  background:var(--surface2);

  border:1px solid var(--line);

  color:#fff;

}

.danger{

  background:#4a1116;

  color:#fff;

  border:1px solid #7b2028;

}

.login-row{

  display:grid;

  grid-template-columns:1fr auto;

  gap:8px;

}

.grid{

  display:grid;

  grid-template-columns:repeat(4,1fr);

  gap:8px;

}

.stat{

  background:#0d1118;

  border:1px solid var(--line);

  border-radius:11px;

  padding:12px;

}

.stat-label{

  color:var(--muted);

  font-size:9px;

}

.stat-value{

  font-size:18px;

  font-weight:950;

  margin-top:4px;

}

.request{

  background:#0d1118;

  border:1px solid var(--line);

  border-radius:12px;

  padding:12px;

  margin-top:8px;

}

.request-top{

  display:flex;

  justify-content:space-between;

  gap:8px;

}

.badge{

  display:inline-block;

  padding:4px 7px;

  border-radius:7px;

  background:#242c38;

  color:#fff;

  font-size:9px;

  font-weight:900;

}

.deposit{

  color:var(--green);

}

.withdraw{

  color:var(--gold);

}

.request-info{

  color:#c5ccd7;

  font-size:10px;

  line-height:17px;

  margin-top:7px;

}

.request-actions{

  display:flex;

  gap:7px;

  margin-top:9px;

}

.request-actions button{

  flex:1;

}

.screenshot{

  display:block;

  width:100%;

  max-height:360px;

  object-fit:contain;

  background:#05070a;

  border-radius:10px;

  margin-top:10px;

}

.hidden{

  display:none;

}

.toolbar{

  display:flex;

  gap:7px;

  flex-wrap:wrap;

}

.status{

  color:var(--muted);

  font-size:10px;

  margin-top:8px;

}

.error{

  color:#ff7b84;

}

.success{

  color:var(--green);

}

@media(max-width:600px){

  .grid{

    grid-template-columns:1fr 1fr;

  }

  .login-row{

    grid-template-columns:1fr;

  }

}

</style>

</head>

<body>

<div class="app">

  <div class="header">

    <div>

      <div class="title">

        Fast Bingo Admin

      </div>

      <div class="subtitle">

        Private administration dashboard

      </div>

    </div>

    <button

      class="dark"

      type="button"

      onclick="logout()">

      Logout

    </button>

  </div>

  <!-- =====================================================

       LOGIN

       ===================================================== -->

  <div

    class="panel"

    id="loginPanel">

    <div class="panel-title">

      Admin Login

    </div>

    <div class="login-row">

      <input

        id="adminKey"

        type="password"

        placeholder="ADMIN_KEY"

        autocomplete="current-password">

      <button

        class="primary"

        type="button"

        id="loginButton"

        onclick="login()">

        Login

      </button>

    </div>

    <div

      class="status"

      id="loginStatus">

    </div>

  </div>

  <!-- =====================================================

       DASHBOARD

       ===================================================== -->

  <div

    id="dashboard"

    class="hidden">

    <!-- ===================================================

         OVERVIEW

         =================================================== -->

    <div class="panel">

      <div class="panel-title">

        Overview

      </div>

      <div

        class="grid"

        id="stats">

      </div>

    </div>

    <!-- ===================================================

         GAME CONTROL

         =================================================== -->

    <div class="panel">

      <div class="panel-title">

        Game Control

      </div>

      <div class="toolbar">

        <button

          class="green"

          type="button"

          onclick="gameControl('resume')">

          Resume

        </button>

        <button

          class="dark"

          type="button"

          onclick="gameControl('pause')">

          Pause

        </button>

        <button

          class="danger"

          type="button"

          onclick="gameControl('reset')">

          Reset

        </button>

      </div>

      <div

        class="status"

        id="gameStatus">

      </div>

    </div>

    <!-- ===================================================

         PENDING REQUESTS

         =================================================== -->

    <div class="panel">

      <div class="panel-title">

        Pending Requests

      </div>

      <div id="requests">

      </div>

    </div>

    <!-- ===================================================

         USERS

         =================================================== -->

    <div class="panel">

      <div class="panel-title">

        Users

      </div>

      <div id="users">

      </div>

    </div>

  </div>

</div>

<script>

/* =========================================================

   ADMIN KEY

   ========================================================= */

var adminKey =

  localStorage.getItem(

    "fastBingoAdminKey"

  ) || "";

/* =========================================================

   API HELPER

   ========================================================= */

function api(path, options){

  options =

    options || {};

  var headers =

    options.headers || {};

  headers["x-admin-key"] =

    adminKey;

  options.headers =

    headers;

  return fetch(

    path,

    options

  )

  .then(function(response){

    return response.text();

  })

  .then(function(text){

    try{

      return JSON.parse(text);

    }catch(error){

      return {

        ok:false,

        error:

          "SERVER_RESPONSE: " +

          text

      };

    }

  });

}

/* =========================================================

   LOGIN

   ========================================================= */

function login(){

  var input =

    document.getElementById(

      "adminKey"

    );

  var status =

    document.getElementById(

      "loginStatus"

    );

  var button =

    document.getElementById(

      "loginButton"

    );

  var key =

    input.value.trim();

  if(!key){

    status.className =

      "status error";

    status.textContent =

      "Enter ADMIN_KEY.";

    return;

  }

  adminKey =

    key;

  button.disabled =

    true;

  status.className =

    "status";

  status.textContent =

    "Checking ADMIN_KEY...";

  api(

    "/do/admin/summary"

  )

  .then(function(data){

    if(data && data.ok){

      localStorage.setItem(

        "fastBingoAdminKey",

        adminKey

      );

      status.className =

        "status success";

      status.textContent =

        "Login successful.";

      showDashboard();

      return;

    }

    adminKey = "";

    button.disabled =

      false;

    status.className =

      "status error";

    status.textContent =

      "Login failed: " +

      (

        data &&

        data.error

          ? data.error

          : "Invalid ADMIN_KEY."

      );

  })

  .catch(function(){

    adminKey = "";

    button.disabled =

      false;

    status.className =

      "status error";

    status.textContent =

      "Connection error.";

  });

}

/* =========================================================

   SHOW DASHBOARD

   ========================================================= */

function showDashboard(){

  document.getElementById(

    "loginPanel"

  ).classList.add(

    "hidden"

  );

  document.getElementById(

    "dashboard"

  ).classList.remove(

    "hidden"

  );

  loadAll();

}

/* =========================================================

   LOGOUT

   ========================================================= */

function logout(){

  adminKey =

    "";

  localStorage.removeItem(

    "fastBingoAdminKey"

  );

  location.reload();

}

/* =========================================================

   LOAD ALL

   ========================================================= */

function loadAll(){

  loadSummary();

  loadRequests();

  loadUsers();

}

/* =========================================================

   SUMMARY

   ========================================================= */

function loadSummary(){

  api(

    "/do/admin/summary"

  )

  .then(function(data){

    if(!data || !data.ok){

      logout();

      return;

    }

    var game =

      data.game || {};

    var html =

      "";

    html += stat(

      "Users",

      data.users || 0

    );

    html += stat(

      "Pending Deposits",

      data.pendingDeposits || 0

    );

    html += stat(

      "Pending Withdrawals",

      data.pendingWithdrawals || 0

    );

    html += stat(

      "Game",

      game.gameNumber

        ? "#" + game.gameNumber

        : "-"

    );

    document.getElementById(

      "stats"

    ).innerHTML =

      html;

    document.getElementById(

      "gameStatus"

    ).textContent =

      "Status: " +

      (

        game.status ||

        "-"

      );

  })

  .catch(function(){

    document.getElementById(

      "gameStatus"

    ).textContent =

      "Status: Connection error.";

  });

}

/* =========================================================

   STAT CARD

   ========================================================= */

function stat(

  label,

  value

){

  return (

    '<div class="stat">' +

      '<div class="stat-label">' +

        escapeHtml(label) +

      '</div>' +

      '<div class="stat-value">' +

        escapeHtml(value) +

      '</div>' +

    '</div>'

  );

}

/* =========================================================

   PENDING REQUESTS

   ========================================================= */

function loadRequests(){

  api(

    "/do/admin/requests"

  )

  .then(function(data){

    if(!data || !data.ok){

      return;

    }

    var list =

      data.requests ||

      [];

    var pending =

      list.filter(

        function(item){

          return (

            item.status ===

            "pending"

          );

        }

      );

    if(!pending.length){

      document.getElementById(

        "requests"

      ).innerHTML =

        '<div class="status">' +

        'No pending requests.' +

        '</div>';

      return;

    }

    var html =

      "";

    pending.forEach(

      function(item){

        var typeLabel =

          item.type === "deposit"

            ? "DEPOSIT"

            : "WITHDRAWAL";

        var userId =

          item.userId ||

          "-";

        html +=

          '<div class="request">' +

            '<div class="request-top">' +

              '<span class="badge">' +

                typeLabel +

              '</span>' +

              '<strong>' +

                Number(

                  item.amount || 0

                ).toFixed(2) +

                ' ETB' +

              '</strong>' +

            '</div>' +

            '<div class="request-info">' +

              'User: ' +

              escapeHtml(

                userId

              ) +

              '<br>' +

              'Name: ' +

              escapeHtml(

                item.firstName ||

                item.username ||

                "-"

              ) +

              '<br>' +

              'Method: ' +

              escapeHtml(

                item.method ||

                "-"

              ) +

              '<br>' +

              'Status: ' +

              escapeHtml(

                item.status ||

                "-"

              ) +

            '</div>';

        if(

          item.type === "deposit" &&

          item.screenshot

        ){

          html +=

            '<img class="screenshot" ' +

            'src="' +

            escapeHtml(

              item.screenshot

            ) +

            '" ' +

            'alt="Payment screenshot">';

        }

        html +=

          '<div class="request-actions">' +

            '<button ' +

              'class="green" ' +

              'type="button" ' +

              'onclick="requestAction(' +

                Number(item.id) +

                ',&quot;confirm&quot;)' +

            '>' +

              'Confirm' +

            '</button>' +

            '<button ' +

              'class="danger" ' +

              'type="button" ' +

              'onclick="requestAction(' +

                Number(item.id) +

                ',&quot;reject&quot;)' +

            '>' +

              'Reject' +

            '</button>' +

          '</div>' +

        '</div>';

      }

    );

    document.getElementById(

      "requests"

    ).innerHTML =

      html;

  })

  .catch(function(){

    document.getElementById(

      "requests"

    ).innerHTML =

      '<div class="status error">' +

      'Failed to load requests.' +

      '</div>';

  });

}

/* =========================================================

   REQUEST ACTION

   ========================================================= */

function requestAction(

  id,

  action

){

  if(

    !confirm(

      "Are you sure?"

    )

  ){

    return;

  }

  api(

    "/do/admin/request-action",

    {

      method:"POST",

      headers:{

        "content-type":

          "application/json"

      },

      body:

        JSON.stringify({

          requestId:id,

          action:action

        })

    }

  )

  .then(function(data){

    if(data && data.ok){

      loadAll();

    }else{

      alert(

        data &&

        data.error

          ? data.error

          : "Action failed."

      );

    }

  })

  .catch(function(){

    alert(

      "Connection error."

    );

  });

}

/* =========================================================

   USERS

   ========================================================= */

function loadUsers(){

  api(

    "/do/admin/users"

  )

  .then(function(data){

    if(!data || !data.ok){

      return;

    }

    var list =

      data.users ||

      [];

    if(!list.length){

      document.getElementById(

        "users"

      ).innerHTML =

        '<div class="status">' +

        'No users.' +

        '</div>';

      return;

    }

    var html =

      "";

    list.forEach(

      function(user){

        var displayName =

          user.firstName ||

          user.username ||

          user.userId ||

          "-";

        html +=

          '<div class="request">' +

            '<div class="request-info">' +

              '<strong>' +

                escapeHtml(

                  displayName

                ) +

              '</strong>' +

              '<br>' +

              'User ID: ' +

              escapeHtml(

                user.userId ||

                "-"

              ) +

              '<br>' +

              'Username: ' +

              escapeHtml(

                user.username

                  ? "@" +

                    user.username

                  : "-"

              ) +

              '<br>' +

              'Main Balance: ' +

              Number(

                user.mainBalance || 0

              ).toFixed(2) +

              ' ETB' +

              '<br>' +

              'Play Balance: ' +

              Number(

                user.playBalance || 0

              ).toFixed(2) +

              ' ETB' +

            '</div>' +

          '</div>';

      }

    );

    document.getElementById(

      "users"

    ).innerHTML =

      html;

  })

  .catch(function(){

    document.getElementById(

      "users"

    ).innerHTML =

      '<div class="status error">' +

      'Failed to load users.' +

      '</div>';

  });

}

/* =========================================================

   GAME CONTROL

   ========================================================= */

function gameControl(

  action

){

  if(

    !confirm(

      "Run game action: " +

      action +

      "?"

    )

  ){

    return;

  }

  api(

    "/do/admin/control",

    {

      method:"POST",

      headers:{

        "content-type":

          "application/json"

      },

      body:

        JSON.stringify({

          action:action

        })

    }

  )

  .then(function(data){

    if(data && data.ok){

      loadAll();

    }else{

      alert(

        data &&

        data.error

          ? data.error

          : "Game control failed."

      );

    }

  })

  .catch(function(){

    alert(

      "Connection error."

    );

  });

}

/* =========================================================

   HTML ESCAPE

   ========================================================= */

function escapeHtml(

  value

){

  return String(

    value == null

      ? ""

      : value

  )

  .replace(

    /&/g,

    "&amp;"

  )

  .replace(

    /</g,

    "&lt;"

  )

  .replace(

    />/g,

    "&gt;"

  )

  .replace(

    /"/g,

    "&quot;"

  )

  .replace(

    /'/g,

    "&#039;"

  );

}

/* =========================================================

   ENTER KEY LOGIN

   ========================================================= */

document

  .getElementById(

    "adminKey"

  )

  .addEventListener(

    "keydown",

    function(event){

      if(

        event.key ===

        "Enter"

      ){

        login();

      }

    }

  );

/* =========================================================

   RESTORE SAVED LOGIN

   ========================================================= */

if(adminKey){

  api(

    "/do/admin/summary"

  )

  .then(function(data){

    if(

      data &&

      data.ok

    ){

      showDashboard();

    }else{

      adminKey = "";

      localStorage.removeItem(

        "fastBingoAdminKey"

      );

    }

  })

  .catch(function(){

    adminKey = "";

    localStorage.removeItem(

      "fastBingoAdminKey"

    );

  });

}

</script>

</body>

</html>`;

}

/* =========================================================

   MAIN WORKER

   ========================================================= */

export default {

  async fetch(

    request,

    env

  ){

    const url =

      new URL(request.url);

    /* =====================================================

       ADMIN DASHBOARD

       ===================================================== */

    if(

      url.pathname ===

      "/admin"

    ){

      return html(

        adminHtml()

      );

    }

    /* =====================================================

       HEALTH

       ===================================================== */

    if(

      url.pathname ===

      "/health"

    ){

      return json({

        ok:true,

        app:APP_NAME,

        time:

          new Date().toISOString()

      });

    }

    /* =====================================================

       PLAYER API

       ===================================================== */

    const apiRoutes = [

      "/api/game",

      "/api/cards",

      "/api/user-cards",

      "/api/select-cards",

      "/api/balance",

      "/api/wallet",

      "/api/claim",

      "/api/auth/status",

      "/api/auth/register",

      "/api/auth/request",

      "/api/auth/verify"
       
    ];

    if(

      apiRoutes.includes(

        url.pathname

      )

    ){

      return proxyToGame(

        request,

        env,

        url.pathname

      );

    }

    /* =====================================================

       PLAYER DIRECT DO ROUTES

       ===================================================== */

    const doRoutes = [

      "/do/game",

      "/do/cards",

      "/do/user-cards",

      "/do/select-cards",

      "/do/balance",

      "/do/wallet",

      "/do/claim"

    ];

    if(

      doRoutes.includes(

        url.pathname

      )

    ){

      const id =

        env.GAME_SCHEDULER.idFromName(

          "main-game"

        );

      const stub =

        env.GAME_SCHEDULER.get(

          id

        );

      return stub.fetch(

        request

      );

    }

    /* =====================================================

       ADMIN API

       ===================================================== */

    const adminRoutes = [

      "/do/admin/summary",

      "/do/admin/users",

      "/do/admin/requests",

      "/do/admin/request-action",

      "/do/admin/set-balance",

      "/do/admin/control"

    ];

    if(

      adminRoutes.includes(

        url.pathname

      )

    ){

      const id =

        env.GAME_SCHEDULER.idFromName(

          "main-game"

        );

      const stub =

        env.GAME_SCHEDULER.get(

          id

        );

      return stub.fetch(

        request

      );

    }

    /* =====================================================

       FAVICON

       ===================================================== */

    if(

      url.pathname ===

      "/favicon.ico"

    ){

      return new Response(

        null,

        {

          status:204

        }

      );

    }

    /* =====================================================

       MINI APP

       ===================================================== */

    return html(

      pageHtml()

    );

  }

};

export {

  GameScheduler

};

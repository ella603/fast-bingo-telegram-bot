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

class GameScheduler extends DurableObject {

  constructor(ctx, env) {

    super(ctx, env);

    this.ctx = ctx;

    this.env = env;

    ctx.blockConcurrencyWhile(async () => {

      await this.init();

    });

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

    sql.exec(`

      CREATE TABLE IF NOT EXISTS balances (

        user_id TEXT PRIMARY KEY,

        balance REAL NOT NULL

      )

    `);

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

    let existing = sql.exec(

      "SELECT * FROM state WHERE id = 1"

    ).toArray();

    if (!existing.length) {

      const now = Date.now();

      const ends = now + LOBBY_SECONDS * 1000;

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

      await this.scheduleNext(LOBBY_SECONDS * 1000);

      return;

    }

    let state = existing[0];

    if (state.status !== "lobby" && state.status !== "live") {

      const nextGame = Number(state.game_number || 0) + 1;

      const now = Date.now();

      const ends = now + LOBBY_SECONDS * 1000;

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

        JSON.stringify(makeBallOrder(nextGame))

      );

      state = this.getState();

    }

    if (state && !isValidBallOrder(state.ball_order)) {

      const gameNumber = Number(state.game_number || 1);

      sql.exec(

        `

        UPDATE state

        SET ball_order = ?

        WHERE id = 1

        `,

        JSON.stringify(makeBallOrder(gameNumber))

      );

      state = this.getState();

    }

    const existingAlarm = await this.ctx.storage.getAlarm();

    if (existingAlarm !== null) {

      return;

    }

    if (!state) {

      await this.createFreshLobby();

      return;

    }

    if (state.status === "lobby") {

      const ends = Number(state.lobby_ends_at || 0);

      const remaining =

        ends > Date.now()

          ? ends - Date.now()

          : 1000;

      await this.scheduleNext(remaining);

      return;

    }

    if (state.status === "live") {

      let index = Number(state.ball_index);

      if (

        !Number.isInteger(index) ||

        index < 0

      ) {

        sql.exec(

          `

          UPDATE state

          SET

            ball_index = 0,

            started_at = COALESCE(started_at, ?),

            lobby_ends_at = NULL

          WHERE id = 1

          `,

          Date.now()

        );

        index = 0;

      }

      if (index >= TOTAL_BALLS) {

        await this.startNextGame();

        return;

      }

      await this.scheduleNext(BALL_INTERVAL);

    }

  }

  getState() {

    const rows = this.ctx.storage.sql

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

      order = JSON.parse(state.ball_order);

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

  async ensureScheduler() {

    const state = this.getState();

    if (!state) {

      await this.createFreshLobby(1);

      return;

    }

    const alarm = await this.ctx.storage.getAlarm();

    if (alarm !== null) {

      return;

    }

    if (state.status === "lobby") {

      const ends = Number(

        state.lobby_ends_at || 0

      );

      const remaining =

        ends > Date.now()

          ? ends - Date.now()

          : 1000;

      await this.scheduleNext(remaining);

      return;

    }

    if (state.status === "live") {

      const index = Number(state.ball_index);

      if (

        !Number.isInteger(index) ||

        index < 0

      ) {

        this.ctx.storage.sql.exec(

          `

          UPDATE state

          SET

            ball_index = 0,

            started_at = COALESCE(started_at, ?),

            lobby_ends_at = NULL

          WHERE id = 1

          `,

          Date.now()

        );

        await this.scheduleNext(BALL_INTERVAL);

        return;

      }

      if (index >= TOTAL_BALLS - 1) {

        await this.startNextGame();

        return;

      }

      await this.scheduleNext(BALL_INTERVAL);

      return;

    }

    await this.createFreshLobby(

      Number(state.game_number || 0) + 1

    );

  }

  async createFreshLobby(gameNumber = 1) {

    const now = Date.now();

    const lobbyEnds =

      now + LOBBY_SECONDS * 1000;

    const order = makeBallOrder(gameNumber);

    const state = this.getState();

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

      await this.ensureScheduler();

    } catch (recoveryError) {

      console.error(

        "Fast Bingo scheduler recovery failed:",

        recoveryError

      );

      try {

        await this.ctx.storage.setAlarm(

          Date.now() + 5000

        );

      } catch (_) {}

    }

  }

  async alarm(alarmInfo) {

    try {

      const state = this.getState();

      if (!state) {

        await this.createFreshLobby(1);

        return;

      }

      const now = Date.now();

      if (state.status === "lobby") {

        const ends = Number(

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

          order = JSON.parse(

            state.ball_order

          );

        } else {

          order = makeBallOrder(

            Number(state.game_number || 1)

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

      if (state.status === "live") {

        let currentIndex = Number(

          state.ball_index

        );

        if (

          !Number.isInteger(currentIndex) ||

          currentIndex < 0

        ) {

          this.ctx.storage.sql.exec(

            `

            UPDATE state

            SET

              ball_index = 0,

              started_at = COALESCE(started_at, ?),

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

        if (

          currentIndex >=

          TOTAL_BALLS - 1

        ) {

          await this.startNextGame();

          return;

        }

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

      await this.createFreshLobby(

        Number(state.game_number || 0) + 1

      );

    } catch (error) {

      console.error(

        "Fast Bingo alarm error:",

        error,

        "retry:",

        alarmInfo?.retryCount || 0

      );

      await this.recoverScheduler();

    }

  }

  async startNextGame() {

    const current = this.getState();

    const nextGame =

      Number(

        current?.game_number || 0

      ) + 1;

    const now = Date.now();

    const lobbyEnds =

      now + LOBBY_SECONDS * 1000;

    const order =

      makeBallOrder(nextGame);

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

    const state = this.getState();

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

    const state = this.getState();

    if (!state) {

      return {

        ok: false,

        error: "NO_GAME"

      };

    }

    if (state.status !== "lobby") {

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

        INSERT OR IGNORE INTO selected_cards

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

  getBalance(userId) {

    let row =

      this.ctx.storage.sql

        .exec(

          `

          SELECT balance

          FROM balances

          WHERE user_id = ?

          `,

          userId

        )

        .toArray()[0];

    if (!row) {

      this.ctx.storage.sql.exec(

        `

        INSERT INTO balances

        (user_id, balance)

        VALUES (?, ?)

        `,

        userId,

        PLAY_BALANCE_START

      );

      return PLAY_BALANCE_START;

    }

    return Number(

      row.balance || 0

    );

  }

  async walletRequest(

    userId,

    body

  ) {

    const amount =

      Number(

        body?.amount || 0

      );

    const type =

      body?.type === "withdraw"

        ? "withdraw"

        : "deposit";

    const method =

      String(

        body?.method || "Demo"

      );

    if (

      !Number.isFinite(amount) ||

      amount <= 0

    ) {

      return {

        ok: false,

        error: "INVALID_AMOUNT"

      };

    }

    const current =

      this.getBalance(userId);

    if (

      type === "withdraw" &&

      amount > current

    ) {

      return {

        ok: false,

        error: "INSUFFICIENT_BALANCE"

      };

    }

    const next =

      type === "deposit"

        ? current + amount

        : current - amount;

    this.ctx.storage.sql.exec(

      `

      UPDATE balances

      SET balance = ?

      WHERE user_id = ?

      `,

      next,

      userId

    );

    this.ctx.storage.sql.exec(

      `

      INSERT INTO transactions

      (

        user_id,

        type,

        method,

        amount,

        simulated,

        created_at

      )

      VALUES (?, ?, ?, ?, 1, ?)

      `,

      userId,

      type,

      method,

      amount,

      Date.now()

    );

    return {

      ok: true,

      simulated: true,

      balance: next

    };

  }

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

  async fetch(request) {

    const url =

      new URL(request.url);

    const user =

      getTelegramUser(request);

    /*

     * WATCHDOG:

     * Every API request verifies that the

     * Durable Object has a live alarm.

     * If the alarm disappeared, recreate it.

     */

    try {

      await this.ensureScheduler();

    } catch (schedulerError) {

      console.error(

        "Fast Bingo scheduler watchdog error:",

        schedulerError

      );

    }

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

        cards: Array.from(

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

      url.pathname ===

        "/do/select-cards" &&

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

    if (

      url.pathname ===

      "/do/balance"

    ) {

      return json({

        ok: true,

        balance:

          this.getBalance(

            user.id

          )

      });

    }

    if (

      url.pathname === "/do/wallet" &&

      request.method === "POST"

    ) {

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

    if (

      url.pathname === "/do/claim"

    ) {

      return json(

        await this.claim(

          user.id

        )

      );

    }

    return json(

      {

        ok: false,

        error: "NOT_FOUND"

      },

      404

    );

  }

}

export { GameScheduler };


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

        error,

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

    if (

      url.pathname ===

      "/do/game"

    ) {

      return json(

        this.getGameResponse()

      );

    }

    if (

      url.pathname ===

      "/do/cards"

    ) {

      return json({

        ok: true,

        count: CARD_COUNT,

        cards: Array.from(

          { length: CARD_COUNT },

          (_, i) => ({

            number: i + 1,

            available: true

          })

        )

      });

    }

    if (

      url.pathname ===

      "/do/user-cards"

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

          this.getBalance(user.id)

      });

    }

    if (

      url.pathname ===

        "/do/wallet" &&

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

      url.pathname ===

      "/do/claim"

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

  margin-top:10px;

  color:#9ca6b5;

  background:#0c1118;

  border:1px solid #252d39;

  border-radius:10px;

  padding:10px;

  font-size:9px;

  line-height:14px;

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

    <div

      class="panel-sub"

      id="walletSub"

    >

      ይህ የሙከራ ሂሳብ ብቻ ነው።

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

      <label id="methodLabel">

        ዘዴ

      </label>

      <select id="walletMethod">

        <option value="Demo">

          Demo

        </option>

        <option value="Telebirr">

          Telebirr (Demo)

        </option>

        <option value="eBirr">

          eBirr (Demo)

        </option>

        <option value="M-PESA">

          M-PESA (Demo)

        </option>

      </select>

    </div>

    <div class="field">

      <label id="amountLabel">

        መጠን

      </label>

      <input

        id="walletAmount"

        type="number"

        min="1"

        max="100000"

        placeholder="100"

      >

    </div>

    <button

      class="primary-btn"

      id="walletSubmit"

      style="margin-top:10px"

    >

      ገቢ አድርግ

    </button>

    <div

      class="note"

      id="walletNote"

    >

      ⚠️ ይህ የሙከራ ሂሳብ ብቻ ነው።

      ትክክለኛ ገንዘብ አይላክም ወይም አይቀበልም።

    </div>

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

      <span id="navHome">መነሻ</span>

    </button>

    <button

      class="bottom-btn"

      data-section="rank"

    >

      <div class="nav-icon">♛</div>

      <span id="navRank">ደረጃ</span>

    </button>

    <button

      class="bottom-btn"

      data-section="profile"

    >

      <div class="nav-icon">◉</div>

      <span id="navProfile">ፕሮፋይል</span>

    </button>

    <button

      class="bottom-btn"

      data-section="wallet"

    >

      <div class="nav-icon">▣</div>

      <span id="navWallet">ቦርሳ</span>

    </button>

  </div>

</div>

<div

  class="toast"

  id="toast"

></div>

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

  var telegramUser =

    tg &&

    tg.initDataUnsafe &&

    tg.initDataUnsafe.user

      ? tg.initDataUnsafe.user

      : {

          id:"guest",

          first_name:"Guest",

          username:""

        };

  var userHeader =

    JSON.stringify(telegramUser);

  var selected = [];

  var currentGame = null;

  var walletType = "deposit";

  var language = "am";

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

      walletSub:"ይህ የሙከራ ሂሳብ ብቻ ነው።",

      method:"ዘዴ",

      amount:"መጠን",

      deposit:"+ ገቢ",

      withdraw:"− ወጪ",

      depositAction:"ገቢ አድርግ",

      withdrawAction:"ወጪ አድርግ",

      language:"ቋንቋ",

      languageSub:"የመተግበሪያውን ቋንቋ ይምረጡ።",

      walletNote:"⚠️ ይህ የሙከራ ሂሳብ ብቻ ነው። ትክክለኛ ገንዘብ አይላክም ወይም አይቀበልም።",

      saved:"ካርዶችዎ ተቀምጠዋል።",

      lobbyOnly:"ካርድ መምረጥ የሚቻለው Lobby ጊዜ ብቻ ነው።",

      maxCards:"እስከ 4 ካርዶች ብቻ መምረጥ ይችላሉ።",

      gameProgress:"ጨዋታው ጀምሯል። ቀጣዩን ዙር ይጠብቁ።",

      invalidAmount:"ትክክለኛ መጠን ያስገቡ።",

      insufficient:"በቂ ሂሳብ የለዎትም።",

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

      walletSub:"This is a simulated play-money balance only.",

      method:"Method",

      amount:"Amount",

      deposit:"+ DEPOSIT",

      withdraw:"− WITHDRAW",

      depositAction:"ADD BALANCE",

      withdrawAction:"WITHDRAW",

      language:"Language",

      languageSub:"Choose your application language.",

      walletNote:"⚠️ This is simulated play-money only. No real money is sent or received.",

      saved:"Your cards have been saved.",

      lobbyOnly:"Cards can only be selected during the lobby.",

      maxCards:"You can select up to 4 cards.",

      gameProgress:"Game has started. Wait for the next round.",

      invalidAmount:"Enter a valid amount.",

      insufficient:"Insufficient balance.",

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

  function api(path, options){

    options = options || {};

    var headers =

      options.headers || {};

    headers["x-telegram-user"] =

      userHeader;

    if(

      options.body &&

      !headers["content-type"]

    ){

      headers["content-type"] =

        "application/json";

    }

    options.headers = headers;

    return fetch(

      path +

      (

        path.indexOf("?") >= 0

          ? "&"

          : "?"

      ) +

      "_=" +

      Date.now(),

      options

    ).then(function(response){

      return response.json();

    });

  }

  function showToast(message){

    var toast =

      document.getElementById(

        "toast"

      );

    toast.textContent =

      message;

    toast.classList.add("show");

    clearTimeout(

      showToast.timer

    );

    showToast.timer =

      setTimeout(function(){

        toast.classList.remove(

          "show"

        );

      },2200);

  }

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

  function seededShuffle(arr, seed){

    var a = arr.slice();

    var s = seed >>> 0;

    for(

      var i=a.length-1;

      i>0;

      i--

    ){

      s =

        (s * 1664525 +

        1013904223) >>> 0;

      var j =

        s % (i+1);

      var tmp =

        a[i];

      a[i]=a[j];

      a[j]=tmp;

    }

    return a;

  }

  function makeClientCard(number){

    var ranges = [

      [1,15],

      [16,30],

      [31,45],

      [46,60],

      [61,75]

    ];

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

    return {

      number:number,

      grid:grid

    };

  }

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

          currentGame.calledBalls.indexOf(

            value

          ) !== -1;

        var classes =

          "bingo-cell";

        if(value === "FREE"){

          classes += " free";

        }else if(called){

          classes += " called";

        }

        html +=

          '<div class="' +

          classes +

          '">' +

          value +

          '</div>';

      }

    }

    html +=

      "</div></div>";

    return html;

  }

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

        '<button class="card-select' +

        (

          isSelected

            ? " selected"

            : ""

        ) +

        '" data-card="' +

        i +

        '">' +

        i +

        "</button>";

    }

    grid.innerHTML=html;

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

  function renderPreviews(){

    var grid =

      document.getElementById(

        "previewGrid"

      );

    if(!selected.length){

      grid.innerHTML =

        '<div style="grid-column:1/-1;color:#667184;font-size:10px;padding:8px 0">' +

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

    grid.innerHTML=html;

  }

  function updateSelectionCount(){

    document.getElementById(

      "selectionCount"

    ).textContent =

      selected.length +

      "/4";

  }

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

      selected.indexOf(number);

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

      selected.push(number);

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

            data.selected.map(Number);

        }

        updateSelectionCount();

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

          ? data.selected.map(Number)

          : [];

      updateSelectionCount();

      renderCards();

      renderPreviews();

    });

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

    var countdown =

      document.getElementById(

        "countdown"

      );

    if(live){

      countdown.innerHTML =

        '<strong>' +

        currentGame.calledCount +

        '</strong> / 75';

    }else{

      countdown.innerHTML =

        '<strong>' +

        Math.max(

          0,

          currentGame.lobbyRemaining

        ) +

        's</strong>';

    }

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

      currentGame.calledCount +

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

      selected.length

        ? "block"

        : "block";

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

  function refreshGame(){

    return api(

      "/api/game"

    ).then(function(data){

      currentGame = data;

      updateGameUI();

    }).catch(function(){

      return null;

    });

  }

  function loadBalance(){

    return api(

      "/api/balance"

    ).then(function(data){

      var balance =

        Number(

          data.balance || 0

        );

      var formatted =

        balance.toFixed(2) +

        " ETB";

      document.getElementById(

        "topBalance"

      ).textContent =

        formatted;

      document.getElementById(

        "mainBalance"

      ).textContent =

        balance.toFixed(2);

      document.getElementById(

        "walletBalance"

      ).textContent =

        formatted;

    }).catch(function(){});

  }

  function setWalletType(type){

    walletType=type;

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

  }

  function walletRequest(){

    var amount =

      Number(

        document.getElementById(

          "walletAmount"

        ).value

      );

    var method =

      document.getElementById(

        "walletMethod"

      ).value;

    if(

      !Number.isFinite(amount) ||

      amount <= 0

    ){

      showToast(

        t("invalidAmount")

      );

      return;

    }

    api(

      "/api/wallet",

      {

        method:"POST",

        body:JSON.stringify({

          method:method,

          type:walletType,

          amount:amount

        })

      }

    ).then(function(data){

      if(data.ok){

        document.getElementById(

          "walletAmount"

        ).value="";

        loadBalance();

        showToast(

          t("balanceUpdated")

        );

      }else if(

        data.error ===

        "INSUFFICIENT_BALANCE"

      ){

        showToast(

          t("insufficient")

        );

      }else{

        showToast("Error");

      }

    }).catch(function(){

      showToast(

        "Connection error"

      );

    });

  }

  function setLanguage(next){

    language=next;

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

      "walletSub"

    ).textContent =

      x.walletSub;

    document.getElementById(

      "methodLabel"

    ).textContent =

      x.method;

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

      "walletNote"

    ).textContent =

      x.walletNote;

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

  function boot(){

    setLanguage("am");

    renderCards();

    renderPreviews();

    Promise.all([

      loadBalance(),

      loadMyCards(),

      refreshGame()

    ]).then(function(){

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

<script src="https://telegram.org/js/telegram-web-app.js"></script>

</body>

</html>`;

}

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

        method:request.method,

        headers:headers,

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

export default {

  async fetch(

    request,

    env

  ){

    const url =

      new URL(request.url);

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

    const apiRoutes = [

      "/api/game",

      "/api/cards",

      "/api/user-cards",

      "/api/select-cards",

      "/api/balance",

      "/api/wallet",

      "/api/claim"

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

        env.GAME_SCHEDULER.get(id);

      return stub.fetch(

        request

      );

    }

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

    return html(

      pageHtml()

    );

  }

};

export { GameScheduler };

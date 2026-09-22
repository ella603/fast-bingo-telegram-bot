import { DurableObject } from "cloudflare:workers";

const APP_NAME = "Fast Bingo";

const LOBBY_SECONDS = 45;

const BALL_INTERVAL = 3500;

const TOTAL_BALLS = 75;

const MAX_CARDS_PER_PLAYER = 4;

const CARD_COUNT = 400;

const PLAY_BALANCE_START = 2500;

function json(data, status = 200) {

  return new Response(JSON.stringify(data), {

    status,

    headers: {

      "content-type": "application/json; charset=UTF-8",

      "cache-control": "no-store",

    },

  });

}

function html(body) {

  return new Response(body, {

    headers: {

      "content-type": "text/html; charset=UTF-8",

      "cache-control": "no-store",

    },

  });

}

function shuffle(arr, seed) {

  const a = [...arr];

  let s = seed >>> 0;

  for (let i = a.length - 1; i > 0; i--) {

    s = (s * 1664525 + 1013904223) >>> 0;

    const j = s % (i + 1);

    [a[i], a[j]] = [a[j], a[i]];

  }

  return a;

}

function ballLetter(n) {

  if (n <= 15) return "B";

  if (n <= 30) return "I";

  if (n <= 45) return "N";

  if (n <= 60) return "G";

  return "O";

}

function makeCard(number) {

  const seed = 100000 + number * 7919;

  const ranges = [

    [1, 15],

    [16, 30],

    [31, 45],

    [46, 60],

    [61, 75],

  ];

  const columns = [];

  for (let c = 0; c < 5; c++) {

    const from = ranges[c][0];

    const to = ranges[c][1];

    const values = shuffle(

      Array.from(

        { length: to - from + 1 },

        (_, i) => from + i

      ),

      seed + c * 97

    ).slice(0, 5);

    columns.push(values);

  }

  const grid = Array.from(

    { length: 5 },

    () => Array(5).fill(null)

  );

  for (let c = 0; c < 5; c++) {

    for (let r = 0; r < 5; r++) {

      grid[r][c] = columns[c][r];

    }

  }

  grid[2][2] = "FREE";

  return {

    number,

    grid,

  };

}

function makeBallOrder(gameNumber) {

  return shuffle(

    Array.from(

      { length: TOTAL_BALLS },

      (_, i) => i + 1

    ),

    50000 + gameNumber * 9176

  );

}

function hasTwoLines(card, called) {

  const calledSet = new Set(called);

  const marked = (value) => {

    return value === "FREE" || calledSet.has(value);

  };

  let lines = 0;

  for (let r = 0; r < 5; r++) {

    if (card.grid[r].every(marked)) {

      lines++;

    }

  }

  for (let c = 0; c < 5; c++) {

    let complete = true;

    for (let r = 0; r < 5; r++) {

      if (!marked(card.grid[r][c])) {

        complete = false;

        break;

      }

    }

    if (complete) {

      lines++;

    }

  }

  let diagonal1 = true;

  let diagonal2 = true;

  for (let i = 0; i < 5; i++) {

    if (!marked(card.grid[i][i])) {

      diagonal1 = false;

    }

    if (!marked(card.grid[i][4 - i])) {

      diagonal2 = false;

    }

  }

  if (diagonal1) lines++;

  if (diagonal2) lines++;

  return lines >= 2;

}

function cardNumberValid(n) {

  return Number.isInteger(n) &&

    n >= 1 &&

    n <= CARD_COUNT;

}

function getTelegramUser(request) {

  const raw = request.headers.get("x-telegram-user");

  if (raw) {

    try {

      const parsed = JSON.parse(raw);

      if (parsed && parsed.id) {

        return {

          id: String(parsed.id),

          first_name: parsed.first_name || "",

          username: parsed.username || "",

        };

      }

    } catch {}

  }

  return {

    id: "guest",

    first_name: "Guest",

    username: "",

  };

}

class GameScheduler extends DurableObject {

  constructor(ctx, env) {

    super(ctx, env);

    this.ctx = ctx;

    this.env = env;

    this.ctx.blockConcurrencyWhile(async () => {

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

        started_at INTEGER NOT NULL,

        ball_index INTEGER NOT NULL,

        ball_order TEXT NOT NULL

      )

    `);

    sql.exec(`

      CREATE TABLE IF NOT EXISTS selected_cards (

        user_id TEXT NOT NULL,

        game_number INTEGER NOT NULL,

        card_number INTEGER NOT NULL,

        PRIMARY KEY(user_id, game_number, card_number)

      )

    `);

    sql.exec(`

      CREATE TABLE IF NOT EXISTS balances (

        user_id TEXT PRIMARY KEY,

        balance INTEGER NOT NULL

      )

    `);

    sql.exec(`

      CREATE TABLE IF NOT EXISTS transactions (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        user_id TEXT NOT NULL,

        method TEXT NOT NULL,

        type TEXT NOT NULL,

        amount INTEGER NOT NULL,

        created_at INTEGER NOT NULL

      )

    `);

    const rows = [

      ...sql.exec(

        "SELECT * FROM state WHERE id = 1"

      ),

    ];

    if (!rows.length) {

      const gameNumber = 1;

      const now = Date.now();

      sql.exec(

        `INSERT INTO state

        (id, game_number, status, started_at, ball_index, ball_order)

        VALUES (?, ?, ?, ?, ?, ?)`,

        1,

        gameNumber,

        "lobby",

        now,

        -1,

        JSON.stringify(

          makeBallOrder(gameNumber)

        )

      );

      await this.ctx.storage.setAlarm(

        now + LOBBY_SECONDS * 1000

      );

    } else {

      const state = rows[0];

      if (state.status === "lobby") {

        const elapsed =

          Date.now() - state.started_at;

        const remaining = Math.max(

          1000,

          LOBBY_SECONDS * 1000 - elapsed

        );

        await this.ctx.storage.setAlarm(

          Date.now() + remaining

        );

      } else if (state.status === "live") {

        await this.ctx.storage.setAlarm(

          Date.now() + BALL_INTERVAL

        );

      }

    }

  }

  getState() {

    const rows = [

      ...this.ctx.storage.sql.exec(

        "SELECT * FROM state WHERE id = 1"

      ),

    ];

    if (!rows.length) {

      return null;

    }

    const state = rows[0];

    return {

      ...state,

      ball_order: JSON.parse(

        state.ball_order

      ),

    };

  }

  getCalledBalls(state) {

    if (!state || state.ball_index < 0) {

      return [];

    }

    return state.ball_order.slice(

      0,

      state.ball_index + 1

    );

  }

  async scheduleNext(ms) {

    await this.ctx.storage.setAlarm(

      Date.now() + Math.max(500, ms)

    );

  }

  async alarm() {

    const state = this.getState();

    if (!state) {

      await this.init();

      return;

    }

    const sql = this.ctx.storage.sql;

    if (state.status === "lobby") {

      sql.exec(

        `UPDATE state

        SET status = ?,

            started_at = ?,

            ball_index = ?

        WHERE id = 1`,

        "live",

        Date.now(),

        0

      );

      await this.scheduleNext(

        BALL_INTERVAL

      );

      return;

    }

    if (state.status === "live") {

      const nextIndex =

        state.ball_index + 1;

      if (nextIndex >= TOTAL_BALLS) {

        await this.startNextGame();

        return;

      }

      sql.exec(

        `UPDATE state

        SET ball_index = ?

        WHERE id = 1`,

        nextIndex

      );

      await this.scheduleNext(

        BALL_INTERVAL

      );

    }

  }

  async startNextGame() {

    const oldState = this.getState();

    const gameNumber =

      Number(oldState.game_number) + 1;

    const now = Date.now();

    this.ctx.storage.sql.exec(

      `DELETE FROM selected_cards

       WHERE game_number < ?`,

      gameNumber - 2

    );

    this.ctx.storage.sql.exec(

      `UPDATE state

       SET game_number = ?,

           status = ?,

           started_at = ?,

           ball_index = ?,

           ball_order = ?

       WHERE id = 1`,

      gameNumber,

      "lobby",

      now,

      -1,

      JSON.stringify(

        makeBallOrder(gameNumber)

      )

    );

    await this.scheduleNext(

      LOBBY_SECONDS * 1000

    );

  }

  async game() {

    const state = this.getState();

    if (!state) {

      return {

        status: "lobby",

        gameNumber: 1,

        lobbyRemaining: LOBBY_SECONDS,

        currentBall: null,

        currentLetter: null,

        calledBalls: [],

        calledCount: 0,

      };

    }

    const calledBalls =

      this.getCalledBalls(state);

    let lobbyRemaining = 0;

    if (state.status === "lobby") {

      lobbyRemaining = Math.max(

        0,

        LOBBY_SECONDS -

          Math.floor(

            (Date.now() - state.started_at) /

              1000

          )

      );

    }

    const currentBall =

      state.status === "live" &&

      state.ball_index >= 0

        ? state.ball_order[

            state.ball_index

          ]

        : null;

    return {

      status: state.status,

      gameNumber: state.game_number,

      lobbyRemaining,

      currentBall,

      currentLetter: currentBall

        ? ballLetter(currentBall)

        : null,

      calledBalls,

      calledCount: calledBalls.length,

    };

  }

  async cards() {

    const cards = [];

    for (

      let i = 1;

      i <= CARD_COUNT;

      i++

    ) {

      cards.push({

        number: i,

        available: true,

      });

    }

    return {

      cards,

      total: CARD_COUNT,

    };

  }

  async selectCards(userId, cards) {

    const state = this.getState();

    if (!state) {

      return {

        ok: false,

        error: "GAME_NOT_READY",

      };

    }

    if (state.status !== "lobby") {

      return {

        ok: false,

        error: "GAME_IN_PROGRESS",

      };

    }

    const clean = [

      ...new Set(

        Array.isArray(cards)

          ? cards

              .map(Number)

              .filter(cardNumberValid)

          : []

      ),

    ].slice(

      0,

      MAX_CARDS_PER_PLAYER

    );

    const sql = this.ctx.storage.sql;

    sql.exec(

      `DELETE FROM selected_cards

       WHERE user_id = ?

       AND game_number = ?`,

      userId,

      state.game_number

    );

    for (const cardNumber of clean) {

      sql.exec(

        `INSERT OR IGNORE INTO selected_cards

         (user_id, game_number, card_number)

         VALUES (?, ?, ?)`,

        userId,

        state.game_number,

        cardNumber

      );

    }

    return {

      ok: true,

      selected: clean,

      gameNumber: state.game_number,

    };

  }

  async userCards(userId) {

    const state = this.getState();

    if (!state) {

      return {

        selected: [],

      };

    }

    const rows = [

      ...this.ctx.storage.sql.exec(

        `SELECT card_number

         FROM selected_cards

         WHERE user_id = ?

         AND game_number = ?

         ORDER BY card_number`,

        userId,

        state.game_number

      ),

    ];

    return {

      selected: rows.map(

        (r) => Number(r.card_number)

      ),

      gameNumber: state.game_number,

    };

  }

  async balance(userId) {

    const sql = this.ctx.storage.sql;

    const rows = [

      ...sql.exec(

        `SELECT balance

         FROM balances

         WHERE user_id = ?`,

        userId

      ),

    ];

    if (!rows.length) {

      sql.exec(

        `INSERT INTO balances

         (user_id, balance)

         VALUES (?, ?)`,

        userId,

        PLAY_BALANCE_START

      );

      return {

        balance: PLAY_BALANCE_START,

      };

    }

    return {

      balance: Number(

        rows[0].balance

      ),

    };

  }

  async walletRequest(

    userId,

    method,

    type,

    amount

  ) {

    const allowedMethods = [

      "Telebirr",

      "eBirr",

      "M-PESA",

    ];

    if (

      !allowedMethods.includes(method)

    ) {

      return {

        ok: false,

        error: "INVALID_METHOD",

      };

    }

    const cleanAmount =

      Math.floor(Number(amount));

    if (

      !Number.isFinite(cleanAmount) ||

      cleanAmount <= 0 ||

      cleanAmount > 100000

    ) {

      return {

        ok: false,

        error: "INVALID_AMOUNT",

      };

    }

    const sql = this.ctx.storage.sql;

    const current =

      await this.balance(userId);

    let newBalance =

      current.balance;

    if (type === "deposit") {

      newBalance += cleanAmount;

    } else if (type === "withdraw") {

      if (

        cleanAmount >

        current.balance

      ) {

        return {

          ok: false,

          error:

            "INSUFFICIENT_BALANCE",

          balance:

            current.balance,

        };

      }

      newBalance -= cleanAmount;

    } else {

      return {

        ok: false,

        error: "INVALID_TYPE",

      };

    }

    sql.exec(

      `UPDATE balances

       SET balance = ?

       WHERE user_id = ?`,

      newBalance,

      userId

    );

    sql.exec(

      `INSERT INTO transactions

       (user_id, method, type, amount, created_at)

       VALUES (?, ?, ?, ?, ?)`,

      userId,

      method,

      type,

      cleanAmount,

      Date.now()

    );

    return {

      ok: true,

      balance: newBalance,

      method,

      type,

      amount: cleanAmount,

      simulated: true,

    };

  }

  async checkWinners(userId) {

    const state = this.getState();

    if (!state) {

      return {

        ok: false,

        winner: false,

      };

    }

    const rows = [

      ...this.ctx.storage.sql.exec(

        `SELECT card_number

         FROM selected_cards

         WHERE user_id = ?

         AND game_number = ?

         ORDER BY card_number`,

        userId,

        state.game_number

      ),

    ];

    const called =

      this.getCalledBalls(state);

    const winners = [];

    for (const row of rows) {

      const cardNumber =

        Number(row.card_number);

      const card =

        makeCard(cardNumber);

      if (

        hasTwoLines(

          card,

          called

        )

      ) {

        winners.push(

          cardNumber

        );

      }

    }

    return {

      ok: true,

      winner:

        winners.length > 0,

      cards: winners,

      gameNumber:

        state.game_number,

    };

  }

  async fetch(request) {

    const url = new URL(request.url);

    const path = url.pathname;

    const user =

      getTelegramUser(request);

    try {

      if (path === "/do/game") {

        return json(

          await this.game()

        );

      }

      if (path === "/do/cards") {

        return json(

          await this.cards()

        );

      }

      if (

        path === "/do/user-cards"

      ) {

        return json(

          await this.userCards(

            user.id

          )

        );

      }

      if (

        path === "/do/select-cards"

      ) {

        if (

          request.method !== "POST"

        ) {

          return json(

            {

              error:

                "METHOD_NOT_ALLOWED",

            },

            405

          );

        }

        const body =

          await request.json();

        return json(

          await this.selectCards(

            user.id,

            body.cards

          )

        );

      }

      if (

        path === "/do/balance"

      ) {

        return json(

          await this.balance(

            user.id

          )

        );

      }

      if (

        path === "/do/wallet"

      ) {

        if (

          request.method !== "POST"

        ) {

          return json(

            {

              error:

                "METHOD_NOT_ALLOWED",

            },

            405

          );

        }

        const body =

          await request.json();

        return json(

          await this.walletRequest(

            user.id,

            body.method,

            body.type,

            body.amount

          )

        );

      }

      if (path === "/do/claim") {

        return json(

          await this.checkWinners(

            user.id

          )

        );

      }

      return json(

        {

          error: "NOT_FOUND",

        },

        404

      );

    } catch (error) {

      return json(

        {

          error: "SERVER_ERROR",

          message:

            error?.message ||

            String(error),

        },

        500

      );

    }

  }

}

function pageHtml() {

  return `<!DOCTYPE html>

<html lang="am">

<head>

<meta charset="UTF-8">

<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">

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

  padding-bottom:92px;

  background:

    radial-gradient(

      circle at 50% -10%,

      rgba(229,9,20,.14),

      transparent 38%

    ),

    var(--bg);

}

button,input,select{

  font:inherit;

}

button{

  cursor:pointer;

}

.app{

  width:100%;

  max-width:760px;

  margin:auto;

}

.topbar{

  position:sticky;

  top:0;

  z-index:20;

  display:flex;

  align-items:center;

  justify-content:space-between;

  gap:10px;

  padding:

    calc(10px + env(safe-area-inset-top))

    14px

    10px;

  background:rgba(7,9,13,.94);

  backdrop-filter:blur(18px);

  border-bottom:1px solid rgba(255,255,255,.06);

}

.brand{

  display:flex;

  align-items:center;

  gap:9px;

  min-width:0;

}

.brand-ball{

  width:38px;

  height:38px;

  border-radius:50%;

  display:grid;

  place-items:center;

  background:

    radial-gradient(

      circle at 32% 25%,

      #ff5960,

      var(--red) 50%,

      #a50009

    );

  box-shadow:0 5px 18px rgba(229,9,20,.32);

  font-size:18px;

}

.brand-name{

  font-size:15px;

  font-weight:950;

  letter-spacing:.7px;

}

.brand-sub{

  margin-top:3px;

  color:var(--muted);

  font-size:9px;

}

.balance-pill{

  border:1px solid var(--line);

  background:var(--surface);

  border-radius:999px;

  padding:8px 11px;

  font-size:11px;

  font-weight:900;

  white-space:nowrap;

}

.balance-pill span{

  color:var(--gold);

}

.hero{

  padding:18px 14px 8px;

}

.status-row{

  display:flex;

  align-items:center;

  justify-content:space-between;

  margin-bottom:12px;

}

.status-badge{

  display:flex;

  align-items:center;

  gap:7px;

  border-radius:999px;

  padding:7px 10px;

  color:var(--green);

  background:rgba(38,208,124,.1);

  border:1px solid rgba(38,208,124,.25);

  font-size:10px;

  font-weight:950;

}

.status-dot{

  width:7px;

  height:7px;

  border-radius:50%;

  background:currentColor;

  box-shadow:0 0 10px currentColor;

}

.game-number{

  color:var(--muted);

  font-size:10px;

  font-weight:800;

}

.hero-card{

  position:relative;

  overflow:hidden;

  padding:17px;

  border:1px solid var(--line);

  border-radius:24px;

  background:

    linear-gradient(

      145deg,

      rgba(255,255,255,.055),

      rgba(255,255,255,.015)

    ),

    var(--surface);

  box-shadow:0 15px 40px rgba(0,0,0,.3);

}

.hero-title{

  text-align:center;

  font-size:13px;

  font-weight:950;

}

.hero-message{

  margin-top:6px;

  min-height:18px;

  text-align:center;

  color:var(--muted);

  font-size:11px;

  line-height:1.5;

}

.countdown{

  margin:10px 0;

  text-align:center;

  color:var(--gold);

  font-size:13px;

  font-weight:900;

}

.countdown strong{

  font-size:22px;

}

.ball-area{

  display:flex;

  justify-content:center;

  padding:8px 0 14px;

}

.current-ball{

  width:140px;

  height:140px;

  border-radius:50%;

  display:flex;

  flex-direction:column;

  justify-content:center;

  align-items:center;

  background:

    radial-gradient(

      circle at 32% 22%,

      #fff,

      #eee 18%,

      #d0d3d8 52%,

      #92969d

    );

  color:#090b10;

  border:8px solid #272c34;

  box-shadow:

    0 0 0 5px rgba(229,9,20,.13),

    0 20px 45px rgba(0,0,0,.45);

}

.current-ball-letter{

  color:var(--red);

  font-size:18px;

  font-weight:1000;

}

.current-ball-number{

  margin-top:3px;

  font-size:50px;

  line-height:1;

  font-weight:1000;

}

.ball-caption{

  margin-top:5px;

  color:#626a77;

  font-size:8px;

  font-weight:900;

  letter-spacing:.7px;

}

.recent-row{

  display:flex;

  gap:6px;

  overflow-x:auto;

  scrollbar-width:none;

}

.recent-row::-webkit-scrollbar{

  display:none;

}

.mini-ball{

  width:31px;

  height:31px;

  flex:none;

  display:grid;

  place-items:center;

  border-radius:50%;

  background:var(--surface3);

  border:1px solid var(--line);

  font-size:9px;

  font-weight:900;

}

.mini-ball.latest{

  background:var(--red);

  border-color:var(--red);

}

.stats{

  display:grid;

  grid-template-columns:repeat(3,1fr);

  gap:8px;

  padding:8px 14px 14px;

}

.stat{

  padding:11px 7px;

  text-align:center;

  background:var(--surface);

  border:1px solid var(--line);

  border-radius:15px;

}

.stat-value{

  font-size:17px;

  font-weight:950;

}

.stat-label{

  margin-top:4px;

  color:var(--muted);

  font-size:8px;

  font-weight:700;

}

.tabs{

  display:grid;

  grid-template-columns:repeat(3,1fr);

  gap:5px;

  margin:0 14px 14px;

  padding:5px;

  background:var(--surface);

  border:1px solid var(--line);

  border-radius:16px;

}

.tab{

  border:0;

  border-radius:11px;

  padding:10px 5px;

  background:transparent;

  color:var(--muted);

  font-size:10px;

  font-weight:900;

}

.tab.active{

  background:var(--surface3);

  color:#fff;

}

.section{

  display:none;

  padding:0 14px;

}

.section.active{

  display:block;

}

.panel{

  margin-bottom:12px;

  padding:15px;

  background:var(--surface);

  border:1px solid var(--line);

  border-radius:19px;

}

.panel-title{

  font-size:13px;

  font-weight:950;

}

.panel-sub{

  margin:4px 0 13px;

  color:var(--muted);

  font-size:10px;

  line-height:1.6;

}

.info-grid{

  display:grid;

  grid-template-columns:repeat(2,1fr);

  gap:8px;

}

.info-box{

  padding:12px;

  background:var(--surface2);

  border:1px solid var(--line);

  border-radius:13px;

}

.info-box-title{

  font-size:10px;

  font-weight:900;

}

.info-box-text{

  margin-top:4px;

  color:var(--muted);

  font-size:9px;

  line-height:1.5;

}

.bingo-card{

  margin-bottom:10px;

  padding:11px;

  background:var(--surface2);

  border:1px solid var(--line);

  border-radius:16px;

}

.bingo-card-head{

  display:flex;

  justify-content:space-between;

  margin-bottom:8px;

}

.card-number-label{

  font-size:10px;

  font-weight:950;

}

.card-state{

  color:var(--green);

  font-size:8px;

  font-weight:900;

}

.bingo-grid{

  display:grid;

  grid-template-columns:repeat(5,1fr);

  gap:4px;

}

.bingo-cell{

  min-height:36px;

  display:grid;

  place-items:center;

  background:#0e131b;

  border:1px solid #242d3b;

  border-radius:6px;

  font-size:10px;

  font-weight:850;

}

.bingo-cell.called{

  background:var(--red);

  border-color:var(--red);

}

.bingo-cell.free{

  color:var(--gold);

  background:rgba(255,200,87,.12);

  border-color:rgba(255,200,87,.3);

  font-size:7px;

}

.primary-btn,

.secondary-btn{

  width:100%;

  border-radius:13px;

  padding:12px;

  font-size:11px;

  font-weight:950;

}

.primary-btn{

  border:0;

  background:linear-gradient(

    135deg,

    var(--red),

    var(--red2)

  );

  color:#fff;

}

.secondary-btn{

  border:1px solid var(--line);

  background:var(--surface2);

  color:#fff;

}

.btn-row{

  display:grid;

  grid-template-columns:1fr 1fr;

  gap:8px;

}

.called-grid{

  display:grid;

  grid-template-columns:repeat(10,1fr);

  gap:4px;

}

.called-number{

  aspect-ratio:1;

  display:grid;

  place-items:center;

  border-radius:6px;

  background:var(--surface2);

  border:1px solid var(--line);

  color:var(--muted);

  font-size:8px;

  font-weight:900;

}

.called-number.active{

  background:var(--red);

  border-color:var(--red);

  color:#fff;

}

.letter-heading{

  display:grid;

  grid-template-columns:repeat(5,1fr);

  gap:4px;

  margin-bottom:5px;

}

.letter-heading div{

  text-align:center;

  color:var(--red);

  font-size:9px;

  font-weight:1000;

}

.selected-list{

  display:flex;

  flex-wrap:wrap;

  gap:5px;

  margin-bottom:11px;

}

.selected-pill{

  padding:6px 8px;

  border-radius:999px;

  color:var(--green);

  background:rgba(38,208,124,.09);

  border:1px solid rgba(38,208,124,.28);

  font-size:9px;

  font-weight:900;

}

.card-grid{

  display:grid;

  grid-template-columns:repeat(10,minmax(0,1fr));

  gap:4px;

}

.card-select{

  min-width:0;

  aspect-ratio:1;

  padding:0;

  border:1px solid var(--line);

  border-radius:6px;

  background:#0d1219;

  color:#dfe3e9;

  font-size:8px;

  font-weight:950;

}

.card-select.selected{

  background:var(--red);

  border-color:var(--red);

  color:#fff;

}

.wallet-balance{

  display:flex;

  justify-content:space-between;

  align-items:center;

  margin-bottom:12px;

  padding:14px;

  border:1px solid var(--line);

  border-radius:15px;

  background:var(--surface2);

}

.wallet-label{

  color:var(--muted);

  font-size:9px;

}

.wallet-value{

  margin-top:2px;

  color:var(--gold);

  font-size:22px;

  font-weight:1000;

}

.type-toggle{

  display:grid;

  grid-template-columns:1fr 1fr;

  gap:5px;

  margin-bottom:10px;

  padding:4px;

  border:1px solid var(--line);

  border-radius:12px;

  background:var(--surface2);

}

.type-btn{

  border:0;

  border-radius:9px;

  padding:10px;

  background:transparent;

  color:var(--muted);

  font-size:10px;

  font-weight:900;

}

.type-btn.active{

  background:var(--surface3);

  color:#fff;

}

.field{

  margin-bottom:9px;

}

.field label{

  display:block;

  margin:0 0 5px 3px;

  color:var(--muted);

  font-size:9px;

  font-weight:800;

}

.field input,

.field select{

  width:100%;

  padding:11px;

  outline:none;

  border:1px solid var(--line);

  border-radius:11px;

  background:#0c1118;

  color:#fff;

  font-size:12px;

}

.language-buttons{

  display:grid;

  grid-template-columns:1fr 1fr;

  gap:7px;

}

.language-btn{

  border:1px solid var(--line);

  border-radius:11px;

  padding:10px;

  background:var(--surface2);

  color:var(--muted);

  font-size:10px;

  font-weight:900;

}

.language-btn.active{

  border-color:var(--red);

  background:rgba(229,9,20,.12);

  color:#fff;

}

.note{

  margin-top:10px;

  color:#727b89;

  font-size:8px;

  line-height:1.6;

  text-align:center;

}

.empty{

  padding:25px 10px;

  color:var(--muted);

  text-align:center;

  font-size:10px;

}

.bottom-nav{

  position:fixed;

  left:0;

  right:0;

  bottom:0;

  z-index:40;

  padding:

    8px

    12px

    calc(8px + env(safe-area-inset-bottom));

  background:rgba(7,9,13,.95);

  backdrop-filter:blur(18px);

  border-top:1px solid rgba(255,255,255,.07);

}

.bottom-inner{

  display:grid;

  grid-template-columns:repeat(3,1fr);

  gap:6px;

  max-width:500px;

  margin:auto;

}

.bottom-btn{

  border:0;

  border-radius:11px;

  padding:8px;

  background:transparent;

  color:var(--muted);

  font-size:9px;

  font-weight:900;

}

.bottom-btn.active{

  background:var(--surface2);

  color:#fff;

}

.toast{

  position:fixed;

  left:50%;

  bottom:95px;

  z-index:100;

  width:min(92%,420px);

  transform:translate(-50%,20px);

  padding:12px 14px;

  border-radius:13px;

  background:#f5f6f8;

  color:#090b10;

  text-align:center;

  font-size:10px;

  font-weight:850;

  opacity:0;

  pointer-events:none;

  transition:.22s;

}

.toast.show{

  transform:translate(-50%,0);

  opacity:1;

}

@media(max-width:480px){

  .current-ball{

    width:128px;

    height:128px;

  }

  .current-ball-number{

    font-size:45px;

  }

  .card-grid{

    gap:3px;

  }

  .card-select{

    font-size:7px;

  }

}

</style>

</head>

<body>

<div class="app">

<header class="topbar">

  <div class="brand">

    <div class="brand-ball">8</div>

    <div>

      <div class="brand-name">

        FAST BINGO

      </div>

      <div

        class="brand-sub"

        id="brandSub"

      >

        75 BALL • LIVE BINGO

      </div>

    </div>

  </div>

  <div class="balance-pill">

    💰

    <span id="topBalance">

      2,500

    </span>

  </div>

</header>

<main>

<section class="hero">

  <div class="status-row">

    <div

      class="status-badge"

      id="statusBadge"

    >

      <span class="status-dot"></span>

      <span id="statusText">

        በመጠበቅ ላይ

      </span>

    </div>

    <div

      class="game-number"

      id="gameNumber"

    >

      GAME #1

    </div>

  </div>

  <div class="hero-card">

    <div

      class="hero-title"

      id="heroTitle"

    >

      የቀጣዩ ጨዋታ ዝግጁ ነው

    </div>

    <div

      class="hero-message"

      id="heroMessage"

    >

      ካርድዎን ይምረጡ

    </div>

    <div

      class="countdown"

      id="countdown"

    >

      <strong>45</strong>

    </div>

    <div class="ball-area">

      <div class="current-ball">

        <div

          class="current-ball-letter"

          id="ballLetter"

        >

          B

        </div>

        <div

          class="current-ball-number"

          id="ballNumber"

        >

          —

        </div>

        <div

          class="ball-caption"

          id="ballCaption"

        >

          CURRENT BALL

        </div>

      </div>

    </div>

    <div

      class="recent-row"

      id="recentBalls"

    ></div>

  </div>

</section>

<section class="stats">

  <div class="stat">

    <div

      class="stat-value"

      id="calledCount"

    >

      0

    </div>

    <div

      class="stat-label"

      id="calledLabel"

    >

      የተጠሩ

    </div>

  </div>

  <div class="stat">

    <div class="stat-value">

      400

    </div>

    <div

      class="stat-label"

      id="cardsLabel"

    >

      ካርዶች

    </div>

  </div>

  <div class="stat">

    <div class="stat-value">

      4

    </div>

    <div

      class="stat-label"

      id="maxLabel"

    >

      ከፍተኛ

    </div>

  </div>

</section>

<nav class="tabs">

  <button

    class="tab active"

    data-section="play"

  >

    🎮 <span id="tabPlay">ጨዋታ</span>

  </button>

  <button

    class="tab"

    data-section="cards"

  >

    🎫 <span id="tabCards">ካርዶች</span>

  </button>

  <button

    class="tab"

    data-section="balance"

  >

    💰 <span id="tabBalance">ሂሳብ</span>

  </button>

</nav>

<section

  class="section active"

  id="section-play"

>

  <div class="panel">

    <div

      class="panel-title"

      id="yourGameTitle"

    >

      የእርስዎ ጨዋታ

    </div>

    <div

      class="panel-sub"

      id="yourGameSub"

    >

      ካርድዎን ይምረጡና ጨዋታውን ይከታተሉ።

    </div>

    <div class="info-grid">

      <div class="info-box">

        <div

          class="info-box-title"

          id="rule75"

        >

          75 Ball Bingo

        </div>

        <div

          class="info-box-text"

          id="rule75Text"

        >

          B 1–15 • I 16–30 • N 31–45 • G 46–60 • O 61–75

        </div>

      </div>

      <div class="info-box">

        <div

          class="info-box-title"

          id="ruleLines"

        >

          2 Lines

        </div>

        <div

          class="info-box-text"

          id="ruleLinesText"

        >

          ሁለት መስመሮች ሲሞሉ Bingo ይሆናል።

        </div>

      </div>

    </div>

  </div>

  <div class="panel">

    <div

      class="panel-title"

      id="myCardsTitle"

    >

      የእኔ ካርዶች

    </div>

    <div

      class="panel-sub"

      id="myCardsSub"

    >

      እስከ 4 ካርዶች መምረጥ ይችላሉ።

    </div>

    <div

      class="my-cards"

      id="myCards"

    >

      <div class="empty">

        ካርድ አልመረጡም።

      </div>

    </div>

    <div style="height:8px"></div>

    <button

      class="primary-btn"

      id="claimBtn"

    >

      🏆 BINGO

    </button>

  </div>

  <div class="panel">

    <div

      class="panel-title"

      id="calledTitle"

    >

      የተጠሩ ኳሶች

    </div>

    <div

      class="panel-sub"

      id="calledSub"

    >

      የተጠሩትን ኳሶች እዚህ ይመልከቱ።

    </div>

    <div class="letter-heading">

      <div>B</div>

      <div>I</div>

      <div>N</div>

      <div>G</div>

      <div>O</div>

    </div>

    <div

      class="called-grid"

      id="calledGrid"

    ></div>

  </div>

</section>

<section

  class="section"

  id="section-cards"

>

  <div class="panel">

    <div

      class="panel-title"

      id="chooseTitle"

    >

      ካርድ ይምረጡ

    </div>

    <div

      class="panel-sub"

      id="chooseSub"

    >

      በአንድ ጨዋታ እስከ 4 ካርዶች ይምረጡ።

    </div>

    <div

      class="selected-list"

      id="selectedList"

    ></div>

    <div

      class="card-grid"

      id="cardGrid"

    ></div>

    <div style="height:12px"></div>

    <button

      class="primary-btn"

      id="saveCardsBtn"

    >

      ✓ ካርዶችን አስቀምጥ

    </button>

  </div>

</section>

<section

  class="section"

  id="section-balance"

>

  <div class="panel">

    <div

      class="panel-title"

      id="balanceTitle"

    >

      የእኔ ሂሳብ

    </div>

    <div

      class="panel-sub"

      id="balanceSub"

    >

      ይህ የጨዋታ ሙከራ ሂሳብ ነው።

    </div>

    <div class="wallet-balance">

      <div>

        <div

          class="wallet-label"

          id="walletLabel"

        >

          የጨዋታ ሂሳብ

        </div>

        <div

          class="wallet-value"

          id="walletBalance"

        >

          2,500 ETB

        </div>

      </div>

      <div>💰</div>

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

        <option value="Telebirr">

          Telebirr

        </option>

        <option value="eBirr">

          eBirr

        </option>

        <option value="M-PESA">

          M-PESA

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

      data-section="play"

    >

      🎮

      <br>

      <span id="bottomPlay">

        ጨዋታ

      </span>

    </button>

    <button

      class="bottom-btn"

      data-section="cards"

    >

      🎫

      <br>

      <span id="bottomCards">

        ካርዶች

      </span>

    </button>

    <button

      class="bottom-btn"

      data-section="balance"

    >

      💰

      <br>

      <span id="bottomBalance">

        ሂሳብ

      </span>

    </button>

  </div>

</div>

<div

  class="toast"

  id="toast"

></div>

<script>

(function(){

  var tg = window.Telegram &&

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

      lobby:"በመጠበቅ ላይ",

      live:"ጨዋታው ቀጥሏል",

      lobbyTitle:"የቀጣዩ ጨዋታ ዝግጁ ነው",

      liveTitle:"GAME IN PROGRESS",

      lobbyMessage:"ካርድዎን ይምረጡ",

      liveMessage:"ኳሎቹ እየተጠሩ ነው።",

      currentBall:"CURRENT BALL",

      called:"የተጠሩ",

      cards:"ካርዶች",

      maximum:"ከፍተኛ",

      play:"ጨዋታ",

      cardsTab:"ካርዶች",

      balance:"ሂሳብ",

      yourGame:"የእርስዎ ጨዋታ",

      yourGameSub:"ካርድዎን ይምረጡና ጨዋታውን ይከታተሉ።",

      twoLines:"2 Lines",

      twoLinesText:"ሁለት መስመሮች ሲሞሉ Bingo ይሆናል።",

      myCards:"የእኔ ካርዶች",

      myCardsSub:"እስከ 4 ካርዶች መምረጥ ይችላሉ።",

      noCards:"ካርድ አልመረጡም።",

      bingo:"🏆 BINGO",

      calledBalls:"የተጠሩ ኳሶች",

      calledSub:"የተጠሩትን ኳሶች እዚህ ይመልከቱ።",

      choose:"ካርድ ይምረጡ",

      chooseSub:"በአንድ ጨዋታ እስከ 4 ካርዶች ይምረጡ።",

      save:"✓ ካርዶችን አስቀምጥ",

      balanceTitle:"የእኔ ሂሳብ",

      balanceSub:"ይህ የጨዋታ ሙከራ ሂሳብ ነው።",

      wallet:"የጨዋታ ሂሳብ",

      deposit:"+ ገቢ",

      withdraw:"− ወጪ",

      method:"ዘዴ",

      amount:"መጠን",

      depositAction:"ገቢ አድርግ",

      withdrawAction:"ወጪ አድርግ",

      walletNote:"⚠️ ይህ የሙከራ ሂሳብ ብቻ ነው። ትክክለኛ ገንዘብ አይላክም ወይም አይቀበልም።",

      language:"ቋንቋ",

      languageSub:"የመተግበሪያውን ቋንቋ ይምረጡ።",

      saved:"ካርዶችዎ ተቀምጠዋል።",

      lobbyOnly:"ካርድ መምረጥ የሚቻለው በLobby ጊዜ ብቻ ነው።",

      maxCards:"እስከ 4 ካርዶች ብቻ መምረጥ ይችላሉ።",

      gameProgress:"ጨዋታው ቀጥሏል። የሚቀጥለውን Lobby ይጠብቁ።",

      balanceUpdated:"ሂሳቡ ተዘምኗል።",

      invalidAmount:"ትክክለኛ መጠን ያስገቡ።",

      winner:"🎉 Bingo! የሚያሸንፉ ካርዶች ተገኝተዋል።",

      notWinner:"እስካሁን 2 መስመር ያሟላ ካርድ የለም።"

    },

    en:{

      brandSub:"75 BALL • LIVE BINGO",

      lobby:"LOBBY",

      live:"LIVE GAME",

      lobbyTitle:"Next game is getting ready",

      liveTitle:"GAME IN PROGRESS",

      lobbyMessage:"Choose your cards",

      liveMessage:"Balls are being called.",

      currentBall:"CURRENT BALL",

      called:"Called",

      cards:"Cards",

      maximum:"Maximum",

      play:"PLAY",

      cardsTab:"CARDS",

      balance:"BALANCE",

      yourGame:"Your Game",

      yourGameSub:"Choose your cards and follow the live game.",

      twoLines:"2 Lines",

      twoLinesText:"Bingo is reached when two lines are completed.",

      myCards:"My Cards",

      myCardsSub:"You can select up to 4 cards.",

      noCards:"No cards selected.",

      bingo:"🏆 BINGO",

      calledBalls:"Called Balls",

      calledSub:"See all called balls here.",

      choose:"Choose Cards",

      chooseSub:"Select up to 4 cards for this game.",

      save:"✓ SAVE SELECTED CARDS",

      balanceTitle:"My Balance",

      balanceSub:"This is a simulated play balance.",

      wallet:"Play Balance",

      deposit:"+ DEPOSIT",

      withdraw:"− WITHDRAW",

      method:"Method",

      amount:"Amount",

      depositAction:"ADD BALANCE",

      withdrawAction:"WITHDRAW",

      walletNote:"⚠️ This is a simulated play-money balance only. No real money is sent or received.",

      language:"Language",

      languageSub:"Choose your application language.",

      saved:"Your cards have been saved.",

      lobbyOnly:"Cards can only be selected during the lobby.",

      maxCards:"You can select up to 4 cards.",

      gameProgress:"Game is already in progress. Wait for the next lobby.",

      balanceUpdated:"Balance updated.",

      invalidAmount:"Enter a valid amount.",

      winner:"🎉 Bingo! Winning card(s) found.",

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

      document.getElementById("toast");

    toast.textContent = message;

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

      .querySelectorAll(".tab")

      .forEach(function(button){

        button.classList.toggle(

          "active",

          button.dataset.section === name

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

  function makeClientCard(number){

    var seed =

      100000 +

      number * 7919;

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

      var from =

        ranges[c][0];

      var to =

        ranges[c][1];

      var values =

        [];

      for(

        var n=from;

        n<=to;

        n++

      ){

        values.push(n);

      }

      values =

        seededShuffle(

          values,

          seed + c * 97

        ).slice(0,5);

      columns.push(values);

    }

    var grid =

      [];

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

  function renderBingoCard(card){

    var html =

      '<div class="bingo-card">' +

      '<div class="bingo-card-head">' +

      '<div class="card-number-label">' +

      'CARD #' + card.number +

      '</div>' +

      '<div class="card-state">' +

      '✓' +

      '</div>' +

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

  function renderMyCards(){

    var container =

      document.getElementById(

        "myCards"

      );

    if(!selected.length){

      container.innerHTML =

        '<div class="empty">' +

        t("noCards") +

        "</div>";

      return;

    }

    var html="";

    selected.forEach(

      function(number){

        html +=

          renderBingoCard(

            makeClientCard(

              number

            )

          );

      }

    );

    container.innerHTML =

      html;

  }

  function renderSelected(){

    var list =

      document.getElementById(

        "selectedList"

      );

    if(!selected.length){

      list.innerHTML="";

      return;

    }

    var html="";

    selected.forEach(

      function(number){

        html +=

          '<div class="selected-pill">' +

          "#" + number +

          "</div>";

      }

    );

    list.innerHTML=html;

  }

  function loadCards(){

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

      .querySelectorAll(

        ".card-select"

      )

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

      if(

        selected.length >=

        4

      ){

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

    renderSelected();

    loadCards();

    renderMyCards();

  }

  function saveCards(){

    if(

      !currentGame ||

      currentGame.status !== "lobby"

    ){

      showToast(

        t("gameProgress")

      );

      return;

    }

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

        selected =

          data.selected || [];

        renderSelected();

        loadCards();

        renderMyCards();

        showToast(

          t("saved")

        );

      }else{

        if(

          data.error ===

          "GAME_IN_PROGRESS"

        ){

          showToast(

            t("gameProgress")

          );

        }else{

          showToast(

            "Error"

          );

        }

      }

    }).catch(function(){

      showToast(

        "Connection error"

      );

    });

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

      renderSelected();

      loadCards();

      renderMyCards();

    });

  }

  function renderCalledBalls(){

    var grid =

      document.getElementById(

        "calledGrid"

      );

    var called =

      currentGame &&

      currentGame.calledBalls

        ? currentGame.calledBalls

        : [];

    var html="";

    for(

      var i=1;

      i<=75;

      i++

    ){

      var active =

        called.indexOf(i) >= 0;

      html +=

        '<div class="called-number' +

        (

          active

            ? " active"

            : ""

        ) +

        '">' +

        i +

        "</div>";

    }

    grid.innerHTML=html;

  }

  function updateGameUI(){

    if(!currentGame){

      return;

    }

    var live =

      currentGame.status ===

      "live";

    var statusText =

      document.getElementById(

        "statusText"

      );

    var statusBadge =

      document.getElementById(

        "statusBadge"

      );

    statusText.textContent =

      live

        ? t("live")

        : t("lobby");

    statusBadge.style.color =

      live

        ? "#26d07c"

        : "#ffc857";

    document.getElementById(

      "gameNumber"

    ).textContent =

      "GAME #" +

      currentGame.gameNumber;

    document.getElementById(

      "heroTitle"

    ).textContent =

      live

        ? t("liveTitle")

        : t("lobbyTitle");

    document.getElementById(

      "heroMessage"

    ).textContent =

      live

        ? t("liveMessage")

        : t("lobbyMessage");

    var countdown =

      document.getElementById(

        "countdown"

      );

    if(live){

      countdown.innerHTML =

        '<strong>' +

        currentGame.calledCount +

        "</strong> / 75";

    }else{

      countdown.innerHTML =

        '<strong>' +

        Math.max(

          0,

          currentGame.lobbyRemaining

        ) +

        "</strong> sec";

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

      "ballCaption"

    ).textContent =

      t("currentBall");

    document.getElementById(

      "calledCount"

    ).textContent =

      currentGame.calledCount;

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

    renderCalledBalls();

    renderMyCards();

  }

  function refreshGame(){

    return api(

      "/api/game"

    ).then(function(data){

      currentGame =

        data;

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

      document.getElementById(

        "topBalance"

      ).textContent =

        balance.toLocaleString();

      document.getElementById(

        "walletBalance"

      ).textContent =

        balance.toLocaleString() +

        " ETB";

    });

  }

  function setWalletType(type){

    walletType=type;

    document

      .getElementById(

        "depositBtn"

      )

      .classList.toggle(

        "active",

        type === "deposit"

      );

    document

      .getElementById(

        "withdrawBtn"

      )

      .classList.toggle(

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

      }else{

        if(

          data.error ===

          "INSUFFICIENT_BALANCE"

        ){

          showToast(

            language === "am"

              ? "በቂ ሂሳብ የለዎትም።"

              : "Insufficient balance."

          );

        }else{

          showToast(

            "Error"

          );

        }

      }

    }).catch(function(){

      showToast(

        "Connection error"

      );

    });

  }

  function claim(){

    api(

      "/api/claim"

    ).then(function(data){

      showToast(

        data.winner

          ? t("winner")

          : t("notWinner")

      );

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

      "calledLabel"

    ).textContent =

      x.called;

    document.getElementById(

      "cardsLabel"

    ).textContent =

      x.cards;

    document.getElementById(

      "maxLabel"

    ).textContent =

      x.maximum;

    document.getElementById(

      "tabPlay"

    ).textContent =

      x.play;

    document.getElementById(

      "tabCards"

    ).textContent =

      x.cardsTab;

    document.getElementById(

      "tabBalance"

    ).textContent =

      x.balance;

    document.getElementById(

      "bottomPlay"

    ).textContent =

      x.play;

    document.getElementById(

      "bottomCards"

    ).textContent =

      x.cardsTab;

    document.getElementById(

      "bottomBalance"

    ).textContent =

      x.balance;

    document.getElementById(

      "yourGameTitle"

    ).textContent =

      x.yourGame;

    document.getElementById(

      "yourGameSub"

    ).textContent =

      x.yourGameSub;

    document.getElementById(

      "ruleLines"

    ).textContent =

      x.twoLines;

    document.getElementById(

      "ruleLinesText"

    ).textContent =

      x.twoLinesText;

    document.getElementById(

      "myCardsTitle"

    ).textContent =

      x.myCards;

    document.getElementById(

      "myCardsSub"

    ).textContent =

      x.myCardsSub;

    document.getElementById(

      "claimBtn"

    ).textContent =

      x.bingo;

    document.getElementById(

      "calledTitle"

    ).textContent =

      x.calledBalls;

    document.getElementById(

      "calledSub"

    ).textContent =

      x.calledSub;

    document.getElementById(

      "chooseTitle"

    ).textContent =

      x.choose;

    document.getElementById(

      "chooseSub"

    ).textContent =

      x.chooseSub;

    document.getElementById(

      "saveCardsBtn"

    ).textContent =

      x.save;

    document.getElementById(

      "balanceTitle"

    ).textContent =

      x.balanceTitle;

    document.getElementById(

      "balanceSub"

    ).textContent =

      x.balanceSub;

    document.getElementById(

      "walletLabel"

    ).textContent =

      x.wallet;

    document.getElementById(

      "depositBtn"

    ).textContent =

      x.deposit;

    document.getElementById(

      "withdrawBtn"

    ).textContent =

      x.withdraw;

    document.getElementById(

      "methodLabel"

    ).textContent =

      x.method;

    document.getElementById(

      "amountLabel"

    ).textContent =

      x.amount;

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

    setWalletType(

      walletType

    );

    renderSelected();

    renderMyCards();

    updateGameUI();

  }

  document.getElementById(

    "saveCardsBtn"

  ).addEventListener(

    "click",

    saveCards

  );

  document.getElementById(

    "claimBtn"

  ).addEventListener(

    "click",

    claim

  );

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

  function boot(){

    setLanguage("am");

    loadCards();

    Promise.all([

      loadBalance(),

      loadMyCards(),

      refreshGame()

    ]).then(function(){

      setInterval(

        refreshGame,

        2500

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

      /^\\/api/,

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

    if(

      url.pathname ===

      "/api/game"

    ){

      return proxyToGame(

        request,

        env,

        "/api/game"

      );

    }

    if(

      url.pathname ===

      "/api/cards"

    ){

      return proxyToGame(

        request,

        env,

        "/api/cards"

      );

    }

    if(

      url.pathname ===

      "/api/user-cards"

    ){

      return proxyToGame(

        request,

        env,

        "/api/user-cards"

      );

    }

    if(

      url.pathname ===

      "/api/select-cards"

    ){

      return proxyToGame(

        request,

        env,

        "/api/select-cards"

      );

    }

    if(

      url.pathname ===

      "/api/balance"

    ){

      return proxyToGame(

        request,

        env,

        "/api/balance"

      );

    }

    if(

      url.pathname ===

      "/api/wallet"

    ){

      return proxyToGame(

        request,

        env,

        "/api/wallet"

      );

    }

    if(

      url.pathname ===

      "/api/claim"

    ){

      return proxyToGame(

        request,

        env,

        "/api/claim"

      );

    }

    if(

      url.pathname ===

      "/do/game" ||

      url.pathname ===

      "/do/cards" ||

      url.pathname ===

      "/do/user-cards" ||

      url.pathname ===

      "/do/select-cards" ||

      url.pathname ===

      "/do/balance" ||

      url.pathname ===

      "/do/wallet" ||

      url.pathname ===

      "/do/claim"

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

        {status:204}

      );

    }

    return html(

      pageHtml()

    );

  }

};

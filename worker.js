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

  const pool = Array.from({ length: 75 }, (_, i) => i + 1);

  const card = [];

  const ranges = [

    [1, 15],

    [16, 30],

    [31, 45],

    [46, 60],

    [61, 75],

  ];

  for (let c = 0; c < 5; c++) {

    const [from, to] = ranges[c];

    const values = shuffle(

      pool.filter((n) => n >= from && n <= to),

      seed + c * 97

    ).slice(0, 5);

    card.push(values);

  }

  const grid = Array.from({ length: 5 }, () => Array(5).fill(null));

  for (let c = 0; c < 5; c++) {

    for (let r = 0; r < 5; r++) {

      grid[r][c] = card[c][r];

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

    Array.from({ length: TOTAL_BALLS }, (_, i) => i + 1),

    50000 + gameNumber * 9176

  );

}

function hasTwoLines(card, called) {

  const calledSet = new Set(called);

  const marked = (value) => value === "FREE" || calledSet.has(value);

  let lines = 0;

  for (let r = 0; r < 5; r++) {

    if (card.grid[r].every(marked)) lines++;

  }

  for (let c = 0; c < 5; c++) {

    let complete = true;

    for (let r = 0; r < 5; r++) {

      if (!marked(card.grid[r][c])) {

        complete = false;

        break;

      }

    }

    if (complete) lines++;

  }

  let d1 = true;

  let d2 = true;

  for (let i = 0; i < 5; i++) {

    if (!marked(card.grid[i][i])) d1 = false;

    if (!marked(card.grid[i][4 - i])) d2 = false;

  }

  if (d1) lines++;

  if (d2) lines++;

  return lines >= 2;

}

function cardNumberValid(n) {

  return Number.isInteger(n) && n >= 1 && n <= CARD_COUNT;

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

    const rows = [...sql.exec("SELECT * FROM state WHERE id = 1")];

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

        JSON.stringify(makeBallOrder(gameNumber))

      );

      await this.ctx.storage.setAlarm(now + LOBBY_SECONDS * 1000);

    } else {

      const state = rows[0];

      if (state.status === "lobby") {

        const elapsed = Date.now() - state.started_at;

        const remaining = Math.max(

          1000,

          LOBBY_SECONDS * 1000 - elapsed

        );

        await this.ctx.storage.setAlarm(Date.now() + remaining);

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

    if (!rows.length) return null;

    const state = rows[0];

    return {

      ...state,

      ball_order: JSON.parse(state.ball_order),

    };

  }

  getCalledBalls(state) {

    if (!state || state.ball_index < 0) return [];

    return state.ball_order.slice(0, state.ball_index + 1);

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

         SET status = ?, started_at = ?, ball_index = ?

         WHERE id = 1`,

        "live",

        Date.now(),

        0

      );

      await this.scheduleNext(BALL_INTERVAL);

      return;

    }

    if (state.status === "live") {

      const nextIndex = state.ball_index + 1;

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

      await this.scheduleNext(BALL_INTERVAL);

    }

  }

  async startNextGame() {

    const oldState = this.getState();

    const gameNumber = Number(oldState.game_number) + 1;

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

      JSON.stringify(makeBallOrder(gameNumber))

    );

    await this.scheduleNext(LOBBY_SECONDS * 1000);

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

    const calledBalls = this.getCalledBalls(state);

    let lobbyRemaining = 0;

    if (state.status === "lobby") {

      lobbyRemaining = Math.max(

        0,

        LOBBY_SECONDS -

          Math.floor((Date.now() - state.started_at) / 1000)

      );

    }

    const currentBall =

      state.status === "live" && state.ball_index >= 0

        ? state.ball_order[state.ball_index]

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

    for (let i = 1; i <= CARD_COUNT; i++) {

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

    ].slice(0, MAX_CARDS_PER_PLAYER);

    const sql = this.ctx.storage.sql;

    sql.exec(

      `DELETE FROM selected_cards

       WHERE user_id = ? AND game_number = ?`,

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

         WHERE user_id = ? AND game_number = ?

         ORDER BY card_number`,

        userId,

        state.game_number

      ),

    ];

    return {

      selected: rows.map((r) => Number(r.card_number)),

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

        `INSERT INTO balances(user_id, balance)

         VALUES (?, ?)`,

        userId,

        PLAY_BALANCE_START

      );

      return {

        balance: PLAY_BALANCE_START,

      };

    }

    return {

      balance: Number(rows[0].balance),

    };

  }

  async walletRequest(userId, method, type, amount) {

    const allowedMethods = [

      "Telebirr",

      "eBirr",

      "M-PESA",

    ];

    if (!allowedMethods.includes(method)) {

      return {

        ok: false,

        error: "INVALID_METHOD",

      };

    }

    const cleanAmount = Math.floor(Number(amount));

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

    const current = await this.balance(userId);

    let newBalance = current.balance;

    if (type === "deposit") {

      newBalance += cleanAmount;

    } else if (type === "withdraw") {

      if (cleanAmount > current.balance) {

        return {

          ok: false,

          error: "INSUFFICIENT_BALANCE",

          balance: current.balance,

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

         WHERE user_id = ? AND game_number = ?

         ORDER BY card_number`,

        userId,

        state.game_number

      ),

    ];

    const called = this.getCalledBalls(state);

    const winners = [];

    for (const row of rows) {

      const cardNumber = Number(row.card_number);

      const card = makeCard(cardNumber);

      if (hasTwoLines(card, called)) {

        winners.push(cardNumber);

      }

    }

    return {

      ok: true,

      winner: winners.length > 0,

      cards: winners,

      gameNumber: state.game_number,

    };

  }

  async fetch(request) {

    const url = new URL(request.url);

    const path = url.pathname;

    const user = getTelegramUser(request);

    try {

      if (path === "/do/game") {

        return json(await this.game());

      }

      if (path === "/do/cards") {

        return json(await this.cards());

      }

      if (path === "/do/user-cards") {

        return json(await this.userCards(user.id));

      }

      if (path === "/do/select-cards") {

        if (request.method !== "POST") {

          return json(

            { error: "METHOD_NOT_ALLOWED" },

            405

          );

        }

        const body = await request.json();

        return json(

          await this.selectCards(

            user.id,

            body.cards

          )

        );

      }

      if (path === "/do/balance") {

        return json(await this.balance(user.id));

      }

      if (path === "/do/wallet") {

        if (request.method !== "POST") {

          return json(

            { error: "METHOD_NOT_ALLOWED" },

            405

          );

        }

        const body = await request.json();

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

          await this.checkWinners(user.id)

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

          message: error?.message || String(error),

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

  <meta

    name="viewport"

    content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover"

  >

  <meta

    name="theme-color"

    content="#07090d"

  >

  <title>Fast Bingo</title>

  <style>

    :root{

      --bg:#07090d;

      --surface:#10141c;

      --surface2:#151b25;

      --surface3:#1b2230;

      --line:#293243;

      --text:#ffffff;

      --muted:#8993a4;

      --red:#e50914;

      --red2:#ff3038;

      --green:#26d07c;

      --gold:#ffc857;

      --blue:#4c8dff;

      --shadow:0 12px 35px rgba(0,0,0,.28);

    }

    *{

      box-sizing:border-box;

      -webkit-tap-highlight-color:transparent;

    }

    html{

      background:var(--bg);

      scroll-behavior:smooth;

    }

    body{

      margin:0;

      background:

        radial-gradient(

          circle at 50% -10%,

          rgba(229,9,20,.13),

          transparent 38%

        ),

        var(--bg);

      color:var(--text);

      font-family:

        -apple-system,

        BlinkMacSystemFont,

        "Segoe UI",

        Roboto,

        Arial,

        sans-serif;

      min-height:100vh;

      padding-bottom:92px;

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

      max-width:760px;

      margin:0 auto;

      padding-bottom:30px;

    }

    .topbar{

      position:sticky;

      top:0;

      z-index:30;

      display:flex;

      align-items:center;

      justify-content:space-between;

      gap:10px;

      padding:

        calc(10px + env(safe-area-inset-top))

        14px

        10px;

      background:rgba(7,9,13,.92);

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

      box-shadow:

        0 5px 18px rgba(229,9,20,.32);

      font-size:19px;

      flex:none;

    }

    .brand-text{

      min-width:0;

    }

    .brand-name{

      font-weight:900;

      letter-spacing:.7px;

      font-size:15px;

      line-height:1.1;

    }

    .brand-sub{

      color:var(--muted);

      font-size:10px;

      margin-top:3px;

      white-space:nowrap;

    }

    .balance-pill{

      display:flex;

      align-items:center;

      gap:6px;

      border:1px solid var(--line);

      background:var(--surface);

      border-radius:999px;

      padding:8px 11px;

      font-size:12px;

      font-weight:800;

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

      justify-content:space-between;

      align-items:center;

      gap:10px;

      margin-bottom:12px;

    }

    .status-badge{

      display:inline-flex;

      align-items:center;

      gap:7px;

      border-radius:999px;

      padding:7px 10px;

      background:rgba(38,208,124,.10);

      border:1px solid rgba(38,208,124,.25);

      color:var(--green);

      font-size:11px;

      font-weight:900;

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

      font-size:11px;

      font-weight:700;

    }

    .hero-card{

      position:relative;

      overflow:hidden;

      border:1px solid var(--line);

      border-radius:24px;

      background:

        linear-gradient(

          145deg,

          rgba(255,255,255,.055),

          rgba(255,255,255,.015)

        ),

        var(--surface);

      box-shadow:var(--shadow);

      padding:18px;

    }

    .hero-card::before{

      content:"";

      position:absolute;

      width:190px;

      height:190px;

      border-radius:50%;

      background:rgba(229,9,20,.08);

      filter:blur(4px);

      right:-90px;

      top:-90px;

    }

    .hero-title{

      position:relative;

      text-align:center;

      font-size:13px;

      font-weight:900;

      color:#f1f3f6;

      margin-bottom:14px;

    }

    .hero-message{

      position:relative;

      text-align:center;

      color:var(--muted);

      font-size:12px;

      line-height:1.6;

      min-height:20px;

    }

    .countdown{

      position:relative;

      display:flex;

      align-items:center;

      justify-content:center;

      gap:7px;

      margin:12px 0 14px;

      color:var(--gold);

      font-size:15px;

      font-weight:950;

    }

    .countdown strong{

      font-size:22px;

    }

    .ball-area{

      position:relative;

      display:flex;

      justify-content:center;

      align-items:center;

      padding:8px 0 13px;

    }

    .current-ball{

      width:146px;

      height:146px;

      border-radius:50%;

      display:flex;

      flex-direction:column;

      align-items:center;

      justify-content:center;

      background:

        radial-gradient(

          circle at 32% 22%,

          #ffffff,

          #f0f1f4 16%,

          #d7d9de 44%,

          #9da1a8 100%

        );

      color:#090b10;

      border:8px solid #272c34;

      box-shadow:

        0 0 0 5px rgba(229,9,20,.13),

        0 20px 45px rgba(0,0,0,.45);

    }

    .current-ball-letter{

      font-size:19px;

      font-weight:1000;

      color:var(--red);

      line-height:1;

    }

    .current-ball-number{

      font-size:52px;

      line-height:1;

      font-weight:1000;

      letter-spacing:-2px;

      margin-top:4px;

    }

    .ball-caption{

      margin-top:6px;

      color:#626a77;

      font-size:9px;

      font-weight:900;

      letter-spacing:.8px;

    }

    .recent-row{

      position:relative;

      display:flex;

      align-items:center;

      gap:7px;

      overflow-x:auto;

      padding:7px 2px 2px;

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

      color:#fff;

      font-size:10px;

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

      background:var(--surface);

      border:1px solid var(--line);

      border-radius:15px;

      padding:11px 8px;

      text-align:center;

    }

    .stat-value{

      font-size:17px;

      font-weight:950;

      line-height:1;

    }

    .stat-label{

      color:var(--muted);

      font-size:9px;

      margin-top:5px;

      font-weight:700;

    }

    .tabs{

      display:grid;

      grid-template-columns:repeat(3,1fr);

      gap:6px;

      margin:0 14px 14px;

      padding:5px;

      background:var(--surface);

      border:1px solid var(--line);

      border-radius:16px;

    }

    .tab{

      border:0;

      background:transparent;

      color:var(--muted);

      padding:10px 7px;

      border-radius:11px;

      font-size:11px;

      font-weight:900;

    }

    .tab.active{

      color:#fff;

      background:var(--surface3);

      box-shadow:0 2px 8px rgba(0,0,0,.2);

    }

    .section{

      display:none;

      padding:0 14px;

    }

    .section.active{

      display:block;

    }

    .panel{

      background:var(--surface);

      border:1px solid var(--line);

      border-radius:19px;

      padding:15px;

      margin-bottom:12px;

    }

    .panel-title{

      font-size:13px;

      font-weight:950;

      margin-bottom:4px;

    }

    .panel-sub{

      color:var(--muted);

      font-size:10px;

      line-height:1.6;

      margin-bottom:13px;

    }

    .info-grid{

      display:grid;

      grid-template-columns:repeat(2,1fr);

      gap:8px;

    }

    .info-box{

      background:var(--surface2);

      border:1px solid var(--line);

      border-radius:13px;

      padding:12px;

    }

    .info-box-title{

      font-size:11px;

      font-weight:900;

    }

    .info-box-text{

      color:var(--muted);

      font-size:9px;

      margin-top:4px;

      line-height:1.5;

    }

    .my-cards{

      display:grid;

      gap:10px;

    }

    .bingo-card{

      background:var(--surface2);

      border:1px solid var(--line);

      border-radius:16px;

      padding:11px;

    }

    .bingo-card-head{

      display:flex;

      justify-content:space-between;

      align-items:center;

      margin-bottom:8px;

    }

    .card-number-label{

      font-size:11px;

      font-weight:950;

    }

    .card-state{

      color:var(--green);

      font-size:9px;

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

      color:#f7f8fa;

      font-size:11px;

      font-weight:850;

    }

    .bingo-cell.called{

      background:rgba(229,9,20,.9);

      border-color:var(--red);

      color:#fff;

    }

    .bingo-cell.free{

      background:rgba(255,200,87,.13);

      border-color:rgba(255,200,87,.35);

      color:var(--gold);

      font-size:8px;

    }

    .primary-btn{

      width:100%;

      border:0;

      border-radius:13px;

      padding:13px 15px;

      background:linear-gradient(

        135deg,

        var(--red),

        var(--red2)

      );

      color:#fff;

      font-weight:950;

      font-size:12px;

      box-shadow:0 8px 20px rgba(229,9,20,.2);

    }

    .secondary-btn{

      width:100%;

      border:1px solid var(--line);

      border-radius:13px;

      padding:12px 15px;

      background:var(--surface2);

      color:#fff;

      font-weight:900;

      font-size:11px;

    }

    .btn-row{

      display:grid;

      grid-template-columns:1fr 1fr;

      gap:8px;

    }

    .called-grid{

      display:grid;

      grid-template-columns:repeat(10,1fr);

      gap:5px;

    }

    .called-number{

      aspect-ratio:1;

      display:grid;

      place-items:center;

      border-radius:7px;

      background:var(--surface2);

      border:1px solid var(--line);

      color:var(--muted);

      font-size:9px;

      font-weight:850;

    }

    .called-number.active{

      background:var(--red);

      border-color:var(--red);

      color:#fff;

    }

    .letter-heading{

      display:grid;

      grid-template-columns:repeat(5,1fr);

      gap:5px;

      margin-bottom:5px;

    }

    .letter-heading div{

      text-align:center;

      color:var(--red);

      font-size:10px;

      font-weight:1000;

    }

    .selected-list{

      display:flex;

      flex-wrap:wrap;

      gap:6px;

      margin-bottom:12px;

    }

    .selected-pill{

      border:1px solid rgba(38,208,124,.28);

      background:rgba(38,208,124,.09);

      color:var(--green);

      border-radius:999px;

      padding:6px 9px;

      font-size:10px;

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

      border:1px solid var(--line);

      background:#0d1219;

      color:#dfe3e9;

      border-radius:6px;

      font-size:8px;

      font-weight:950;

      padding:0;

    }

    .card-select.selected{

      background:var(--red);

      color:#fff;

      border-color:var(--red);

      box-shadow:0 0 0 1px rgba(255,255,255,.08);

    }

    .card-select:disabled{

      opacity:.35;

    }

    .wallet-balance{

      display:flex;

      align-items:center;

      justify-content:space-between;

      background:var(--surface2);

      border:1px solid var(--line);

      border-radius:15px;

      padding:14px;

      margin-bottom:12px;

    }

    .wallet-label{

      color:var(--muted);

      font-size:10px;

    }

    .wallet-value{

      font-size:22px;

      font-weight:1000;

      color:var(--gold);

      margin-top:2px;

    }

    .type-toggle{

      display:grid;

      grid-template-columns:1fr 1fr;

      gap:5px;

      padding:4px;

      background:var(--surface2);

      border:1px solid var(--line);

      border-radius:12px;

      margin-bottom:10px;

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

      color:var(--muted);

      font-size:9px;

      font-weight:800;

      margin:0 0 5px 3px;

    }

    .field input,

    .field select{

      width:100%;

      border:1px solid var(--line);

      border-radius:11px;

      background:#0c1118;

      color:#fff;

      padding:11px;

      outline:none;

      font-size:12px;

    }

    .language-buttons{

      display:grid;

      grid-template-columns:1fr 1fr;

      gap:7px;

    }

    .language-btn{

      border:1px solid var(--line);

      background:var(--surface2);

      color:var(--muted);

      border-radius:11px;

      padding:10px;

      font-size:11px;

      font-weight:900;

    }

    .language-btn.active{

      border-color:var(--red);

      color:#fff;

      background:rgba(229,9,20,.12);

    }

    .note{

      margin-top:10px;

      color:#727b89;

      font-size:9px;

      line-height:1.6;

      text-align:center;

    }

    .bottom-nav{

      position:fixed;

      z-index:50;

      left:50%;

      bottom:0;

      transform:translateX(-50%);

      width:min(760px,100%);

      padding:

        8px

        12px

        calc(8px + env(safe-area-inset-bottom));

      background:rgba(7,9,13,.94);

      backdrop-filter:blur(18px);

      border-top:1px solid rgba(255,255,255,.07);

    }

    .bottom-inner{

      display:grid;

      grid-template-columns:repeat(3,1fr);

      gap:6px;

      max-width:500px;

      margin:0 auto;

    }

    .bottom-btn{

      border:0;

      background:transparent;

      color:var(--muted);

      padding:7px 4px;

      border-radius:11px;

      font-size:9px;

      font-weight:900;

    }

    .bottom-btn.active{

      color:#fff;

      background:var(--surface2);

    }

    .toast{

      position:fixed;

      z-index:100;

      left:50%;

      bottom:92px;

      transform:translate(-50%,20px);

      width:min(92%,420px);

      background:#f5f6f8;

      color:#090b10;

      border-radius:13px;

      padding:12px 14px;

      font-size:11px;

      font-weight:850;

      text-align:center;

      opacity:0;

      pointer-events:none;

      transition:.22s ease;

      box-shadow:0 12px 30px rgba(0,0,0,.35);

    }

    .toast.show{

      opacity:1;

      transform:translate(-50%,0);

    }

    .empty{

      padding:25px 10px;

      text-align:center;

      color:var(--muted);

      font-size:11px;

    }

    @media(max-width:480px){

      .current-ball{

        width:128px;

        height:128px;

      }

      .current-ball-number{

        font-size:46px;

      }

      .card-grid{

        gap:3px;

      }

      .card-select{

        border-radius:5px;

        font-size:7px;

      }

      .called-grid{

        gap:4px;

      }

      .called-number{

        font-size:8px;

      }

    }

    @media(max-width:360px){

      .card-grid{

        gap:2px;

      }

      .card-select{

        font-size:6px;

      }

      .brand-sub{

        display:none;

      }

      .balance-pill{

        padding:7px 9px;

        font-size:10px;

      }

    }

  </style>

</head>

<body>

  <div class="app">

    <header class="topbar">

      <div class="brand">

        <div class="brand-ball">🎱</div>

        <div class="brand-text">

          <div class="brand-name">

            FAST BINGO

          </div>

          <div class="brand-sub" id="brandSub">

            75 BALL • LIVE BINGO

          </div>

        </div>

      </div>

      <div class="balance-pill">

        💵

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

              ሎቢ

            </span>

          </div>

          <div

            class="game-number"

            id="gameNumber"

          >

            Game #1

          </div>

        </div>

        <div class="hero-card">

          <div

            class="hero-title"

            id="heroTitle"

          >

            ለሚቀጥለው ጨዋታ ይዘጋጁ

          </div>

          <div

            class="hero-message"

            id="heroMessage"

          >

            ካርድዎን ይምረጡ። ጨዋታው በቅርቡ ይጀምራል።

          </div>

          <div

            class="countdown"

            id="countdown"

          >

            <span>⏱</span>

            <strong id="countdownValue">

              45

            </strong>

            <span id="countdownLabel">

              ሰከንድ

            </span>

          </div>

          <div class="ball-area">

            <div class="current-ball">

              <div

                class="current-ball-letter"

                id="currentBallLetter"

              >

                B

              </div>

              <div

                class="current-ball-number"

                id="currentBallNumber"

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

          id="tabPlay"

          onclick="showSection('play')"

        >

          መጫወት

        </button>

        <button

          class="tab"

          id="tabCards"

          onclick="showSection('cards')"

        >

          ካርዶች

        </button>

        <button

          class="tab"

          id="tabBalance"

          onclick="showSection('balance')"

        >

          ሂሳብ

        </button>

      </nav>

      <!-- PLAY -->

      <section

        class="section active"

        id="sectionPlay"

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

            እስከ 4 ካርድ መምረጥ ይችላሉ።

          </div>

          <div class="info-grid">

            <div class="info-box">

              <div

                class="info-box-title"

                id="rule75Title"

              >

                75 ኳስ

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

                id="ruleLinesTitle"

              >

                2 መስመር

              </div>

              <div

                class="info-box-text"

                id="ruleLinesText"

              >

                ሁለት ሙሉ መስመሮች ሲሞሉ Bingo ነው።

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

            በዚህ ጨዋታ የመረጡት ካርዶች።

          </div>

          <div

            class="my-cards"

            id="myCards"

          >

            <div class="empty">

              ካርድ አልመረጡም።

            </div>

          </div>

          <div style="height:10px"></div>

          <div class="btn-row">

            <button

              class="secondary-btn"

              onclick="showSection('cards')"

              id="chooseCardsBtn"

            >

              ካርድ ምረጥ

            </button>

            <button

              class="primary-btn"

              onclick="claim()"

              id="checkBingoBtn"

            >

              CHECK BINGO

            </button>

          </div>

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

            በዚህ ጨዋታ እስካሁን የተጠሩ ቁጥሮች።

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

      <!-- CARDS -->

      <section

        class="section"

        id="sectionCards"

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

            እስከ 4 ካርድ መምረጥ ይችላሉ።

          </div>

          <div

            class="selected-list"

            id="selectedList"

          ></div>

          <button

            class="primary-btn"

            onclick="saveCards()"

            id="saveCardsBtn"

          >

            የመረጥኩትን አስቀምጥ

          </button>

          <div style="height:14px"></div>

          <div

            class="card-grid"

            id="cardGrid"

          ></div>

        </div>

      </section>

      <!-- BALANCE -->

      <section

        class="section"

        id="sectionBalance"

      >

        <div class="panel">

          <div class="wallet-balance">

            <div>

              <div

                class="wallet-label"

                id="walletLabel"

              >

                የእርስዎ ሂሳብ

              </div>

              <div

                class="wallet-value"

                id="walletBalance"

              >

                2,500 ETB

              </div>

            </div>

            <div style="font-size:26px">

              💵

            </div>

          </div>

          <div

            class="type-toggle"

          >

            <button

              class="type-btn active"

              id="depositBtn"

              onclick="setWalletType('deposit')"

            >

              ገቢ አድርግ

            </button>

            <button

              class="type-btn"

              id="withdrawBtn"

              onclick="setWalletType('withdraw')"

            >

              ወጪ አድርግ

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

              inputmode="numeric"

              placeholder="100"

            >

          </div>

          <button

            class="primary-btn"

            onclick="walletRequest()"

            id="walletSubmit"

          >

            ገቢ አድርግ

          </button>

          <div

            class="note"

            id="walletNote"

          >

            ይህ የplay-money ሙከራ ሂሳብ ብቻ ነው። ትክክለኛ ገንዘብ አይንቀሳቀስም።

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

            የMini App ቋንቋ ይምረጡ።

          </div>

          <div class="language-buttons">

            <button

              class="language-btn active"

              id="amBtn"

              onclick="setLanguage('am')"

            >

              🇪🇹 አማርኛ

            </button>

            <button

              class="language-btn"

              id="enBtn"

              onclick="setLanguage('en')"

            >

              🇬🇧 English

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

        id="bottomPlay"

        onclick="showSection('play')"

      >

        🎮<br>

        <span>መጫወት</span>

      </button>

      <button

        class="bottom-btn"

        id="bottomCards"

        onclick="showSection('cards')"

      >

        🃏<br>

        <span>ካርዶች</span>

      </button>

      <button

        class="bottom-btn"

        id="bottomBalance"

        onclick="showSection('balance')"

      >

        💵<br>

        <span>ሂሳብ</span>

      </button>

    </div>

  </div>

  <div

    class="toast"

    id="toast"

  ></div>

<script>

  const tg =

    window.Telegram &&

    window.Telegram.WebApp

      ? window.Telegram.WebApp

      : null;

  if (tg) {

    tg.ready();

    tg.expand();

  }

  const telegramUser =

    tg &&

    tg.initDataUnsafe &&

    tg.initDataUnsafe.user

      ? tg.initDataUnsafe.user

      : {

          id: "guest",

          first_name: "Guest"

        };

  const userHeader =

    JSON.stringify(telegramUser);

  let selected = [];

  let currentGame = null;

  let walletType = "deposit";

  let language = "am";

  let refreshBusy = false;

  const translations = {

    am: {

      brandSub: "75 ኳስ • የቀጥታ Bingo",

      lobby: "ሎቢ",

      live: "በመካሄድ ላይ",

      game: "ጨዋታ",

      prepare: "ለሚቀጥለው ጨዋታ ይዘጋጁ",

      lobbyMessage:

        "ካርድዎን ይምረጡ። ጨዋታው በቅርቡ ይጀምራል።",

      liveMessage:

        "ጨዋታው በመካሄድ ላይ ነው። ቀጣዩን ኳስ ይጠብቁ።",

      waitMessage:

        "🎱 GAME IN PROGRESS • እባክዎ ቀጣዩን ጨዋታ ይጠብቁ።",

      seconds: "ሰከንድ",

      currentBall: "የአሁኑ ኳስ",

      called: "የተጠሩ",

      cards: "ካርዶች",

      maximum: "ከፍተኛ",

      play: "መጫወት",

      cardTab: "ካርዶች",

      balance: "ሂሳብ",

      yourGame: "የእርስዎ ጨዋታ",

      yourGameSub:

        "እስከ 4 ካርድ መምረጥ ይችላሉ።",

      ball75: "75 ኳስ",

      ball75Text:

        "B 1–15 • I 16–30 • N 31–45 • G 46–60 • O 61–75",

      twoLines: "2 መስመር",

      twoLinesText:

        "ሁለት ሙሉ መስመሮች ሲሞሉ Bingo ነው።",

      myCards: "የእኔ ካርዶች",

      myCardsSub:

        "በዚህ ጨዋታ የመረጡት ካርዶች።",

      chooseCard: "ካርድ ምረጥ",

      checkBingo: "CHECK BINGO",

      calledBalls: "የተጠሩ ኳሶች",

      calledBallsSub:

        "በዚህ ጨዋታ እስካሁን የተጠሩ ቁጥሮች።",

      chooseCards: "ካርድ ይምረጡ",

      chooseCardsSub:

        "እስከ 4 ካርድ መምረጥ ይችላሉ።",

      saveCards: "የመረጥኩትን አስቀምጥ",

      wallet: "የእርስዎ ሂሳብ",

      deposit: "ገቢ አድርግ",

      withdraw: "ወጪ አድርግ",

      method: "ዘዴ",

      amount: "መጠን",

      submitDeposit: "ገቢ አድርግ",

      submitWithdraw: "ወጪ አድርግ",

      walletNote:

        "ይህ የplay-money ሙከራ ሂሳብ ብቻ ነው። ትክክለኛ ገንዘብ አይንቀሳቀስም።",

      language: "ቋንቋ",

      languageSub:

        "የMini App ቋንቋ ይምረጡ።",

      noCards: "ካርድ አልመረጡም።",

      saved: "ካርዶችዎ ተቀምጠዋል።",

      selectDuringLobby:

        "ካርድ መምረጥ የሚችሉት በLobby ጊዜ ብቻ ነው።",

      maxCards:

        "ከፍተኛው 4 ካርድ ብቻ ነው።",

      gameProgress:

        "ጨዋታው በመካሄድ ላይ ነው። ቀጣዩን ጨዋታ ይጠብቁ።",

      savedSuccess:

        "የመረጧቸው ካርዶች ተቀምጠዋል።",

      bingo:

        "🎉 BINGO! ሁለት መስመሮች ሞልተዋል።",

      noBingo:

        "እስካሁን Bingo አልሞላም።",

      amountInvalid:

        "እባክዎ ትክክለኛ መጠን ያስገቡ።",

      insufficient:

        "በሂሳብዎ ላይ በቂ ቀሪ የለም።",

      walletSuccess:

        "የplay-money ሂሳብዎ ተሻሽሏል።",

      cardSaved: "ተመርጧል",

      free: "FREE"

    },

    en: {

      brandSub: "75 BALL • LIVE BINGO",

      lobby: "LOBBY",

      live: "LIVE",

      game: "GAME",

      prepare: "Get ready for the next game",

      lobbyMessage:

        "Choose your cards. The game will start soon.",

      liveMessage:

        "The game is live. Wait for the next ball.",

      waitMessage:

        "🎱 GAME IN PROGRESS • Please wait for the next game.",

      seconds: "seconds",

      currentBall: "CURRENT BALL",

      called: "CALLED",

      cards: "CARDS",

      maximum: "MAX",

      play: "PLAY",

      cardTab: "CARDS",

      balance: "BALANCE",

      yourGame: "Your Game",

      yourGameSub:

        "You can select up to 4 cards.",

      ball75: "75 BALL",

      ball75Text:

        "B 1–15 • I 16–30 • N 31–45 • G 46–60 • O 61–75",

      twoLines: "2 LINES",

      twoLinesText:

        "Bingo is reached when two complete lines are marked.",

      myCards: "My Cards",

      myCardsSub:

        "Cards selected for this game.",

      chooseCard: "Choose Cards",

      checkBingo: "CHECK BINGO",

      calledBalls: "Called Balls",

      calledBallsSub:

        "Numbers called so far in this game.",

      chooseCards: "Choose Cards",

      chooseCardsSub:

        "Select up to 4 cards.",

      saveCards: "SAVE SELECTED CARDS",

      wallet: "Your Balance",

      deposit: "ADD BALANCE",

      withdraw: "WITHDRAW",

      method: "METHOD",

      amount: "AMOUNT",

      submitDeposit: "ADD BALANCE",

      submitWithdraw: "WITHDRAW",

      walletNote:

        "This is a play-money simulation only. No real money is transferred.",

      language: "Language",

      languageSub:

        "Choose the Mini App language.",

      noCards: "No cards selected.",

      saved: "Your cards are saved.",

      selectDuringLobby:

        "Cards can only be selected during the lobby.",

      maxCards:

        "You can select a maximum of 4 cards.",

      gameProgress:

        "The game is in progress. Please wait for the next game.",

      savedSuccess:

        "Your selected cards have been saved.",

      bingo:

        "🎉 BINGO! You have two completed lines.",

      noBingo:

        "No Bingo yet.",

      amountInvalid:

        "Please enter a valid amount.",

      insufficient:

        "Insufficient balance.",

      walletSuccess:

        "Your play-money balance has been updated.",

      cardSaved: "SELECTED",

      free: "FREE"

    }

  };

  function t(key){

    return (

      translations[language][key] ||

      translations.en[key] ||

      key

    );

  }

  function showToast(message){

    const el =

      document.getElementById("toast");

    el.textContent = message;

    el.classList.add("show");

    clearTimeout(window.toastTimer);

    window.toastTimer =

      setTimeout(() => {

        el.classList.remove("show");

      }, 2400);

  }

  async function api(path, options = {}){

    const headers = {

      ...(options.headers || {}),

      "x-telegram-user": userHeader

    };

    if (

      options.body &&

      !headers["content-type"]

    ) {

      headers["content-type"] =

        "application/json";

    }

    const response = await fetch(

      path,

      {

        ...options,

        headers,

        cache:"no-store"

      }

    );

    const text =

      await response.text();

    let data = {};

    try {

      data = JSON.parse(text);

    } catch {

      data = {

        error: text

      };

    }

    if (!response.ok) {

      throw new Error(

        data.error ||

        "Request failed"

      );

    }

    return data;

  }

  function showSection(section){

    const sections = {

      play:

        document.getElementById(

          "sectionPlay"

        ),

      cards:

        document.getElementById(

          "sectionCards"

        ),

      balance:

        document.getElementById(

          "sectionBalance"

        )

    };

    Object.values(sections)

      .forEach((el) => {

        el.classList.remove("active");

      });

    sections[section].classList.add(

      "active"

    );

    const tabMap = {

      play:

        document.getElementById("tabPlay"),

      cards:

        document.getElementById("tabCards"),

      balance:

        document.getElementById("tabBalance")

    };

    Object.values(tabMap)

      .forEach((el) => {

        el.classList.remove("active");

      });

    tabMap[section].classList.add(

      "active"

    );

    const bottomMap = {

      play:

        document.getElementById(

          "bottomPlay"

        ),

      cards:

        document.getElementById(

          "bottomCards"

        ),

      balance:

        document.getElementById(

          "bottomBalance"

        )

    };

    Object.values(bottomMap)

      .forEach((el) => {

        el.classList.remove("active");

      });

    bottomMap[section].classList.add(

      "active"

    );

    if (section === "cards") {

      loadCards();

    }

    if (section === "balance") {

      loadBalance();

    }

  }

  function ballLetterClient(n){

    if (n <= 15) return "B";

    if (n <= 30) return "I";

    if (n <= 45) return "N";

    if (n <= 60) return "G";

    return "O";

  }

  function seededShuffle(arr, seed){

    const a = [...arr];

    let s = seed >>> 0;

    for (let i = a.length - 1; i > 0; i--) {

      s =

        (s * 1664525 + 1013904223) >>> 0;

      const j = s % (i + 1);

      [a[i], a[j]] =

        [a[j], a[i]];

    }

    return a;

  }

  function makeClientCard(number){

    const ranges = [

      [1,15],

      [16,30],

      [31,45],

      [46,60],

      [61,75]

    ];

    const columns = [];

    for(let c = 0; c < 5; c++){

      const [from,to] =

        ranges[c];

      const pool =

        Array.from(

          {length:to-from+1},

          (_,i) => from+i

        );

      columns.push(

        seededShuffle(

          pool,

          number * 1009 + c * 917

        ).slice(0,5)

      );

    }

    const grid =

      Array.from(

        {length:5},

        () => Array(5).fill(null)

      );

    for(let c = 0; c < 5; c++){

      for(let r = 0; r < 5; r++){

        grid[r][c] =

          columns[c][r];

      }

    }

    grid[2][2] = "FREE";

    return {

      number,

      grid

    };

  }

  function renderBingoCard(card){

    const state =

      currentGame || {

        calledBalls:[]

      };

    const called =

      new Set(

        state.calledBalls || []

      );

    let html = "";

    html += `

      <div class="bingo-card">

        <div class="bingo-card-head">

          <div class="card-number-label">

            #${card.number}

          </div>

          <div class="card-state">

            ${t("cardSaved")}

          </div>

        </div>

        <div class="letter-heading">

          <div>B</div>

          <div>I</div>

          <div>N</div>

          <div>G</div>

          <div>O</div>

        </div>

        <div class="bingo-grid">

    `;

    for(let r=0;r<5;r++){

      for(let c=0;c<5;c++){

        const value =

          card.grid[r][c];

        const isFree =

          value === "FREE";

        const isCalled =

          !isFree &&

          called.has(value);

        let classes =

          "bingo-cell";

        if(isFree){

          classes += " free";

        }

        if(isCalled){

          classes += " called";

        }

        html += `

          <div class="${classes}">

            ${

              isFree

                ? t("free")

                : value

            }

          </div>

        `;

      }

    }

    html += `

        </div>

      </div>

    `;

    return html;

  }

  async function loadCards(){

    const grid =

      document.getElementById(

        "cardGrid"

      );

    if(grid.dataset.loaded === "1"){

      renderSelected();

      return;

    }

    grid.innerHTML = "";

    for(let i=1;i<=CARD_COUNT;i++){

      const button =

        document.createElement(

          "button"

        );

      button.className =

        "card-select";

      button.textContent =

        i;

      button.dataset.number =

        i;

      button.onclick =

        () => toggleCard(i);

      grid.appendChild(button);

    }

    grid.dataset.loaded = "1";

    renderSelected();

  }

  function toggleCard(number){

    if(

      currentGame &&

      currentGame.status !== "lobby"

    ){

      showToast(

        t("selectDuringLobby")

      );

      return;

    }

    const index =

      selected.indexOf(number);

    if(index >= 0){

      selected.splice(index,1);

    }else{

      if(

        selected.length >=

        MAX_CARDS_PER_PLAYER

      ){

        showToast(

          t("maxCards")

        );

        return;

      }

      selected.push(number);

    }

    selected.sort(

      (a,b) => a-b

    );

    renderSelected();

  }

  function renderSelected(){

    const list =

      document.getElementById(

        "selectedList"

      );

    const grid =

      document.getElementById(

        "cardGrid"

      );

    list.innerHTML = "";

    selected.forEach((number) => {

      const pill =

        document.createElement(

          "div"

        );

      pill.className =

        "selected-pill";

      pill.textContent =

        "#" + number;

      list.appendChild(pill);

    });

    if(!selected.length){

      list.innerHTML = "";

    }

    if(grid){

      grid

        .querySelectorAll(

          ".card-select"

        )

        .forEach((button) => {

          const number =

            Number(

              button.dataset.number

            );

          button.classList.toggle(

            "selected",

            selected.includes(number)

          );

        });

    }

  }

  async function saveCards(){

    if(

      !currentGame ||

      currentGame.status !== "lobby"

    ){

      showToast(

        t("selectDuringLobby")

      );

      return;

    }

    try{

      const result =

        await api(

          "/api/select-cards",

          {

            method:"POST",

            body:JSON.stringify({

              cards:selected

            })

          }

        );

      selected =

        Array.isArray(

          result.selected

        )

          ? result.selected

          : [];

      renderSelected();

      await loadMyCards();

      showToast(

        t("savedSuccess")

      );

      showSection("play");

    }catch(error){

      showToast(

        error.message ||

        "Error"

      );

    }

  }

  async function loadMyCards(){

    try{

      const data =

        await api(

          "/api/user-cards"

        );

      selected =

        Array.isArray(

          data.selected

        )

          ? data.selected

          : [];

      renderSelected();

      renderMyCards();

    }catch{

      renderMyCards();

    }

  }

  function renderMyCards(){

    const container =

      document.getElementById(

        "myCards"

      );

    if(!selected.length){

      container.innerHTML = `

        <div class="empty">

          ${t("noCards")}

        </div>

      `;

      return;

    }

    container.innerHTML =

      selected

        .map((number) =>

          renderBingoCard(

            makeClientCard(number)

          )

        )

        .join("");

  }

  function renderCalledBalls(){

    const grid =

      document.getElementById(

        "calledGrid"

      );

    if(!currentGame){

      grid.innerHTML = "";

      return;

    }

    const called =

      new Set(

        currentGame.calledBalls || []

      );

    let html = "";

    for(

      let number = 1;

      number <= TOTAL_BALLS;

      number++

    ){

      html += `

        <div

          class="called-number ${

            called.has(number)

              ? "active"

              : ""

          }"

        >

          ${number}

        </div>

      `;

    }

    grid.innerHTML = html;

  }

  function renderRecentBalls(){

    const container =

      document.getElementById(

        "recentBalls"

      );

    if(!currentGame){

      container.innerHTML = "";

      return;

    }

    const called =

      currentGame.calledBalls || [];

    const recent =

      called.slice(-12).reverse();

    container.innerHTML =

      recent

        .map((number,index) => `

          <div

            class="mini-ball ${

              index === 0

                ? "latest"

                : ""

            }"

          >

            ${number}

          </div>

        `)

        .join("");

  }

  function updateGameUI(){

    if(!currentGame) return;

    const live =

      currentGame.status === "live";

    const statusText =

      document.getElementById(

        "statusText"

      );

    const statusBadge =

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

    statusBadge.style.background =

      live

        ? "rgba(38,208,124,.10)"

        : "rgba(255,200,87,.10)";

    statusBadge.style.borderColor =

      live

        ? "rgba(38,208,124,.25)"

        : "rgba(255,200,87,.25)";

    document.getElementById(

      "gameNumber"

    ).textContent =

      t("game") +

      " #" +

      currentGame.gameNumber;

    document.getElementById(

      "heroTitle"

    ).textContent =

      live

        ? "🎱 " + t("live")

        : t("prepare");

    document.getElementById(

      "heroMessage"

    ).textContent =

      live

        ? t("liveMessage")

        : t("lobbyMessage");

    const countdown =

      document.getElementById(

        "countdown"

      );

    if(live){

      countdown.style.display =

        "none";

    }else{

      countdown.style.display =

        "flex";

      document.getElementById(

        "countdownValue"

      ).textContent =

        currentGame.lobbyRemaining || 0;

      document.getElementById(

        "countdownLabel"

      ).textContent =

        t("seconds");

    }

    const currentBall =

      currentGame.currentBall;

    document.getElementById(

      "currentBallNumber"

    ).textContent =

      currentBall || "—";

    document.getElementById(

      "currentBallLetter"

    ).textContent =

      currentBall

        ? ballLetterClient(

            currentBall

          )

        : "B";

    document.getElementById(

      "ballCaption"

    ).textContent =

      t("currentBall");

    document.getElementById(

      "calledCount"

    ).textContent =

      currentGame.calledCount || 0;

    renderRecentBalls();

    renderCalledBalls();

    renderMyCards();

  }

  async function refreshGame(){

    if(refreshBusy) return;

    refreshBusy = true;

    try{

      currentGame =

        await api(

          "/api/game"

        );

      updateGameUI();

    }catch(error){

      console.error(error);

    }finally{

      refreshBusy = false;

    }

  }

  async function loadBalance(){

    try{

      const data =

        await api(

          "/api/balance"

        );

      const balance =

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

    }catch(error){

      console.error(error);

    }

  }

  function setWalletType(type){

    walletType = type;

    const deposit =

      document.getElementById(

        "depositBtn"

      );

    const withdraw =

      document.getElementById(

        "withdrawBtn"

      );

    deposit.classList.toggle(

      "active",

      type === "deposit"

    );

    withdraw.classList.toggle(

      "active",

      type === "withdraw"

    );

    document.getElementById(

      "walletSubmit"

    ).textContent =

      type === "deposit"

        ? t("submitDeposit")

        : t("submitWithdraw");

  }

  async function walletRequest(){

    const method =

      document.getElementById(

        "walletMethod"

      ).value;

    const amount =

      Number(

        document.getElementById(

          "walletAmount"

        ).value

      );

    if(

      !Number.isFinite(amount) ||

      amount <= 0

    ){

      showToast(

        t("amountInvalid")

      );

      return;

    }

    try{

      const result =

        await api(

          "/api/wallet",

          {

            method:"POST",

            body:JSON.stringify({

              method,

              type:walletType,

              amount

            })

          }

        );

      if(

        result.error ===

        "INSUFFICIENT_BALANCE"

      ){

        showToast(

          t("insufficient")

        );

        return;

      }

      if(!result.ok){

        showToast(

          result.error ||

          "Error"

        );

        return;

      }

      document.getElementById(

        "walletAmount"

      ).value = "";

      await loadBalance();

      showToast(

        t("walletSuccess")

      );

    }catch(error){

      showToast(

        error.message ||

        "Error"

      );

    }

  }

  async function claim(){

    try{

      const result =

        await api(

          "/api/claim"

        );

      if(result.winner){

        showToast(

          t("bingo") +

          " #" +

          result.cards.join(", #")

        );

      }else{

        showToast(

          t("noBingo")

        );

      }

    }catch(error){

      showToast(

        error.message ||

        "Error"

      );

    }

  }

  function applyLanguage(){

    document.documentElement

      .lang = language;

    document.getElementById(

      "brandSub"

    ).textContent =

      t("brandSub");

    document.getElementById(

      "calledLabel"

    ).textContent =

      t("called");

    document.getElementById(

      "cardsLabel"

    ).textContent =

      t("cards");

    document.getElementById(

      "maxLabel"

    ).textContent =

      t("maximum");

    document.getElementById(

      "tabPlay"

    ).textContent =

      t("play");

    document.getElementById(

      "tabCards"

    ).textContent =

      t("cardTab");

    document.getElementById(

      "tabBalance"

    ).textContent =

      t("balance");

    document.getElementById(

      "bottomPlay"

    ).innerHTML =

      "🎮<br><span>" +

      t("play") +

      "</span>";

    document.getElementById(

      "bottomCards"

    ).innerHTML =

      "🃏<br><span>" +

      t("cardTab") +

      "</span>";

    document.getElementById(

      "bottomBalance"

    ).innerHTML =

      "💵<br><span>" +

      t("balance") +

      "</span>";

    document.getElementById(

      "yourGameTitle"

    ).textContent =

      t("yourGame");

    document.getElementById(

      "yourGameSub"

    ).textContent =

      t("yourGameSub");

    document.getElementById(

      "rule75Title"

    ).textContent =

      t("ball75");

    document.getElementById(

      "rule75Text"

    ).textContent =

      t("ball75Text");

    document.getElementById(

      "ruleLinesTitle"

    ).textContent =

      t("twoLines");

    document.getElementById(

      "ruleLinesText"

    ).textContent =

      t("twoLinesText");

    document.getElementById(

      "myCardsTitle"

    ).textContent =

      t("myCards");

    document.getElementById(

      "myCardsSub"

    ).textContent =

      t("myCardsSub");

    document.getElementById(

      "chooseCardsBtn"

    ).textContent =

      t("chooseCard");

    document.getElementById(

      "checkBingoBtn"

    ).textContent =

      t("checkBingo");

    document.getElementById(

      "calledTitle"

    ).textContent =

      t("calledBalls");

    document.getElementById(

      "calledSub"

    ).textContent =

      t("calledBallsSub");

    document.getElementById(

      "chooseTitle"

    ).textContent =

      t("chooseCards");

    document.getElementById(

      "chooseSub"

    ).textContent =

      t("chooseCardsSub");

    document.getElementById(

      "saveCardsBtn"

    ).textContent =

      t("saveCards");

    document.getElementById(

      "walletLabel"

    ).textContent =

      t("wallet");

    document.getElementById(

      "depositBtn"

    ).textContent =

      t("deposit");

    document.getElementById(

      "withdrawBtn"

    ).textContent =

      t("withdraw");

    document.getElementById(

      "methodLabel"

    ).textContent =

      t("method");

    document.getElementById(

      "amountLabel"

    ).textContent =

      t("amount");

    document.getElementById(

      "walletSubmit"

    ).textContent =

      walletType === "deposit"

        ? t("submitDeposit")

        : t("submitWithdraw");

    document.getElementById(

      "walletNote"

    ).textContent =

      t("walletNote");

    document.getElementById(

      "languageTitle"

    ).textContent =

      t("language");

    document.getElementById(

      "languageSub"

    ).textContent =

      t("languageSub");

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

    setWalletType(walletType);

    updateGameUI();

    renderMyCards();

    renderSelected();

  }

  function setLanguage(lang){

    if(

      lang !== "am" &&

      lang !== "en"

    ){

      return;

    }

    language = lang;

    try{

      localStorage.setItem(

        "fastBingoLanguage",

        lang

      );

    }catch{}

    applyLanguage();

  }

  async function boot(){

    try{

      const savedLanguage =

        localStorage.getItem(

          "fastBingoLanguage"

        );

      if(

        savedLanguage === "am" ||

        savedLanguage === "en"

      ){

        language =

          savedLanguage;

      }else{

        language = "am";

      }

    }catch{

      language = "am";

    }

    applyLanguage();

    await Promise.all([

      refreshGame(),

      loadBalance(),

      loadMyCards(),

      loadCards()

    ]);

    setInterval(

      refreshGame,

      1000

    );

    setInterval(

      loadBalance,

      10000

    );

  }

  boot();

</script>

<script

  src="https://telegram.org/js/telegram-web-app.js"

></script>

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

    path.replace(/^\/api/, "/do");

  const headers =

    new Headers(request.headers);

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

        headers,

        body:

          request.method === "GET" ||

          request.method === "HEAD"

            ? undefined

            : request.body

      }

    );

  return stub.fetch(proxied);

}

export default {

  async fetch(request, env){

    const url =

      new URL(request.url);

    if(url.pathname === "/health"){

      return json({

        ok:true,

        app:APP_NAME,

        time:new Date().toISOString()

      });

    }

    if(

      url.pathname === "/api/game"

    ){

      return proxyToGame(

        request,

        env,

        "/api/game"

      );

    }

    if(

      url.pathname === "/api/cards"

    ){

      return proxyToGame(

        request,

        env,

        "/api/cards"

      );

    }

    if(

      url.pathname === "/api/user-cards"

    ){

      return proxyToGame(

        request,

        env,

        "/api/user-cards"

      );

    }

    if(

      url.pathname === "/api/select-cards"

    ){

      return proxyToGame(

        request,

        env,

        "/api/select-cards"

      );

    }

    if(

      url.pathname === "/api/balance"

    ){

      return proxyToGame(

        request,

        env,

        "/api/balance"

      );

    }

    if(

      url.pathname === "/api/wallet"

    ){

      return proxyToGame(

        request,

        env,

        "/api/wallet"

      );

    }

    if(

      url.pathname === "/api/claim"

    ){

      return proxyToGame(

        request,

        env,

        "/api/claim"

      );

    }

    if(

      url.pathname === "/do/game" ||

      url.pathname === "/do/cards" ||

      url.pathname === "/do/user-cards" ||

      url.pathname === "/do/select-cards" ||

      url.pathname === "/do/balance" ||

      url.pathname === "/do/wallet" ||

      url.pathname === "/do/claim"

    ){

      const id =

        env.GAME_SCHEDULER.idFromName(

          "main-game"

        );

      const stub =

        env.GAME_SCHEDULER.get(id);

      return stub.fetch(request);

    }

    if(

      url.pathname === "/favicon.ico"

    ){

      return new Response(null,{

        status:204

      });

    }

    return html(

      pageHtml()

    );

  }

};

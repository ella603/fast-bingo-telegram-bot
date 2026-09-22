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

      "cache-control": "no-store"

    }

  });

}

function html(body) {

  return new Response(body, {

    headers: {

      "content-type": "text/html; charset=UTF-8",

      "cache-control": "no-store"

    }

  });

}

function shuffle(arr, seed) {

  const a = [...arr];

  let s = seed >>> 0;

  function rnd() {

    s = (s * 1664525 + 1013904223) >>> 0;

    return s / 4294967296;

  }

  for (let i = a.length - 1; i > 0; i--) {

    const j = Math.floor(rnd() * (i + 1));

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

  const seed = number * 9973;

  const B = shuffle(

    Array.from({ length: 15 }, (_, i) => i + 1),

    seed + 1

  ).slice(0, 5);

  const I = shuffle(

    Array.from({ length: 15 }, (_, i) => i + 16),

    seed + 2

  ).slice(0, 5);

  const N = shuffle(

    Array.from({ length: 15 }, (_, i) => i + 31),

    seed + 3

  ).slice(0, 5);

  const G = shuffle(

    Array.from({ length: 15 }, (_, i) => i + 46),

    seed + 4

  ).slice(0, 5);

  const O = shuffle(

    Array.from({ length: 15 }, (_, i) => i + 61),

    seed + 5

  ).slice(0, 5);

  return [

    B[0], I[0], N[0], G[0], O[0],

    B[1], I[1], N[1], G[1], O[1],

    B[2], I[2], "FREE", G[2], O[2],

    B[3], I[3], N[3], G[3], O[3],

    B[4], I[4], N[4], G[4], O[4]

  ];

}

function makeBallOrder(gameNumber) {

  return shuffle(

    Array.from({ length: TOTAL_BALLS }, (_, i) => i + 1),

    gameNumber * 7919 + 17

  );

}

function hasTwoLines(card, called) {

  const c = new Set(called);

  function marked(v) {

    return v === "FREE" || c.has(Number(v));

  }

  let lines = 0;

  for (let r = 0; r < 5; r++) {

    let ok = true;

    for (let col = 0; col < 5; col++) {

      if (!marked(card[r * 5 + col])) ok = false;

    }

    if (ok) lines++;

  }

  for (let col = 0; col < 5; col++) {

    let ok = true;

    for (let r = 0; r < 5; r++) {

      if (!marked(card[r * 5 + col])) ok = false;

    }

    if (ok) lines++;

  }

  let d1 = true;

  let d2 = true;

  for (let i = 0; i < 5; i++) {

    if (!marked(card[i * 5 + i])) d1 = false;

    if (!marked(card[i * 5 + (4 - i)])) d2 = false;

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

  if (!raw) {

    return {

      id: "guest",

      first_name: "Player",

      username: ""

    };

  }

  try {

    const u = JSON.parse(raw);

    return {

      id: String(u.id || "guest"),

      first_name: String(u.first_name || "Player"),

      username: String(u.username || "")

    };

  } catch {

    return {

      id: "guest",

      first_name: "Player",

      username: ""

    };

  }

}

export class GameScheduler extends DurableObject {

  constructor(ctx, env) {

    super(ctx, env);

    this.ctx = ctx;

    this.env = env;

    this.ctx.blockConcurrencyWhile(async () => {

      await this.init();

    });

  }

  async init() {

    this.ctx.storage.sql.exec(`

      CREATE TABLE IF NOT EXISTS state (

        id INTEGER PRIMARY KEY,

        game_number INTEGER NOT NULL,

        status TEXT NOT NULL,

        lobby_started INTEGER NOT NULL,

        started_at INTEGER,

        ended_at INTEGER,

        current_ball INTEGER,

        called_count INTEGER NOT NULL,

        ball_order TEXT NOT NULL

      )

    `);

    this.ctx.storage.sql.exec(`

      CREATE TABLE IF NOT EXISTS selected_cards (

        game_number INTEGER NOT NULL,

        telegram_id TEXT NOT NULL,

        card_number INTEGER NOT NULL,

        PRIMARY KEY(game_number, telegram_id, card_number)

      )

    `);

    this.ctx.storage.sql.exec(`

      CREATE TABLE IF NOT EXISTS balances (

        telegram_id TEXT PRIMARY KEY,

        balance REAL NOT NULL

      )

    `);

    this.ctx.storage.sql.exec(`

      CREATE TABLE IF NOT EXISTS transactions (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        telegram_id TEXT NOT NULL,

        method TEXT NOT NULL,

        type TEXT NOT NULL,

        amount REAL NOT NULL,

        created_at INTEGER NOT NULL

      )

    `);

    const row = this.ctx.storage.sql

      .exec(`SELECT * FROM state WHERE id = 1`)

      .toArray()[0];

    if (!row) {

      const t = Date.now();

      const gameNumber = 1;

      this.ctx.storage.sql.exec(

        `INSERT INTO state

        (id, game_number, status, lobby_started, started_at, ended_at, current_ball, called_count, ball_order)

        VALUES (1, ?, 'lobby', ?, NULL, NULL, NULL, 0, ?)`,

        gameNumber,

        t,

        JSON.stringify(makeBallOrder(gameNumber))

      );

      await this.ctx.storage.setAlarm(t + LOBBY_SECONDS * 1000);

    } else {

      const alarm = await this.ctx.storage.getAlarm();

      if (alarm === null) {

        await this.scheduleNext();

      }

    }

  }

  async getState() {

    return this.ctx.storage.sql

      .exec(`SELECT * FROM state WHERE id = 1`)

      .toArray()[0];

  }

  async getCalledBalls(state) {

    const order = JSON.parse(state.ball_order);

    return order.slice(0, state.called_count);

  }

  async scheduleNext() {

    const state = await this.getState();

    if (!state) return;

    const t = Date.now();

    if (state.status === "lobby") {

      const target = state.lobby_started + LOBBY_SECONDS * 1000;

      await this.ctx.storage.setAlarm(Math.max(t + 50, target));

      return;

    }

    if (state.status === "live") {

      const target =

        (state.started_at || t) +

        (state.called_count + 1) * BALL_INTERVAL;

      await this.ctx.storage.setAlarm(Math.max(t + 50, target));

    }

  }

  async alarm() {

    try {

      const state = await this.getState();

      if (!state) return;

      const t = Date.now();

      if (state.status === "lobby") {

        if (t < state.lobby_started + LOBBY_SECONDS * 1000) {

          await this.scheduleNext();

          return;

        }

        this.ctx.storage.sql.exec(

          `UPDATE state

           SET status='live',

               started_at=?,

               current_ball=NULL,

               called_count=0

           WHERE id=1`,

          t

        );

        await this.scheduleNext();

        return;

      }

      if (state.status === "live") {

        const order = JSON.parse(state.ball_order);

        if (state.called_count >= TOTAL_BALLS) {

          await this.startNextGame();

          return;

        }

        const nextIndex = state.called_count;

        const nextBall = order[nextIndex];

        this.ctx.storage.sql.exec(

          `UPDATE state

           SET current_ball=?,

               called_count=?

           WHERE id=1`,

          nextBall,

          nextIndex + 1

        );

        if (nextIndex + 1 >= TOTAL_BALLS) {

          await this.startNextGame();

          return;

        }

        await this.scheduleNext();

      }

    } catch (e) {

      await this.ctx.storage.setAlarm(Date.now() + 3500);

    }

  }

  async startNextGame() {

    const current = await this.getState();

    const nextGame = Number(current.game_number) + 1;

    const t = Date.now();

    this.ctx.storage.sql.exec(

      `DELETE FROM selected_cards WHERE game_number < ?`,

      nextGame

    );

    this.ctx.storage.sql.exec(

      `UPDATE state

       SET game_number=?,

           status='lobby',

           lobby_started=?,

           started_at=NULL,

           ended_at=?,

           current_ball=NULL,

           called_count=0,

           ball_order=?

       WHERE id=1`,

      nextGame,

      t,

      t,

      JSON.stringify(makeBallOrder(nextGame))

    );

    await this.ctx.storage.setAlarm(t + LOBBY_SECONDS * 1000);

  }

  async game() {

    const state = await this.getState();

    const called = await this.getCalledBalls(state);

    const remaining =

      state.status === "lobby"

        ? Math.max(

            0,

            Math.ceil(

              (state.lobby_started + LOBBY_SECONDS * 1000 - Date.now()) / 1000

            )

          )

        : 0;

    return {

      ok: true,

      gameNumber: state.game_number,

      status: state.status,

      lobbyRemaining: remaining,

      currentBall: state.current_ball,

      currentLetter: state.current_ball

        ? ballLetter(state.current_ball)

        : null,

      calledBalls: called,

      calledCount: called.length,

      nextGameStartsAutomatically: true

    };

  }

  async cards() {

    const state = await this.getState();

    return {

      ok: true,

      cards: Array.from({ length: CARD_COUNT }, (_, i) => ({

        number: i + 1,

        available: true

      })),

      gameNumber: state.game_number

    };

  }

  async selectCards(userId, cards) {

    const state = await this.getState();

    if (state.status !== "lobby") {

      return {

        ok: false,

        error: "GAME_IN_PROGRESS"

      };

    }

    const unique = [...new Set(cards.map(Number))];

    if (

      unique.length < 1 ||

      unique.length > MAX_CARDS_PER_PLAYER ||

      unique.some((n) => !cardNumberValid(n))

    ) {

      return {

        ok: false,

        error: "INVALID_CARDS"

      };

    }

    this.ctx.storage.sql.exec(

      `DELETE FROM selected_cards

       WHERE game_number=? AND telegram_id=?`,

      state.game_number,

      userId

    );

    for (const n of unique) {

      this.ctx.storage.sql.exec(

        `INSERT INTO selected_cards

         (game_number, telegram_id, card_number)

         VALUES (?, ?, ?)`,

        state.game_number,

        userId,

        n

      );

    }

    return {

      ok: true,

      selectedCards: unique,

      gameNumber: state.game_number

    };

  }

  async userCards(userId) {

    const state = await this.getState();

    const rows = this.ctx.storage.sql

      .exec(

        `SELECT card_number

         FROM selected_cards

         WHERE game_number=? AND telegram_id=?

         ORDER BY card_number`,

        state.game_number,

        userId

      )

      .toArray();

    return {

      ok: true,

      gameNumber: state.game_number,

      selectedCards: rows.map((r) => Number(r.card_number))

    };

  }

  async balance(userId) {

    let row = this.ctx.storage.sql

      .exec(

        `SELECT balance FROM balances WHERE telegram_id=?`,

        userId

      )

      .toArray()[0];

    if (!row) {

      this.ctx.storage.sql.exec(

        `INSERT INTO balances (telegram_id, balance)

         VALUES (?, ?)`,

        userId,

        PLAY_BALANCE_START

      );

      row = { balance: PLAY_BALANCE_START };

    }

    return {

      ok: true,

      balance: Number(row.balance)

    };

  }

  async walletRequest(userId, method, type, amount) {

    const value = Number(amount);

    if (!Number.isFinite(value) || value <= 0 || value > 1000000) {

      return {

        ok: false,

        error: "INVALID_AMOUNT"

      };

    }

    const methods = ["Telebirr", "eBirr", "M-PESA"];

    if (!methods.includes(method)) {

      return {

        ok: false,

        error: "INVALID_METHOD"

      };

    }

    if (type === "withdraw") {

      const current = await this.balance(userId);

      if (current.balance < value) {

        return {

          ok: false,

          error: "INSUFFICIENT_BALANCE"

        };

      }

      this.ctx.storage.sql.exec(

        `UPDATE balances

         SET balance=balance-?

         WHERE telegram_id=?`,

        value,

        userId

      );

    }

    if (type === "deposit") {

      this.ctx.storage.sql.exec(

        `INSERT INTO balances (telegram_id, balance)

         VALUES (?, ?)

         ON CONFLICT(telegram_id)

         DO UPDATE SET balance=balance+excluded.balance`,

        userId,

        value

      );

    }

    this.ctx.storage.sql.exec(

      `INSERT INTO transactions

       (telegram_id, method, type, amount, created_at)

       VALUES (?, ?, ?, ?, ?)`,

      userId,

      method,

      type,

      value,

      Date.now()

    );

    return await this.balance(userId);

  }

  async checkWinners(userId) {

    const state = await this.getState();

    const called = await this.getCalledBalls(state);

    if (state.status !== "live") {

      return {

        ok: false,

        error: "GAME_NOT_LIVE"

      };

    }

    const rows = this.ctx.storage.sql

      .exec(

        `SELECT card_number

         FROM selected_cards

         WHERE game_number=? AND telegram_id=?`,

        state.game_number,

        userId

      )

      .toArray();

    const winningCards = [];

    for (const row of rows) {

      const n = Number(row.card_number);

      const card = makeCard(n);

      if (hasTwoLines(card, called)) {

        winningCards.push(n);

      }

    }

    return {

      ok: true,

      winningCards,

      calledCount: called.length

    };

  }

  async fetch(request) {

    const url = new URL(request.url);

    const path = url.pathname;

    const user = getTelegramUser(request);

    if (path === "/game") {

      return json(await this.game());

    }

    if (path === "/cards") {

      return json(await this.cards());

    }

    if (path === "/user-cards") {

      return json(await this.userCards(user.id));

    }

    if (path === "/select-cards" && request.method === "POST") {

      const body = await request.json();

      return json(await this.selectCards(user.id, body.cards || []));

    }

    if (path === "/balance") {

      return json(await this.balance(user.id));

    }

    if (path === "/wallet" && request.method === "POST") {

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

    if (path === "/claim") {

      return json(await this.checkWinners(user.id));

    }

    return json({

      ok: true,

      service: APP_NAME

    });

  }

}

function pageHtml() {

  return `<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">

<meta name="theme-color" content="#070b16">

<title>Fast Bingo</title>

<script src="https://telegram.org/js/telegram-web-app.js"></script>

<style>

*{box-sizing:border-box}

html,body{margin:0;padding:0;background:#070b16;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}

body{min-height:100vh}

button{font:inherit}

.app{max-width:760px;margin:auto;padding:14px 12px 35px}

.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}

.brand{font-weight:900;font-size:22px}

.sub{font-size:11px;color:#8d96a8}

.balance{background:#121a2b;border:1px solid #25314a;border-radius:14px;padding:9px 12px;text-align:right}

.balance small{display:block;color:#8d96a8;font-size:10px}

.balance strong{font-size:15px}

.hero{background:linear-gradient(145deg,#151f34,#0c1220);border:1px solid #263653;border-radius:22px;padding:18px;margin-bottom:12px}

.status{font-size:12px;font-weight:900;letter-spacing:.5px;color:#8de6b1}

.status.live{color:#ffcc66}

.timer{font-size:34px;font-weight:950;margin:6px 0}

.message{color:#aeb8c9;font-size:13px;line-height:1.45}

.ballbox{text-align:center;background:#080d18;border:1px solid #25314a;border-radius:18px;padding:16px;margin-top:14px}

.ball{width:74px;height:74px;border-radius:50%;margin:auto;display:flex;align-items:center;justify-content:center;background:#d71920;font-size:30px;font-weight:950;box-shadow:0 10px 30px #0008}

.ball.empty{background:#202b40;color:#6d7890}

.ballletter{font-size:12px;color:#98a5b9;margin-top:8px;font-weight:800}

.tabs{display:flex;gap:7px;margin:12px 0}

.tab{flex:1;border:1px solid #27344d;background:#101827;color:#aeb8c9;border-radius:12px;padding:11px 7px;font-weight:800}

.tab.active{background:#d71920;color:white;border-color:#d71920}

.panel{background:#0d1422;border:1px solid #202d43;border-radius:18px;padding:14px;margin-bottom:12px}

.panel h3{margin:0 0 11px;font-size:16px}

.cardgrid{display:grid;grid-template-columns:repeat(10,1fr);gap:5px}

.cardbtn{border:1px solid #26334a;background:#111a2a;color:#dbe2ed;border-radius:7px;padding:7px 0;font-size:11px;font-weight:800}

.cardbtn.selected{background:#d71920;border-color:#ff4c51;color:white}

.cardbtn.disabled{opacity:.35}

.selected{display:flex;gap:7px;flex-wrap:wrap}

.pill{background:#182338;border:1px solid #293955;border-radius:999px;padding:6px 9px;font-size:11px}

.action{width:100%;border:0;border-radius:13px;padding:13px;background:#d71920;color:#fff;font-weight:900;margin-top:11px}

.action.secondary{background:#182338;border:1px solid #2a3a56}

.lang{display:flex;gap:8px}

.lang button{flex:1;border:1px solid #2a3851;background:#111a2a;color:#c7d0de;border-radius:11px;padding:9px}

.lang button.active{background:#d71920;color:#fff;border-color:#d71920}

.called{display:flex;flex-wrap:wrap;gap:5px;max-height:180px;overflow:auto}

.called span{width:31px;height:31px;border-radius:50%;background:#182238;border:1px solid #2a3954;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800}

.bingo-card{background:#111a2a;border:1px solid #2b3953;border-radius:14px;padding:9px}

.headrow,.grid5{display:grid;grid-template-columns:repeat(5,1fr);gap:4px}

.headrow div{text-align:center;font-weight:950;color:#d71920;padding:4px}

.cell{aspect-ratio:1;border-radius:6px;background:#182338;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900}

.cell.marked{background:#d71920;color:#fff}

.walletrow{display:flex;gap:7px}

.walletrow button{flex:1;background:#121d30;border:1px solid #293a57;color:#fff;border-radius:11px;padding:10px;font-weight:800}

input,select{width:100%;background:#0a111e;border:1px solid #2a3952;color:white;border-radius:11px;padding:11px;margin-top:8px;outline:none}

.notice{font-size:11px;color:#8f9caf;line-height:1.4;margin-top:8px}

.footer{text-align:center;color:#5f6b80;font-size:10px;margin-top:18px}

@media(max-width:520px){

.cardgrid{grid-template-columns:repeat(8,1fr)}

}

</style>

</head>

<body>

<div class="app">

  <div class="top">

    <div>

      <div class="brand">FAST BINGO</div>

      <div class="sub">75 BALL • LIVE ROOMS</div>

    </div>

    <div class="balance">

      <small>Play Balance</small>

      <strong id="balance">2,500.00 ETB</strong>

    </div>

  </div>

  <div class="hero">

    <div id="status" class="status">LOBBY</div>

    <div id="timer" class="timer">45</div>

    <div id="message" class="message">

      Choose up to 4 cards before the next game starts.

    </div>

    <div class="ballbox">

      <div id="ball" class="ball empty">—</div>

      <div id="ballletter" class="ballletter">WAITING</div>

    </div>

  </div>

  <div class="tabs">

    <button class="tab active" onclick="showTab('play')">🎱 Play</button>

    <button class="tab" onclick="showTab('wallet')">💵 Balance</button>

  </div>

  <section id="playTab">

    <div class="panel">

      <h3>Choose your cards</h3>

      <div id="selected" class="selected"></div>

      <button class="action" onclick="saveCards()">

        Save Selected Cards

      </button>

      <div class="notice">

        Up to 4 cards per player. Cards can be selected during the lobby.

      </div>

    </div>

    <div class="panel">

      <h3>400 Cards</h3>

      <div id="cards" class="cardgrid"></div>

    </div>

    <div class="panel">

      <h3>Called Balls</h3>

      <div id="called" class="called"></div>

    </div>

    <div class="panel">

      <h3>My Cards</h3>

      <div id="myCards"></div>

      <button class="action secondary" onclick="claim()">

        Check Bingo

      </button>

      <div id="claimResult" class="notice"></div>

    </div>

  </section>

  <section id="walletTab" style="display:none">

    <div class="panel">

      <h3>Play Balance</h3>

      <div class="walletrow">

        <button onclick="walletType='deposit'">Add Balance</button>

        <button onclick="walletType='withdraw'">Withdraw</button>

      </div>

      <select id="method">

        <option>Telebirr</option>

        <option>eBirr</option>

        <option>M-PESA</option>

      </select>

      <input id="amount" type="number" min="1" placeholder="Amount">

      <button class="action" onclick="walletRequest()">

        Submit Request

      </button>

      <div class="notice">

        This balance is for play only. No real money is transferred.

      </div>

      <div id="walletResult" class="notice"></div>

    </div>

    <div class="panel">

      <h3>Language</h3>

      <div class="lang">

        <button id="enBtn" class="active" onclick="setLanguage('en')">

          English

        </button>

        <button id="amBtn" onclick="setLanguage('am')">

          አማርኛ

        </button>

      </div>

    </div>

  </section>

  <div class="footer">

    Fast Bingo • 75 Ball

  </div>

</div>

<script>

const tg = window.Telegram && window.Telegram.WebApp

  ? window.Telegram.WebApp

  : null;

if (tg) {

  tg.ready();

  tg.expand();

}

const telegramUser =

  tg && tg.initDataUnsafe && tg.initDataUnsafe.user

    ? tg.initDataUnsafe.user

    : {

        id: "guest",

        first_name: "Player",

        username: ""

      };

const userHeader = JSON.stringify(telegramUser);

let selected = [];

let currentGame = null;

let walletType = "deposit";

let language = "en";

const translations = {

  en: {

    lobby: "LOBBY",

    live: "LIVE",

    wait: "Choose up to 4 cards before the next game starts.",

    liveMsg: "GAME IN PROGRESS",

    save: "Save Selected Cards",

    gameWait: "Game in progress. Please wait for the next lobby.",

    bingo: "BINGO!"

  },

  am: {

    lobby: "መጠበቂያ",

    live: "በመካሄድ ላይ",

    wait: "ጨዋታው ከመጀመሩ በፊት እስከ 4 ካርድ ይምረጡ።",

    liveMsg: "ጨዋታው በመካሄድ ላይ ነው",

    save: "የመረጥኳቸውን ካርዶች አስቀምጥ",

    gameWait: "ጨዋታው በመካሄድ ላይ ነው። ቀጣዩን መጠበቂያ ይጠብቁ።",

    bingo: "ቢንጎ!"

  }

};

function headers() {

  return {

    "content-type": "application/json",

    "x-telegram-user": userHeader

  };

}

async function api(path, options = {}) {

  options.headers = {

    ...(options.headers || {}),

    "x-telegram-user": userHeader

  };

  const r = await fetch(path, options);

  return await r.json();

}

async function loadCards() {

  const data = await api("/do/cards");

  const box = document.getElementById("cards");

  box.innerHTML = "";

  for (const card of data.cards) {

    const b = document.createElement("button");

    b.className = "cardbtn";

    b.textContent = card.number;

    if (selected.includes(card.number)) {

      b.classList.add("selected");

    }

    b.onclick = () => toggleCard(card.number);

    box.appendChild(b);

  }

}

function toggleCard(n) {

  if (selected.includes(n)) {

    selected = selected.filter(x => x !== n);

  } else {

    if (selected.length >= 4) {

      alert(

        language === "am"

          ? "ከ4 ካርድ በላይ መምረጥ አይችሉም።"

          : "You can select up to 4 cards."

      );

      return;

    }

    selected.push(n);

  }

  renderSelected();

  loadCards();

}

function renderSelected() {

  const box = document.getElementById("selected");

  box.innerHTML = selected.length

    ? selected

        .sort((a,b)=>a-b)

        .map(n => '<span class="pill">Card ' + n + '</span>')

        .join("")

    : '<span class="notice">No cards selected</span>';

}

async function saveCards() {

  if (!selected.length) {

    alert(

      language === "am"

        ? "ቢያንስ አንድ ካርድ ይምረጡ።"

        : "Select at least one card."

    );

    return;

  }

  const result = await api("/do/select-cards", {

    method: "POST",

    headers: {"content-type":"application/json"},

    body: JSON.stringify({cards:selected})

  });

  if (!result.ok) {

    alert(

      result.error === "GAME_IN_PROGRESS"

        ? translations[language].gameWait

        : "Unable to save cards."

    );

    return;

  }

  alert(

    language === "am"

      ? "ካርዶቹ ተቀምጠዋል።"

      : "Cards saved."

  );

  loadMyCards();

}

async function loadMyCards() {

  const data = await api("/do/user-cards");

  selected = data.selectedCards || [];

  renderSelected();

  const box = document.getElementById("myCards");

  box.innerHTML = "";

  for (const n of selected) {

    box.appendChild(renderBingoCard(n));

  }

}

function renderBingoCard(number) {

  const wrap = document.createElement("div");

  wrap.className = "bingo-card";

  wrap.style.marginBottom = "10px";

  const headers = document.createElement("div");

  headers.className = "headrow";

  ["B","I","N","G","O"].forEach(x => {

    const d = document.createElement("div");

    d.textContent = x;

    headers.appendChild(d);

  });

  wrap.appendChild(headers);

  const grid = document.createElement("div");

  grid.className = "grid5";

  const card = makeClientCard(number);

  const called = new Set(

    (currentGame && currentGame.calledBalls) || []

  );

  card.forEach(v => {

    const d = document.createElement("div");

    d.className = "cell";

    d.textContent = v;

    if (v === "FREE" || called.has(Number(v))) {

      d.classList.add("marked");

    }

    grid.appendChild(d);

  });

  wrap.appendChild(grid);

  return wrap;

}

function seededShuffle(arr, seed) {

  return shuffle(arr, seed);

}

function makeClientCard(number) {

  const seed = number * 9973;

  const B = seededShuffle(

    Array.from({length:15},(_,i)=>i+1),

    seed+1

  ).slice(0,5);

  const I = seededShuffle(

    Array.from({length:15},(_,i)=>i+16),

    seed+2

  ).slice(0,5);

  const N = seededShuffle(

    Array.from({length:15},(_,i)=>i+31),

    seed+3

  ).slice(0,5);

  const G = seededShuffle(

    Array.from({length:15},(_,i)=>i+46),

    seed+4

  ).slice(0,5);

  const O = seededShuffle(

    Array.from({length:15},(_,i)=>i+61),

    seed+5

  ).slice(0,5);

  return [

    B[0],I[0],N[0],G[0],O[0],

    B[1],I[1],N[1],G[1],O[1],

    B[2],I[2],"FREE",G[2],O[2],

    B[3],I[3],N[3],G[3],O[3],

    B[4],I[4],N[4],G[4],O[4]

  ];

}

async function refreshGame() {

  const data = await api("/do/game");

  currentGame = data;

  const status = document.getElementById("status");

  const timer = document.getElementById("timer");

  const message = document.getElementById("message");

  const ball = document.getElementById("ball");

  const letter = document.getElementById("ballletter");

  if (data.status === "lobby") {

    status.textContent = translations[language].lobby;

    status.className = "status";

    timer.textContent = data.lobbyRemaining;

    message.textContent = translations[language].wait;

    ball.className = "ball empty";

    ball.textContent = "—";

    letter.textContent = "WAITING";

  } else {

    status.textContent = translations[language].live;

    status.className = "status live";

    timer.textContent = "LIVE";

    message.textContent = translations[language].liveMsg;

    if (data.currentBall) {

      ball.className = "ball";

      ball.textContent = data.currentBall;

      letter.textContent = data.currentLetter;

    }

  }

  const called = document.getElementById("called");

  called.innerHTML = (data.calledBalls || [])

    .slice()

    .reverse()

    .map(

      n => '<span>' + n + '</span>'

    )

    .join("");

  loadMyCards();

}

async function loadBalance() {

  const data = await api("/do/balance");

  document.getElementById("balance").textContent =

    Number(data.balance || 0).toLocaleString(

      undefined,

      {

        minimumFractionDigits:2,

        maximumFractionDigits:2

      }

    ) + " ETB";

}

async function walletRequest() {

  const amount = Number(

    document.getElementById("amount").value

  );

  const method =

    document.getElementById("method").value;

  if (!amount || amount <= 0) {

    alert("Enter an amount.");

    return;

  }

  const result = await api("/do/wallet", {

    method:"POST",

    headers:{"content-type":"application/json"},

    body:JSON.stringify({

      method,

      type:walletType,

      amount

    })

  });

  if (!result.ok) {

    document.getElementById("walletResult").textContent =

      result.error || "Request failed.";

    return;

  }

  document.getElementById("walletResult").textContent =

    language === "am"

      ? "የጨዋታ ሂሳብዎ ተሻሽሏል።"

      : "Play balance updated.";

  document.getElementById("amount").value = "";

  loadBalance();

}

async function claim() {

  const result = await api("/do/claim");

  const box = document.getElementById("claimResult");

  if (!result.ok) {

    box.textContent =

      language === "am"

        ? "ጨዋታው እስካሁን አልጀመረም።"

        : "The game is not live yet.";

    return;

  }

  if (result.winningCards && result.winningCards.length) {

    box.textContent =

      language === "am"

        ? translations.am.bingo + " • Card " +

          result.winningCards.join(", ")

        : translations.en.bingo + " • Card " +

          result.winningCards.join(", ");

  } else {

    box.textContent =

      language === "am"

        ? "እስካሁን 2 መስመር አልሞላም።"

        : "You do not have two completed lines yet.";

  }

}

function showTab(tab) {

  document.getElementById("playTab").style.display =

    tab === "play" ? "block" : "none";

  document.getElementById("walletTab").style.display =

    tab === "wallet" ? "block" : "none";

  document.querySelectorAll(".tab").forEach((b,i)=>{

    b.classList.toggle(

      "active",

      (tab === "play" && i === 0) ||

      (tab === "wallet" && i === 1)

    );

  });

}

function setLanguage(l) {

  language = l;

  document.getElementById("enBtn")

    .classList.toggle("active", l === "en");

  document.getElementById("amBtn")

    .classList.toggle("active", l === "am");

  refreshGame();

}

async function boot() {

  await loadBalance();

  await loadCards();

  await refreshGame();

  setInterval(refreshGame, 1500);

  setInterval(loadBalance, 5000);

}

boot();

</script>

</body>

</html>`;

}

async function proxyToGame(request, env, path) {

  const id = env.GAME_SCHEDULER.idFromName("main-game");

  const stub = env.GAME_SCHEDULER.get(id);

  const user = getTelegramUser(request);

  const headers = new Headers(request.headers);

  headers.set("x-telegram-user", JSON.stringify(user));

  const newRequest = new Request(

    new URL(path, request.url),

    {

      method: request.method,

      headers,

      body:

        request.method === "GET" || request.method === "HEAD"

          ? undefined

          : await request.arrayBuffer()

    }

  );

  return await stub.fetch(newRequest);

}

export default {

  async fetch(request, env) {

    const url = new URL(request.url);

    try {

      if (url.pathname === "/health") {

        return json({

          ok: true,

          service: APP_NAME,

          status: "online"

        });

      }

      if (url.pathname === "/api/game") {

        return proxyToGame(request, env, "/game");

      }

      if (url.pathname === "/api/cards") {

        return proxyToGame(request, env, "/cards");

      }

      if (url.pathname === "/api/user-cards") {

        return proxyToGame(request, env, "/user-cards");

      }

      if (url.pathname === "/api/select-cards") {

        return proxyToGame(request, env, "/select-cards");

      }

      if (url.pathname === "/api/balance") {

        return proxyToGame(request, env, "/balance");

      }

      if (url.pathname === "/api/wallet") {

        return proxyToGame(request, env, "/wallet");

      }

      if (url.pathname === "/api/claim") {

        return proxyToGame(request, env, "/claim");

      }

      if (url.pathname === "/do/game") {

        return proxyToGame(request, env, "/game");

      }

      if (url.pathname === "/do/cards") {

        return proxyToGame(request, env, "/cards");

      }

      if (url.pathname === "/do/user-cards") {

        return proxyToGame(request, env, "/user-cards");

      }

      if (url.pathname === "/do/select-cards") {

        return proxyToGame(request, env, "/select-cards");

      }

      if (url.pathname === "/do/balance") {

        return proxyToGame(request, env, "/balance");

      }

      if (url.pathname === "/do/wallet") {

        return proxyToGame(request, env, "/wallet");

      }

      if (url.pathname === "/do/claim") {

        return proxyToGame(request, env, "/claim");

      }

      if (url.pathname === "/favicon.ico") {

        return new Response("", {status:204});

      }

      return html(pageHtml());

    } catch (error) {

      return json({

        ok: false,

        error: String(error)

      }, 500);

    }

  }

};

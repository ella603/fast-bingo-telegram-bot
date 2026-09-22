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

        (

          id,

          game_number,

          status,

          lobby_started,

          started_at,

          ended_at,

          current_ball,

          called_count,

          ball_order

        )

        VALUES (1, ?, 'lobby', ?, NULL, NULL, NULL, 0, ?)`,

        gameNumber,

        t,

        JSON.stringify(makeBallOrder(gameNumber))

      );

      await this.ctx.storage.setAlarm(

        t + LOBBY_SECONDS * 1000

      );

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

      const target =

        state.lobby_started +

        LOBBY_SECONDS * 1000;

      await this.ctx.storage.setAlarm(

        Math.max(t + 50, target)

      );

      return;

    }

    if (state.status === "live") {

      const target =

        (state.started_at || t) +

        (state.called_count + 1) *

        BALL_INTERVAL;

      await this.ctx.storage.setAlarm(

        Math.max(t + 50, target)

      );

    }

  }

  async alarm() {

    try {

      const state = await this.getState();

      if (!state) return;

      const t = Date.now();

      if (state.status === "lobby") {

        if (

          t <

          state.lobby_started +

          LOBBY_SECONDS * 1000

        ) {

          await this.scheduleNext();

          return;

        }

        this.ctx.storage.sql.exec(

          `UPDATE state

           SET

             status='live',

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

        const order = JSON.parse(

          state.ball_order

        );

        if (

          state.called_count >= TOTAL_BALLS

        ) {

          await this.startNextGame();

          return;

        }

        const nextIndex =

          state.called_count;

        const nextBall =

          order[nextIndex];

        this.ctx.storage.sql.exec(

          `UPDATE state

           SET

             current_ball=?,

             called_count=?

           WHERE id=1`,

          nextBall,

          nextIndex + 1

        );

        if (

          nextIndex + 1 >= TOTAL_BALLS

        ) {

          await this.startNextGame();

          return;

        }

        await this.scheduleNext();

      }

    } catch (e) {

      await this.ctx.storage.setAlarm(

        Date.now() + 3500

      );

    }

  }

  async startNextGame() {

    const current = await this.getState();

    const nextGame =

      Number(current.game_number) + 1;

    const t = Date.now();

    this.ctx.storage.sql.exec(

      `DELETE FROM selected_cards

       WHERE game_number < ?`,

      nextGame

    );

    this.ctx.storage.sql.exec(

      `UPDATE state

       SET

         game_number=?,

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

      JSON.stringify(

        makeBallOrder(nextGame)

      )

    );

    await this.ctx.storage.setAlarm(

      t + LOBBY_SECONDS * 1000

    );

  }

  async game() {

    const state = await this.getState();

    const called =

      await this.getCalledBalls(state);

    const remaining =

      state.status === "lobby"

        ? Math.max(

            0,

            Math.ceil(

              (

                state.lobby_started +

                LOBBY_SECONDS * 1000 -

                Date.now()

              ) / 1000

            )

          )

        : 0;

    return {

      ok: true,

      gameNumber: state.game_number,

      status: state.status,

      lobbyRemaining: remaining,

      currentBall: state.current_ball,

      currentLetter:

        state.current_ball

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

      cards: Array.from(

        { length: CARD_COUNT },

        (_, i) => ({

          number: i + 1,

          available: true

        })

      ),

      gameNumber:

        state.game_number

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

    const unique = [

      ...new Set(

        cards.map(Number)

      )

    ];

    if (

      unique.length < 1 ||

      unique.length >

        MAX_CARDS_PER_PLAYER ||

      unique.some(

        n => !cardNumberValid(n)

      )

    ) {

      return {

        ok: false,

        error: "INVALID_CARDS"

      };

    }

    this.ctx.storage.sql.exec(

      `DELETE FROM selected_cards

       WHERE game_number=?

       AND telegram_id=?`,

      state.game_number,

      userId

    );

    for (const n of unique) {

      this.ctx.storage.sql.exec(

        `INSERT INTO selected_cards

         (

           game_number,

           telegram_id,

           card_number

         )

         VALUES (?, ?, ?)`,

        state.game_number,

        userId,

        n

      );

    }

    return {

      ok: true,

      selectedCards: unique,

      gameNumber:

        state.game_number

    };

  }

  async userCards(userId) {

    const state =

      await this.getState();

    const rows =

      this.ctx.storage.sql

        .exec(

          `SELECT card_number

           FROM selected_cards

           WHERE game_number=?

           AND telegram_id=?

           ORDER BY card_number`,

          state.game_number,

          userId

        )

        .toArray();

    return {

      ok: true,

      gameNumber:

        state.game_number,

      selectedCards:

        rows.map(

          r => Number(r.card_number)

        )

    };

  }

  async balance(userId) {

    let row =

      this.ctx.storage.sql

        .exec(

          `SELECT balance

           FROM balances

           WHERE telegram_id=?`,

          userId

        )

        .toArray()[0];

    if (!row) {

      this.ctx.storage.sql.exec(

        `INSERT INTO balances

         (telegram_id, balance)

         VALUES (?, ?)`,

        userId,

        PLAY_BALANCE_START

      );

      row = {

        balance:

          PLAY_BALANCE_START

      };

    }

    return {

      ok: true,

      balance:

        Number(row.balance)

    };

  }

  async walletRequest(

    userId,

    method,

    type,

    amount

  ) {

    const value =

      Number(amount);

    if (

      !Number.isFinite(value) ||

      value <= 0 ||

      value > 1000000

    ) {

      return {

        ok: false,

        error: "INVALID_AMOUNT"

      };

    }

    const methods = [

      "Telebirr",

      "eBirr",

      "M-PESA"

    ];

    if (!methods.includes(method)) {

      return {

        ok: false,

        error: "INVALID_METHOD"

      };

    }

    if (type === "withdraw") {

      const current =

        await this.balance(userId);

      if (

        current.balance < value

      ) {

        return {

          ok: false,

          error:

            "INSUFFICIENT_BALANCE"

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

        `INSERT INTO balances

         (telegram_id, balance)

         VALUES (?, ?)

         ON CONFLICT(telegram_id)

         DO UPDATE SET

           balance=

           balance+

           excluded.balance`,

        userId,

        value

      );

    }

    this.ctx.storage.sql.exec(

      `INSERT INTO transactions

       (

         telegram_id,

         method,

         type,

         amount,

         created_at

       )

       VALUES (?, ?, ?, ?, ?)`,

      userId,

      method,

      type,

      value,

      Date.now()

    );

    return await this.balance(

      userId

    );

  }

  async checkWinners(userId) {

    const state =

      await this.getState();

    const called =

      await this.getCalledBalls(

        state

      );

    if (

      state.status !== "live"

    ) {

      return {

        ok: false,

        error: "GAME_NOT_LIVE"

      };

    }

    const rows =

      this.ctx.storage.sql

        .exec(

          `SELECT card_number

           FROM selected_cards

           WHERE game_number=?

           AND telegram_id=?`,

          state.game_number,

          userId

        )

        .toArray();

    const winningCards = [];

    for (const row of rows) {

      const n =

        Number(row.card_number);

      const card =

        makeCard(n);

      if (

        hasTwoLines(

          card,

          called

        )

      ) {

        winningCards.push(n);

      }

    }

    return {

      ok: true,

      winningCards,

      calledCount:

        called.length

    };

  }

  async fetch(request) {

    const url =

      new URL(request.url);

    const path =

      url.pathname;

    const user =

      getTelegramUser(request);

    if (path === "/game") {

      return json(

        await this.game()

      );

    }

    if (path === "/cards") {

      return json(

        await this.cards()

      );

    }

    if (

      path === "/user-cards"

    ) {

      return json(

        await this.userCards(

          user.id

        )

      );

    }

    if (

      path === "/select-cards" &&

      request.method === "POST"

    ) {

      const body =

        await request.json();

      return json(

        await this.selectCards(

          user.id,

          body.cards || []

        )

      );

    }

    if (path === "/balance") {

      return json(

        await this.balance(

          user.id

        )

      );

    }

    if (

      path === "/wallet" &&

      request.method === "POST"

    ) {

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

    if (path === "/claim") {

      return json(

        await this.checkWinners(

          user.id

        )

      );

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

<meta

  name="viewport"

  content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"

>

<meta

  name="theme-color"

  content="#07090d"

>

<title>Fast Bingo</title>

<script src="https://telegram.org/js/telegram-web-app.js"></script>

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

}

*{

  box-sizing:border-box;

  -webkit-tap-highlight-color:transparent;

}

html{

  margin:0;

  padding:0;

  background:var(--bg);

}

body{

  margin:0;

  padding:0;

  min-height:100vh;

  background:

    radial-gradient(

      circle at 50% -10%,

      #263247 0,

      #111722 28%,

      var(--bg) 58%

    );

  color:var(--text);

  font-family:

    -apple-system,

    BlinkMacSystemFont,

    "Segoe UI",

    Arial,

    sans-serif;

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

  max-width:820px;

  margin:0 auto;

  padding:

    14px

    12px

    100px;

}

/* TOP BAR */

.topbar{

  display:flex;

  align-items:center;

  justify-content:space-between;

  gap:10px;

  margin-bottom:14px;

}

.brandWrap{

  display:flex;

  align-items:center;

  gap:10px;

  min-width:0;

}

.logo{

  width:44px;

  height:44px;

  border-radius:13px;

  display:flex;

  align-items:center;

  justify-content:center;

  background:

    linear-gradient(

      145deg,

      var(--red2),

      #a90008

    );

  box-shadow:

    0 8px 25px #e5091438;

  font-size:21px;

  flex:none;

}

.brand{

  font-size:19px;

  line-height:1;

  font-weight:950;

  letter-spacing:.5px;

}

.subtitle{

  margin-top:5px;

  font-size:10px;

  color:var(--muted);

  letter-spacing:.7px;

  font-weight:700;

}

.balanceMini{

  background:

    linear-gradient(

      145deg,

      #171e2a,

      #0e131c

    );

  border:1px solid var(--line);

  border-radius:14px;

  padding:8px 11px;

  text-align:right;

  min-width:112px;

}

.balanceMini span{

  display:block;

  color:var(--muted);

  font-size:9px;

  font-weight:700;

}

.balanceMini strong{

  display:block;

  margin-top:2px;

  font-size:13px;

}

/* HERO */

.hero{

  position:relative;

  overflow:hidden;

  border-radius:25px;

  border:1px solid #293344;

  background:

    linear-gradient(

      145deg,

      #171d28,

      #0d1118

    );

  box-shadow:

    0 18px 45px #00000070;

  padding:17px;

  margin-bottom:13px;

}

.heroGlow{

  position:absolute;

  width:190px;

  height:190px;

  right:-75px;

  top:-90px;

  border-radius:50%;

  background:#e5091428;

  filter:blur(4px);

  pointer-events:none;

}

.heroTop{

  position:relative;

  display:flex;

  align-items:center;

  justify-content:space-between;

  gap:12px;

}

.statusBadge{

  display:inline-flex;

  align-items:center;

  gap:7px;

  padding:7px 10px;

  border-radius:999px;

  background:#19221f;

  color:var(--green);

  border:1px solid #29463a;

  font-size:10px;

  font-weight:950;

  letter-spacing:.6px;

}

.statusDot{

  width:7px;

  height:7px;

  border-radius:50%;

  background:currentColor;

  box-shadow:0 0 10px currentColor;

}

.statusBadge.live{

  background:#2a2020;

  color:#ff6d72;

  border-color:#4d292d;

}

.gameNumber{

  color:var(--muted);

  font-size:10px;

  font-weight:800;

}

.heroTitle{

  position:relative;

  margin-top:13px;

  font-size:25px;

  font-weight:950;

  letter-spacing:-.5px;

}

.heroMessage{

  position:relative;

  margin-top:4px;

  color:#9da7b7;

  font-size:12px;

  line-height:1.45;

}

.countdown{

  position:relative;

  display:flex;

  align-items:center;

  justify-content:center;

  margin:16px 0 4px;

}

.countNumber{

  font-size:48px;

  line-height:1;

  font-weight:950;

  letter-spacing:-2px;

}

.countLabel{

  margin-left:8px;

  color:var(--muted);

  font-size:11px;

  font-weight:850;

  text-transform:uppercase;

}

/* CURRENT BALL */

.ballStage{

  position:relative;

  margin-top:16px;

  padding:16px;

  border-radius:20px;

  background:

    linear-gradient(

      180deg,

      #0a0e15,

      #080b11

    );

  border:1px solid #222b3a;

  text-align:center;

}

.ballCaption{

  color:#707b8d;

  font-size:9px;

  font-weight:900;

  letter-spacing:1.2px;

  margin-bottom:10px;

}

.ballCircle{

  width:92px;

  height:92px;

  margin:0 auto;

  border-radius:50%;

  display:flex;

  align-items:center;

  justify-content:center;

  background:

    radial-gradient(

      circle at 34% 25%,

      #ff5b61,

      #e50914 47%,

      #990006 100%

    );

  border:5px solid #ffffff;

  box-shadow:

    0 0 0 6px #e5091422,

    0 14px 35px #000000aa;

  font-size:31px;

  font-weight:950;

}

.ballCircle.empty{

  background:

    radial-gradient(

      circle at 35% 25%,

      #354052,

      #1c2533 55%,

      #10151e

    );

  color:#697486;

  border-color:#465163;

  box-shadow:none;

}

.ballInfo{

  margin-top:9px;

  color:#c2cad6;

  font-size:11px;

  font-weight:900;

}

/* TICKER */

.ballTicker{

  display:flex;

  align-items:center;

  gap:8px;

  overflow:hidden;

  margin-top:12px;

}

.tickerLabel{

  flex:none;

  color:#6f798b;

  font-size:9px;

  font-weight:900;

  letter-spacing:.8px;

}

.tickerBalls{

  display:flex;

  gap:5px;

  overflow:hidden;

}

.tickerBall{

  flex:none;

  min-width:29px;

  height:29px;

  padding:0 7px;

  display:flex;

  align-items:center;

  justify-content:center;

  border-radius:50%;

  background:#1a2230;

  border:1px solid #2b3749;

  font-size:9px;

  font-weight:900;

}

.tickerBall.latest{

  background:var(--red);

  border-color:#ff5459;

}

/* QUICK STATS */

.quickStats{

  display:grid;

  grid-template-columns:

    repeat(3,1fr);

  gap:7px;

  margin-bottom:13px;

}

.statBox{

  background:#10151e;

  border:1px solid #222c3b;

  border-radius:15px;

  padding:11px;

  text-align:center;

}

.statBox strong{

  display:block;

  font-size:16px;

  font-weight:950;

}

.statBox span{

  display:block;

  margin-top:3px;

  color:var(--muted);

  font-size:8px;

  font-weight:800;

}

/* NAV */

.nav{

  position:sticky;

  top:7px;

  z-index:20;

  display:grid;

  grid-template-columns:

    repeat(3,1fr);

  gap:6px;

  padding:6px;

  margin-bottom:13px;

  background:#0d121aee;

  border:1px solid #252f3f;

  border-radius:17px;

  backdrop-filter:blur(18px);

}

.navBtn{

  border:0;

  border-radius:12px;

  padding:10px 5px;

  color:#8d98a9;

  background:transparent;

  font-size:10px;

  font-weight:900;

}

.navBtn.active{

  color:#fff;

  background:var(--red);

  box-shadow:0 5px 16px #e5091435;

}

/* PANELS */

.panel{

  background:

    linear-gradient(

      145deg,

      #111720,

      #0c1118

    );

  border:1px solid #222c3b;

  border-radius:20px;

  padding:14px;

  margin-bottom:12px;

}

.panelHeader{

  display:flex;

  align-items:center;

  justify-content:space-between;

  gap:10px;

  margin-bottom:12px;

}

.panelTitle{

  font-size:15px;

  font-weight:950;

}

.panelHint{

  color:#687386;

  font-size:9px;

  font-weight:800;

}

/* CARD SELECTION */

.selectionTop{

  display:flex;

  align-items:center;

  justify-content:space-between;

  gap:8px;

  margin-bottom:10px;

}

.selectionCount{

  color:#aab4c3;

  font-size:11px;

  font-weight:800;

}

.selectionCount strong{

  color:#fff;

}

.selectedPills{

  display:flex;

  gap:5px;

  flex-wrap:wrap;

  margin-bottom:11px;

}

.pill{

  display:inline-flex;

  align-items:center;

  padding:6px 9px;

  border-radius:999px;

  background:#242d3b;

  border:1px solid #344155;

  color:#e7ebf2;

  font-size:9px;

  font-weight:900;

}

.cardGrid{

  display:grid;

  grid-template-columns:

    repeat(10,1fr);

  gap:5px;

}

.cardBtn{

  min-width:0;

  border:1px solid #293445;

  border-radius:8px;

  background:#141b26;

  color:#b9c2d0;

  padding:8px 2px;

  font-size:9px;

  font-weight:950;

}

.cardBtn:active{

  transform:scale(.95);

}

.cardBtn.selected{

  background:

    linear-gradient(

      145deg,

      #f0141e,

      #b9060d

    );

  border-color:#ff555b;

  color:#fff;

  box-shadow:0 4px 12px #e5091435;

}

/* ACTION BUTTON */

.primaryBtn{

  width:100%;

  border:0;

  border-radius:14px;

  padding:13px 14px;

  margin-top:11px;

  background:

    linear-gradient(

      145deg,

      #f20d18,

      #bf050d

    );

  color:#fff;

  font-size:12px;

  font-weight:950;

  box-shadow:

    0 8px 20px #e5091435;

}

.primaryBtn:active{

  transform:scale(.985);

}

.secondaryBtn{

  width:100%;

  border:1px solid #2c384a;

  border-radius:14px;

  padding:12px 14px;

  margin-top:9px;

  background:#171f2b;

  color:#e1e6ed;

  font-size:11px;

  font-weight:900;

}

/* BINGO CARD */

.myCards{

  display:flex;

  flex-direction:column;

  gap:10px;

}

.bingoCard{

  background:#0b1017;

  border:1px solid #2a3546;

  border-radius:17px;

  padding:10px;

}

.cardHeader{

  display:flex;

  align-items:center;

  justify-content:space-between;

  margin-bottom:7px;

}

.cardName{

  font-size:11px;

  font-weight:950;

}

.cardState{

  color:#6f7b8d;

  font-size:8px;

  font-weight:900;

}

.bingoHead,

.bingoGrid{

  display:grid;

  grid-template-columns:

    repeat(5,1fr);

  gap:4px;

}

.bingoHead div{

  text-align:center;

  color:var(--red2);

  font-size:11px;

  font-weight:950;

  padding:3px 0;

}

.bingoCell{

  aspect-ratio:1;

  display:flex;

  align-items:center;

  justify-content:center;

  border-radius:7px;

  background:#192231;

  border:1px solid #263244;

  color:#dce2ea;

  font-size:12px;

  font-weight:950;

}

.bingoCell.marked{

  background:

    linear-gradient(

      145deg,

      #ef111b,

      #b5060d

    );

  border-color:#ff555a;

  color:#fff;

  box-shadow:

    inset 0 0 0 1px #ffffff12;

}

.bingoCell.free{

  background:#2a303c;

  color:#ffc857;

  border-color:#4b4431;

  font-size:8px;

}

/* CALLED BALLS */

.calledGrid{

  display:grid;

  grid-template-columns:

    repeat(10,1fr);

  gap:6px;

  max-height:235px;

  overflow:auto;

  padding-right:2px;

}

.calledItem{

  height:32px;

  display:flex;

  align-items:center;

  justify-content:center;

  border-radius:50%;

  background:#171f2b;

  border:1px solid #2a3749;

  color:#bac4d2;

  font-size:9px;

  font-weight:950;

}

.calledItem.latest{

  background:var(--red);

  border-color:#ff5b60;

  color:#fff;

}

/* WINNER */

.claimBox{

  text-align:center;

  padding:14px;

  border-radius:16px;

  background:#101720;

  border:1px solid #263345;

}

.claimIcon{

  font-size:32px;

  margin-bottom:5px;

}

.claimTitle{

  font-size:16px;

  font-weight:950;

}

.claimText{

  margin-top:4px;

  color:#8995a7;

  font-size:10px;

  line-height:1.4;

}

/* WALLET */

.walletBalance{

  text-align:center;

  padding:19px;

  border-radius:18px;

  background:

    radial-gradient(

      circle at 50% 0,

      #273246,

      #121821 62%

    );

  border:1px solid #2b3748;

}

.walletLabel{

  color:#7e899a;

  font-size:9px;

  font-weight:900;

  letter-spacing:.8px;

}

.walletAmount{

  margin-top:5px;

  font-size:30px;

  font-weight:950;

}

.walletCurrency{

  color:#8e99a9;

  font-size:10px;

  font-weight:800;

}

.walletActions{

  display:grid;

  grid-template-columns:

    repeat(2,1fr);

  gap:7px;

  margin-top:12px;

}

.walletAction{

  border:1px solid #2b384b;

  border-radius:13px;

  padding:12px 7px;

  background:#171f2b;

  color:#e8ecf2;

  font-size:10px;

  font-weight:900;

}

.walletAction.active{

  background:#e50914;

  border-color:#ff4b51;

  color:#fff;

}

.field{

  width:100%;

  margin-top:8px;

  padding:12px;

  border-radius:12px;

  border:1px solid #2a3749;

  background:#0b1017;

  color:#fff;

  outline:none;

  font-size:12px;

}

.field:focus{

  border-color:#d92a31;

}

.notice{

  margin-top:8px;

  color:#6f7b8d;

  font-size:9px;

  line-height:1.5;

}

/* LANGUAGE */

.languageGrid{

  display:grid;

  grid-template-columns:

    repeat(2,1fr);

  gap:7px;

}

.languageBtn{

  border:1px solid #2b3749;

  border-radius:12px;

  padding:11px;

  background:#171f2b;

  color:#aeb8c7;

  font-size:10px;

  font-weight:900;

}

.languageBtn.active{

  background:#e50914;

  color:#fff;

  border-color:#ff4c52;

}

/* HOME INFO */

.infoGrid{

  display:grid;

  grid-template-columns:

    repeat(2,1fr);

  gap:7px;

}

.infoCard{

  background:#151c27;

  border:1px solid #263244;

  border-radius:14px;

  padding:11px;

}

.infoCard strong{

  display:block;

  font-size:11px;

}

.infoCard span{

  display:block;

  margin-top:4px;

  color:#768294;

  font-size:8px;

  line-height:1.35;

}

/* EMPTY */

.empty{

  padding:24px 10px;

  text-align:center;

  color:#697587;

  font-size:10px;

  font-weight:800;

}

/* BOTTOM BAR */

.bottomBar{

  position:fixed;

  left:50%;

  bottom:8px;

  transform:translateX(-50%);

  width:

    min(

      calc(100% - 20px),

      620px

    );

  z-index:30;

  display:flex;

  align-items:center;

  justify-content:space-around;

  gap:4px;

  padding:6px;

  background:#0d121bee;

  border:1px solid #283344;

  border-radius:18px;

  backdrop-filter:blur(20px);

  box-shadow:

    0 10px 35px #00000080;

}

.bottomBtn{

  flex:1;

  border:0;

  border-radius:12px;

  padding:9px 4px;

  background:transparent;

  color:#727d8e;

  font-size:9px;

  font-weight:900;

}

.bottomBtn.active{

  background:#1d2532;

  color:#fff;

}

.bottomIcon{

  display:block;

  font-size:15px;

  margin-bottom:2px;

}

/* TOAST */

.toast{

  position:fixed;

  left:50%;

  bottom:78px;

  transform:

    translate(-50%,15px);

  z-index:100;

  opacity:0;

  pointer-events:none;

  background:#202a38;

  border:1px solid #354257;

  color:#fff;

  border-radius:12px;

  padding:10px 14px;

  font-size:10px;

  font-weight:850;

  transition:

    opacity .2s ease,

    transform .2s ease;

  max-width:

    calc(100% - 40px);

  text-align:center;

}

.toast.show{

  opacity:1;

  transform:

    translate(-50%,0);

}

/* RESPONSIVE */

@media(max-width:600px){

  .app{

    padding-left:10px;

    padding-right:10px;

  }

  .cardGrid{

    grid-template-columns:

      repeat(8,1fr);

  }

  .calledGrid{

    grid-template-columns:

      repeat(8,1fr);

  }

}

@media(max-width:380px){

  .logo{

    width:40px;

    height:40px;

  }

  .brand{

    font-size:17px;

  }

  .balanceMini{

    min-width:100px;

  }

  .cardGrid{

    grid-template-columns:

      repeat(7,1fr);

  }

  .calledGrid{

    grid-template-columns:

      repeat(7,1fr);

  }

}

</style>

</head>

<body>

<div class="app">

  <div class="topbar">

    <div class="brandWrap">

      <div class="logo">🎱</div>

      <div>

        <div class="brand">

          FAST BINGO

        </div>

        <div class="subtitle">

          75 BALL • LIVE BINGO

        </div>

      </div>

    </div>

    <div class="balanceMini">

      <span id="balanceLabel">

        Play Balance

      </span>

      <strong id="balance">

        2,500.00 ETB

      </strong>

    </div>

  </div>

  <div class="hero">

    <div class="heroGlow"></div>

    <div class="heroTop">

      <div

        id="statusBadge"

        class="statusBadge"

      >

        <span class="statusDot"></span>

        <span id="status">

          LOBBY

        </span>

      </div>

      <div

        id="gameNumber"

        class="gameNumber"

      >

        GAME #1

      </div>

    </div>

    <div

      id="heroTitle"

      class="heroTitle"

    >

      Next game starts soon

    </div>

    <div

      id="message"

      class="heroMessage"

    >

      Choose up to 4 cards before the game starts.

    </div>

    <div class="countdown">

      <div

        id="timer"

        class="countNumber"

      >

        45

      </div>

      <div

        id="timerLabel"

        class="countLabel"

      >

        seconds

      </div>

    </div>

    <div class="ballStage">

      <div class="ballCaption">

        CURRENT BALL

      </div>

      <div

        id="ball"

        class="ballCircle empty"

      >

        —

      </div>

      <div

        id="ballletter"

        class="ballInfo"

      >

        WAITING FOR THE GAME

      </div>

    </div>

    <div class="ballTicker">

      <div class="tickerLabel">

        RECENT

      </div>

      <div

        id="tickerBalls"

        class="tickerBalls"

      ></div>

    </div>

  </div>

  <div class="quickStats">

    <div class="statBox">

      <strong id="calledCount">

        0

      </strong>

      <span>

        BALLS CALLED

      </span>

    </div>

    <div class="statBox">

      <strong>

        400

      </strong>

      <span>

        CARDS

      </span>

    </div>

    <div class="statBox">

      <strong>

        4

      </strong>

      <span>

        MAX / PLAYER

      </span>

    </div>

  </div>

  <div class="nav">

    <button

      class="navBtn active"

      onclick="showSection('play',this)"

    >

      🎱 PLAY

    </button>

    <button

      class="navBtn"

      onclick="showSection('cardsSection',this)"

    >

      🎟 CARDS

    </button>

    <button

      class="navBtn"

      onclick="showSection('wallet',this)"

    >

      💵 BALANCE

    </button>

  </div>

  <section

    id="play"

    class="section"

  >

    <div class="panel">

      <div class="panelHeader">

        <div class="panelTitle">

          Your game

        </div>

        <div

          id="playHint"

          class="panelHint"

        >

          SELECT CARDS

        </div>

      </div>

      <div class="infoGrid">

        <div class="infoCard">

          <strong>

            75 Ball Bingo

          </strong>

          <span>

            B 1–15 · I 16–30 · N 31–45 · G 46–60 · O 61–75

          </span>

        </div>

        <div class="infoCard">

          <strong>

            2 Lines

          </strong>

          <span>

            Complete two lines to claim Bingo.

          </span>

        </div>

      </div>

    </div>

    <div class="panel">

      <div class="panelHeader">

        <div class="panelTitle">

          My Cards

        </div>

        <div

          id="myCardCount"

          class="panelHint"

        >

          0 / 4

        </div>

      </div>

      <div

        id="myCards"

        class="myCards"

      >

        <div class="empty">

          Select your cards below.

        </div>

      </div>

      <button

        class="secondaryBtn"

        onclick="claim()"

      >

        🏆 CHECK BINGO

      </button>

      <div

        id="claimResult"

        class="notice"

      ></div>

    </div>

    <div class="panel">

      <div class="panelHeader">

        <div class="panelTitle">

          Called Balls

        </div>

        <div

          id="calledTitle"

          class="panelHint"

        >

          0 / 75

        </div>

      </div>

      <div

        id="called"

        class="calledGrid"

      >

        <div class="empty">

          No balls called yet.

        </div>

      </div>

    </div>

  </section>

  <section

    id="cardsSection"

    class="section"

    style="display:none"

  >

    <div class="panel">

      <div class="selectionTop">

        <div class="panelTitle">

          Choose your cards

        </div>

        <div

          id="selectionCount"

          class="selectionCount"

        >

          <strong>0</strong> / 4

        </div>

      </div>

      <div

        id="selected"

        class="selectedPills"

      >

        <span class="pill">

          No cards selected

        </span>

      </div>

      <button

        class="primaryBtn"

        onclick="saveCards()"

      >

        SAVE SELECTED CARDS

      </button>

      <div class="notice">

        Choose up to 4 cards while the lobby is open. Once the game begins, card selection is locked.

      </div>

    </div>

    <div class="panel">

      <div class="panelHeader">

        <div class="panelTitle">

          400 Cards

        </div>

        <div class="panelHint">

          1 — 400

        </div>

      </div>

      <div

        id="cards"

        class="cardGrid"

      ></div>

    </div>

  </section>

  <section

    id="wallet"

    class="section"

    style="display:none"

  >

    <div class="panel">

      <div class="walletBalance">

        <div class="walletLabel">

          PLAY BALANCE

        </div>

        <div

          id="walletAmount"

          class="walletAmount"

        >

          2,500.00

        </div>

        <div class="walletCurrency">

          ETB

        </div>

      </div>

      <div class="walletActions">

        <button

          id="depositBtn"

          class="walletAction active"

          onclick="setWalletType('deposit')"

        >

          ADD BALANCE

        </button>

        <button

          id="withdrawBtn"

          class="walletAction"

          onclick="setWalletType('withdraw')"

        >

          WITHDRAW

        </button>

      </div>

      <select

        id="method"

        class="field"

      >

        <option>

          Telebirr

        </option>

        <option>

          eBirr

        </option>

        <option>

          M-PESA

        </option>

      </select>

      <input

        id="amount"

        class="field"

        type="number"

        min="1"

        placeholder="Enter amount"

      >

      <button

        class="primaryBtn"

        onclick="walletRequest()"

      >

        SUBMIT REQUEST

      </button>

      <div class="notice">

        This balance is for play only. No real money is transferred.

      </div>

      <div

        id="walletResult"

        class="notice"

      ></div>

    </div>

    <div class="panel">

      <div class="panelHeader">

        <div class="panelTitle">

          Language

        </div>

        <div class="panelHint">

          LANGUAGE

        </div>

      </div>

      <div class="languageGrid">

        <button

          id="enBtn"

          class="languageBtn active"

          onclick="setLanguage('en')"

        >

          English

        </button>

        <button

          id="amBtn"

          class="languageBtn"

          onclick="setLanguage('am')"

        >

          አማርኛ

        </button>

      </div>

    </div>

  </section>

</div>

<div class="bottomBar">

  <button

    id="bottomPlay"

    class="bottomBtn active"

    onclick="bottomNavigate('play')"

  >

    <span class="bottomIcon">

      🎱

    </span>

    PLAY

  </button>

  <button

    id="bottomCards"

    class="bottomBtn"

    onclick="bottomNavigate('cardsSection')"

  >

    <span class="bottomIcon">

      🎟

    </span>

    CARDS

  </button>

  <button

    id="bottomWallet"

    class="bottomBtn"

    onclick="bottomNavigate('wallet')"

  >

    <span class="bottomIcon">

      💵

    </span>

    BALANCE

  </button>

</div>

<div

  id="toast"

  class="toast"

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

        id:"guest",

        first_name:"Player",

        username:""

      };

const userHeader =

  JSON.stringify(

    telegramUser

  );

let selected = [];

let currentGame = null;

let walletType = "deposit";

let language = "en";

let refreshBusy = false;

const translations = {

  en: {

    lobby:

      "LOBBY",

    live:

      "GAME IN PROGRESS",

    titleLobby:

      "Next game starts soon",

    titleLive:

      "Game is live",

    wait:

      "Choose up to 4 cards before the next game starts.",

    liveMsg:

      "🎱 GAME IN PROGRESS — please wait for the next lobby.",

    waiting:

      "WAITING FOR THE GAME",

    seconds:

      "seconds",

    liveTime:

      "LIVE",

    selectCards:

      "SELECT CARDS",

    gameLocked:

      "GAME LOCKED",

    noBalls:

      "No balls called yet.",

    save:

      "SAVE SELECTED CARDS",

    saved:

      "Cards saved successfully.",

    bingo:

      "BINGO!",

    noBingo:

      "You do not have two completed lines yet.",

    gameWait:

      "Game in progress. Please wait for the next lobby.",

    notLive:

      "The game is not live yet.",

    choose:

      "Select your cards below.",

    noCards:

      "No cards selected.",

    selectOne:

      "Select at least one card.",

    maxCards:

      "You can select up to 4 cards.",

    updated:

      "Play balance updated.",

    invalidAmount:

      "Enter a valid amount.",

    balance:

      "Play Balance"

  },

  am: {

    lobby:

      "መጠበቂያ",

    live:

      "🎱 ጨዋታው በመካሄድ ላይ",

    titleLobby:

      "ቀጣዩ ጨዋታ በቅርቡ ይጀምራል",

    titleLive:

      "ጨዋታው ተጀምሯል",

    wait:

      "ጨዋታው ከመጀመሩ በፊት እስከ 4 ካርድ ይምረጡ።",

    liveMsg:

      "🎱 GAME IN PROGRESS — እባክዎ ቀጣዩን መጠበቂያ ይጠብቁ።",

    waiting:

      "ጨዋታውን በመጠበቅ ላይ",

    seconds:

      "ሰከንድ",

    liveTime:

      "በመካሄድ ላይ",

    selectCards:

      "ካርድ ይምረጡ",

    gameLocked:

      "ጨዋታው ተጀምሯል",

    noBalls:

      "እስካሁን ኳስ አልተጠራም።",

    save:

      "የመረጥኳቸውን ካርዶች አስቀምጥ",

    saved:

      "ካርዶቹ በትክክል ተቀምጠዋል።",

    bingo:

      "ቢንጎ!",

    noBingo:

      "እስካሁን 2 መስመር አልሞላም።",

    gameWait:

      "ጨዋታው በመካሄድ ላይ ነው። ቀጣዩን መጠበቂያ ይጠብቁ።",

    notLive:

      "ጨዋታው ገና አልጀመረም።",

    choose:

      "ከታች ያሉትን ካርዶች ይምረጡ።",

    noCards:

      "ምንም ካርድ አልተመረጠም።",

    selectOne:

      "ቢያንስ አንድ ካርድ ይምረጡ።",

    maxCards:

      "ከ4 ካርድ በላይ መምረጥ አይችሉም።",

    updated:

      "የጨዋታ ሂሳብዎ ተሻሽሏል።",

    invalidAmount:

      "ትክክለኛ መጠን ያስገቡ።",

    balance:

      "የጨዋታ ሂሳብ"

  }

};

function api(path, options = {}) {

  options.headers = {

    ...(options.headers || {}),

    "x-telegram-user":

      userHeader

  };

  return fetch(

    path,

    options

  ).then(

    r => r.json()

  );

}

function showToast(message) {

  const toast =

    document.getElementById(

      "toast"

    );

  toast.textContent =

    message;

  toast.classList.add(

    "show"

  );

  clearTimeout(

    window.__toastTimer

  );

  window.__toastTimer =

    setTimeout(

      () => {

        toast.classList.remove(

          "show"

        );

      },

      2200

    );

}

function showSection(

  sectionId,

  button

) {

  document

    .querySelectorAll(

      ".section"

    )

    .forEach(

      section => {

        section.style.display =

          "none";

      }

    );

  const section =

    document.getElementById(

      sectionId

    );

  if (section) {

    section.style.display =

      "block";

  }

  document

    .querySelectorAll(

      ".navBtn"

    )

    .forEach(

      b => {

        b.classList.remove(

          "active"

        );

      }

    );

  if (button) {

    button.classList.add(

      "active"

    );

  }

  updateBottomButtons(

    sectionId

  );

  window.scrollTo({

    top:0,

    behavior:"smooth"

  });

}

function bottomNavigate(

  sectionId

) {

  const matching =

    Array.from(

      document.querySelectorAll(

        ".navBtn"

      )

    ).find(

      b =>

        (

          sectionId === "play" &&

          b.textContent.includes(

            "PLAY"

          )

        ) ||

        (

          sectionId ===

          "cardsSection" &&

          b.textContent.includes(

            "CARDS"

          )

        ) ||

        (

          sectionId ===

          "wallet" &&

          b.textContent.includes(

            "BALANCE"

          )

        )

    );

  showSection(

    sectionId,

    matching

  );

}

function updateBottomButtons(

  sectionId

) {

  document

    .getElementById(

      "bottomPlay"

    )

    .classList.toggle(

      "active",

      sectionId === "play"

    );

  document

    .getElementById(

      "bottomCards"

    )

    .classList.toggle(

      "active",

      sectionId ===

        "cardsSection"

    );

  document

    .getElementById(

      "bottomWallet"

    )

    .classList.toggle(

      "active",

      sectionId ===

        "wallet"

    );

}

function makeClientCard(

  number

) {

  const seed =

    number * 9973;

  const B =

    seededShuffle(

      Array.from(

        {length:15},

        (_,i) => i + 1

      ),

      seed + 1

    ).slice(0,5);

  const I =

    seededShuffle(

      Array.from(

        {length:15},

        (_,i) => i + 16

      ),

      seed + 2

    ).slice(0,5);

  const N =

    seededShuffle(

      Array.from(

        {length:15},

        (_,i) => i + 31

      ),

      seed + 3

    ).slice(0,5);

  const G =

    seededShuffle(

      Array.from(

        {length:15},

        (_,i) => i + 46

      ),

      seed + 4

    ).slice(0,5);

  const O =

    seededShuffle(

      Array.from(

        {length:15},

        (_,i) => i + 61

      ),

      seed + 5

    ).slice(0,5);

  return [

    B[0],I[0],N[0],G[0],O[0],

    B[1],I[1],N[1],G[1],O[1],

    B[2],I[2],

    "FREE",

    G[2],O[2],

    B[3],I[3],N[3],G[3],O[3],

    B[4],I[4],N[4],G[4],O[4]

  ];

}

function seededShuffle(

  arr,

  seed

) {

  const a = [

    ...arr

  ];

  let s =

    seed >>> 0;

  function rnd() {

    s =

      (

        s * 1664525 +

        1013904223

      ) >>> 0;

    return s /

      4294967296;

  }

  for (

    let i =

      a.length - 1;

    i > 0;

    i--

  ) {

    const j =

      Math.floor(

        rnd() *

        (i + 1)

      );

    [

      a[i],

      a[j]

    ] =

    [

      a[j],

      a[i]

    ];

  }

  return a;

}

function renderBingoCard(

  number

) {

  const wrap =

    document.createElement(

      "div"

    );

  wrap.className =

    "bingoCard";

  const header =

    document.createElement(

      "div"

    );

  header.className =

    "cardHeader";

  const title =

    document.createElement(

      "div"

    );

  title.className =

    "cardName";

  title.textContent =

    "CARD #" +

    number;

  const state =

    document.createElement(

      "div"

    );

  state.className =

    "cardState";

  state.textContent =

    "5 × 5";

  header.appendChild(

    title

  );

  header.appendChild(

    state

  );

  wrap.appendChild(

    header

  );

  const head =

    document.createElement(

      "div"

    );

  head.className =

    "bingoHead";

  [

    "B",

    "I",

    "N",

    "G",

    "O"

  ].forEach(

    letter => {

      const d =

        document.createElement(

          "div"

        );

      d.textContent =

        letter;

      head.appendChild(

        d

      );

    }

  );

  wrap.appendChild(

    head

  );

  const grid =

    document.createElement(

      "div"

    );

  grid.className =

    "bingoGrid";

  const card =

    makeClientCard(

      number

    );

  const called =

    new Set(

      (

        currentGame &&

        currentGame.calledBalls

      ) || []

    );

  card.forEach(

    value => {

      const cell =

        document.createElement(

          "div"

        );

      cell.className =

        "bingoCell";

      cell.textContent =

        value;

      if (

        value === "FREE"

      ) {

        cell.classList.add(

          "free"

        );

      }

      if (

        value === "FREE" ||

        called.has(

          Number(value)

        )

      ) {

        cell.classList.add(

          "marked"

        );

      }

      grid.appendChild(

        cell

      );

    }

  );

  wrap.appendChild(

    grid

  );

  return wrap;

}

async function loadCards() {

  try {

    const data =

      await api(

        "/do/cards"

      );

    const box =

      document.getElementById(

        "cards"

      );

    box.innerHTML =

      "";

    for (

      const card

      of data.cards

    ) {

      const button =

        document.createElement(

          "button"

        );

      button.className =

        "cardBtn";

      button.textContent =

        card.number;

      if (

        selected.includes(

          card.number

        )

      ) {

        button.classList.add(

          "selected"

        );

      }

      button.onclick =

        () =>

          toggleCard(

            card.number

          );

      box.appendChild(

        button

      );

    }

  } catch (e) {

    console.error(e);

  }

}

function toggleCard(

  number

) {

  if (

    selected.includes(

      number

    )

  ) {

    selected =

      selected.filter(

        x =>

          x !== number

      );

  } else {

    if (

      selected.length >= 4

    ) {

      showToast(

        translations[

          language

        ].maxCards

      );

      return;

    }

    selected.push(

      number

    );

  }

  selected.sort(

    (a,b) => a - b

  );

  renderSelected();

  loadCards();

  renderMyCards();

}

function renderSelected() {

  const box =

    document.getElementById(

      "selected"

    );

  const count =

    document.getElementById(

      "selectionCount"

    );

  const myCount =

    document.getElementById(

      "myCardCount"

    );

  count.innerHTML =

    "<strong>" +

    selected.length +

    "</strong> / 4";

  myCount.textContent =

    selected.length +

    " / 4";

  if (

    !selected.length

  ) {

    box.innerHTML =

      '<span class="pill">' +

      translations[

        language

      ].noCards +

      "</span>";

    return;

  }

  box.innerHTML =

    selected

      .map(

        n =>

          '<span class="pill">' +

          "CARD #" +

          n +

          "</span>"

      )

      .join("");

}

async function saveCards() {

  if (

    !selected.length

  ) {

    showToast(

      translations[

        language

      ].selectOne

    );

    return;

  }

  const result =

    await api(

      "/do/select-cards",

      {

        method:"POST",

        headers:{

          "content-type":

            "application/json"

        },

        body:

          JSON.stringify({

            cards:selected

          })

      }

    );

  if (

    !result.ok

  ) {

    if (

      result.error ===

      "GAME_IN_PROGRESS"

    ) {

      showToast(

        translations[

          language

        ].gameWait

      );

    } else {

      showToast(

        "Unable to save cards."

      );

    }

    return;

  }

  selected =

    result.selectedCards ||

    selected;

  renderSelected();

  renderMyCards();

  showToast(

    translations[

      language

    ].saved

  );

}

async function loadMyCards() {

  try {

    const data =

      await api(

        "/do/user-cards"

      );

    selected =

      data.selectedCards ||

      [];

    selected.sort(

      (a,b) => a - b

    );

    renderSelected();

    renderMyCards();

  } catch (e) {

    console.error(e);

  }

}

function renderMyCards() {

  const box =

    document.getElementById(

      "myCards"

    );

  box.innerHTML =

    "";

  if (

    !selected.length

  ) {

    box.innerHTML =

      '<div class="empty">' +

      translations[

        language

      ].choose +

      "</div>";

    return;

  }

  selected.forEach(

    number => {

      box.appendChild(

        renderBingoCard(

          number

        )

      );

    }

  );

}

function renderCalledBalls(

  balls

) {

  const box =

    document.getElementById(

      "called"

    );

  const ticker =

    document.getElementById(

      "tickerBalls"

    );

  if (

    !balls ||

    !balls.length

  ) {

    box.innerHTML =

      '<div class="empty">' +

      translations[

        language

      ].noBalls +

      "</div>";

    ticker.innerHTML =

      "";

    return;

  }

  const reversed =

    [...balls].reverse();

  box.innerHTML =

    reversed

      .map(

        (

          number,

          index

        ) =>

          '<div class="calledItem ' +

          (

            index === 0

              ? "latest"

              : ""

          ) +

          '">' +

          number +

          "</div>"

      )

      .join("");

  ticker.innerHTML =

    reversed

      .slice(0,9)

      .map(

        (

          number,

          index

        ) =>

          '<div class="tickerBall ' +

          (

            index === 0

              ? "latest"

              : ""

          ) +

          '">' +

          ballLetterClient(

            number

          ) +

          "-" +

          number +

          "</div>"

      )

      .join("");

}

function ballLetterClient(

  n

) {

  if (n <= 15)

    return "B";

  if (n <= 30)

    return "I";

  if (n <= 45)

    return "N";

  if (n <= 60)

    return "G";

  return "O";

}

function updateGameUI(

  data

) {

  currentGame =

    data;

  const status =

    document.getElementById(

      "status"

    );

  const badge =

    document.getElementById(

      "statusBadge"

    );

  const title =

    document.getElementById(

      "heroTitle"

    );

  const message =

    document.getElementById(

      "message"

    );

  const timer =

    document.getElementById(

      "timer"

    );

  const timerLabel =

    document.getElementById(

      "timerLabel"

    );

  const ball =

    document.getElementById(

      "ball"

    );

  const ballInfo =

    document.getElementById(

      "ballletter"

    );

  const gameNumber =

    document.getElementById(

      "gameNumber"

    );

  const calledCount =

    document.getElementById(

      "calledCount"

    );

  const calledTitle =

    document.getElementById(

      "calledTitle"

    );

  const playHint =

    document.getElementById(

      "playHint"

    );

  gameNumber.textContent =

    "GAME #" +

    data.gameNumber;

  calledCount.textContent =

    data.calledCount ||

    0;

  calledTitle.textContent =

    (

      data.calledCount ||

      0

    ) +

    " / 75";

  if (

    data.status === "lobby"

  ) {

    badge.className =

      "statusBadge";

    status.textContent =

      translations[

        language

      ].lobby;

    title.textContent =

      translations[

        language

      ].titleLobby;

    message.textContent =

      translations[

        language

      ].wait;

    timer.textContent =

      data.lobbyRemaining;

    timerLabel.textContent =

      translations[

        language

      ].seconds;

    ball.className =

      "ballCircle empty";

    ball.textContent =

      "—";

    ballInfo.textContent =

      translations[

        language

      ].waiting;

    playHint.textContent =

      translations[

        language

      ].selectCards;

  } else {

    badge.className =

      "statusBadge live";

    status.textContent =

      translations[

        language

      ].live;

    title.textContent =

      translations[

        language

      ].titleLive;

    message.textContent =

      translations[

        language

      ].liveMsg;

    timer.textContent =

      translations[

        language

      ].liveTime;

    timerLabel.textContent =

      "";

    playHint.textContent =

      translations[

        language

      ].gameLocked;

    if (

      data.currentBall

    ) {

      ball.className =

        "ballCircle";

      ball.textContent =

        data.currentBall;

      ballInfo.textContent =

        data.currentLetter +

        " • " +

        data.currentBall;

    } else {

      ball.className =

        "ballCircle empty";

      ball.textContent =

        "—";

      ballInfo.textContent =

        translations[

          language

        ].waiting;

    }

  }

  renderCalledBalls(

    data.calledBalls ||

    []

  );

  renderMyCards();

}

async function refreshGame() {

  if (

    refreshBusy

  ) {

    return;

  }

  refreshBusy =

    true;

  try {

    const data =

      await api(

        "/do/game"

      );

    updateGameUI(

      data

    );

  } catch (e) {

    console.error(e);

  } finally {

    refreshBusy =

      false;

  }

}

async function loadBalance() {

  try {

    const data =

      await api(

        "/do/balance"

      );

    const value =

      Number(

        data.balance || 0

      );

    const formatted =

      value.toLocaleString(

        undefined,

        {

          minimumFractionDigits:2,

          maximumFractionDigits:2

        }

      );

    document.getElementById(

      "balance"

    ).textContent =

      formatted +

      " ETB";

    document.getElementById(

      "walletAmount"

    ).textContent =

      formatted;

  } catch (e) {

    console.error(e);

  }

}

function setWalletType(

  type

) {

  walletType =

    type;

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

}

async function walletRequest() {

  const amount =

    Number(

      document.getElementById(

        "amount"

      ).value

    );

  const method =

    document.getElementById(

      "method"

    ).value;

  if (

    !amount ||

    amount <= 0

  ) {

    showToast(

      translations[

        language

      ].invalidAmount

    );

    return;

  }

  const result =

    await api(

      "/do/wallet",

      {

        method:"POST",

        headers:{

          "content-type":

            "application/json"

        },

        body:

          JSON.stringify({

            method,

            type:walletType,

            amount

          })

      }

    );

  if (

    !result.ok

  ) {

    const message =

      result.error ===

      "INSUFFICIENT_BALANCE"

        ? (

          language === "am"

            ? "በሂሳብዎ በቂ ገንዘብ የለም።"

            : "Insufficient balance."

        )

        : (

          result.error ||

          "Request failed."

        );

    showToast(

      message

    );

    return;

  }

  document.getElementById(

    "amount"

  ).value =

    "";

  await loadBalance();

  showToast(

    translations[

      language

    ].updated

  );

}

async function claim() {

  const result =

    await api(

      "/do/claim"

    );

  const box =

    document.getElementById(

      "claimResult"

    );

  if (

    !result.ok

  ) {

    box.textContent =

      result.error ===

      "GAME_NOT_LIVE"

        ? translations[

            language

          ].notLive

        : "Unable to check Bingo.";

    return;

  }

  if (

    result.winningCards &&

    result.winningCards.length

  ) {

    box.textContent =

      translations[

        language

      ].bingo +

      " • CARD #" +

      result.winningCards.join(

        ", #"

      );

    showToast(

      translations[

        language

      ].bingo

    );

  } else {

    box.textContent =

      translations[

        language

      ].noBingo;

  }

}

function setLanguage(

  lang

) {

  language =

    lang;

  document

    .getElementById(

      "enBtn"

    )

    .classList.toggle(

      "active",

      lang === "en"

    );

  document

    .getElementById(

      "amBtn"

    )

    .classList.toggle(

      "active",

      lang === "am"

    );

  document.getElementById(

    "balanceLabel"

  ).textContent =

    translations[

      lang

    ].balance;

  refreshGame();

  renderSelected();

  renderMyCards();

}

function boot() {

  loadBalance();

  loadCards();

  loadMyCards();

  refreshGame();

  setInterval(

    refreshGame,

    1500

  );

  setInterval(

    loadBalance,

    5000

  );

}

boot();

</script>

</body>

</html>`;

}

async function proxyToGame(

  request,

  env,

  path

) {

  const id =

    env.GAME_SCHEDULER

      .idFromName(

        "main-game"

      );

  const stub =

    env.GAME_SCHEDULER.get(

      id

    );

  const user =

    getTelegramUser(

      request

    );

  const headers =

    new Headers(

      request.headers

    );

  headers.set(

    "x-telegram-user",

    JSON.stringify(user)

  );

  const newRequest =

    new Request(

      new URL(

        path,

        request.url

      ),

      {

        method:

          request.method,

        headers,

        body:

          request.method ===

            "GET" ||

          request.method ===

            "HEAD"

            ? undefined

            : await request.arrayBuffer()

      }

    );

  return await stub.fetch(

    newRequest

  );

}

export default {

  async fetch(

    request,

    env

  ) {

    const url =

      new URL(request.url);

    try {

      if (

        url.pathname ===

        "/health"

      ) {

        return json({

          ok:true,

          service:

            APP_NAME,

          status:

            "online"

        });

      }

      if (

        url.pathname ===

        "/api/game"

      ) {

        return proxyToGame(

          request,

          env,

          "/game"

        );

      }

      if (

        url.pathname ===

        "/api/cards"

      ) {

        return proxyToGame(

          request,

          env,

          "/cards"

        );

      }

      if (

        url.pathname ===

        "/api/user-cards"

      ) {

        return proxyToGame(

          request,

          env,

          "/user-cards"

        );

      }

      if (

        url.pathname ===

        "/api/select-cards"

      ) {

        return proxyToGame(

          request,

          env,

          "/select-cards"

        );

      }

      if (

        url.pathname ===

        "/api/balance"

      ) {

        return proxyToGame(

          request,

          env,

          "/balance"

        );

      }

      if (

        url.pathname ===

        "/api/wallet"

      ) {

        return proxyToGame(

          request,

          env,

          "/wallet"

        );

      }

      if (

        url.pathname ===

        "/api/claim"

      ) {

        return proxyToGame(

          request,

          env,

          "/claim"

        );

      }

      if (

        url.pathname ===

        "/do/game"

      ) {

        return proxyToGame(

          request,

          env,

          "/game"

        );

      }

      if (

        url.pathname ===

        "/do/cards"

      ) {

        return proxyToGame(

          request,

          env,

          "/cards"

        );

      }

      if (

        url.pathname ===

        "/do/user-cards"

      ) {

        return proxyToGame(

          request,

          env,

          "/user-cards"

        );

      }

      if (

        url.pathname ===

        "/do/select-cards"

      ) {

        return proxyToGame(

          request,

          env,

          "/select-cards"

        );

      }

      if (

        url.pathname ===

        "/do/balance"

      ) {

        return proxyToGame(

          request,

          env,

          "/balance"

        );

      }

      if (

        url.pathname ===

        "/do/wallet"

      ) {

        return proxyToGame(

          request,

          env,

          "/wallet"

        );

      }

      if (

        url.pathname ===

        "/do/claim"

      ) {

        return proxyToGame(

          request,

          env,

          "/claim"

        );

      }

      if (

        url.pathname ===

        "/favicon.ico"

      ) {

        return new Response(

          "",

          {

            status:204

          }

        );

      }

      return html(

        pageHtml()

      );

    } catch (error) {

      return json(

        {

          ok:false,

          error:

            String(error)

        },

        500

      );

    }

  }

};

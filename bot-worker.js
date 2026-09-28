const APP_URL =

  "https://fast-bingo-mini-app.dagnaeli21.workers.dev/";

const WORKER_URL =

  "https://fast-bingo-telegram-bot.dagnaeli21.workers.dev";

export default {

  async fetch(request, env) {

    const url =

      new URL(request.url);

    /* =====================================================

       TEMPORARY WEBHOOK SETUP

       ===================================================== */

    if (

      request.method === "GET" &&

      url.pathname === "/set-webhook"

    ) {

      const key =

        url.searchParams.get("key");

      if (

        !env.SETUP_KEY ||

        key !== env.SETUP_KEY

      ) {

        return new Response(

          "Unauthorized",

          { status: 401 }

        );

      }

      if (!env.BOT_TOKEN) {

        return new Response(

          "BOT_TOKEN secret is missing.",

          { status: 500 }

        );

      }

      const webhookUrl =

        `${WORKER_URL}/webhook`;

      const response =

        await fetch(

          `https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook`,

          {

            method: "POST",

            headers: {

              "Content-Type":

                "application/json"

            },

            body: JSON.stringify({

              url: webhookUrl,

              allowed_updates: [

                "message",

                "callback_query"

              ]

            })

          }

        );

      const result =

        await response.text();

      return new Response(

        result,

        {

          status:

            response.ok

              ? 200

              : 500,

          headers: {

            "Content-Type":

              "application/json"

          }

        }

      );

    }

    /* =====================================================

       LOGIN PASSWORD API

       Called by Fast Bingo Mini App Worker

       ===================================================== */

    if (

      request.method === "POST" &&

      url.pathname === "/send-login-password"

    ) {

      try {

        /* -------------------------------------------------

           Secure worker-to-worker authentication

           ------------------------------------------------- */

        if (

          !env.LOGIN_API_KEY

        ) {

          console.error(

            "LOGIN_API_KEY secret is missing."

          );

          return jsonResponse(

            {

              ok: false,

              error:

                "LOGIN_API_NOT_CONFIGURED"

            },

            500

          );

        }

        const suppliedKey =

          request.headers.get(

            "x-login-api-key"

          );

        if (

          !suppliedKey ||

          suppliedKey !==

            env.LOGIN_API_KEY

        ) {

          return jsonResponse(

            {

              ok: false,

              error: "UNAUTHORIZED"

            },

            401

          );

        }

        /* -------------------------------------------------

           Read request

           ------------------------------------------------- */

        let body = {};

        try {

          body =

            await request.json();

        } catch (_) {

          return jsonResponse(

            {

              ok: false,

              error: "INVALID_JSON"

            },

            400

          );

        }

        const userId =

          String(

            body.userId || ""

          );

        const password =

          String(

            body.password || ""

          );

        /* -------------------------------------------------

           Validate

           ------------------------------------------------- */

        if (!userId) {

          return jsonResponse(

            {

              ok: false,

              error: "USER_ID_REQUIRED"

            },

            400

          );

        }

        if (

          !/^\d{4,8}$/.test(

            password

          )

        ) {

          return jsonResponse(

            {

              ok: false,

              error:

                "INVALID_PASSWORD_FORMAT"

            },

            400

          );

        }

        /* -------------------------------------------------

           Telegram chat ID = Telegram user ID

           ------------------------------------------------- */

        const chatId =

          userId;

        const message =

          "🔐 Fast Bingo Login\n\n" +

          "የመግቢያ የይለፍ ቃልህ:\n\n" +

          `🔑 ${password}\n\n` +

          "ይህን ኮድ ወደ Fast Bingo Mini App ተመልሰህ አስገባ።\n\n" +

          "⚠️ ይህን ኮድ ለሌላ ሰው አትስጥ።";

        await sendMessage(

          chatId,

          message,

          env

        );

        return jsonResponse({

          ok: true

        });

      } catch (error) {

        console.error(

          "SEND_LOGIN_PASSWORD_ERROR:",

          error

        );

        return jsonResponse(

          {

            ok: false,

            error:

              "TELEGRAM_SEND_FAILED"

          },

          500

        );

      }

    }

    /* =====================================================

       TELEGRAM WEBHOOK

       ===================================================== */

    if (

      request.method === "POST" &&

      url.pathname === "/webhook"

    ) {

      try {

        const update =

          await request.json();

        await handleUpdate(

          update,

          env

        );

        return new Response(

          "OK"

        );

      } catch (error) {

        console.error(

          "Webhook error:",

          error

        );

        return new Response(

          "OK"

        );

      }

    }

    /* =====================================================

       HEALTH CHECK

       ===================================================== */

    if (

      request.method === "GET"

    ) {

      return new Response(

        "Fast Bingo Bot Worker is running."

      );

    }

    return new Response(

      "Not Found",

      { status: 404 }

    );

  }

};

/* =========================================================

   TELEGRAM UPDATE HANDLER

   ========================================================= */

async function handleUpdate(

  update,

  env

) {

  if (!update.message) {

    return;

  }

  const message =

    update.message;

  const chatId =

    message.chat.id;

  const text =

    message.text || "";

  /* =====================================================

     /start

     ===================================================== */

  if (

    text === "/start" ||

    text.startsWith("/start ")

  ) {

    await sendStartMenu(

      chatId,

      env

    );

    return;

  }

  /* =====================================================

     PLAY

     ===================================================== */

  if (

    text === "🎮 ይጫወቱ"

  ) {

    await sendPlayMessage(

      chatId,

      env

    );

    return;

  }

  /* =====================================================

     BALANCE

     ===================================================== */

  if (

    text === "💵 ሂሳብ"

  ) {

    await sendMessage(

      chatId,

      "💵 ሂሳብ\n\n" +

      "ቀሪ ሂሳብ: 0 ETB",

      env

    );

    return;

  }

  /* =====================================================

     DEPOSIT

     ===================================================== */

  if (

    text === "📤 ገቢ ለማድረግ"

  ) {

    await sendMessage(

      chatId,

      "📤 ገቢ ለማድረግ\n\n" +

      "የገቢ አማራጮች በቅርቡ ይታያሉ።",

      env

    );

    return;

  }

  /* =====================================================

     WITHDRAWAL

     ===================================================== */

  if (

    text === "📥 ወጪ ለማድረግ"

  ) {

    await sendMessage(

      chatId,

      "📥 ወጪ ለማድረግ\n\n" +

      "የወጪ አማራጮች በቅርቡ ይታያሉ።",

      env

    );

    return;

  }

  /* =====================================================

     INVITE

     ===================================================== */

  if (

    text === "🔗 ጋብዝ & አግኝ"

  ) {

    await sendMessage(

      chatId,

      "🔗 ጋብዝ & አግኝ\n\n" +

      "ጓደኞችዎን ይጋብዙ እና ሽልማት ያግኙ።",

      env

    );

    return;

  }

  /* =====================================================

     VIP

     ===================================================== */

  if (

    text === "💎 VIP ክፍል"

  ) {

    await sendMessage(

      chatId,

      "💎 VIP ክፍል\n\n" +

      "VIP ክፍል በቅርቡ ይከፈታል።",

      env

    );

    return;

  }

  /* =====================================================

     SPECIAL PROMOTER

     ===================================================== */

  if (

    text === "📢 Special promoter"

  ) {

    await sendMessage(

      chatId,

      "📢 Special promoter\n\n" +

      "ይህ አገልግሎት በቅርቡ ይከፈታል።",

      env

    );

    return;

  }

  /* =====================================================

     HELP

     ===================================================== */

  if (

    text === "📲 እርዳታ"

  ) {

    await sendMessage(

      chatId,

      "📲 እርዳታ\n\n" +

      "Fast Bingo 75-ball Bingo ጨዋታ ነው።",

      env

    );

    return;

  }

}

/* =========================================================

   START MENU

   ========================================================= */

async function sendStartMenu(

  chatId,

  env

) {

  await sendMessage(

    chatId,

    "እንኳን ወደ Fast Bingo በደህና መጡ ❤️\n\n" +

    "እየተዝናኑ ያሸንፉ🏆",

    env,

    {

      reply_markup: {

        keyboard: [

          [

            {

              text:

                "🎮 ይጫወቱ",

              web_app: {

                url:

                  APP_URL

              }

            },

            {

              text:

                "💵 ሂሳብ"

            }

          ],

          [

            {

              text:

                "📤 ገቢ ለማድረግ"

            },

            {

              text:

                "📥 ወጪ ለማድረግ"

            }

          ],

          [

            {

              text:

                "🔗 ጋብዝ & አግኝ"

            },

            {

              text:

                "💎 VIP ክፍል"

            }

          ],

          [

            {

              text:

                "📢 Special promoter"

            },

            {

              text:

                "📲 እርዳታ"

            }

          ]

        ],

        resize_keyboard:

          true,

        is_persistent:

          true

      }

    }

  );

}

/* =========================================================

   PLAY MESSAGE

   ========================================================= */

async function sendPlayMessage(

  chatId,

  env

) {

  await sendMessage(

    chatId,

    "🎮 Fast Bingo\n\n" +

    "ከታች ያለውን የመጫወቻ ቁልፍ በመጫን ጨዋታውን ይክፈቱ።",

    env,

    {

      reply_markup: {

        inline_keyboard: [

          [

            {

              text:

                "🎮 Fast Bingo ክፈት",

              web_app: {

                url:

                  APP_URL

              }

            }

          ]

        ]

      }

    }

  );

}

/* =========================================================

   SEND TELEGRAM MESSAGE

   ========================================================= */

async function sendMessage(

  chatId,

  text,

  env,

  extra = {}

) {

  if (!env.BOT_TOKEN) {

    console.error(

      "BOT_TOKEN secret is missing."

    );

    return;

  }

  const response =

    await fetch(

      `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,

      {

        method:

          "POST",

        headers: {

          "Content-Type":

            "application/json"

        },

        body:

          JSON.stringify({

            chat_id:

              chatId,

            text,

            ...extra

          })

      }

    );

  if (!response.ok) {

    console.error(

      "Telegram sendMessage failed:",

      await response.text()

    );

  }

}

/* =========================================================

   JSON RESPONSE HELPER

   ========================================================= */

function jsonResponse(

  data,

  status = 200

) {

  return new Response(

    JSON.stringify(data),

    {

      status,

      headers: {

        "Content-Type":

          "application/json",

        "Cache-Control":

          "no-store"

      }

    }

  );

}

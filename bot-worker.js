const APP_URL = "https://fast-bingo-mini-app.dagnaeli21.workers.dev/";

export default {

  async fetch(request, env) {

    const url = new URL(request.url);

    // Telegram webhook

    if (request.method === "POST" && url.pathname === "/webhook") {

      try {

        const update = await request.json();

        await handleUpdate(update, env);

        return new Response("OK");

      } catch (error) {

        console.error("Webhook error:", error);

        return new Response("OK");

      }

    }

    // Health check

    if (request.method === "GET") {

      return new Response("Fast Bingo Bot Worker is running.");

    }

    return new Response("Not Found", { status: 404 });

  }

};

async function handleUpdate(update, env) {

  if (!update.message) return;

  const message = update.message;

  const chatId = message.chat.id;

  const text = message.text || "";

  if (text === "/start" || text.startsWith("/start ")) {

    await sendStartMenu(chatId, env);

    return;

  }

  if (text === "🎮 ይጫወቱ") {

    await sendPlayMessage(chatId, env);

    return;

  }

  if (text === "💵 ሂሳብ") {

    await sendMessage(

      chatId,

      "💵 ሂሳብ\n\nቀሪ ሂሳብ: 0 ETB",

      env

    );

    return;

  }

  if (text === "📤 ገቢ ለማድረግ") {

    await sendMessage(

      chatId,

      "📤 ገቢ ለማድረግ\n\nየገቢ አማራጮች በቅርቡ ይታያሉ።",

      env

    );

    return;

  }

  if (text === "📥 ወጪ ለማድረግ") {

    await sendMessage(

      chatId,

      "📥 ወጪ ለማድረግ\n\nየወጪ አማራጮች በቅርቡ ይታያሉ።",

      env

    );

    return;

  }

  if (text === "🔗 ጋብዝ & አግኝ") {

    await sendMessage(

      chatId,

      "🔗 ጋብዝ & አግኝ\n\nጓደኞችዎን ይጋብዙ እና ሽልማት ያግኙ።",

      env

    );

    return;

  }

  if (text === "💎 VIP ክፍል") {

    await sendMessage(

      chatId,

      "💎 VIP ክፍል\n\nVIP ክፍል በቅርቡ ይከፈታል።",

      env

    );

    return;

  }

  if (text === "📢 Special promoter") {

    await sendMessage(

      chatId,

      "📢 Special promoter\n\nይህ አገልግሎት በቅርቡ ይከፈታል።",

      env

    );

    return;

  }

  if (text === "📲 እርዳታ") {

    await sendMessage(

      chatId,

      "📲 እርዳታ\n\nFast Bingo 75-ball Bingo ጨዋታ ነው።",

      env

    );

  }

}

async function sendStartMenu(chatId, env) {

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

              text: "🎮 ይጫወቱ",

              web_app: {

                url: APP_URL

              }

            },

            {

              text: "💵 ሂሳብ"

            }

          ],

          [

            {

              text: "📤 ገቢ ለማድረግ"

            },

            {

              text: "📥 ወጪ ለማድረግ"

            }

          ],

          [

            {

              text: "🔗 ጋብዝ & አግኝ"

            },

            {

              text: "💎 VIP ክፍል"

            }

          ],

          [

            {

              text: "📢 Special promoter"

            },

            {

              text: "📲 እርዳታ"

            }

          ]

        ],

        resize_keyboard: true,

        is_persistent: true

      }

    }

  );

}

async function sendPlayMessage(chatId, env) {

  await sendMessage(

    chatId,

    "🎮 Fast Bingo\n\nከታች ያለውን የመጫወቻ ቁልፍ በመጫን ጨዋታውን ይክፈቱ።",

    env,

    {

      reply_markup: {

        inline_keyboard: [

          [

            {

              text: "🎮 Fast Bingo ክፈት",

              web_app: {

                url: APP_URL

              }

            }

          ]

        ]

      }

    }

  );

}

async function sendMessage(chatId, text, env, extra = {}) {

  if (!env.BOT_TOKEN) {

    console.error("BOT_TOKEN secret is missing.");

    return;

  }

  const response = await fetch(

    `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,

    {

      method: "POST",

      headers: {

        "Content-Type": "application/json"

      },

      body: JSON.stringify({

        chat_id: chatId,

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

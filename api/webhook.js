module.exports = async (req, res) => {
  const update = req.body;

  if (update.message && update.message.text === "/start") {
    const chatId = update.message.chat.id;

    await fetch(
      `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: "Welcome! Your bot is working ✅",
        }),
      }
    );
  }

  res.status(200).send("ok");
};

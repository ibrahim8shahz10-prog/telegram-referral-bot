const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  const update = req.body;

  if (!update.message) {
    return res.status(200).send("ok");
  }

  const msg = update.message;
  const user = msg.from;

  if (msg.text && msg.text.startsWith("/start")) {
    const referrer = msg.text.split(" ")[1];

    const { data: existing } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", user.id)
      .single();

    if (!existing) {
      let points = 0;

      await supabase.from("users").insert({
        telegram_id: user.id,
        username: user.username || "",
        referrer_id: referrer || null,
        points: points
      });

      if (referrer && referrer != user.id) {
        const { data: refUser } = await supabase
          .from("users")
          .select("points")
          .eq("telegram_id", referrer)
          .single();

        if (refUser) {
          await supabase
            .from("users")
            .update({
              points: refUser.points + 10
            })
            .eq("telegram_id", referrer);
        }
      }
    }
  }

  res.status(200).send("ok");
};

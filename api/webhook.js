const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = 'ReActsHelPer_bot';
const ADMIN_ID = process.env.ADMIN_ID;

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

async function sendMessage(chatId, text, keyboard = null) {
  const body = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (keyboard) body.reply_markup = keyboard;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function editMessage(chatId, messageId, text, keyboard = null) {
  const body = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' };
  if (keyboard) body.reply_markup = keyboard;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function answerCallback(callbackId, text = '') {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text }),
  });
}

async function checkMembership(userId, channelUsername) {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=@${channelUsername}&user_id=${userId}`
    );
    const data = await res.json();
    const status = data?.result?.status;
    return ['member', 'administrator', 'creator'].includes(status);
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────
// KEYBOARDS
// ─────────────────────────────────────────────

function mainMenuKeyboard() {
  return {
    keyboard: [
      [{ text: '🔷 IVS Panel' }, { text: '📱 SMS Panel' }],
      [{ text: '📊 INF Panel' }, { text: '🛠 IMS Panel' }],
      [{ text: '💰 My Points' }, { text: '🔗 My Referral Link' }],
      [{ text: '🎁 Redeem Code' }, { text: '🛍 Contacts Store' }],
      [{ text: '📋 Commands' }, { text: '❓ Help' }]
    ],
    resize_keyboard: true,
    persistent: true
  };
}

function adminMenuKeyboard() {
  return {
    keyboard: [
      [{ text: '➕ Add Contact' }, { text: '❌ Delete Contact' }],
      [{ text: '🎟 Create Code' }, { text: '📋 List Codes' }],
      [{ text: '📢 Add Channel' }, { text: '🗑 Remove Channel' }],
      [{ text: '👥 All Users' }, { text: '💰 Give Points' }],
      [{ text: '🏠 Main Menu' }]
    ],
    resize_keyboard: true,
    persistent: true
  };
}

function forceJoinKeyboard(channels) {
  const buttons = channels.map(c => ([{
    text: `📢 Join ${c.channel_name}`,
    url: c.invite_link
  }]));
  buttons.push([{ text: '✅ Verify', callback_data: 'verify' }]);
  return { inline_keyboard: buttons };
}

// ─────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Bot is running ✅');
  }

  try {
    const body = req.body;

    // ─── CALLBACK QUERIES (Verify button) ────
    if (body.callback_query) {
      const cb = body.callback_query;
      const userId = cb.from.id.toString();
      const chatId = cb.message.chat.id;
      const messageId = cb.message.message_id;
      const firstName = cb.from.first_name || cb.from.username || 'User';

      await answerCallback(cb.id, 'Checking...');

      if (cb.data === 'verify') {
        const { data: channels } = await supabase
          .from('required_channels').select('*');

        const results = await Promise.all(
          channels.map(c => checkMembership(userId, c.channel_username))
        );
        const notJoined = channels.filter((_, i) => !results[i]);

        if (notJoined.length > 0) {
          const names = notJoined.map(c => `📢 ${c.channel_name}`).join('\n');
          await editMessage(chatId, messageId,
            `❌ <b>Not joined yet!</b>\n\nPlease join these first:\n\n${names}\n\nThen press ✅ Verify again.`,
            forceJoinKeyboard(channels)
          );
        } else {
          const { data: existing } = await supabase
            .from('users').select('*').eq('telegram_id', userId).single();

          if (!existing) {
            await supabase.from('users').insert({
              telegram_id: userId,
              username: cb.from.username || firstName,
              points: 0,
              referrer_id: null,
            });
          } else if (existing.referrer_id) {
            // Give referrer points now that user is verified
            await supabase.rpc('increment_points', {
              user_telegram_id: existing.referrer_id,
              amount: 10,
            });
            await supabase.from('users').update({ referrer_id: null }).eq('telegram_id', userId);
          }

          await editMessage(chatId, messageId,
            `✅ <b>Verified! Welcome ${firstName}!</b>\n\nYou now have full access. Use the menu below! 👇`,
            null
          );
          await sendMessage(chatId,
            `🏠 <b>Main Menu</b>\n\nChoose an option:`,
            mainMenuKeyboard()
          );
        }
      }
      return res.status(200).json({ ok: true });
    }

    // ─── MESSAGES ─────────────────────────────
    const { message } = body;
    if (!message || !message.text) return res.status(200).json({ ok: true });

    const chatId = message.chat.id;
    const text = message.text.trim();
    const userId = message.from.id.toString();
    const username = message.from.username || message.from.first_name || 'User';
    const firstName = message.from.first_name || username;
    const isAdmin = userId === ADMIN_ID;

    // ─── /start ───────────────────────────────
    if (text.startsWith('/start')) {
      const parts = text.split(' ');
      const referrerId = parts[1] || null;

      const { data: existing } = await supabase
        .from('users').select('*').eq('telegram_id', userId).single();

      if (existing) {
        await sendMessage(chatId,
          `👋 <b>Welcome back, ${firstName}!</b>\n\nYou have <b>${existing.points} points</b>.`,
          mainMenuKeyboard()
        );
      } else {
        if (referrerId && referrerId !== userId) {
          await supabase.from('users').upsert({
            telegram_id: userId,
            username,
            points: 0,
            referrer_id: referrerId,
          }, { onConflict: 'telegram_id' });
        }

        const { data: channels } = await supabase
          .from('required_channels').select('*');

        await sendMessage(chatId,
          `👋 <b>Welcome, ${firstName}!</b>\n\nTo use this bot, please join our channels first.\n\nJoin all channels below then press ✅ <b>Verify</b>.`,
          forceJoinKeyboard(channels)
        );
      }
      return res.status(200).json({ ok: true });
    }

    // ─── /admin ───────────────────────────────
    if (text === '/admin') {
      if (!isAdmin) {
        await sendMessage(chatId, `❌ You are not authorized.`);
      } else {
        await sendMessage(chatId,
          `🔐 <b>Admin Panel</b>\n\nWelcome, Admin! Choose an option:`,
          adminMenuKeyboard()
        );
      }
      return res.status(200).json({ ok: true });
    }

    // ─── ADMIN COMMANDS ───────────────────────
    if (isAdmin) {

      // ── Add Contact ──
      if (text === '➕ Add Contact') {
        await sendMessage(chatId,
          `➕ <b>Add Contact</b>\n\nSend contact details in this format:\n\n<code>/addcontact Name | Phone | Description | PointsCost</code>\n\nExample:\n<code>/addcontact Ali Khan | +923001234567 | Business contact | 3</code>`,
          adminMenuKeyboard()
        );
        return res.status(200).json({ ok: true });
      }

      if (text.startsWith('/addcontact ')) {
        const parts = text.replace('/addcontact ', '').split('|').map(s => s.trim());
        if (parts.length < 4) {
          await sendMessage(chatId,
            `❌ Wrong format. Use:\n<code>/addcontact Name | Phone | Description | PointsCost</code>`,
            adminMenuKeyboard()
          );
        } else {
          await supabase.from('contacts').insert({
            name: parts[0],
            phone: parts[1],
            description: parts[2],
            points_cost: parseInt(parts[3]) || 3,
            is_available: true,
          });
          await sendMessage(chatId,
            `✅ Contact <b>${parts[0]}</b> added successfully!`,
            adminMenuKeyboard()
          );
        }
        return res.status(200).json({ ok: true });
      }

      // ── Delete Contact ──
      if (text === '❌ Delete Contact') {
        const { data: contacts } = await supabase
          .from('contacts').select('*').eq('is_available', true);

        if (!contacts || contacts.length === 0) {
          await sendMessage(chatId, `No contacts found.`, adminMenuKeyboard());
        } else {
          let list = `❌ <b>Delete Contact</b>\n\nSend: <code>/deletecontact ID</code>\n\n`;
          contacts.forEach(c => {
            list += `ID: <b>${c.id}</b> — ${c.name} (${c.points_cost} pts)\n`;
          });
          await sendMessage(chatId, list, adminMenuKeyboard());
        }
        return res.status(200).json({ ok: true });
      }

      if (text.startsWith('/deletecontact ')) {
        const id = parseInt(text.replace('/deletecontact ', '').trim());
        await supabase.from('contacts').update({ is_available: false }).eq('id', id);
        await sendMessage(chatId, `✅ Contact ID ${id} deleted.`, adminMenuKeyboard());
        return res.status(200).json({ ok: true });
      }

      // ── Create Code ──
      if (text === '🎟 Create Code') {
        await sendMessage(chatId,
          `🎟 <b>Create Redeem Code</b>\n\nFormat:\n<code>/createcode CODE | Points | MaxUses</code>\n\nExample:\n<code>/createcode PROMO100 | 100 | 50</code>`,
          adminMenuKeyboard()
        );
        return res.status(200).json({ ok: true });
      }

      if (text.startsWith('/createcode ')) {
        const parts = text.replace('/createcode ', '').split('|').map(s => s.trim());
        if (parts.length < 3) {
          await sendMessage(chatId,
            `❌ Wrong format. Use:\n<code>/createcode CODE | Points | MaxUses</code>`,
            adminMenuKeyboard()
          );
        } else {
          await supabase.from('redeem_codes').insert({
            code: parts[0].toUpperCase(),
            points: parseInt(parts[1]) || 10,
            max_uses: parseInt(parts[2]) || 1,
            used_count: 0,
          });
          await sendMessage(chatId,
            `✅ Code <b>${parts[0].toUpperCase()}</b> created!\n💰 Points: ${parts[1]}\n👥 Max uses: ${parts[2]}`,
            adminMenuKeyboard()
          );
        }
        return res.status(200).json({ ok: true });
      }

      // ── List Codes ──
      if (text === '📋 List Codes') {
        const { data: codes } = await supabase.from('redeem_codes').select('*');
        if (!codes || codes.length === 0) {
          await sendMessage(chatId, `No codes found.`, adminMenuKeyboard());
        } else {
          let list = `📋 <b>All Redeem Codes</b>\n\n`;
          codes.forEach(c => {
            list += `🎟 <b>${c.code}</b>\n💰 ${c.points} pts | Used: ${c.used_count}/${c.max_uses}\n\n`;
          });
          await sendMessage(chatId, list, adminMenuKeyboard());
        }
        return res.status(200).json({ ok: true });
      }

      // ── Add Channel ──
      if (text === '📢 Add Channel') {
        await sendMessage(chatId,
          `📢 <b>Add Required Channel</b>\n\nFormat:\n<code>/addchannel username | Channel Name | https://t.me/link</code>\n\nExample:\n<code>/addchannel mychannel | My Channel | https://t.me/mychannel</code>`,
          adminMenuKeyboard()
        );
        return res.status(200).json({ ok: true });
      }

      if (text.startsWith('/addchannel ')) {
        const parts = text.replace('/addchannel ', '').split('|').map(s => s.trim());
        if (parts.length < 3) {
          await sendMessage(chatId,
            `❌ Wrong format. Use:\n<code>/addchannel username | Name | link</code>`,
            adminMenuKeyboard()
          );
        } else {
          await supabase.from('required_channels').insert({
            channel_username: parts[0],
            channel_name: parts[1],
            invite_link: parts[2],
          });
          await sendMessage(chatId,
            `✅ Channel <b>${parts[1]}</b> added to force join!`,
            adminMenuKeyboard()
          );
        }
        return res.status(200).json({ ok: true });
      }

      // ── Remove Channel ──
      if (text === '🗑 Remove Channel') {
        const { data: channels } = await supabase
          .from('required_channels').select('*');
        if (!channels || channels.length === 0) {
          await sendMessage(chatId, `No channels found.`, adminMenuKeyboard());
        } else {
          let list = `🗑 <b>Remove Channel</b>\n\nSend: <code>/removechannel ID</code>\n\n`;
          channels.forEach(c => {
            list += `ID: <b>${c.id}</b> — ${c.channel_name} (@${c.channel_username})\n`;
          });
          await sendMessage(chatId, list, adminMenuKeyboard());
        }
        return res.status(200).json({ ok: true });
      }

      if (text.startsWith('/removechannel ')) {
        const id = parseInt(text.replace('/removechannel ', '').trim());
        await supabase.from('required_channels').delete().eq('id', id);
        await sendMessage(chatId, `✅ Channel ID ${id} removed.`, adminMenuKeyboard());
        return res.status(200).json({ ok: true });
      }

      // ── All Users ──
      if (text === '👥 All Users') {
        const { data: users } = await supabase
          .from('users').select('*').order('points', { ascending: false }).limit(20);
        if (!users || users.length === 0) {
          await sendMessage(chatId, `No users found.`, adminMenuKeyboard());
        } else {
          let list = `👥 <b>Top 20 Users</b>\n\n`;
          users.forEach((u, i) => {
            list += `${i + 1}. @${u.username} — <b>${u.points} pts</b>\n`;
          });
          await sendMessage(chatId, list, adminMenuKeyboard());
        }
        return res.status(200).json({ ok: true });
      }

      // ── Give Points ──
      if (text === '💰 Give Points') {
        await sendMessage(chatId,
          `💰 <b>Give Points</b>\n\nFormat:\n<code>/givepoints TelegramID | Points</code>\n\nExample:\n<code>/givepoints 123456789 | 50</code>\n\n(Get user's Telegram ID from the All Users section)`,
          adminMenuKeyboard()
        );
        return res.status(200).json({ ok: true });
      }

      if (text.startsWith('/givepoints ')) {
        const parts = text.replace('/givepoints ', '').split('|').map(s => s.trim());
        if (parts.length < 2) {
          await sendMessage(chatId,
            `❌ Wrong format. Use:\n<code>/givepoints TelegramID | Points</code>`,
            adminMenuKeyboard()
          );
        } else {
          await supabase.rpc('increment_points', {
            user_telegram_id: parts[0],
            amount: parseInt(parts[1]),
          });
          await sendMessage(chatId,
            `✅ Gave <b>${parts[1]} points</b> to user ID <b>${parts[0]}</b>`,
            adminMenuKeyboard()
          );
        }
        return res.status(200).json({ ok: true });
      }

      // ── Back to Main Menu ──
      if (text === '🏠 Main Menu') {
        await sendMessage(chatId,
          `🏠 <b>Main Menu</b>`,
          mainMenuKeyboard()
        );
        return res.status(200).json({ ok: true });
      }
    }

    // ─── USER COMMANDS ────────────────────────
    const { data: userData } = await supabase
      .from('users').select('*').eq('telegram_id', userId).single();

    if (!userData) {
      const { data: channels } = await supabase
        .from('required_channels').select('*');
      await sendMessage(chatId,
        `⚠️ Please press /start first to register.`,
        forceJoinKeyboard(channels)
      );
      return res.status(200).json({ ok: true });
    }

    if (text === '🔷 IVS Panel') {
      await sendMessage(chatId, `🔷 <b>IVS Panel</b>\n\nComing soon!`, mainMenuKeyboard());
    }
    else if (text === '📱 SMS Panel') {
      await sendMessage(chatId, `📱 <b>SMS Panel</b>\n\nComing soon!`, mainMenuKeyboard());
    }
    else if (text === '📊 INF Panel') {
      await sendMessage(chatId, `📊 <b>INF Panel</b>\n\nComing soon!`, mainMenuKeyboard());
    }
    else if (text === '🛠 IMS Panel') {
      await sendMessage(chatId, `🛠 <b>IMS Panel</b>\n\nComing soon!`, mainMenuKeyboard());
    }
    else if (text === '/points' || text === '💰 My Points') {
      await sendMessage(chatId,
        `💰 <b>Your Balance</b>\n\nYou have <b>${userData.points} points</b>.`,
        mainMenuKeyboard()
      );
    }
    else if (text === '/referral' || text === '🔗 My Referral Link') {
      const link = `https://t.me/${BOT_USERNAME}?start=${userId}`;
      await sendMessage(chatId,
        `🔗 <b>Your Referral Link</b>\n\n<code>${link}</code>\n\n✅ Earn <b>10 points</b> per new user!`,
        mainMenuKeyboard()
      );
    }
    else if (text === '/redeem' || text === '🎁 Redeem Code') {
      await sendMessage(chatId,
        `🎁 <b>Redeem a Code</b>\n\nSend: <code>/code YOURCODE</code>`,
        mainMenuKeyboard()
      );
    }
    else if (text.startsWith('/code ')) {
      const code = text.replace('/code ', '').trim().toUpperCase();
      const { data: codeData } = await supabase
        .from('redeem_codes').select('*').eq('code', code).single();

      if (!codeData) {
        await sendMessage(chatId, `❌ Invalid code.`, mainMenuKeyboard());
      } else if (codeData.used_count >= codeData.max_uses) {
        await sendMessage(chatId, `❌ Code expired.`, mainMenuKeyboard());
      } else {
        const { data: alreadyUsed } = await supabase
          .from('used_codes').select('*').eq('telegram_id', userId).eq('code', code).single();
        if (alreadyUsed) {
          await sendMessage(chatId, `❌ Already used this code.`, mainMenuKeyboard());
        } else {
          await supabase.rpc('increment_points', { user_telegram_id: userId, amount: codeData.points });
          await supabase.from('used_codes').insert({ telegram_id: userId, code });
          await supabase.from('redeem_codes').update({ used_count: codeData.used_count + 1 }).eq('code', code);
          await sendMessage(chatId,
            `✅ <b>Redeemed!</b> You got <b>${codeData.points} points!</b>\n\nNew balance: <b>${userData.points + codeData.points} points</b>`,
            mainMenuKeyboard()
          );
        }
      }
    }
    else if (text === '/store' || text === '🛍 Contacts Store') {
      const { data: contacts } = await supabase
        .from('contacts').select('*').eq('is_available', true);
      if (!contacts || contacts.length === 0) {
        await sendMessage(chatId, `🛍 No contacts available yet.`, mainMenuKeyboard());
      } else {
        let storeText = `🛍 <b>Contacts Store</b>\n\nYour balance: <b>${userData.points} pts</b>\n\n`;
        contacts.forEach(c => {
          storeText += `📋 <b>${c.name}</b>\n💬 ${c.description}\n💰 <b>${c.points_cost} pts</b> → <code>/buy ${c.id}</code>\n\n`;
        });
        await sendMessage(chatId, storeText, mainMenuKeyboard());
      }
    }
    else if (text.startsWith('/buy ')) {
      const contactId = parseInt(text.replace('/buy ', '').trim());
      const { data: contact } = await supabase
        .from('contacts').select('*').eq('id', contactId).eq('is_available', true).single();

      if (!contact) {
        await sendMessage(chatId, `❌ Contact not found.`, mainMenuKeyboard());
      } else {
        const { data: alreadyBought } = await supabase
          .from('user_contacts').select('*').eq('telegram_id', userId).eq('contact_id', contactId).single();
        if (alreadyBought) {
          await sendMessage(chatId,
            `✅ Already purchased!\n\n📞 <b>${contact.name}</b>: <code>${contact.phone}</code>`,
            mainMenuKeyboard()
          );
        } else if (userData.points < contact.points_cost) {
          await sendMessage(chatId,
            `❌ Need <b>${contact.points_cost} pts</b>, you have <b>${userData.points} pts</b>.`,
            mainMenuKeyboard()
          );
        } else {
          await supabase.rpc('increment_points', { user_telegram_id: userId, amount: -contact.points_cost });
          await supabase.from('user_contacts').insert({ telegram_id: userId, contact_id: contactId });
          await sendMessage(chatId,
            `✅ <b>Purchased!</b>\n\n📞 <b>${contact.name}</b>\n📱 <code>${contact.phone}</code>\n\n💰 Spent: ${contact.points_cost} pts\nLeft: <b>${userData.points - contact.points_cost} pts</b>`,
            mainMenuKeyboard()
          );
        }
      }
    }
    else if (text === '/help' || text === '❓ Help' || text === '📋 Commands') {
      await sendMessage(chatId,
        `📋 <b>All Commands</b>\n\n/start — Start & verify\n/points — Your balance\n/referral — Your referral link\n/redeem — Redeem a code\n/code CODE — Use a code\n/store — Contacts store\n/buy ID — Buy a contact\n/help — This menu`,
        mainMenuKeyboard()
      );
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true });
  }
    }

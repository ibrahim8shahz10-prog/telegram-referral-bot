const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = 'ReActsHelPer_bot';
const ADMIN_ID = process.env.ADMIN_ID;

// ─────────────────────────────────────────────
// TELEGRAM API HELPERS
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
// DATABASE HELPERS
// ─────────────────────────────────────────────

async function getChannels() {
  const { data } = await supabase.from('required_channels').select('*');
  return data || [];
}

async function getUser(userId) {
  const { data } = await supabase.from('users').select('*').eq('telegram_id', userId).single();
  return data || null;
}

async function getPanels() {
  const { data } = await supabase.from('panels').select('*').eq('is_active', true).order('id');
  return data || [];
}

// ─────────────────────────────────────────────
// KEYBOARDS
// ─────────────────────────────────────────────

async function mainMenuKeyboard() {
  const panels = await getPanels();
  const rows = [];

  // Build panel buttons in pairs
  for (let i = 0; i < panels.length; i += 2) {
    const row = [{ text: `${panels[i].name} (${panels[i].price} pts)` }];
    if (panels[i + 1]) row.push({ text: `${panels[i + 1].name} (${panels[i + 1].price} pts)` });
    rows.push(row);
  }

  rows.push([{ text: '💰 My Points' }, { text: '🔗 Referral Link' }]);
  rows.push([{ text: '🎁 Redeem Code' }, { text: '📋 Commands' }]);

  return { keyboard: rows, resize_keyboard: true, persistent: true };
}

function adminMenuKeyboard() {
  return {
    keyboard: [
      [{ text: '➕ Add Panel' }, { text: '✏️ Edit Panel' }],
      [{ text: '❌ Delete Panel' }, { text: '📋 List Panels' }],
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
  if (!channels || channels.length === 0) return null;
  const buttons = channels.map(c => ([{
    text: `📢 Join ${c.channel_name}`,
    url: c.invite_link
  }]));
  buttons.push([{ text: '✅ I Joined — Verify Me', callback_data: 'verify' }]);
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

    // ─── CALLBACK QUERIES ─────────────────────
    if (body.callback_query) {
      const cb = body.callback_query;
      const userId = cb.from.id.toString();
      const chatId = cb.message.chat.id;
      const messageId = cb.message.message_id;
      const firstName = cb.from.first_name || 'User';

      await answerCallback(cb.id, '⏳ Checking...');

      if (cb.data === 'verify') {
        const channels = await getChannels();

        // Check all channels
        const results = await Promise.all(
          channels.map(c => checkMembership(userId, c.channel_username))
        );
        const notJoined = channels.filter((_, i) => !results[i]);

        if (notJoined.length > 0) {
          const names = notJoined.map(c => `❌ ${c.channel_name}`).join('\n');
          await editMessage(chatId, messageId,
            `⚠️ <b>You haven't joined all channels!</b>\n\nStill need to join:\n${names}\n\nJoin them and press Verify again.`,
            forceJoinKeyboard(channels)
          );
        } else {
          // All joined — mark as verified
          const existingUser = await getUser(userId);

          if (!existingUser) {
            await supabase.from('users').insert({
              telegram_id: userId,
              username: cb.from.username || '',
              first_name: firstName,
              points: 0,
              is_verified: true,
            });
          } else {
            await supabase.from('users').update({ is_verified: true }).eq('telegram_id', userId);

            // Give referrer points
            if (existingUser.referrer_id) {
              await supabase.rpc('increment_points', {
                user_telegram_id: existingUser.referrer_id,
                amount: 10,
              });
              await supabase.from('users').update({ referrer_id: null }).eq('telegram_id', userId);
            }
          }

          await editMessage(chatId, messageId,
            `✅ <b>Verified! Welcome ${firstName}!</b>\n\nYou now have full access to the bot! 🎉`,
            null
          );

          const menuKb = await mainMenuKeyboard();
          await sendMessage(chatId,
            `🏠 <b>Main Menu</b>\n\nHello ${firstName}! Choose an option below:`,
            menuKb
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
    const username = message.from.username || '';
    const firstName = message.from.first_name || 'User';
    const isAdmin = userId === ADMIN_ID;

    // ─── /start ───────────────────────────────
    if (text.startsWith('/start')) {
      const parts = text.split(' ');
      const referrerId = (parts[1] && parts[1] !== userId) ? parts[1] : null;

      const existingUser = await getUser(userId);

      if (existingUser && existingUser.is_verified) {
        // Already verified — show main menu directly
        const menuKb = await mainMenuKeyboard();
        await sendMessage(chatId,
          `👋 <b>Welcome back, ${firstName}!</b>\n\n💰 Points: <b>${existingUser.points}</b>\n\nChoose an option:`,
          menuKb
        );
      } else {
        // Save referrer if new user
        if (!existingUser) {
          await supabase.from('users').insert({
            telegram_id: userId,
            username,
            first_name: firstName,
            points: 0,
            referrer_id: referrerId,
            is_verified: false,
          });
        }

        // Show force join
        const channels = await getChannels();

        if (channels.length === 0) {
          // No channels required — auto verify
          await supabase.from('users').update({ is_verified: true }).eq('telegram_id', userId);
          const menuKb = await mainMenuKeyboard();
          await sendMessage(chatId,
            `👋 <b>Welcome, ${firstName}!</b>\n\nYou now have full access!`,
            menuKb
          );
        } else {
          await sendMessage(chatId,
            `👋 <b>Welcome to the bot, ${firstName}!</b>\n\n🔒 To get access, please join all our channels below.\n\nAfter joining, press the <b>Verify</b> button.`,
            forceJoinKeyboard(channels)
          );
        }
      }

      return res.status(200).json({ ok: true });
    }

    // ─── /admin ───────────────────────────────
    if (text === '/admin') {
      if (!isAdmin) {
        await sendMessage(chatId, `❌ You are not authorized to use this command.`);
      } else {
        await sendMessage(chatId,
          `🔐 <b>Admin Panel</b>\n\nWelcome back, Admin!\n\nWhat would you like to manage?`,
          adminMenuKeyboard()
        );
      }
      return res.status(200).json({ ok: true });
    }

    // ─── ADMIN SECTION ────────────────────────
    if (isAdmin) {

      // ── Add Panel ──
      if (text === '➕ Add Panel') {
        await sendMessage(chatId,
          `➕ <b>Add New Panel</b>\n\nSend in this format:\n<code>/addpanel Name | Price | Description | Content</code>\n\nExample:\n<code>/addpanel VIP Panel | 50 | Premium VIP access | Your VIP login details here</code>`,
          adminMenuKeyboard()
        );
        return res.status(200).json({ ok: true });
      }

      if (text.startsWith('/addpanel ')) {
        const parts = text.replace('/addpanel ', '').split('|').map(s => s.trim());
        if (parts.length < 4) {
          await sendMessage(chatId,
            `❌ Wrong format! Use:\n<code>/addpanel Name | Price | Description | Content</code>`,
            adminMenuKeyboard()
          );
        } else {
          await supabase.from('panels').insert({
            name: parts[0],
            price: parseInt(parts[1]) || 0,
            description: parts[2],
            content: parts[3],
            is_active: true,
          });
          await sendMessage(chatId,
            `✅ Panel <b>${parts[0]}</b> added!\n💰 Price: ${parts[1]} points`,
            adminMenuKeyboard()
          );
        }
        return res.status(200).json({ ok: true });
      }

      // ── List Panels ──
      if (text === '📋 List Panels') {
        const panels = await getPanels();
        if (panels.length === 0) {
          await sendMessage(chatId, `No panels found.`, adminMenuKeyboard());
        } else {
          let list = `📋 <b>All Panels</b>\n\n`;
          panels.forEach(p => {
            list += `🆔 ID: <b>${p.id}</b>\n📌 Name: <b>${p.name}</b>\n💰 Price: <b>${p.price} pts</b>\n📝 ${p.description}\n\n`;
          });
          await sendMessage(chatId, list, adminMenuKeyboard());
        }
        return res.status(200).json({ ok: true });
      }

      // ── Edit Panel ──
      if (text === '✏️ Edit Panel') {
        const panels = await getPanels();
        if (panels.length === 0) {
          await sendMessage(chatId, `No panels found.`, adminMenuKeyboard());
        } else {
          let list = `✏️ <b>Edit Panel</b>\n\nSend in this format:\n<code>/editpanel ID | Name | Price | Description | Content</code>\n\nCurrent panels:\n\n`;
          panels.forEach(p => {
            list += `ID <b>${p.id}</b> — ${p.name} (${p.price} pts)\n`;
          });
          await sendMessage(chatId, list, adminMenuKeyboard());
        }
        return res.status(200).json({ ok: true });
      }

      if (text.startsWith('/editpanel ')) {
        const parts = text.replace('/editpanel ', '').split('|').map(s => s.trim());
        if (parts.length < 5) {
          await sendMessage(chatId,
            `❌ Wrong format! Use:\n<code>/editpanel ID | Name | Price | Description | Content</code>`,
            adminMenuKeyboard()
          );
        } else {
          await supabase.from('panels').update({
            name: parts[1],
            price: parseInt(parts[2]) || 0,
            description: parts[3],
            content: parts[4],
          }).eq('id', parseInt(parts[0]));
          await sendMessage(chatId,
            `✅ Panel ID <b>${parts[0]}</b> updated!\n📌 Name: ${parts[1]}\n💰 Price: ${parts[2]} pts`,
            adminMenuKeyboard()
          );
        }
        return res.status(200).json({ ok: true });
      }

      // ── Delete Panel ──
      if (text === '❌ Delete Panel') {
        const panels = await getPanels();
        if (panels.length === 0) {
          await sendMessage(chatId, `No panels found.`, adminMenuKeyboard());
        } else {
          let list = `❌ <b>Delete Panel</b>\n\nSend: <code>/deletepanel ID</code>\n\n`;
          panels.forEach(p => { list += `ID <b>${p.id}</b> — ${p.name} (${p.price} pts)\n`; });
          await sendMessage(chatId, list, adminMenuKeyboard());
        }
        return res.status(200).json({ ok: true });
      }

      if (text.startsWith('/deletepanel ')) {
        const id = parseInt(text.replace('/deletepanel ', '').trim());
        await supabase.from('panels').update({ is_active: false }).eq('id', id);
        await sendMessage(chatId, `✅ Panel ID <b>${id}</b> deleted.`, adminMenuKeyboard());
        return res.status(200).json({ ok: true });
      }

      // ── Create Code ──
      if (text === '🎟 Create Code') {
        await sendMessage(chatId,
          `🎟 <b>Create Redeem Code</b>\n\nFormat:\n<code>/createcode CODE | Points | MaxUses</code>\n\nExample:\n<code>/createcode WELCOME100 | 100 | 50</code>`,
          adminMenuKeyboard()
        );
        return res.status(200).json({ ok: true });
      }

      if (text.startsWith('/createcode ')) {
        const parts = text.replace('/createcode ', '').split('|').map(s => s.trim());
        if (parts.length < 3) {
          await sendMessage(chatId,
            `❌ Wrong format! Use:\n<code>/createcode CODE | Points | MaxUses</code>`,
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
            `✅ Code <b>${parts[0].toUpperCase()}</b> created!\n💰 ${parts[1]} points | 👥 Max uses: ${parts[2]}`,
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
          `📢 <b>Add Required Channel</b>\n\nFormat:\n<code>/addchannel username | Name | https://t.me/link</code>\n\nExample:\n<code>/addchannel mychannel | My Channel | https://t.me/mychannel</code>`,
          adminMenuKeyboard()
        );
        return res.status(200).json({ ok: true });
      }

      if (text.startsWith('/addchannel ')) {
        const parts = text.replace('/addchannel ', '').split('|').map(s => s.trim());
        if (parts.length < 3) {
          await sendMessage(chatId,
            `❌ Wrong format! Use:\n<code>/addchannel username | Name | link</code>`,
            adminMenuKeyboard()
          );
        } else {
          await supabase.from('required_channels').insert({
            channel_username: parts[0],
            channel_name: parts[1],
            invite_link: parts[2],
          });
          await sendMessage(chatId, `✅ Channel <b>${parts[1]}</b> added to force join!`, adminMenuKeyboard());
        }
        return res.status(200).json({ ok: true });
      }

      // ── Remove Channel ──
      if (text === '🗑 Remove Channel') {
        const channels = await getChannels();
        if (channels.length === 0) {
          await sendMessage(chatId, `No channels found.`, adminMenuKeyboard());
        } else {
          let list = `🗑 <b>Remove Channel</b>\n\nSend: <code>/removechannel ID</code>\n\n`;
          channels.forEach(c => { list += `ID <b>${c.id}</b> — ${c.channel_name} (@${c.channel_username})\n`; });
          await sendMessage(chatId, list, adminMenuKeyboard());
        }
        return res.status(200).json({ ok: true });
      }

      if (text.startsWith('/removechannel ')) {
        const id = parseInt(text.replace('/removechannel ', '').trim());
        await supabase.from('required_channels').delete().eq('id', id);
        await sendMessage(chatId, `✅ Channel removed successfully.`, adminMenuKeyboard());
        return res.status(200).json({ ok: true });
      }

      // ── All Users ──
      if (text === '👥 All Users') {
        const { data: users } = await supabase
          .from('users').select('*').order('points', { ascending: false }).limit(20);
        if (!users || users.length === 0) {
          await sendMessage(chatId, `No users yet.`, adminMenuKeyboard());
        } else {
          let list = `👥 <b>All Users (Top 20)</b>\n\n`;
          users.forEach((u, i) => {
            list += `${i + 1}. <b>${u.first_name || u.username}</b>\n   💰 ${u.points} pts | ID: <code>${u.telegram_id}</code>\n\n`;
          });
          await sendMessage(chatId, list, adminMenuKeyboard());
        }
        return res.status(200).json({ ok: true });
      }

      // ── Give Points ──
      if (text === '💰 Give Points') {
        await sendMessage(chatId,
          `💰 <b>Give Points to User</b>\n\nFormat:\n<code>/givepoints TelegramID | Points</code>\n\nExample:\n<code>/givepoints 123456789 | 100</code>\n\n(Find IDs in All Users section)`,
          adminMenuKeyboard()
        );
        return res.status(200).json({ ok: true });
      }

      if (text.startsWith('/givepoints ')) {
        const parts = text.replace('/givepoints ', '').split('|').map(s => s.trim());
        if (parts.length < 2) {
          await sendMessage(chatId,
            `❌ Wrong format! Use:\n<code>/givepoints TelegramID | Points</code>`,
            adminMenuKeyboard()
          );
        } else {
          await supabase.rpc('increment_points', {
            user_telegram_id: parts[0],
            amount: parseInt(parts[1]),
          });
          await sendMessage(chatId,
            `✅ Gave <b>${parts[1]} points</b> to user <b>${parts[0]}</b>`,
            adminMenuKeyboard()
          );
        }
        return res.status(200).json({ ok: true });
      }

      // ── Back to Main Menu ──
      if (text === '🏠 Main Menu') {
        const menuKb = await mainMenuKeyboard();
        await sendMessage(chatId, `🏠 <b>Main Menu</b>`, menuKb);
        return res.status(200).json({ ok: true });
      }
    }

    // ─── USER SECTION ─────────────────────────
    const userData = await getUser(userId);

    if (!userData || !userData.is_verified) {
      const channels = await getChannels();
      if (channels.length > 0) {
        await sendMessage(chatId,
          `⚠️ Please send /start and verify first to use the bot.`,
          forceJoinKeyboard(channels)
        );
      } else {
        await sendMessage(chatId, `⚠️ Please send /start first.`);
      }
      return res.status(200).json({ ok: true });
    }

    // ── Points ──
    if (text === '/points' || text === '💰 My Points') {
      await sendMessage(chatId,
        `💰 <b>Your Balance</b>\n\nYou have <b>${userData.points} points</b>.\n\n🎁 Use /redeem to add more points with a code.\n🔗 Share your referral link to earn points!`,
        await mainMenuKeyboard()
      );
      return res.status(200).json({ ok: true });
    }

    // ── Referral ──
    if (text === '/referral' || text === '🔗 Referral Link') {
      const link = `https://t.me/${BOT_USERNAME}?start=${userId}`;
      await sendMessage(chatId,
        `🔗 <b>Your Referral Link</b>\n\n<code>${link}</code>\n\nShare this link!\n✅ You earn <b>10 points</b> for every new verified user.`,
        await mainMenuKeyboard()
      );
      return res.status(200).json({ ok: true });
    }

    // ── Redeem ──
    if (text === '/redeem' || text === '🎁 Redeem Code') {
      await sendMessage(chatId,
        `🎁 <b>Redeem a Code</b>\n\nSend your code like this:\n<code>/code YOURCODE</code>\n\nExample: <code>/code WELCOME100</code>`,
        await mainMenuKeyboard()
      );
      return res.status(200).json({ ok: true });
    }

    if (text.startsWith('/code ')) {
      const code = text.replace('/code ', '').trim().toUpperCase();
      const { data: codeData } = await supabase
        .from('redeem_codes').select('*').eq('code', code).single();

      if (!codeData) {
        await sendMessage(chatId, `❌ Invalid code. Please check and try again.`, await mainMenuKeyboard());
      } else if (codeData.used_count >= codeData.max_uses) {
        await sendMessage(chatId, `❌ This code has expired.`, await mainMenuKeyboard());
      } else {
        const { data: alreadyUsed } = await supabase
          .from('used_codes').select('*').eq('telegram_id', userId).eq('code', code).single();
        if (alreadyUsed) {
          await sendMessage(chatId, `❌ You already used this code.`, await mainMenuKeyboard());
        } else {
          await supabase.rpc('increment_points', { user_telegram_id: userId, amount: codeData.points });
          await supabase.from('used_codes').insert({ telegram_id: userId, code });
          await supabase.from('redeem_codes').update({ used_count: codeData.used_count + 1 }).eq('code', code);
          await sendMessage(chatId,
            `✅ <b>Code Redeemed!</b>\n\nYou got <b>${codeData.points} points!</b>\n\nNew balance: <b>${userData.points + codeData.points} points</b>`,
            await mainMenuKeyboard()
          );
        }
      }
      return res.status(200).json({ ok: true });
    }

    // ── Commands ──
    if (text === '/help' || text === '📋 Commands') {
      await sendMessage(chatId,
        `📋 <b>All Commands</b>\n\n/start — Start the bot\n/points — Check your points\n/referral — Get your referral link\n/redeem — Redeem a code\n/code CODE — Use a specific code\n/help — Show this menu`,
        await mainMenuKeyboard()
      );
      return res.status(200).json({ ok: true });
    }

    // ── Panel Buttons ──
    const panels = await getPanels();
    const matchedPanel = panels.find(p => text.startsWith(p.name));

    if (matchedPanel) {
      const { data: alreadyBought } = await supabase
        .from('user_panels').select('*')
        .eq('telegram_id', userId).eq('panel_id', matchedPanel.id).single();

      if (alreadyBought) {
        await sendMessage(chatId,
          `✅ <b>${matchedPanel.name}</b>\n\nYou already have access!\n\n📋 <b>Content:</b>\n${matchedPanel.content}`,
          await mainMenuKeyboard()
        );
      } else if (userData.points < matchedPanel.price) {
        await sendMessage(chatId,
          `❌ <b>Not enough points!</b>\n\n${matchedPanel.name} costs <b>${matchedPanel.price} pts</b>\nYou have <b>${userData.points} pts</b>\n\n🔗 Share your referral link to earn more points!`,
          await mainMenuKeyboard()
        );
      } else {
        await supabase.rpc('increment_points', { user_telegram_id: userId, amount: -matchedPanel.price });
        await supabase.from('user_panels').insert({ telegram_id: userId, panel_id: matchedPanel.id });
        await sendMessage(chatId,
          `✅ <b>Purchase Successful!</b>\n\n📌 <b>${matchedPanel.name}</b>\n\n📋 <b>Content:</b>\n${matchedPanel.content}\n\n💰 Spent: ${matchedPanel.price} pts\nRemaining: <b>${userData.points - matchedPanel.price} pts</b>`,
          await mainMenuKeyboard()
        );
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true });
  }
                                                    }

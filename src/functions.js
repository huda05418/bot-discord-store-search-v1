const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./database');
const config = require('./config');

async function updateAdminDashboard(client) {
    const channel = client.channels.cache.get(config.channels.admin_dashboard);
    if (!channel) return console.log("[DASHBOARD] Error: Channel Dashboard tidak ditemukan!");

    const [rows] = await db.query('SELECT COUNT(*) as total_trx, SUM(price) as total_money, AVG(rating) as avg_rating FROM transactions');
    const stats = rows[0];
    const totalMoney = stats.total_money || 0;
    const avgRating = stats.avg_rating ? parseFloat(stats.avg_rating).toFixed(1) : '0.0';

    const embed = new EmbedBuilder()
        .setTitle('SEARCH - Admin Control Panel')
        .setDescription('Panel kontrol admin untuk manajemen tiket dan toko.')
        .addFields(
            { name: 'Total Transaksi', value: `Rp ${totalMoney.toLocaleString('id-ID')}`, inline: true },
            { name: 'Reputasi Toko', value: `⭐ ${avgRating}/10`, inline: true },
            { name: 'Total Order Sukses', value: `${stats.total_trx} Order`, inline: true }
        )
        .setColor('Blurple')
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('admin_close_ticket').setLabel('Proses Transaksi (Buy)').setStyle(ButtonStyle.Danger).setEmoji('💸'),
        new ButtonBuilder().setCustomId('toggle_store').setLabel('Buka/Tutup Toko').setStyle(ButtonStyle.Secondary).setEmoji('🏪')
    );

    const [settings] = await db.query('SELECT setting_value FROM system_settings WHERE setting_key = "dashboard_msg_id"');
    let msgId = settings[0]?.setting_value;
    let messageFound = false;

    console.log(`[DASHBOARD] ID Tersimpan di DB: ${msgId || 'KOSONG'}`);

    if (msgId) {
        try {
            const msg = await channel.messages.fetch(msgId);
            if (msg) {
                await msg.edit({ embeds: [embed], components: [row] });
                console.log("[DASHBOARD] Sukses EDIT pesan lama.");
                messageFound = true;
            }
        } catch (e) {
            console.log(`[DASHBOARD] Pesan lama tidak ketemu/terhapus (${e.message}). Membuat baru...`);
        }
    }

    if (!messageFound) {
        if (msgId) {
            try { const old = await channel.messages.fetch(msgId); await old.delete(); } catch(e){}
        }

        const newMsg = await channel.send({ embeds: [embed], components: [row] });
        console.log(`[DASHBOARD] Pesan baru terkirim. ID: ${newMsg.id}`);

        await db.query(`
            INSERT INTO system_settings (setting_key, setting_value) 
            VALUES ('dashboard_msg_id', ?) 
            ON DUPLICATE KEY UPDATE setting_value = ?`, 
            [newMsg.id, newMsg.id]
        );
        console.log("[DASHBOARD] Database diperbarui.");
    }
}

async function updateStoreStatus(client) {
    const channel = client.channels.cache.get(config.channels.status_info);
    if (!channel) return console.log("[STATUS] Error: Channel Status tidak ditemukan!");

    const [rows] = await db.query('SELECT setting_value FROM system_settings WHERE setting_key = "store_status"');
    const status = rows[0]?.setting_value || 'OPEN';
    const isOpen = status === 'OPEN';

    const embed = new EmbedBuilder()
        .setTitle(isOpen ? '🟢 TOKO BUKA (OPEN)' : '🟠 TOKO TUTUP (SLOW RESPON)')
        .setDescription(isOpen 
            ? 'Halo @everyone! Store sudah buka kembali.\nSilahkan buat tiket di bawah untuk order atau bertanya. Admin Fast Respon!' 
            : 'Halo, saat ini toko sedang tutup/istirahat.\n**Anda tetap bisa membuat tiket**, namun mohon bersabar karena respon admin akan lambat (Slow Respon).')
        .setImage(isOpen ? config.images.open : config.images.close)
        .setColor(isOpen ? 'Green' : 'Orange')
        .setTimestamp();
    
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('create_ticket')
            .setLabel('Buat Tiket')
            .setStyle(isOpen ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(false)
            .setEmoji('📩')
    );

    const [settings] = await db.query('SELECT setting_value FROM system_settings WHERE setting_key = "status_msg_id"');
    let msgId = settings[0]?.setting_value;

    
    if (isOpen) {
        if (msgId) {
            try { const oldMsg = await channel.messages.fetch(msgId); await oldMsg.delete(); } catch (e) {}
        }
        const newMsg = await channel.send({ content: '@everyone', embeds: [embed], components: [row] });
        
        await db.query(`
            INSERT INTO system_settings (setting_key, setting_value) 
            VALUES ('status_msg_id', ?) 
            ON DUPLICATE KEY UPDATE setting_value = ?`, 
            [newMsg.id, newMsg.id]
        );
    } 
    else {
        let edited = false;
        if (msgId) {
            try {
                const msg = await channel.messages.fetch(msgId);
                await msg.edit({ content: '', embeds: [embed], components: [row] });
                edited = true;
            } catch (e) {}
        }
        
        if (!edited) {
            const newMsg = await channel.send({ embeds: [embed], components: [row] });
            await db.query(`
                INSERT INTO system_settings (setting_key, setting_value) 
                VALUES ('status_msg_id', ?) 
                ON DUPLICATE KEY UPDATE setting_value = ?`, 
                [newMsg.id, newMsg.id]
            );
        }
    }
}

module.exports = { updateAdminDashboard, updateStoreStatus };
const { 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, 
    PermissionsBitField, ChannelType 
} = require('discord.js');
const db = require('../database');
const config = require('../config');
const { updateAdminDashboard, updateStoreStatus } = require('../functions');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        
        // --- 1. MEMBUAT TICKET ---
        if (interaction.isButton() && interaction.customId === 'create_ticket') {
            const existingChannel = interaction.guild.channels.cache.find(c => c.topic === interaction.user.id);
            if (existingChannel) return interaction.reply({ content: `Kamu sudah punya tiket di <#${existingChannel.id}>`, ephemeral: true });

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('ticket_type')
                    .setPlaceholder('Pilih Tujuan Tiket')
                    .addOptions(
                        { label: 'Bertanya (Ask)', value: 'ask', description: 'Ingin bertanya sesuatu' },
                        { label: 'Membeli (Buy)', value: 'buy', description: 'Ingin memesan jasa/produk' }
                    )
            );
            return interaction.reply({ content: 'Pilih jenis tiket:', components: [row], ephemeral: true });
        }

        // --- 2. SELECT MENU TICKET TYPE ---
        if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_type') {
            const type = interaction.values[0];

            if (type === 'buy') {
                const modal = new ModalBuilder().setCustomId('modal_buy').setTitle('Formulir Pembelian');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('buy_title').setLabel('Apa yang mau dibeli?').setStyle(TextInputStyle.Short)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('buy_budget').setLabel('Budget Kamu?').setStyle(TextInputStyle.Short))
                );
                await interaction.showModal(modal);
            } else {
                await createTicket(interaction, 'Bertanya', 'Gratis', 'Ask');
            }
        }

        // --- 3. SUBMIT MODAL BELI ---
        if (interaction.isModalSubmit() && interaction.customId === 'modal_buy') {
            const title = interaction.fields.getTextInputValue('buy_title');
            const budget = interaction.fields.getTextInputValue('buy_budget');
            await createTicket(interaction, title, budget, 'Buy');
        }

        // --- 4. TOGGLE STORE (ADMIN) ---
        // === PERBAIKAN DI SINI ===
        if (interaction.isButton() && interaction.customId === 'toggle_store') {
            if (!interaction.member.roles.cache.has(config.roles.admin)) return interaction.reply({content: 'Khusus Admin!', ephemeral: true});
            
            // Cek status sekarang
            const [rows] = await db.query('SELECT setting_value FROM system_settings WHERE setting_key = "store_status"');
            const currentStatus = rows[0]?.setting_value || 'OPEN';
            const newStatus = currentStatus === 'OPEN' ? 'CLOSE' : 'OPEN';
            
            console.log(`[STORE] Mengubah status dari ${currentStatus} ke ${newStatus}`);

            // PAKSA SIMPAN KE DB (Menggunakan INSERT ... ON DUPLICATE KEY)
            // Ini memastikan status tersimpan meskipun baris datanya hilang/belum ada
            await db.query(`
                INSERT INTO system_settings (setting_key, setting_value) 
                VALUES ('store_status', ?) 
                ON DUPLICATE KEY UPDATE setting_value = ?`, 
                [newStatus, newStatus]
            );
            
            // Panggil fungsi update tampilan
            await updateStoreStatus(client);
            return interaction.reply({ content: `Toko berhasil diubah menjadi **${newStatus}**`, ephemeral: true });
        }

        // --- 5. LOGIKA CLOSE TICKET MANUAL (ASK) ---
        if (interaction.isButton() && interaction.customId === 'close_ask_ticket') {
             try {
                await interaction.channel.delete();
             } catch (err) {}
        }

        // --- 6. ADMIN PROCESS TRANSACTION ---
        if (interaction.isButton() && interaction.customId === 'admin_close_ticket') {
            if (!interaction.member.roles.cache.has(config.roles.admin)) return interaction.reply({content: 'Khusus Admin!', ephemeral: true});

            const modal = new ModalBuilder().setCustomId('modal_admin_price').setTitle('Input Harga Transaksi');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('trx_price').setLabel('Total Harga (Angka)').setStyle(TextInputStyle.Short))
            );
            await interaction.showModal(modal);
        }

        // --- 7. PILIH TIKET ---
        if (interaction.isModalSubmit() && interaction.customId === 'modal_admin_price') {
            const price = interaction.fields.getTextInputValue('trx_price');
            if (isNaN(price)) return interaction.reply({ content: 'Harga harus angka!', ephemeral: true });

            const ticketChannels = interaction.guild.channels.cache.filter(c => c.parentId === config.channels.ticket_category && c.type === ChannelType.GuildText);
            if (ticketChannels.size === 0) return interaction.reply({ content: 'Tidak ada tiket aktif.', ephemeral: true });

            const options = ticketChannels.map(c => ({ label: c.name, value: `${c.id}_${price}`, description: `Proses tiket ${c.name}` })).slice(0, 25);

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('select_ticket_close').setPlaceholder('Pilih Tiket').addOptions(options)
            );

            await interaction.reply({ content: `Harga set: Rp ${price}. Pilih tiket:`, components: [row], ephemeral: true });
        }

        // --- 8. KIRIM TAGIHAN ---
        if (interaction.isStringSelectMenu() && interaction.customId === 'select_ticket_close') {
            const [channelId, price] = interaction.values[0].split('_');
            const targetChannel = interaction.guild.channels.cache.get(channelId);

            if (!targetChannel) return interaction.reply({ content: 'Channel tiket tidak ditemukan.', ephemeral: true });

            const embed = new EmbedBuilder()
                .setTitle('TRANSAKSI SELESAI')
                .setDescription(`Tiket akan ditutup. Total: **Rp ${parseInt(price).toLocaleString('id-ID')}**.\nSilahkan berikan rating layanan kami (1-10) & Testimoni.`)
                .setColor('Gold');

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`rate_now_${price}`).setLabel('Beri Rating & Testimoni').setStyle(ButtonStyle.Success).setEmoji('⭐')
            );

            await targetChannel.send({ content: `<@${targetChannel.topic}>`, embeds: [embed], components: [row] });
            await interaction.update({ content: `Request rating dikirim ke ${targetChannel.name}`, components: [] });
        }

        // --- 9. RATING ---
        if (interaction.isButton() && interaction.customId.startsWith('rate_now_')) {
            const price = interaction.customId.split('_')[2];
            const modal = new ModalBuilder().setCustomId(`modal_rating_${price}`).setTitle('Rating & Testimoni');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rate_note').setLabel('Pesan/Testimoni Anda').setStyle(TextInputStyle.Paragraph)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rate_star').setLabel('Bintang (1-10)').setStyle(TextInputStyle.Short).setMaxLength(2))
            );
            await interaction.showModal(modal);
        }

        // --- 10. SUBMIT RATING ---
        if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_rating_')) {
            const price = parseInt(interaction.customId.split('_')[2]);
            const note = interaction.fields.getTextInputValue('rate_note');
            let stars = parseInt(interaction.fields.getTextInputValue('rate_star'));

            if (stars < 1) stars = 1; if (stars > 10) stars = 10;
            const userId = interaction.channel.topic;
            const handlerName = "SEARCH Bot"; 

            await db.query('INSERT INTO transactions (user_id, handler_id, price, rating, note) VALUES (?, ?, ?, ?, ?)', 
                [userId, handlerName, price, stars, note]);

            await interaction.reply({ content: 'Terima kasih! Tiket dihapus.' });

            const testiChannel = client.channels.cache.get(config.channels.testimonial);
            if (testiChannel) {
                const testiEmbed = new EmbedBuilder()
                    .setTitle(`Transaksi Sukses - ${handlerName}`)
                    .addFields(
                        { name: 'Pembeli', value: `<@${userId}>`, inline: true },
                        { name: 'Nominal', value: `Rp ${price.toLocaleString('id-ID')}`, inline: true },
                        { name: 'Rating', value: `${stars}/10 ⭐`, inline: true },
                        { name: 'Testimoni', value: note }
                    )
                    .setColor('Green')
                    .setTimestamp();
                await testiChannel.send({ embeds: [testiEmbed] });
            }

            await updateAdminDashboard(client);
            setTimeout(() => { try { interaction.channel.delete() } catch(e){} }, 5000);
        }
    },
};

// HELPER: CREATE TICKET
async function createTicket(interaction, title, budget, type) {
    const channelName = `ticket-${interaction.user.username.substring(0, 10)}`;
    
    const ticketChannel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: config.channels.ticket_category,
        topic: interaction.user.id,
        permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            { id: config.roles.admin, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
    });

    const embed = new EmbedBuilder()
        .setTitle(`Tiket: ${title}`)
        .setDescription(`Halo <@${interaction.user.id}>, admin akan segera merespon.\n\n**Info:**\nJenis: ${type}\nBudget: ${budget}`)
        .setColor(type === 'Buy' ? 'Green' : 'Blue'); 
    
    const row = new ActionRowBuilder();

    if (type === 'Ask') {
        row.addComponents(
            new ButtonBuilder().setCustomId('close_ask_ticket').setLabel('🔒 Tutup Tiket').setStyle(ButtonStyle.Secondary)
        );
    } else {
        row.addComponents(
            new ButtonBuilder().setCustomId('dummy_info').setLabel('Menunggu Admin...').setStyle(ButtonStyle.Secondary).setDisabled(true)
        );
    }

    await ticketChannel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [row] });
    await interaction.reply({ content: `Tiket dibuat: <#${ticketChannel.id}>`, ephemeral: true });
}
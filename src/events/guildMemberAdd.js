const config = require('../config');

module.exports = {
    name: 'guildMemberAdd',
    async execute(member) {
        const role = member.guild.roles.cache.get(config.roles.member);
        if (role) await member.roles.add(role);

        try {
            await member.send(`Selamat datang di **SEARCH**! Silahkan baca panduan di <#${config.channels.welcome}> sebelum bertransaksi.`);
        } catch (err) {
            console.log(`Tidak bisa DM ${member.user.tag}`);
        }
    },
};
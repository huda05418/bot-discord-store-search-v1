const { updateAdminDashboard, updateStoreStatus } = require('../functions');

module.exports = {
    name: 'ready',
    once: true,
    async execute(client) {
        console.log(`Login sebagai ${client.user.tag}`);
        
        await updateAdminDashboard(client);
        await updateStoreStatus(client);

        // ini refresh setiap 5 menit, bisa ganti  ya lek sesuiakn saja
        setInterval(() => updateAdminDashboard(client), 300000);
    },
};
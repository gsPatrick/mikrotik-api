// src/features/settings/settings.service.js
const { Settings } = require('../../models');
/**
Busca as configurações do sistema. Se não existirem, cria com valores padrão.
Garante que sempre haverá apenas uma linha de configurações.
*/
const getSettings = async () => {
const [settings, created] = await Settings.findOrCreate({
where: { id: 1 },
defaults: { id: 1 },
});
return settings;
};
/**
Atualiza as configurações do sistema.
*/
const updateSettings = async (settingsData) => {
const settings = await getSettings(); // Garante que as configurações existam
return await settings.update(settingsData);
};
module.exports = {
getSettings,
updateSettings,
};
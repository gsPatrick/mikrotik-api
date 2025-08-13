// src/scheduler/index.js
const cron = require('node-cron');
const { getSettings } = require('../features/settings/settings.service');
const mikrotikService = require('../features/mikrotik/mikrotik.service');
const hotspotUserService = require('../features/hotspotUser/hotspotUser.service');
const companyService = require('../features/company/company.service');
const { Company } = require('../models'); // Certifique-se de que Company está importado

const initScheduler = async () => {
  console.log('⏰ Inicializando o agendador de tarefas...');

  // --- JOB 1: Coleta de uso de dados a cada minuto ---
  cron.schedule('*/1 * * * *', () => {
    console.log(`[${new Date().toISOString()}] Executando job: Coleta de Uso...`);
    mikrotikService.collectUsageForAllCompanies();
  });

  // --- JOB 2: Monitoramento de Status de Empresas a cada 5 minutos ---
  cron.schedule('*/5 * * * *', async () => {
    console.log(`[${new Date().toISOString()}] Executando job: Monitoramento de Status de Empresas...`);
    const companies = await Company.findAll({ attributes: ['id', 'name'] });
    console.log(`Verificando status de ${companies.length} empresas.`);
    
    for (const company of companies) {
      await companyService.updateCompanyStatus(company.id);
    }
  });


  // --- JOB 3: Reset diário de créditos ---
  const settings = await getSettings();
  // Garante que settings existe, caso contrário, usa um valor padrão para evitar erro.
  const creditResetTime = settings?.creditResetTimeUTC || '03:00'; 
  const [hour, minute] = creditResetTime.split(':');
  
  const cronExpressionReset = `${minute} ${hour} * * *`;
  
  console.log(`🕐 Job de reset de créditos agendado para rodar diariamente às ${creditResetTime} UTC (${cronExpressionReset})`);

  cron.schedule(cronExpressionReset, () => {
    console.log(`[${new Date().toISOString()}] Executando job: Reset Diário de Créditos...`);
    hotspotUserService.resetDailyCreditsForAllUsers();
  }, {
    timezone: "UTC"
  });

  // --- NOVO JOB: Sincronização Diária de Usuários do MikroTik para o Sistema ---
  // Exemplo: Rodar todos os dias à 01:00 AM UTC. Ajuste a frequência conforme necessário.
  const cronExpressionImportUsers = '0 1 * * *'; // Todos os dias, à 01:00 AM UTC
  console.log(`🔄 Job de importação de usuários agendado para rodar diariamente às 01:00 AM UTC (${cronExpressionImportUsers})`);

  cron.schedule(cronExpressionImportUsers, async () => {
    console.log(`[${new Date().toISOString()}] Executando job: Sincronização Diária de Usuários MikroTik...`);
    const companies = await Company.findAll({ attributes: ['id', 'name'] });

    if (companies.length === 0) {
      console.log('Nenhuma empresa encontrada para sincronizar usuários do MikroTik.');
      return;
    }

    for (const company of companies) {
      try {
        console.log(`Sincronizando usuários MikroTik para a empresa: '${company.name}' (ID: ${company.id})...`);
        const { importedCount, skippedCount, totalInMikrotik } = await mikrotikService.importUsersFromMikrotik(company.id);
        console.log(`SUCESSO: Empresa '${company.name}' - Total no MikroTik: ${totalInMikrotik}, Importados: ${importedCount}, Ignorados (já existentes): ${skippedCount}.`);
      } catch (error) {
        console.error(`FALHA: Empresa '${company.name}' - Erro ao importar usuários: ${error.message}`);
        // Considerar logar esta falha em ConnectionLog ou Notification se for crítico
      }
    }
    console.log(`[${new Date().toISOString()}] Finalizado job: Sincronização Diária de Usuários MikroTik.`);
  }, {
    timezone: "UTC"
  });
  // --- FIM DO NOVO JOB ---

};

module.exports = { initScheduler };
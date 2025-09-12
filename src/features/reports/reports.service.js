// src/features/reports/reports.service.js
const { Company, HotspotUser, Profile } = require('../../models');
const { Op, fn, col, literal } = require('sequelize');

const getMainDashboardStats = async () => {
  // ... (esta função permanece a mesma, sem alterações)
  try {
    const totalHotspotUsers = await HotspotUser.count();
    const totalCompanies = await Company.count();
    const onlineCompanies = await Company.count({ where: { status: 'online' } });
    const totalProfiles = await Profile.count();
    const totalCreditsUsedBytes = await HotspotUser.sum('creditsUsed') || 0;
    const totalCreditsUsedGB = totalCreditsUsedBytes / (1024 * 1024 * 1024);
    return { totalHotspotUsers, totalCompanies, onlineCompanies, totalProfiles, totalCreditsUsed: totalCreditsUsedGB };
  } catch (error) {
    console.error('Erro ao buscar estatísticas do dashboard:', error);
    throw new Error('Falha ao gerar estatísticas do dashboard.');
  }
};

const getUsageReport = async (filters) => {
  const { 
    startDate, 
    endDate, 
    companyId, 
    groupBy = 'day' 
  } = filters;

  const whereClause = {
    creditsUsed: { [Op.gt]: 0 } // Apenas usuários com consumo
  };

  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    // **CORREÇÃO CRÍTICA**: Usando 'createdAt' que é mais confiável que 'lastLogoutTime'
    whereClause.createdAt = { [Op.between]: [start, end] };
  }
  if (companyId) {
    whereClause.companyId = companyId;
  }

  // --- 1. DADOS PARA O GRÁFICO DE LINHA (Consumo no Tempo) ---
  const truncUnit = groupBy === 'week' ? 'week' : (groupBy === 'month' ? 'month' : 'day');
  const dateGroup = fn('DATE_TRUNC', truncUnit, col('HotspotUser.createdAt'));
  
  const lineData = await HotspotUser.findAll({
    where: whereClause,
    attributes: [
      [dateGroup, 'period'],
      [fn('SUM', col('creditsUsed')), 'totalCreditsUsed'],
    ],
    group: ['period'],
    order: [['period', 'ASC']],
    raw: true,
  });

  // --- 2. DADOS PARA O GRÁFICO DE BARRAS (Top Empresas) ---
  const barData = await HotspotUser.findAll({
    where: whereClause,
    attributes: [
      'companyId',
      [col('company.name'), 'companyName'],
      [fn('SUM', col('creditsUsed')), 'totalCreditsUsed'],
    ],
    include: [{ model: Company, as: 'company', attributes: [] }],
    group: ['companyId', 'company.name'],
    order: [[fn('SUM', col('creditsUsed')), 'DESC']],
    limit: 5,
    raw: true,
  });

  // --- 3. DADOS PARA O GRÁFICO DE PIZZA (Consumo por Turma) ---
  const pieData = await HotspotUser.findAll({
      where: whereClause,
      attributes: [
          // Usa COALESCE para tratar turmas nulas como 'Nenhuma'
          [fn('COALESCE', col('turma'), 'Nenhuma'), 'turmaName'],
          [fn('SUM', col('creditsUsed')), 'totalCreditsUsed']
      ],
      group: ['turmaName'],
      raw: true
  });

  return { lineData, barData, pieData };
};

module.exports = {
  getMainDashboardStats,
  getUsageReport,
};
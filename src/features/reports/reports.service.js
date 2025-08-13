// src/features/reports/reports.service.js
const { Company, Profile, HotspotUser, User } = require('../../models');
const { Op, fn, col, literal, cast } = require('sequelize');

const getMainDashboardStats = async () => { /* ... (sem alterações) ... */ };

const getUsageReport = async (filters) => {
  const where = {};
  if (filters.companyId) where.companyId = filters.companyId;
  if (filters.hotspotUserId) where.id = filters.hotspotUserId;
  if (filters.turma) where.turma = { [Op.iLike]: `%${filters.turma}%` };
  if (filters.startDate && filters.endDate) {
    where.createdAt = {
      [Op.between]: [new Date(filters.startDate), new Date(filters.endDate)],
    };
  }

  // 1. Dados para o Gráfico de Linha (Consumo ao longo do tempo)
  const lineChartData = await HotspotUser.findAll({
    where,
    attributes: [
      [fn('date_trunc', 'day', col('HotspotUser.createdAt')), 'date'],
      [cast(fn('sum', col('creditsUsed')), 'bigint'), 'totalUsage'], // Cast para evitar erro de tipo de dados
    ],
    group: ['date'],
    order: [['date', 'ASC']],
    raw: true,
  });

  // 2. Dados para o Gráfico de Barras (Consumo por empresa)
  // Este gráfico só faz sentido se nenhum filtro de empresa for aplicado
  const barChartData = filters.companyId ? [] : await HotspotUser.findAll({
    where,
    attributes: [
      [col('company.name'), 'name'],
      [cast(fn('sum', col('creditsUsed')), 'bigint'), 'consumo'],
    ],
    include: [{ model: Company, as: 'company', attributes: [] }],
    group: ['company.name'],
    order: [[fn('sum', col('creditsUsed')), 'DESC']],
    limit: 5, // Top 5 empresas
    raw: true,
  });

  // 3. Dados para o Gráfico de Pizza (Comparativo entre turmas)
  const pieChartData = await HotspotUser.findAll({
    where,
    attributes: [
      ['turma', 'name'],
      [cast(fn('sum', col('creditsUsed')), 'bigint'), 'value'],
    ],
    group: ['turma'],
    raw: true,
  });

  return { lineChartData, barChartData, pieChartData };
};

module.exports = {
  getMainDashboardStats,
  getUsageReport,
};
// src/features/hotspotUser/hotspotUser.controller.js
const { validationResult } = require('express-validator');
const hotspotUserService = require('./hotspotUser.service');
// REMOVIDO: const { createActivityLog } = require('../activity/activity.service'); // Não precisa aqui, o service já importa

const getAllHotspotUsers = async (req, res) => {
  try {
    const { rows, count } = await hotspotUserService.findAllHotspotUsers(req.query);
    const totalPages = Math.ceil(count / (req.query.limit || 10));
    res.status(200).json({
      success: true,
      data: rows,
      meta: { totalItems: count, totalPages, currentPage: parseInt(req.query.page, 10) || 1 },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar usuários do hotspot.', error: error.message });
  }
};

const createHotspotUser = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const hotspotUser = await hotspotUserService.createHotspotUser(req.body);
    res.status(201).json({ success: true, message: 'Usuário do hotspot criado com sucesso!', data: hotspotUser });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao criar usuário do hotspot.', error: error.message });
  }
};

const getHotspotUserById = async (req, res) => {
  try {
    const hotspotUser = await hotspotUserService.findHotspotUserById(req.params.id);
    if (!hotspotUser) return res.status(404).json({ success: false, message: 'Usuário do hotspot não encontrado.' });
    res.status(200).json({ success: true, data: hotspotUser });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar usuário do hotspot.', error: error.message });
  }
};

const updateHotspotUser = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const hotspotUser = await hotspotUserService.updateHotspotUser(req.params.id, req.body);
    if (!hotspotUser) return res.status(404).json({ success: false, message: 'Usuário do hotspot não encontrado.' });
    res.status(200).json({ success: true, message: 'Usuário do hotspot atualizado com sucesso!', data: hotspotUser });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao atualizar usuário do hotspot.', error: error.message });
  }
};

const deleteHotspotUser = async (req, res) => {
  try {
    const hotspotUser = await hotspotUserService.deleteHotspotUser(req.params.id);
    if (!hotspotUser) return res.status(404).json({ success: false, message: 'Usuário do hotspot não encontrado.' });
    res.status(200).json({ success: true, message: 'Usuário do hotspot deletado com sucesso!' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao deletar usuário do hotspot.', error: error.message });
  }
};

// --- INÍCIO DO NOVO CONTROLLER (AJUSTADO) ---
const updateUserCredits = async (req, res) => {
    try {
        const { id } = req.params;
        const creditData = req.body; // Ex: { "creditsTotal": 5368709120, "creditsUsed": 0 }
        
        // Obter o usuário que está realizando a ação do req.user (do middleware de autenticação)
        const performingUser = req.user; 

        const updatedUser = await hotspotUserService.updateCredits(id, creditData, performingUser);

        res.status(200).json({
            success: true,
            message: 'Créditos do usuário atualizados com sucesso.',
            data: updatedUser
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro ao atualizar créditos do usuário.', error: error.message });
    }
};
// --- FIM DO NOVO CONTROLLER ---

module.exports = { getAllHotspotUsers, createHotspotUser, getHotspotUserById, updateHotspotUser, deleteHotspotUser,updateUserCredits };
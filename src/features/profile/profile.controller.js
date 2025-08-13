// src/features/profile/profile.controller.js
const { validationResult } = require('express-validator');
const profileService = require('./profile.service');

const getAllProfiles = async (req, res) => {
  try {
    const { rows, count } = await profileService.findAllProfiles(req.query);
    const totalPages = Math.ceil(count / (req.query.limit || 10));

    res.status(200).json({
      success: true,
      data: rows,
      meta: { totalItems: count, totalPages, currentPage: parseInt(req.query.page, 10) || 1 },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar perfis.', error: error.message });
  }
};

const createProfile = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  try {
    const profile = await profileService.createProfile(req.body);
    res.status(201).json({ success: true, message: 'Perfil criado com sucesso!', data: profile });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao criar perfil.', error: error.message });
  }
};

const getProfileById = async (req, res) => {
  try {
    const profile = await profileService.findProfileById(req.params.id);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Perfil não encontrado.' });
    }
    res.status(200).json({ success: true, data: profile });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar perfil.', error: error.message });
  }
};

const updateProfile = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
  try {
    const profile = await profileService.updateProfile(req.params.id, req.body);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Perfil não encontrado.' });
    }
    res.status(200).json({ success: true, message: 'Perfil atualizado com sucesso!', data: profile });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao atualizar perfil.', error: error.message });
  }
};

const deleteProfile = async (req, res) => {
  try {
    const profile = await profileService.deleteProfile(req.params.id);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Perfil não encontrado.' });
    }
    res.status(200).json({ success: true, message: 'Perfil deletado com sucesso!' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao deletar perfil.', error: error.message });
  }
};

module.exports = {
    getAllProfiles,
    createProfile,
    getProfileById,
    updateProfile,
    deleteProfile,
};
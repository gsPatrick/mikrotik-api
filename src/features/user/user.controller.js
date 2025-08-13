// src/features/user/user.controller.js
const { validationResult } = require('express-validator');
const userService = require('./user.service');

const getAllUsers = async (req, res) => {
  try {
    const { rows, count } = await userService.findAllUsers(req.query);
    const totalPages = Math.ceil(count / (req.query.limit || 10));
    res.status(200).json({
      success: true,
      data: rows,
      meta: { totalItems: count, totalPages, currentPage: parseInt(req.query.page, 10) || 1 },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar usuários.', error: error.message });
  }
};

const createUser = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const user = await userService.createUser(req.body);
    const { password, ...userWithoutPassword } = user.get({ plain: true });
    res.status(201).json({ success: true, message: 'Usuário criado com sucesso!', data: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao criar usuário.', error: error.message });
  }
};

const getUserById = async (req, res) => {
  try {
    const user = await userService.findUserById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar usuário.', error: error.message });
  }
};

const updateUser = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const user = await userService.updateUser(req.params.id, req.body);
    if (!user) return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
    const { password, ...userWithoutPassword } = user.get({ plain: true });
    res.status(200).json({ success: true, message: 'Usuário atualizado com sucesso!', data: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao atualizar usuário.', error: error.message });
  }
};

const deleteUser = async (req, res) => {
  try {
    const user = await userService.deleteUser(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
    res.status(200).json({ success: true, message: 'Usuário deletado com sucesso!' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao deletar usuário.', error: error.message });
  }
};

module.exports = { getAllUsers, createUser, getUserById, updateUser, deleteUser };
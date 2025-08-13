// src/features/auth/auth.controller.js
const { User } = require('../../models');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '24h', // Token expira em 24 horas
  });
};

const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Verificar se o email e senha foram fornecidos
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Por favor, forneça email e senha.' });
    }

    // 2. Encontrar o usuário pelo email
    const user = await User.findOne({ where: { email } });

    // 3. Se o usuário existir e a senha estiver correta, gerar o token
    if (user && (await bcrypt.compare(password, user.password))) {
      const token = generateToken(user.id);
      const { password, ...userWithoutPassword } = user.get({ plain: true });

      res.status(200).json({
        success: true,
        message: 'Login bem-sucedido!',
        token,
        user: userWithoutPassword,
      });
    } else {
      // 4. Se não, retornar erro de credenciais inválidas
      res.status(401).json({ success: false, message: 'Credenciais inválidas.' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro no servidor durante o login.', error: error.message });
  }
};

module.exports = { login };
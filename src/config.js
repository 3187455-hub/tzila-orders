require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,

  yemot: {
    sharedSecret: process.env.YEMOT_SHARED_SECRET || '',
    apiToken: process.env.YEMOT_API_TOKEN || '',
    tokensFilePath: process.env.YEMOT_TOKENS_FILE_PATH || '',
  },

  nedarimPlus: {
    terminalNumber: process.env.NEDARIM_PLUS_TERMINAL_NUMBER || '',
    apiValid: process.env.NEDARIM_PLUS_API_VALID || '',
    category: process.env.NEDARIM_PLUS_CATEGORY || '',
    apiPassword: process.env.NEDARIM_PLUS_API_PASSWORD || '',
  },

  mail: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    messageNotifyTo: process.env.MESSAGE_EMAIL_TO || '',
  },

  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || '',
  },

  sessionSecret: process.env.SESSION_SECRET || 'insecure-dev-secret',

  appBaseUrl: process.env.APP_BASE_URL || 'https://tzila-orders.onrender.com',

  defaultBedPrice: 50,
};
